use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

// ---------------------------------------------------------------------------
// State & payloads
// ---------------------------------------------------------------------------

struct PtySession {
    writer_tx: Sender<Vec<u8>>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Default)]
pub struct AppState {
    pty_sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    // sessionId -> pid of the running chat (non-interactive CLI) process
    chat_procs: Arc<Mutex<HashMap<String, u32>>>,
    is_quitting_confirmed: Arc<Mutex<bool>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatSendPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "folderPath")]
    pub folder_path: Option<String>,
    pub cli: String,
    pub prompt: String,
    #[serde(rename = "resumeId")]
    pub resume_id: Option<String>,
    #[serde(rename = "permissionMode")]
    pub permission_mode: Option<String>,
    /// `/btw` side question: one-off run on a fork of the conversation, no tools, not saved
    #[serde(default)]
    pub side: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatCancelPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ChatLinePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub line: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ChatExitPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PtySpawnPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "folderPath")]
    pub folder_path: Option<String>,
    #[serde(rename = "commandToRun")]
    pub command_to_run: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PtyDataPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub data: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PtyExitPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PtyWritePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub data: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PtyResizePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PtyKillPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportFilePayload {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    pub filename: String,
    pub content: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ApiResponse {
    pub success: bool,
    pub error: Option<String>,
    pub path: Option<String>,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
}

impl ApiResponse {
    fn ok() -> Self {
        Self { success: true, error: None, path: None, file_path: None }
    }

    fn fail(error: impl Into<String>) -> Self {
        Self { success: false, error: Some(error.into()), path: None, file_path: None }
    }
}

impl From<Result<(), String>> for ApiResponse {
    fn from(result: Result<(), String>) -> Self {
        result.map_or_else(Self::fail, |()| Self::ok())
    }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

fn epoch_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn now_ms() -> u64 {
    epoch_ms(SystemTime::now())
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified().map(epoch_ms).unwrap_or(0)
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// `Some(s)` only when `s` has non-whitespace content (the value itself is not trimmed)
fn non_blank(s: Option<&str>) -> Option<&str> {
    s.filter(|s| !s.trim().is_empty())
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::to_string)
}

/// Every line of a JSONL text that parses as JSON (broken lines are skipped)
fn json_lines(text: &str) -> impl Iterator<Item = Value> + '_ {
    text.lines().filter_map(|line| serde_json::from_str(line).ok())
}

/// The JSON values among the first `max` lines of a file, without reading the whole
/// (possibly huge) transcript
fn head_json(path: &Path, max: usize) -> Vec<Value> {
    fs::File::open(path)
        .map(|f| {
            std::io::BufReader::new(f)
                .lines()
                .take(max)
                .map_while(Result::ok)
                .filter_map(|line| serde_json::from_str(&line).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Lazily walks `dir` (recursing `depth` levels) yielding files whose name satisfies `pred`.
fn walk_files<'a>(dir: &Path, depth: u32, pred: &'a dyn Fn(&str) -> bool) -> Box<dyn Iterator<Item = PathBuf> + 'a> {
    let Ok(entries) = fs::read_dir(dir) else { return Box::new(std::iter::empty()) };
    Box::new(entries.flatten().map(|e| e.path()).flat_map(move |path| -> Box<dyn Iterator<Item = PathBuf> + 'a> {
        if path.is_dir() {
            match depth {
                0 => Box::new(std::iter::empty()),
                _ => walk_files(&path, depth - 1, pred),
            }
        } else if path.file_name().and_then(|n| n.to_str()).is_some_and(pred) {
            Box::new(std::iter::once(path))
        } else {
            Box::new(std::iter::empty())
        }
    }))
}

/// First file under `dir` (depth-first, `depth` levels) whose name satisfies `pred`
fn find_file(dir: &Path, depth: u32, pred: &dyn Fn(&str) -> bool) -> Option<PathBuf> {
    walk_files(dir, depth, pred).next()
}

fn normalize_path(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn ps_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

// ---------------------------------------------------------------------------
// Well-known locations
// ---------------------------------------------------------------------------

const CONFIG_FILE: &str = "directory.json";

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"))
}

fn get_standard_appdata_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("C:\\Users\\Default\\AppData\\Roaming"))
        .join("ACPL")
}

fn get_standard_config_path() -> PathBuf {
    get_standard_appdata_dir().join(CONFIG_FILE)
}

/// `directory.json` next to the executable
fn exe_config_path() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|dir| dir.join(CONFIG_FILE))
}

/// `directory.json` in the working directory
fn cwd_config_path() -> Option<PathBuf> {
    std::env::current_dir().ok().map(|dir| dir.join(CONFIG_FILE))
}

fn claude_projects_dir() -> PathBuf {
    home_dir().join(".claude").join("projects")
}

fn codex_home() -> PathBuf {
    std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home_dir().join(".codex"))
}

fn codex_sessions_dir() -> PathBuf {
    codex_home().join("sessions")
}

fn agy_dir() -> PathBuf {
    home_dir().join(".gemini").join("antigravity-cli")
}

fn agy_conversations_dir() -> PathBuf {
    agy_dir().join("conversations")
}

// ---------------------------------------------------------------------------
// Windows close dialog
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
#[repr(C, packed(4))]
struct TASKDIALOGCONFIG {
    cb_size: u32,
    hwnd_parent: *mut std::ffi::c_void,
    h_instance: *mut std::ffi::c_void,
    dw_flags: u32,
    dw_common_buttons: u32,
    psz_window_title: *const u16,
    h_main_icon: *const u16,
    psz_main_instruction: *const u16,
    psz_content: *const u16,
    c_buttons: u32,
    p_buttons: *const TASKDIALOG_BUTTON,
    n_default_button: i32,
    c_radio_buttons: u32,
    p_radio_buttons: *const std::ffi::c_void,
    n_default_radio_button: i32,
    psz_verification_text: *const u16,
    psz_expanded_information: *const u16,
    psz_expanded_control_text: *const u16,
    psz_collapsed_control_text: *const u16,
    h_footer_icon: *const u16,
    psz_footer: *const u16,
    pf_callback: *const std::ffi::c_void,
    p_callback_data: *mut std::ffi::c_void,
    cx_width: u32,
}

#[cfg(target_os = "windows")]
#[repr(C, packed(4))]
struct TASKDIALOG_BUTTON {
    n_button_id: i32,
    psz_button_text: *const u16,
}

#[cfg(target_os = "windows")]
#[link(name = "comctl32")]
extern "system" {
    fn TaskDialogIndirect(
        pTaskConfig: *const TASKDIALOGCONFIG,
        pnButton: *mut i32,
        pnRadioButton: *mut i32,
        pfVerificationFlagChecked: *mut i32,
    ) -> i32;
}

/// Pressing Alt on its own makes Windows enter the menu loop of the main window (there is no
/// menu bar, so nothing visible happens) and the keyboard focus leaves the page until Esc or a
/// click. The window is subclassed to drop exactly that command; Alt+Space (system menu) and
/// Alt+<key> shortcuts are untouched.
#[cfg(target_os = "windows")]
mod alt_menu_guard {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    type SubclassProc = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;

    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(hwnd: Hwnd, proc_: SubclassProc, id: usize, data: usize) -> i32;
        fn DefSubclassProc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    const WM_SYSCOMMAND: u32 = 0x0112;
    const SC_KEYMENU: usize = 0xF100;
    const SUBCLASS_ID: usize = 0xAC91;

