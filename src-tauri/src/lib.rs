use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Default)]
pub struct AppState {
    pty_sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    is_quitting_confirmed: Arc<Mutex<bool>>,
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

#[cfg(target_os = "windows")]
fn show_close_task_dialog(active_count: usize) -> u32 {
    let title_utf16: Vec<u16> = "프로그램 종료 및 설정 저장\0".encode_utf16().collect();
    let header_utf16: Vec<u16> = "프로그램을 종료합니다.\0".encode_utf16().collect();

    let detail_str = if active_count > 0 {
        format!(
            "현재 {}개의 세션이 구동 중입니다.\n실행 중인 모든 세션도 함께 종료됩니다.\n\n현재 폴더구성을 저장하시겠습니까?\0",
            active_count
        )
    } else {
        "현재 폴더구성을 저장하시겠습니까?\0".to_string()
    };
    let detail_utf16: Vec<u16> = detail_str.encode_utf16().collect();

    let btn1_text: Vec<u16> = "저장 후 종료\0".encode_utf16().collect();
    let btn2_text: Vec<u16> = "저장하지 않고 종료\0".encode_utf16().collect();
    let btn3_text: Vec<u16> = "취소\0".encode_utf16().collect();

    let buttons = [
        TASKDIALOG_BUTTON {
            n_button_id: 100,
            psz_button_text: btn1_text.as_ptr(),
        },
        TASKDIALOG_BUTTON {
            n_button_id: 101,
            psz_button_text: btn2_text.as_ptr(),
        },
        TASKDIALOG_BUTTON {
            n_button_id: 2,
            psz_button_text: btn3_text.as_ptr(),
        },
    ];

    unsafe {
        let mut config: TASKDIALOGCONFIG = std::mem::zeroed();
        config.cb_size = std::mem::size_of::<TASKDIALOGCONFIG>() as u32;
        config.psz_window_title = title_utf16.as_ptr();
        config.psz_main_instruction = header_utf16.as_ptr();
        config.psz_content = detail_utf16.as_ptr();
        config.h_main_icon = 65533 as *const u16; // TD_INFORMATION_ICON
        config.c_buttons = 3;
        config.p_buttons = buttons.as_ptr();
        config.n_default_button = 100;

        let mut button_pressed: i32 = 0;
        let hr = TaskDialogIndirect(
            &config,
            &mut button_pressed,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );

        if hr == 0 {
            if button_pressed == 100 {
                return 0; // 저장 후 종료
            } else if button_pressed == 101 {
                return 1; // 저장하지 않고 종료
            } else {
                return 2; // 취소
            }
        }
    }

    2
}

fn get_standard_appdata_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("C:\\Users\\Default\\AppData\\Roaming"))
        .join("ACPL")
}

fn get_standard_config_path() -> PathBuf {
    get_standard_appdata_dir().join("directory.json")
}

fn read_config_from_path(path: &Path) -> Option<serde_json::Value> {
    if path.exists() {
        if let Ok(bytes) = fs::read(path) {
            let string_data = String::from_utf8_lossy(&bytes);
            let trimmed = string_data.trim();
            if !trimmed.is_empty() {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if parsed.get("folders").and_then(|f| f.as_array()).map_or(false, |a| !a.is_empty()) {
                        return Some(parsed);
                    }
                }
            }
        }
    }
    None
}

fn migrate_legacy_configs() {
    let standard_dir = get_standard_appdata_dir();
    let standard_path = get_standard_config_path();

    if !standard_dir.exists() {
        let _ = fs::create_dir_all(&standard_dir);
    }

    let has_standard_config = standard_path.exists()
        && fs::metadata(&standard_path).map(|m| m.len() > 0).unwrap_or(false);

    if !has_standard_config {
        let mut candidate_paths = Vec::new();

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                candidate_paths.push(parent.join("directory.json"));
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            candidate_paths.push(cwd.join("directory.json"));
        }

        if let Some(roaming_dir) = dirs::data_dir() {
            candidate_paths.push(roaming_dir.join("ACL").join("directory.json"));
            candidate_paths.push(roaming_dir.join("cli_maker").join("directory.json"));
            candidate_paths.push(roaming_dir.join("AI CLI PowerShell Launcher").join("directory.json"));
        }

        for candidate in candidate_paths {
            if candidate != standard_path && candidate.exists() {
                if let Some(parsed) = read_config_from_path(&candidate) {
                    let _ = fs::write(&standard_path, serde_json::to_string_pretty(&parsed).unwrap_or_default());
                    break;
                }
            }
        }
    }
}