    unsafe extern "system" fn proc_(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize, _id: usize, _data: usize) -> isize {
        // lParam is the key pressed together with Alt; 0 = Alt alone
        if msg == WM_SYSCOMMAND && (wparam & 0xFFF0) == SC_KEYMENU && lparam == 0 {
            return 0;
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// Must run on the thread that owns the window (Tauri's setup hook does).
    pub fn install(hwnd: Hwnd) -> bool {
        unsafe { SetWindowSubclass(hwnd, proc_, SUBCLASS_ID, 0) != 0 }
    }
}

// ---------------------------------------------------------------------------
// System monitor for the status bar: system CPU %, system memory, and the memory of ACPL
// itself plus everything it started (CLI sessions, WebView2 processes).
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, Default)]
pub struct SystemUsage {
    /// System-wide CPU % since the previous call (None on the first call)
    pub cpu: Option<f32>,
    #[serde(rename = "memUsed")]
    pub mem_used: u64,
    #[serde(rename = "memTotal")]
    pub mem_total: u64,
    /// Working set of this process and all of its descendants (bytes)
    #[serde(rename = "appMem")]
    pub app_mem: u64,
}

/// Pure: CPU % between two (idle, total) samples of the system times
fn cpu_percent(prev: (u64, u64), cur: (u64, u64)) -> Option<f32> {
    let idle = cur.0.checked_sub(prev.0)?;
    let total = cur.1.checked_sub(prev.1)?;
    (total > 0).then(|| (100.0 * (total.saturating_sub(idle)) as f64 / total as f64).clamp(0.0, 100.0) as f32)
}

/// Pure: `root` and every process below it, from (pid, parent pid) pairs
fn process_tree(root: u32, pairs: &[(u32, u32)]) -> Vec<u32> {
    let mut tree = vec![root];
    let mut i = 0;
    while i < tree.len() {
        let parent = tree[i];
        tree.extend(pairs.iter().filter(|(pid, ppid)| *ppid == parent && *pid != parent && !tree.contains(pid)).map(|(pid, _)| *pid).collect::<Vec<_>>());
        i += 1;
    }
    tree
}

#[cfg(target_os = "windows")]
mod sysmon {
    use std::ffi::c_void;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[repr(C)]
    struct ProcessEntry32W {
        size: u32,
        usage: u32,
        pid: u32,
        default_heap_id: usize,
        module_id: u32,
        threads: u32,
        parent_pid: u32,
        pri_class_base: i32,
        flags: u32,
        exe_file: [u16; 260],
    }

    #[repr(C)]
    struct ProcessMemoryCounters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged_pool: usize,
        quota_paged_pool: usize,
        quota_peak_nonpaged_pool: usize,
        quota_nonpaged_pool: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> *mut c_void;
        fn Process32FirstW(snapshot: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn K32GetProcessMemoryInfo(process: *mut c_void, counters: *mut ProcessMemoryCounters, cb: u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn GetCurrentProcessId() -> u32;
    }

    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    fn ticks(t: &FileTime) -> u64 {
        ((t.high as u64) << 32) | t.low as u64
    }

    /// (idle, kernel + user) in 100ns ticks; kernel time already contains idle time
    pub fn cpu_times() -> Option<(u64, u64)> {
        let (mut idle, mut kernel, mut user) = (FileTime { low: 0, high: 0 }, FileTime { low: 0, high: 0 }, FileTime { low: 0, high: 0 });
        let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0;
        ok.then(|| (ticks(&idle), ticks(&kernel) + ticks(&user)))
    }

    /// (used, total) physical memory in bytes
    pub fn memory() -> (u64, u64) {
        let mut status: MemoryStatusEx = unsafe { std::mem::zeroed() };
        status.length = std::mem::size_of::<MemoryStatusEx>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return (0, 0);
        }
        (status.total_phys.saturating_sub(status.avail_phys), status.total_phys)
    }

    /// (pid, parent pid) of every running process
    fn process_pairs() -> Vec<(u32, u32)> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot.is_null() || snapshot as isize == -1 {
            return Vec::new();
        }
        let mut entry: ProcessEntry32W = unsafe { std::mem::zeroed() };
        entry.size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut pairs = Vec::new();
        let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while more {
            pairs.push((entry.pid, entry.parent_pid));
            more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe { CloseHandle(snapshot) };
        pairs
    }

    fn working_set(pid: u32) -> u64 {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return 0;
        }
        let mut counters: ProcessMemoryCounters = unsafe { std::mem::zeroed() };
        counters.cb = std::mem::size_of::<ProcessMemoryCounters>() as u32;
        let ok = unsafe { K32GetProcessMemoryInfo(handle, &mut counters, counters.cb) } != 0;
        unsafe { CloseHandle(handle) };
        if ok { counters.working_set as u64 } else { 0 }
    }

    /// Working set of this process and its whole process tree
    pub fn app_memory() -> u64 {
        let root = unsafe { GetCurrentProcessId() };
        super::process_tree(root, &process_pairs()).into_iter().map(working_set).sum()
    }
}

/// Last (idle, total) CPU sample, for the delta of the next call
static CPU_SAMPLE: Mutex<Option<(u64, u64)>> = Mutex::new(None);

// async: the process walk runs off the main thread
#[tauri::command]
async fn system_usage() -> SystemUsage {
    #[cfg(target_os = "windows")]
    {
        let cur = sysmon::cpu_times();
        let prev = std::mem::replace(&mut *CPU_SAMPLE.lock(), cur);
        let (mem_used, mem_total) = sysmon::memory();
        SystemUsage {
            cpu: prev.zip(cur).and_then(|(p, c)| cpu_percent(p, c)),
            mem_used,
            mem_total,
            app_mem: sysmon::app_memory(),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &CPU_SAMPLE;
        SystemUsage::default()
    }
}

/// The page is an app, not a web page: WebView2's browser shortcuts (F5 / Ctrl+R reload,
/// Ctrl+F find, Ctrl+P print, Ctrl +/- zoom, F12 / Ctrl+Shift+I devtools, Alt+Left back, ...)
/// are switched off. Editing keys (Ctrl+C/V/X/A/Z) and the key events the page receives are
/// unaffected, so the terminal still gets Ctrl+R etc.
#[cfg(target_os = "windows")]
fn disable_browser_shortcuts(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let result = window.with_webview(|webview| unsafe {
        let settings = webview
            .controller()
            .CoreWebView2()
            .and_then(|core| core.Settings())
            .and_then(|settings| settings.cast::<ICoreWebView2Settings3>());
        match settings {
            Ok(settings) => {
                if let Err(e) = settings.SetAreBrowserAcceleratorKeysEnabled(false) {
                    eprintln!("[ACPL] could not disable browser shortcuts: {e}");
                }
            }
            Err(e) => eprintln!("[ACPL] WebView2 settings unavailable (runtime too old?): {e}"),
        }
    });
    if let Err(e) = result {
        eprintln!("[ACPL] with_webview failed: {e}");
    }
}

enum CloseChoice {
    SaveAndQuit,
    QuitWithoutSaving,
    Cancel,
}

#[cfg(target_os = "windows")]
fn show_close_task_dialog(active_count: usize) -> CloseChoice {
    const BTN_SAVE: i32 = 100;
    const BTN_NO_SAVE: i32 = 101;
    const BTN_CANCEL: i32 = 2; // IDCANCEL

    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let title = wide("프로그램 종료 및 설정 저장");
    let header = wide("프로그램을 종료합니다.");
    let detail = wide(&if active_count > 0 {
        format!(
            "현재 {}개의 세션이 구동 중입니다.\n실행 중인 모든 세션도 함께 종료됩니다.\n\n현재 폴더구성을 저장하시겠습니까?",
            active_count
        )
    } else {
        "현재 폴더구성을 저장하시겠습니까?".to_string()
    });
    let labels = [(BTN_SAVE, wide("저장 후 종료")), (BTN_NO_SAVE, wide("저장하지 않고 종료")), (BTN_CANCEL, wide("취소"))];
    // `labels` owns the UTF-16 buffers, so it must outlive the dialog call
    let buttons: Vec<TASKDIALOG_BUTTON> = labels
        .iter()
        .map(|(id, text)| TASKDIALOG_BUTTON { n_button_id: *id, psz_button_text: text.as_ptr() })
        .collect();

    let mut pressed: i32 = 0;
    let hr = unsafe {
        let mut config: TASKDIALOGCONFIG = std::mem::zeroed();
        config.cb_size = std::mem::size_of::<TASKDIALOGCONFIG>() as u32;
        config.psz_window_title = title.as_ptr();
        config.psz_main_instruction = header.as_ptr();
        config.psz_content = detail.as_ptr();
        config.h_main_icon = 65533 as *const u16; // TD_INFORMATION_ICON
        config.c_buttons = buttons.len() as u32;
        config.p_buttons = buttons.as_ptr();
        config.n_default_button = BTN_SAVE;
        TaskDialogIndirect(&config, &mut pressed, std::ptr::null_mut(), std::ptr::null_mut())
    };

    match (hr, pressed) {
        (0, BTN_SAVE) => CloseChoice::SaveAndQuit,
        (0, BTN_NO_SAVE) => CloseChoice::QuitWithoutSaving,
        _ => CloseChoice::Cancel,
    }
}

#[cfg(not(target_os = "windows"))]
fn show_close_task_dialog(_active_count: usize) -> CloseChoice {
    CloseChoice::SaveAndQuit // default save & quit
}

// ---------------------------------------------------------------------------
// Config load / save (+ migration of legacy locations)
// ---------------------------------------------------------------------------

/// A config file is only accepted when it has at least one folder
fn read_config_from_path(path: &Path) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    let parsed: Value = serde_json::from_str(String::from_utf8_lossy(&bytes).trim()).ok()?;
    let has_folders = parsed.get("folders").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    has_folders.then_some(parsed)
}

/// `directory.json` next to the executable and in the working directory (when resolvable)
fn local_config_paths() -> impl Iterator<Item = PathBuf> {
    [exe_config_path(), cwd_config_path()].into_iter().flatten()
}

fn migrate_legacy_configs() {
    let standard_path = get_standard_config_path();
    let _ = fs::create_dir_all(get_standard_appdata_dir());

    let has_standard_config = fs::metadata(&standard_path).map(|m| m.len() > 0).unwrap_or(false);
    if has_standard_config {
        return;
    }
    let roaming = dirs::data_dir()
        .map(|dir| ["ACL", "cli_maker", "AI CLI PowerShell Launcher"].map(|app| dir.join(app).join(CONFIG_FILE)));
    let legacy = local_config_paths()
        .chain(roaming.into_iter().flatten())
        .filter(|candidate| *candidate != standard_path)
        .find_map(|candidate| read_config_from_path(&candidate));
    if let Some(parsed) = legacy {
        let _ = fs::write(&standard_path, serde_json::to_string_pretty(&parsed).unwrap_or_default());
    }
}

fn default_config() -> Value {
    json!({
        "theme": "dark",
        "lang": "ko",
        "folders": [
            { "id": "folder_default", "path": "C:\\", "alias": "", "cli": "claude", "customCommand": "" }
        ]
    })
}

#[tauri::command]
fn config_load() -> Value {
    migrate_legacy_configs();
    std::iter::once(get_standard_config_path())
        .chain(local_config_paths())
        .find_map(|path| read_config_from_path(&path))
        .unwrap_or_else(default_config)
}

/// Write via a temp file + rename so a crash never leaves a half-written config
fn write_atomic(target: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp_path = target.with_extension("json.tmp");
    fs::write(&temp_path, contents).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(target);
    fs::rename(&temp_path, target).map_err(|e| e.to_string())
}

#[tauri::command]
fn config_save(config_data: Value) -> ApiResponse {
    let standard_path = get_standard_config_path();
    let saved = serde_json::to_string_pretty(&config_data)
        .map_err(|e| e.to_string())
        .and_then(|json| {
            let result = write_atomic(&standard_path, &json);
            // best-effort mirrors next to the exe / in the working directory
            local_config_paths().filter(|path| *path != standard_path).for_each(|path| {
                let _ = write_atomic(&path, &json);
            });
            result
        });
    match saved {
        Ok(()) => ApiResponse { path: Some(path_string(&standard_path)), ..ApiResponse::ok() },
        Err(e) => ApiResponse::fail(e),
    }
}