#[tauri::command]
fn config_load() -> serde_json::Value {
    migrate_legacy_configs();

    let standard_path = get_standard_config_path();
    if let Some(parsed) = read_config_from_path(&standard_path) {
        return parsed;
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let candidate = parent.join("directory.json");
            if let Some(parsed) = read_config_from_path(&candidate) {
                return parsed;
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("directory.json");
        if let Some(parsed) = read_config_from_path(&candidate) {
            return parsed;
        }
    }

    serde_json::json!({
        "theme": "dark",
        "lang": "ko",
        "folders": [
            { "id": "folder_default", "path": "C:\\", "alias": "", "cli": "claude", "customCommand": "" }
        ]
    })
}

#[tauri::command]
fn config_save(config_data: serde_json::Value) -> ApiResponse {
    let standard_path = get_standard_config_path();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|parent| parent.to_path_buf()));
    let exe_config_path = exe_dir.map(|d| d.join("directory.json"));
    let cwd_config_path = std::env::current_dir().ok().map(|d| d.join("directory.json"));

    let mut success_count = 0;
    let mut last_error = None;

    let save_to_location = |target_path: &Path| -> Result<(), String> {
        let temp_path = target_path.with_extension("json.tmp");
        if let Some(parent) = target_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        let json_string = serde_json::to_string_pretty(&config_data).map_err(|e| e.to_string())?;
        fs::write(&temp_path, json_string.as_bytes()).map_err(|e| e.to_string())?;
        if target_path.exists() {
            let _ = fs::remove_file(target_path);
        }
        fs::rename(&temp_path, target_path).map_err(|e| e.to_string())?;
        Ok(())
    };

    if let Err(e) = save_to_location(&standard_path) {
        last_error = Some(e);
    } else {
        success_count += 1;
    }

    if let Some(exe_path) = exe_config_path {
        if exe_path != standard_path {
            let _ = save_to_location(&exe_path);
        }
    }

    if let Some(cwd_path) = cwd_config_path {
        if cwd_path != standard_path {
            let _ = save_to_location(&cwd_path);
        }
    }

    if success_count > 0 {
        ApiResponse {
            success: true,
            error: None,
            path: Some(standard_path.to_string_lossy().to_string()),
            file_path: None,
        }
    } else {
        ApiResponse {
            success: false,
            error: last_error,
            path: None,
            file_path: None,
        }
    }
}

#[tauri::command]
fn save_export_file(payload: ExportFilePayload) -> ApiResponse {
    let full_path = Path::new(&payload.folder_path).join(&payload.filename);
    if let Some(parent) = full_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    match fs::write(&full_path, &payload.content) {
        Ok(_) => ApiResponse {
            success: true,
            error: None,
            path: None,
            file_path: Some(full_path.to_string_lossy().to_string()),
        },
        Err(err) => ApiResponse {
            success: false,
            error: Some(err.to_string()),
            path: None,
            file_path: None,
        },
    }
}