#[tauri::command]
fn save_export_file(payload: ExportFilePayload) -> ApiResponse {
    let full_path = Path::new(&payload.folder_path).join(&payload.filename);
    if let Some(parent) = full_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&full_path, &payload.content) {
        Ok(()) => ApiResponse { file_path: Some(path_string(&full_path)), ..ApiResponse::ok() },
        Err(err) => ApiResponse::fail(err.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn hidden_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Kill a process and its whole child tree (powershell -> node -> ...).
fn kill_process_tree(pid: u32) {
    let _ = hidden_command("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

fn kill_pty_session(mut session: PtySession) {
    if let Some(pid) = session.child.process_id() {
        kill_process_tree(pid);
    }
    let _ = session.child.kill();
}

/// Marks the app as quitting and kills every PTY session and chat process
fn shutdown(state: &AppState) {
    *state.is_quitting_confirmed.lock() = true;
    let sessions: Vec<PtySession> = state.pty_sessions.lock().drain().map(|(_, s)| s).collect();
    sessions.into_iter().for_each(kill_pty_session);
    let pids: Vec<u32> = state.chat_procs.lock().drain().map(|(_, pid)| pid).collect();
    pids.into_iter().for_each(kill_process_tree);
}

/// Sessions that count as "running" for the close dialog (the hidden usage probe does not)
fn active_session_count(state: &AppState) -> usize {
    let ptys = state.pty_sessions.lock().keys().filter(|k| !k.starts_with("__usage_probe_")).count();
    ptys + state.chat_procs.lock().len()
}

// ---------------------------------------------------------------------------
// PTY sessions
// ---------------------------------------------------------------------------

fn pty_size(rows: u16, cols: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Decodes the longest decodable prefix of `bytes`. Invalid sequences become U+FFFD; an
/// incomplete multi-byte sequence at the end is left over for the next read.
/// Returns the text and how many bytes were consumed.
fn decode_utf8_prefix(bytes: &[u8]) -> (String, usize) {
    let mut out = String::new();
    let mut consumed = 0usize;
    loop {
        match std::str::from_utf8(&bytes[consumed..]) {
            Ok(s) => {
                out.push_str(s);
                return (out, bytes.len());
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(std::str::from_utf8(&bytes[consumed..consumed + valid]).unwrap_or(""));
                consumed += valid;
                match e.error_len() {
                    Some(len) => {
                        out.push_str(&String::from_utf8_lossy(&bytes[consumed..consumed + len]));
                        consumed += len;
                    }
                    None => return (out, consumed), // incomplete tail; keep for next read
                }
            }
        }
    }
}

/// Opens a PTY running PowerShell. Returns the session and the reader of its output.
fn open_pty_session(payload: &PtySpawnPayload) -> Result<(PtySession, Box<dyn Read + Send>), String> {
    let size = pty_size(payload.rows.unwrap_or(30), payload.cols.unwrap_or(80));
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new("powershell.exe");
    if let Some(cwd) = non_blank(payload.folder_path.as_deref()) {
        cmd.cwd(cwd);
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let (writer_tx, writer_rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(bytes) = writer_rx.recv() {
            if writer.write_all(&bytes).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    Ok((PtySession { writer_tx, master: pair.master, child }, reader))
}

/// Streams PTY output as `pty:data` events until EOF, then emits `pty:exit`.
fn pump_pty_output(mut reader: Box<dyn Read + Send>, app: AppHandle, session_id: String) {
    let mut buffer = [0u8; 4096];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                pending.extend_from_slice(&buffer[..n]);
                let (data, consumed) = decode_utf8_prefix(&pending);
                pending.drain(..consumed);
                if !data.is_empty() {
                    let _ = app.emit("pty:data", PtyDataPayload { session_id: session_id.clone(), data });
                }
            }
        }
    }
    let _ = app.emit("pty:exit", PtyExitPayload { session_id, exit_code: 0 });
}

#[tauri::command]
fn pty_spawn(app: AppHandle, state: State<'_, AppState>, payload: PtySpawnPayload) -> ApiResponse {
    let session_id = payload.session_id.clone();

    // Kill existing session if present
    let existing = state.pty_sessions.lock().remove(&session_id);
    if let Some(session) = existing {
        kill_pty_session(session);
    }

    let (session, reader) = match open_pty_session(&payload) {
        Ok(opened) => opened,
        Err(e) => return ApiResponse::fail(e),
    };
    state.pty_sessions.lock().insert(session_id.clone(), session);

    let sid = session_id.clone();
    std::thread::spawn(move || pump_pty_output(reader, app, sid));

    // Run initial command if provided
    if let Some(command) = non_blank(payload.command_to_run.as_deref()).map(|c| format!("{}\r", c.trim())) {
        let pty_sessions = state.pty_sessions.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Some(session) = pty_sessions.lock().get(&session_id) {
                let _ = session.writer_tx.send(command.into_bytes());
            }
        });
    }

    ApiResponse::ok()
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, payload: PtyWritePayload) {
    if let Some(session) = state.pty_sessions.lock().get(&payload.session_id) {
        let _ = session.writer_tx.send(payload.data.into_bytes());
    }
}

#[tauri::command]
fn pty_resize(state: State<'_, AppState>, payload: PtyResizePayload) {
    if let Some(session) = state.pty_sessions.lock().get(&payload.session_id) {
        let _ = session.master.resize(pty_size(payload.rows, payload.cols));
    }
}

#[tauri::command]
fn pty_kill(state: State<'_, AppState>, payload: PtyKillPayload) -> ApiResponse {
    let session = state.pty_sessions.lock().remove(&payload.session_id);
    if let Some(session) = session {
        kill_pty_session(session);
    }
    ApiResponse::ok()
}

// ---------------------------------------------------------------------------
// Session (conversation) files of the CLIs
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionLookupPayload {
    pub cli: String,
    /// Check that this session id still exists on disk
    pub id: Option<String>,
    /// Discover a new session started in this folder ...
    pub cwd: Option<String>,
    /// ... created after this time (unix ms)
    #[serde(rename = "sinceMs")]
    pub since_ms: Option<u64>,
    /// Ids that must not be returned (e.g. conversations created by the usage probe)
    pub exclude: Option<Vec<String>>,
}

/// `~/.claude/projects/<project>/<id>.jsonl`
fn claude_session_file(id: &str) -> Option<PathBuf> {
    let file = format!("{}.jsonl", id);
    find_file(&claude_projects_dir(), 1, &|n| n == file)
}

/// `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`
fn codex_session_file(id: &str) -> Option<PathBuf> {
    let suffix = format!("-{}.jsonl", id);
    find_file(&codex_sessions_dir(), 4, &|n| n.ends_with(&suffix))
}

/// `~/.gemini/antigravity-cli/conversations/<id>.*`
fn agy_conversation_file(id: &str) -> Option<PathBuf> {
    fs::read_dir(agy_conversations_dir())
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(id))
}

/// Every codex rollout file with its modification time (unix ms)
fn codex_rollouts() -> Vec<(u64, PathBuf)> {
    walk_files(&codex_sessions_dir(), 4, &|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
        .filter_map(|p| Some((modified_ms(&fs::metadata(&p).ok()?), p)))
        .collect()
}

/// `~/.gemini/antigravity-cli/history.jsonl`: one `{display, timestamp, workspace,
/// conversationId}` entry per user prompt, chronological
fn agy_history() -> Vec<Value> {
    fs::read_to_string(agy_dir().join("history.jsonl"))
        .map(|text| json_lines(&text).collect())
        .unwrap_or_default()
}

fn history_ts(v: &Value) -> u64 {
    v["timestamp"].as_u64().unwrap_or(0)
}

fn history_display(v: &Value) -> &str {
    v["display"].as_str().unwrap_or("")
}

fn history_workspace(v: &Value) -> String {
    normalize_path(v["workspace"].as_str().unwrap_or(""))
}

/// Slash commands (e.g. the usage probe's `/usage`) are not real prompts
fn is_slash_prompt(display: &str) -> bool {
    display.trim_start().starts_with('/')
}

/// Finds the codex session that was started in `cwd` after `since_ms` and has at
/// least one real user message (the hidden usage probe never sends one).
fn discover_codex_session(cwd: &str, since_ms: u64) -> Option<String> {
    let want = normalize_path(cwd);
    let mut candidates: Vec<(u64, PathBuf)> = codex_rollouts()
        .into_iter()
        .filter(|(ms, _)| ms + 2000 >= since_ms)
        .collect();
    candidates.sort_by_key(|(ms, _)| std::cmp::Reverse(*ms)); // newest first

    candidates.into_iter().find_map(|(_, path)| {
        let text = fs::read_to_string(&path).ok()?;
        let meta: Value = serde_json::from_str(text.lines().next()?).ok()?;
        let payload = &meta["payload"];
        // A real turn happened (codex only writes the rollout after the first prompt;
        // 0.166 logs `task_started`, older versions `user_message`)
        let has_turn = text.contains("\"task_started\"") || text.contains("\"user_message\"");
        if normalize_path(payload["cwd"].as_str().unwrap_or("")) != want || !has_turn {
            return None;
        }
        let id = payload["id"].as_str().or_else(|| payload["session_id"].as_str())?;
        is_safe_id(id).then(|| id.to_string())
    })
}

/// Antigravity: take the latest real prompt (not a slash command) sent in `cwd` after
/// `since_ms` from `history.jsonl`.
fn discover_agy_conversation(cwd: &str, since_ms: u64, exclude: &[String]) -> Option<String> {
    let want = normalize_path(cwd);
    agy_history()
        .into_iter()
        .rev()
        .take_while(|v| history_ts(v) + 2000 >= since_ms) // history is chronological
        .find_map(|v| {
            let id = v["conversationId"].as_str()?;
            let usable = !is_slash_prompt(history_display(&v))
                && history_workspace(&v) == want
                && is_safe_id(id)
                && !exclude.iter().any(|x| x == id);
            usable.then(|| id.to_string())
        })
}

fn session_exists(cli: &str, id: &str) -> bool {
    match cli {
        "claude" => claude_session_file(id).is_some(),
        "codex" => codex_session_file(id).is_some(),
        "antigravity" => agy_conversation_file(id).is_some(),
        _ => false,
    }
}

/// Session (conversation) persistence helper:
/// - `{cli, id}`  -> `{ exists }` whether the CLI still has that conversation on disk
/// - `{cli, cwd, sinceMs}` -> `{ id }` the conversation started in that folder after the time
// async: runs off the main thread (walks/reads session files on disk)
#[tauri::command]
async fn session_lookup(payload: SessionLookupPayload) -> Value {
    if let Some(id) = payload.id.as_deref() {
        return json!({ "exists": is_safe_id(id) && session_exists(&payload.cli, id) });
    }
    let since = payload.since_ms.unwrap_or(0);
    let exclude = payload.exclude.as_deref().unwrap_or(&[]);
    let id = payload.cwd.as_deref().and_then(|cwd| match payload.cli.as_str() {
        "codex" => discover_codex_session(cwd, since),
        "antigravity" => discover_agy_conversation(cwd, since, exclude),
        _ => None,
    });
    json!({ "id": id })
}

// ---------------------------------------------------------------------------
// Conversation transcripts: the CLIs' own history files, read back for the chat view
// (resume), the chat extract and the PDF report.
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
pub struct TranscriptMessage {
    /// user / assistant / tool
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "isError", skip_serializing_if = "std::ops::Not::not")]
    pub is_error: bool,
    /// tool_use id, so the result can be attached to its call
    #[serde(rename = "toolId", skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<String>,
}

const TOOL_TEXT_MAX: usize = 2000;

impl TranscriptMessage {
    fn new(role: &str, text: String) -> Self {
        Self { role: role.into(), text, name: None, is_error: false, tool_id: None, ts: None }
    }

    /// A tool call; `text` is a short summary of its input
    fn tool_call(text: String, name: Option<String>, tool_id: Option<String>) -> Self {
        Self { name, tool_id, ..Self::new("tool", text) }
    }

    /// The (clipped) output of a tool call
    fn tool_result(text: &str, tool_id: Option<String>, is_error: bool) -> Self {
        Self { tool_id, is_error, ..Self::new("tool_result", clip(text, TOOL_TEXT_MAX)) }
    }

    fn at(self, ts: Option<String>) -> Self {
        Self { ts, ..self }
    }
}

#[derive(Serialize, Debug, Clone, Default)]
pub struct Transcript {
    pub found: bool,
    /// Only part of the conversation could be read (antigravity: user prompts only)
    pub partial: bool,
    pub path: Option<String>,
    pub messages: Vec<TranscriptMessage>,
}

impl Transcript {
    fn from_file(path: &Path, partial: bool, messages: Vec<TranscriptMessage>) -> Self {
        Self { found: true, partial, path: Some(path_string(path)), messages }
    }
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).chain(std::iter::once('…')).collect()
    }
}

fn first_line_clipped(s: &str) -> String {
    clip(s.lines().next().unwrap_or(""), 160)
}

/// Short one-line description of a tool input (path / command / pattern ...)
fn tool_input_summary(input: &Value) -> String {
    const KEYS: [&str; 10] =
        ["file_path", "path", "notebook_path", "command", "cmd", "pattern", "url", "query", "description", "prompt"];
    input
        .as_str()
        .or_else(|| KEYS.iter().find_map(|key| input.get(key).and_then(Value::as_str)))
        .map(first_line_clipped)
        .unwrap_or_else(|| clip(&input.to_string(), 160))
}

fn block_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|c| match c["type"].as_str() {
                Some("text") | Some("input_text") | Some("output_text") => str_field(c, "text"),
                Some(other) => Some(format!("[{}]", other)),
                None => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Text the CLI injected into the user turn (system reminders, environment blocks, ...)
fn is_injected(text: &str) -> bool {
    let t = text.trim();
    t.is_empty()
        || (t.starts_with('<') && t.ends_with('>') && !t.starts_with("<command-name>"))
        || t.starts_with("Caveat: The messages below")
}

/// `<command-name>/compact</command-name><command-args>x</command-args>` -> "/compact x"
fn slash_command_text(text: &str) -> Option<String> {
    let grab = |tag: &str| -> Option<String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let s = text.find(&open)? + open.len();
        let e = text[s..].find(&close)? + s;
        Some(text[s..e].trim().to_string())
    };
    let name = grab("command-name")?;
    let args = grab("command-args").unwrap_or_default();
    Some(if args.is_empty() { name } else { format!("{} {}", name, args) })
}

/// One content block of a claude transcript entry
fn claude_block_message(kind: &str, block: &Value) -> Option<TranscriptMessage> {
    match (kind, block["type"].as_str().unwrap_or("")) {
        ("user", "text") => {
            let t = block["text"].as_str().unwrap_or("");
            slash_command_text(t)
                .or_else(|| (!is_injected(t)).then(|| t.to_string()))
                .map(|t| TranscriptMessage::new("user", t))
        }
        ("user", "tool_result") => Some(TranscriptMessage::tool_result(
            &block_text(&block["content"]),
            str_field(block, "tool_use_id"),
            block["is_error"].as_bool() == Some(true),
        )),
        ("assistant", "text") => block["text"]
            .as_str()
            .filter(|t| !t.trim().is_empty())
            .map(|t| TranscriptMessage::new("assistant", t.to_string())),
        ("assistant", "tool_use") => Some(TranscriptMessage::tool_call(
            tool_input_summary(&block["input"]),
            str_field(block, "name"),
            str_field(block, "id"),
        )),
        _ => None,
    }
}

/// One line of a claude transcript -> its messages
fn claude_line_messages(v: &Value) -> Vec<TranscriptMessage> {
    let kind = v["type"].as_str().unwrap_or("");
    let hidden = ["isSidechain", "isMeta", "isCompactSummary"].iter().any(|k| v[*k].as_bool() == Some(true));
    if (kind != "user" && kind != "assistant") || hidden {
        return Vec::new();
    }
    let single;
    let blocks: &[Value] = match &v["message"]["content"] {
        Value::String(s) => {
            single = [json!({ "type": "text", "text": s })];
            &single
        }
        Value::Array(a) => a,
        _ => return Vec::new(),
    };
    let ts = str_field(v, "timestamp");
    blocks
        .iter()
        .filter_map(|b| claude_block_message(kind, b))
        .map(|m| m.at(ts.clone()))
        .collect()
}