#[tauri::command]
fn pty_spawn(app: AppHandle, state: State<'_, AppState>, payload: PtySpawnPayload) -> ApiResponse {
    let session_id = payload.session_id.clone();

    // Kill existing session if present
    {
        let mut sessions = state.pty_sessions.lock();
        if let Some(mut existing) = sessions.remove(&session_id) {
            let _ = existing.child.kill();
        }
    }

    let pty_system = native_pty_system();
    let size = PtySize {
        rows: payload.rows.unwrap_or(30),
        cols: payload.cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = match pty_system.openpty(size) {
        Ok(p) => p,
        Err(err) => {
            return ApiResponse {
                success: false,
                error: Some(format!("Failed to open PTY: {}", err)),
                path: None,
                file_path: None,
            }
        }
    };

    let mut cmd = CommandBuilder::new("powershell.exe");
    if let Some(ref cwd) = payload.folder_path {
        if !cwd.trim().is_empty() {
            cmd.cwd(cwd);
        }
    }

    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(err) => {
            return ApiResponse {
                success: false,
                error: Some(format!("Failed to spawn process: {}", err)),
                path: None,
                file_path: None,
            }
        }
    };

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(err) => {
            return ApiResponse {
                success: false,
                error: Some(format!("Failed to clone PTY reader: {}", err)),
                path: None,
                file_path: None,
            }
        }
    };

    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(err) => {
            return ApiResponse {
                success: false,
                error: Some(format!("Failed to take PTY writer: {}", err)),
                path: None,
                file_path: None,
            }
        }
    };

    let pty_session = PtySession {
        writer,
        master: pair.master,
        child,
    };

    state.pty_sessions.lock().insert(session_id.clone(), pty_session);

    // Read loop thread
    let app_handle = app.clone();
    let sid = session_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_handle.emit("pty:data", PtyDataPayload {
                        session_id: sid.clone(),
                        data,
                    });
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit("pty:exit", PtyExitPayload {
            session_id: sid,
            exit_code: 0,
        });
    });

    // Run initial command if provided
    if let Some(command_to_run) = payload.command_to_run {
        if !command_to_run.trim().is_empty() {
            let pty_sessions = state.pty_sessions.clone();
            let sid_cmd = session_id.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let mut sessions = pty_sessions.lock();
                if let Some(session) = sessions.get_mut(&sid_cmd) {
                    let formatted_cmd = format!("{}\r\n", command_to_run.trim());
                    let _ = session.writer.write_all(formatted_cmd.as_bytes());
                    let _ = session.writer.flush();
                }
            });
        }
    }

    ApiResponse {
        success: true,
        error: None,
        path: None,
        file_path: None,
    }
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, payload: PtyWritePayload) {
    let mut sessions = state.pty_sessions.lock();
    if let Some(session) = sessions.get_mut(&payload.session_id) {
        let _ = session.writer.write_all(payload.data.as_bytes());
        let _ = session.writer.flush();
    }
}

#[tauri::command]
fn pty_resize(state: State<'_, AppState>, payload: PtyResizePayload) {
    let mut sessions = state.pty_sessions.lock();
    if let Some(session) = sessions.get_mut(&payload.session_id) {
        let _ = session.master.resize(PtySize {
            rows: payload.rows,
            cols: payload.cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

#[tauri::command]
fn pty_kill(state: State<'_, AppState>, payload: PtyKillPayload) -> ApiResponse {
    let mut sessions = state.pty_sessions.lock();
    if let Some(mut session) = sessions.remove(&payload.session_id) {
        let _ = session.child.kill();
    }
    ApiResponse {
        success: true,
        error: None,
        path: None,
        file_path: None,
    }
}

#[tauri::command]
fn confirm_quit(state: State<'_, AppState>, app: AppHandle) {
    *state.is_quitting_confirmed.lock() = true;

    // Kill all active PTY sessions before exiting
    {
        let mut sessions = state.pty_sessions.lock();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }

    app.exit(0);
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
            confirm_quit
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let is_confirmed = *state.is_quitting_confirmed.lock();

                if !is_confirmed {
                    api.prevent_close();

                    let pty_sessions = state.pty_sessions.lock();
                    let active_count = pty_sessions.len();
                    drop(pty_sessions);

                    let window_handle = window.clone();
                    let app_handle = app.clone();

                    std::thread::spawn(move || {
                        #[cfg(target_os = "windows")]
                        let choice = show_close_task_dialog(active_count);

                        #[cfg(not(target_os = "windows"))]
                        let choice = 0; // default save & quit

                        if choice == 0 {
                            // 0: 저장 후 종료
                            let _ = window_handle.emit("save-before-quit", ());
                        } else if choice == 1 {
                            // 1: 저장하지 않고 종료
                            let state = app_handle.state::<AppState>();
                            *state.is_quitting_confirmed.lock() = true;

                            let mut sessions = state.pty_sessions.lock();
                            for (_, mut session) in sessions.drain() {
                                let _ = session.child.kill();
                            }
                            app_handle.exit(0);
                        } else {
                            // 2: 취소
                        }
                    });
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| match _event {
            RunEvent::Exit => {}
            _ => {}
        });
}