/// One line of a codex rollout -> its message (only `response_item`s are conversation)
fn codex_line_message(v: &Value) -> Option<TranscriptMessage> {
    if v["type"].as_str() != Some("response_item") {
        return None;
    }
    let p = &v["payload"];
    let message = match p["type"].as_str().unwrap_or("") {
        "message" => {
            let role = p["role"].as_str().unwrap_or("");
            let t = block_text(&p["content"]);
            // skip developer / system instructions and injected user context
            let shown = (role == "assistant" || (role == "user" && !is_injected(&t))) && !t.trim().is_empty();
            shown.then(|| TranscriptMessage::new(role, t))?
        }
        "function_call" | "custom_tool_call" | "local_shell_call" => {
            let input = if p["input"].is_null() { &p["arguments"] } else { &p["input"] };
            // `arguments` is a JSON string for function calls
            let parsed = input
                .as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .unwrap_or_else(|| input.clone());
            TranscriptMessage::tool_call(
                tool_input_summary(&parsed),
                str_field(p, "name").or(Some("shell".into())),
                str_field(p, "call_id"),
            )
        }
        "function_call_output" | "custom_tool_call_output" => {
            let o = &p["output"];
            let text = o.as_str().map(str::to_string).unwrap_or_else(|| block_text(o));
            TranscriptMessage::tool_result(&text, str_field(p, "call_id"), false)
        }
        _ => return None,
    };
    Some(message.at(str_field(v, "timestamp")))
}

/// Reads a JSONL transcript and maps each line to messages with `parse_line`
fn read_jsonl_transcript<I>(path: Option<PathBuf>, parse_line: impl Fn(&Value) -> I) -> Transcript
where
    I: IntoIterator<Item = TranscriptMessage>,
{
    let Some(path) = path else { return Transcript::default() };
    let Ok(text) = fs::read_to_string(&path) else { return Transcript::default() };
    let messages = json_lines(&text).flat_map(|v| parse_line(&v)).collect();
    Transcript::from_file(&path, false, messages)
}

/// Antigravity keeps the conversation itself in a binary (compressed protobuf) SQLite file,
/// so only the user prompts can be read - from history.jsonl. Old entries have no
/// conversationId; those are matched by workspace + the conversation file's time span.
fn read_agy_transcript(id: &str, cwd: Option<&str>) -> Transcript {
    let Some(conv) = agy_conversation_file(id) else { return Transcript::default() };
    let span = fs::metadata(&conv).ok().map(|m| {
        let created = m.created().map(epoch_ms).unwrap_or(0);
        (created.saturating_sub(5000), modified_ms(&m) + 5000)
    });
    let want = cwd.map(normalize_path);
    let belongs = |v: &Value| match v["conversationId"].as_str() {
        Some(cid) => cid == id,
        None => {
            let ts = history_ts(v);
            want.as_deref().is_some_and(|w| history_workspace(v) == w)
                && span.is_some_and(|(from, to)| ts >= from && ts <= to)
        }
    };
    let messages = agy_history()
        .iter()
        .filter(|v| {
            let display = history_display(v);
            !is_slash_prompt(display) && !display.trim().is_empty() && belongs(v)
        })
        .map(|v| TranscriptMessage::new("user", history_display(v).to_string()).at(Some(history_ts(v).to_string())))
        .collect();
    Transcript::from_file(&conv, true, messages)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TranscriptRequest {
    pub cli: String,
    pub id: String,
    /// Folder of the conversation (antigravity: matches prompts logged without an id)
    pub cwd: Option<String>,
}

// async: reads (possibly large) transcript files off the main thread
#[tauri::command]
async fn read_transcript(payload: TranscriptRequest) -> Transcript {
    let id = payload.id.as_str();
    if !is_safe_id(id) {
        return Transcript::default();
    }
    match payload.cli.as_str() {
        "claude" => read_jsonl_transcript(claude_session_file(id), claude_line_messages),
        "codex" => read_jsonl_transcript(codex_session_file(id), codex_line_message),
        "antigravity" => read_agy_transcript(id, payload.cwd.as_deref()),
        _ => Transcript::default(),
    }
}

// ---------------------------------------------------------------------------
// Project discovery: folders the user already works in, so they don't have to be added by hand
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscoverPayload {
    /// Root folders whose sub folders (2 levels) are scanned for git repositories
    #[serde(default)]
    pub roots: Vec<String>,
    /// Only CLI conversations newer than this many days (default 60)
    #[serde(rename = "maxAgeDays", default)]
    pub max_age_days: Option<u64>,
}

#[derive(Serialize, Debug, Clone)]
pub struct DiscoveredProject {
    pub path: String,
    /// Where it was found: claude / codex / antigravity / git
    pub sources: Vec<String>,
    #[serde(rename = "lastUsedMs")]
    pub last_used_ms: u64,
}

const DISCOVER_MAX: usize = 200;

/// One sighting of a project folder by a discovery source
#[derive(Debug, Clone)]
struct Hit {
    path: String,
    source: &'static str,
    ms: u64,
}

impl Hit {
    fn new(path: &str, source: &'static str, ms: u64) -> Self {
        Self { path: path.to_string(), source, ms }
    }
}

/// Fold step: merges a hit into the map keyed by normalized path (sources united, newest time kept)
fn add_found(mut found: HashMap<String, DiscoveredProject>, hit: Hit) -> HashMap<String, DiscoveredProject> {
    let path = hit.path.trim().trim_end_matches(['\\', '/']);
    if path.is_empty() {
        return found;
    }
    let entry = found.entry(normalize_path(path)).or_insert_with(|| DiscoveredProject {
        path: path.replace('/', "\\"),
        sources: Vec::new(),
        last_used_ms: 0,
    });
    if !entry.sources.iter().any(|s| s == hit.source) {
        entry.sources.push(hit.source.to_string());
    }
    entry.last_used_ms = entry.last_used_ms.max(hit.ms);
    found
}

fn merge_hits(hits: impl IntoIterator<Item = Hit>) -> HashMap<String, DiscoveredProject> {
    hits.into_iter().fold(HashMap::new(), add_found)
}

/// ~/.claude/projects/<encoded>/<session>.jsonl -> the `cwd` recorded in the newest transcript
fn discover_claude_projects(cutoff: u64) -> Vec<Hit> {
    let Ok(dirs) = fs::read_dir(claude_projects_dir()) else { return Vec::new() };
    dirs.flatten()
        .filter_map(|dir| {
            let (ms, file) = fs::read_dir(dir.path())
                .ok()?
                .flatten()
                .filter(|f| f.path().extension().and_then(|e| e.to_str()) == Some("jsonl"))
                .filter_map(|f| f.metadata().ok().map(|m| (modified_ms(&m), f.path())))
                .max_by_key(|(ms, _)| *ms)
                .filter(|(ms, _)| *ms >= cutoff)?;
            let cwd = head_json(&file, 40).iter().find_map(|v| str_field(v, "cwd"))?;
            Some(Hit::new(&cwd, "claude", ms))
        })
        .collect()
}

/// ~/.codex/sessions/**/rollout-*.jsonl -> first line `payload.cwd`
fn discover_codex_projects(cutoff: u64) -> Vec<Hit> {
    codex_rollouts()
        .into_iter()
        .filter(|(ms, _)| *ms >= cutoff)
        .filter_map(|(ms, path)| {
            let first = head_json(&path, 1);
            Some(Hit::new(first.first()?["payload"]["cwd"].as_str()?, "codex", ms))
        })
        .collect()
}

/// ~/.gemini/antigravity-cli/history.jsonl -> `workspace` of real prompts
fn discover_agy_projects(cutoff: u64) -> Vec<Hit> {
    agy_history()
        .iter()
        .filter(|v| history_ts(v) >= cutoff && !is_slash_prompt(history_display(v)))
        .filter_map(|v| Some(Hit::new(v["workspace"].as_str()?, "antigravity", history_ts(v))))
        .collect()
}

/// `<root>/*` and `<root>/*/*` folders that contain `.git` (not descending into a repo)
fn discover_git_repos(root: &Path, depth: u32) -> Vec<Hit> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let skipped = name.starts_with('.') || name.starts_with('$') || name == "node_modules" || name == "target";
            !skipped && entry.path().is_dir()
        })
        .flat_map(|entry| {
            let path = entry.path();
            let git = path.join(".git");
            if git.exists() {
                // .git/index changes on every commit / stage -> rough "last worked on" time
                let ms = fs::metadata(git.join("index"))
                    .or_else(|_| fs::metadata(&git))
                    .map(|m| modified_ms(&m))
                    .unwrap_or(0);
                vec![Hit::new(&path.to_string_lossy(), "git", ms)]
            } else if depth > 0 {
                discover_git_repos(&path, depth - 1)
            } else {
                Vec::new()
            }
        })
        .collect()
}

// async: walks CLI transcript folders on disk, off the main thread
#[tauri::command]
async fn discover_projects(payload: DiscoverPayload) -> Vec<DiscoveredProject> {
    let days = payload.max_age_days.unwrap_or(60).clamp(1, 3650);
    let cutoff = now_ms().saturating_sub(days * 24 * 60 * 60 * 1000);
    let git_hits = payload
        .roots
        .iter()
        .filter(|r| !r.trim().is_empty())
        .flat_map(|root| discover_git_repos(Path::new(root), 1));
    let found = merge_hits(
        discover_claude_projects(cutoff)
            .into_iter()
            .chain(discover_codex_projects(cutoff))
            .chain(discover_agy_projects(cutoff))
            .chain(git_hits),
    );

    let temp = normalize_path(&std::env::temp_dir().to_string_lossy());
    let home = normalize_path(&home_dir().to_string_lossy());
    let mut list: Vec<DiscoveredProject> = found
        .into_iter()
        // temp folders and the bare home folder are never "projects"
        .filter(|(key, p)| !key.starts_with(&temp) && *key != home && Path::new(&p.path).is_dir())
        .map(|(_, p)| p)
        .collect();
    list.sort_by_key(|p| std::cmp::Reverse(p.last_used_ms));
    list.truncate(DISCOVER_MAX);
    list
}

/// For the "folder is missing" warning on registered folders
#[tauri::command]
async fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_dir()).collect()
}

// ---------------------------------------------------------------------------
// Slash commands for the chat palette
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommandListPayload {
    pub cli: String,
    pub cwd: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct CliCommand {
    pub name: String,
    pub description: String,
    pub source: String,
    /// Prompt body (codex custom prompts are expanded by the app since `codex exec` has no slash commands)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// Returns (frontmatter key/values, body)
fn split_frontmatter(text: &str) -> (HashMap<String, String>, String) {
    let t = text.trim_start_matches('\u{feff}');
    let parts = t
        .strip_prefix("---")
        .and_then(|rest| rest.find("\n---").map(|end| (&rest[..end], &rest[end + 4..])));
    let Some((head, rest)) = parts else { return (HashMap::new(), t.to_string()) };
    let map = head
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().trim_matches('"').trim_matches('\'').to_string()))
        .collect();
    let body = rest.trim_start_matches(|c| c == '-' || c == '\r' || c == '\n');
    (map, body.to_string())
}

fn first_line_summary(body: &str) -> String {
    body.lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(100)
        .collect()
}

/// `<dir>/**/*.md` -> commands; sub folders become `sub:name` (claude convention)
fn scan_md_commands(dir: &Path, prefix: &str, source: &str, with_content: bool, depth: u32) -> Vec<CliCommand> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .map(|entry| entry.path())
        .flat_map(|path| {
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { return Vec::new() };
            if path.is_dir() {
                return match depth {
                    0 => Vec::new(),
                    _ => scan_md_commands(&path, &format!("{}{}:", prefix, stem), source, with_content, depth - 1),
                };
            }
            let is_md = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md"));
            let Some(text) = is_md.then(|| fs::read_to_string(&path).ok()).flatten() else { return Vec::new() };
            let (fm, body) = split_frontmatter(&text);
            vec![CliCommand {
                name: format!("{}{}", prefix, stem),
                description: fm.get("description").cloned().unwrap_or_else(|| first_line_summary(&body)),
                source: source.to_string(),
                content: with_content.then_some(body),
            }]
        })
        .collect()
}

/// `<dir>/<skill>/SKILL.md` -> commands
fn scan_skills(dir: &Path, source: &str) -> Vec<CliCommand> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|entry| {
            let text = fs::read_to_string(entry.path().join("SKILL.md")).ok()?;
            let (fm, _) = split_frontmatter(&text);
            let name = fm
                .get("name")
                .filter(|n| !n.is_empty())
                .cloned()
                .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
            let description = fm.get("description").map(|d| d.chars().take(160).collect()).unwrap_or_default();
            Some(CliCommand { name, description, source: source.to_string(), content: None })
        })
        .collect()
}

#[tauri::command]
async fn list_cli_commands(payload: CommandListPayload) -> Vec<CliCommand> {
    match payload.cli.as_str() {
        "claude" => {
            // project scope first, then the user's own
            let project = payload.cwd.as_deref().map(|p| (Path::new(p).join(".claude"), "project", "project-skill"));
            let user = (home_dir().join(".claude"), "user", "skill");
            project
                .into_iter()
                .chain(std::iter::once(user))
                .flat_map(|(base, commands_source, skills_source)| {
                    scan_md_commands(&base.join("commands"), "", commands_source, false, 2)
                        .into_iter()
                        .chain(scan_skills(&base.join("skills"), skills_source))
                })
                .collect()
        }
        "codex" => scan_md_commands(&codex_home().join("prompts"), "", "prompt", true, 0),
        _ => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Chat (non-interactive CLI processes)
// ---------------------------------------------------------------------------

const CLAUDE_STREAM_JSON: &str = "claude -p --output-format stream-json --verbose --include-partial-messages";

/// Builds the CLI command line (non-interactive JSON streaming mode).
/// Every dynamic part is whitelisted/validated, so nothing user-typed reaches the command line.
fn build_chat_cli_command(payload: &ChatSendPayload) -> Result<String, String> {
    let resume = payload.resume_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if resume.is_some_and(|id| !is_safe_id(id)) {
        return Err("Invalid resume id".into());
    }
    if payload.side && payload.cli != "claude" {
        return Err("/btw is only supported for claude".into());
    }
    let mode = payload.permission_mode.as_deref();

    match payload.cli.as_str() {
        // `/btw` is interactive-only in the CLI, so the app emulates it: the question runs on a
        // throw-away fork of the conversation (`--fork-session` + `--no-session-persistence`)
        // with every tool disabled, so the main session and the working tree stay untouched.
        "claude" if payload.side => Ok(format!(
            "{} --tools= --no-session-persistence{}",
            CLAUDE_STREAM_JSON,
            resume.map(|id| format!(" --resume {} --fork-session", id)).unwrap_or_default()
        )),
        "claude" => {
            let mode = match mode {
                Some(m @ ("default" | "bypassPermissions" | "plan")) => m,
                _ => "acceptEdits",
            };
            Ok(format!(
                "{} --permission-mode {}{}",
                CLAUDE_STREAM_JSON,
                mode,
                resume.map(|id| format!(" --resume {}", id)).unwrap_or_default()
            ))
        }
        "codex" => {
            let sandbox = match mode {
                Some(m @ ("read-only" | "danger-full-access")) => m,
                _ => "workspace-write",
            };
            Ok(format!(
                "codex exec --json --skip-git-repo-check --sandbox {}{} -",
                sandbox,
                resume.map(|id| format!(" resume {}", id)).unwrap_or_default()
            ))
        }
        other => Err(format!("Chat mode is not supported for '{}'", other)),
    }
}

/// Emits every non-empty line of `reader` as `event` (blocks until EOF)
fn emit_lines(reader: impl Read, app: &AppHandle, event: &str, session_id: &str, strip_bom: bool) {
    std::io::BufReader::new(reader)
        .split(b'\n')
        .flatten()
        .map(|raw| {
            let raw = String::from_utf8_lossy(&raw);
            let text = if strip_bom { raw.trim_start_matches('\u{feff}') } else { raw.as_ref() };
            text.trim_end().to_string()
        })
        .filter(|line| !line.is_empty())
        .for_each(|line| {
            let _ = app.emit(event, ChatLinePayload { session_id: session_id.to_string(), line });
        });
}

/// Starts the CLI for one chat turn; output is streamed as `chat:event` / `chat:stderr`,
/// followed by `chat:exit`.
fn start_chat(app: AppHandle, state: &AppState, payload: ChatSendPayload) -> Result<(), String> {
    let session_id = payload.session_id.clone();
    if state.chat_procs.lock().contains_key(&session_id) {
        return Err("A response is already in progress".into());
    }
    let cli_cmd = build_chat_cli_command(&payload)?;

    // Hand the prompt over through a UTF-8 temp file to avoid any quoting / encoding issues.
    let safe_sid: String = session_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    let prompt_path = std::env::temp_dir().join(format!("acpl_chat_{}_{}.txt", safe_sid, now_ms()));
    // A leading BOM (e.g. pasted text) would hide a slash command such as `/clear`
    let prompt = payload.prompt.trim_start_matches('\u{feff}');
    fs::write(&prompt_path, prompt.as_bytes()).map_err(|e| format!("Failed to write prompt file: {}", e))?;

    // Windows PowerShell 5.1: `[Text.Encoding]::UTF8` writes a BOM in front of everything piped
    // into a native program, so the CLI would read "\u{feff}/clear" and not see a command.
    // `$OutputEncoding` (stdin of the CLI) therefore uses UTF-8 without BOM.
    let script = format!(
        "$ErrorActionPreference='Continue'; $utf8 = New-Object System.Text.UTF8Encoding $false; [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8; Get-Content -Raw -Encoding UTF8 -LiteralPath {} | {}",
        ps_single_quote(&prompt_path.to_string_lossy()),
        cli_cmd
    );
    let mut cmd = hidden_command("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(cwd) = non_blank(payload.folder_path.as_deref()) {
        cmd.current_dir(cwd);
    }

    let mut child = cmd.spawn().map_err(|e| {
        let _ = fs::remove_file(&prompt_path);
        format!("Failed to spawn process: {}", e)
    })?;
    let pid = child.id();
    state.chat_procs.lock().insert(session_id.clone(), pid);

    if let Some(stderr) = child.stderr.take() {
        let (app, sid) = (app.clone(), session_id.clone());
        std::thread::spawn(move || emit_lines(stderr, &app, "chat:stderr", &sid, false));
    }

    let stdout = child.stdout.take();
    let chat_procs = state.chat_procs.clone();
    std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            emit_lines(stdout, &app, "chat:event", &session_id, true);
        }
        let exit_code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let _ = fs::remove_file(&prompt_path);
        {
            let mut procs = chat_procs.lock();
            if procs.get(&session_id) == Some(&pid) {
                procs.remove(&session_id);
            }
        }
        let _ = app.emit("chat:exit", ChatExitPayload { session_id, exit_code });
    });

    Ok(())
}

#[tauri::command]
fn chat_send(app: AppHandle, state: State<'_, AppState>, payload: ChatSendPayload) -> ApiResponse {
    start_chat(app, &state, payload).into()
}

#[tauri::command]
fn chat_cancel(state: State<'_, AppState>, payload: ChatCancelPayload) -> ApiResponse {
    let pid = state.chat_procs.lock().get(&payload.session_id).copied();
    if let Some(pid) = pid {
        kill_process_tree(pid);
    }
    ApiResponse::ok()
}

// ---------------------------------------------------------------------------
// Quit
// ---------------------------------------------------------------------------

#[tauri::command]
fn confirm_quit(state: State<'_, AppState>, app: AppHandle) {
    shutdown(&state);
    app.exit(0);
}

fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let app = window.app_handle().clone();
    let state = app.state::<AppState>();
    if *state.is_quitting_confirmed.lock() {
        return;
    }
    api.prevent_close();

    let active_count = active_session_count(&state);
    let window = window.clone();
    std::thread::spawn(move || match show_close_task_dialog(active_count) {
        CloseChoice::SaveAndQuit => {
            // the frontend saves, then calls `confirm_quit`
            let _ = window.emit("save-before-quit", ());
        }
        CloseChoice::QuitWithoutSaving => {
            shutdown(&app.state::<AppState>());
            app.exit(0);
        }
        CloseChoice::Cancel => {}
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            config_load,
            config_save,
            save_export_file,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            chat_send,
            chat_cancel,
            session_lookup,
            discover_projects,
            paths_exist,
            read_transcript,
            system_usage,
            list_cli_commands,
            confirm_quit
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(main) = app.get_webview_window("main") {
                if let Ok(hwnd) = main.hwnd() {
                    if !alt_menu_guard::install(hwnd.0 as _) {
                        eprintln!("[ACPL] Alt menu guard could not be installed");
                    }
                }
                disable_browser_shortcuts(&main);
            }
            #[cfg(not(target_os = "windows"))]
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                on_close_requested(window, api);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {});
}

#[cfg(test)]
mod unit_tests;
