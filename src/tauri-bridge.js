(function () {
  console.log('[ACPL Bridge] Initializing Tauri v2 API Bridge...');

  const getTauriCore = () => window.__TAURI__ && window.__TAURI__.core;
  const getTauriEvent = () => window.__TAURI__ && window.__TAURI__.event;
  const logError = (name) => (e) => console.error(`[ACPL Bridge] ${name} failed:`, e);

  const NO_CORE = Object.freeze({ success: false, error: 'Tauri core not available' });
  const FAILED = Object.freeze({ success: false });
  const DEFAULT_CONFIG = Object.freeze({
    theme: 'dark',
    lang: 'ko',
    folders: [{ id: 'folder_default', path: 'C:\\', alias: '', cli: 'claude', customCommand: '' }],
  });

  // Backend command with a fallback value when Tauri is missing or the command throws.
  // `fallback` may be a function of the error.
  const invoke = async (name, cmd, args, fallback) => {
    const core = getTauriCore();
    if (!core) return typeof fallback === 'function' ? fallback(null) : fallback;
    try {
      return await core.invoke(cmd, args);
    } catch (e) {
      logError(name)(e);
      return typeof fallback === 'function' ? fallback(e) : fallback;
    }
  };

  // `{ payload }` commands (most of them)
  const withPayload = (name, cmd, fallback) => (payload) => invoke(name, cmd, { payload }, fallback);

  // Fire-and-forget command
  const fire = (name, cmd, args) => {
    const core = getTauriCore();
    if (core) core.invoke(cmd, args).catch(logError(name));
  };

  // Subscribe to a Tauri event, retrying until the event API is injected.
  const listenEvent = (name, callback) => {
    let unlisten = null;
    let isSubscribed = true;
    const setupListener = (retryCount = 0) => {
      if (!isSubscribed) return;
      const evt = getTauriEvent();
      if (evt) {
        evt.listen(name, (event) => { if (isSubscribed) callback(event.payload); }).then((fn) => { unlisten = fn; });
      } else if (retryCount < 50) {
        setTimeout(() => setupListener(retryCount + 1), 100);
      }
    };
    setupListener();
    return () => {
      isSubscribed = false;
      if (unlisten) unlisten();
    };
  };

  // Keystrokes are coalesced per session (one invoke per microtask) and sent in order.
  const writeStates = new Map(); // sessionId -> { buffer, scheduled, chain }
  const writePty = (payload) => {
    const sessionId = payload && payload.sessionId;
    if (!sessionId || typeof payload.data !== 'string') return;
    const st = writeStates.get(sessionId) || { buffer: '', scheduled: false, chain: Promise.resolve() };
    writeStates.set(sessionId, st);
    st.buffer += payload.data;
    if (st.scheduled) return;
    st.scheduled = true;
    queueMicrotask(() => {
      st.scheduled = false;
      const data = st.buffer;
      st.buffer = '';
      if (!data) return;
      st.chain = st.chain
        .then(() => {
          const core = getTauriCore();
          return core && core.invoke('pty_write', { payload: { sessionId, data } });
        })
        .catch(logError('writePty'));
    });
  };

  const DIALOG_OPTIONS = { directory: true, multiple: false };
  const openFolder = async () => {
    try {
      const plugin = window.__TAURI_PLUGIN_DIALOG__ || (window.__TAURI__ && window.__TAURI__.dialog);
      if (plugin && plugin.open) return await plugin.open(DIALOG_OPTIONS);
    } catch (e) {
      logError('openFolder')(e);
      return null;
    }
    return invoke('openFolder', 'plugin:dialog|open', { options: DIALOG_OPTIONS }, null);
  };

  const listener = (event) => (callback) => listenEvent(event, (p) => callback(p));

  window.api = {
    // Config
    loadConfig: async () => (await invoke('loadConfig', 'config_load', undefined, null)) || DEFAULT_CONFIG,
    saveConfig: (config) => invoke('saveConfig', 'config_save', { configData: config }, NO_CORE),
    saveExportFile: withPayload('saveExportFile', 'save_export_file', NO_CORE),

    // Dialog
    openFolder,

    // PTY
    spawnPty: withPayload('spawnPty', 'pty_spawn', NO_CORE),
    killPty: withPayload('killPty', 'pty_kill', FAILED),
    writePty,
    resizePty: (payload) => fire('resizePty', 'pty_resize', { payload }),

    // Chat (non-interactive CLI)
    chatSend: withPayload('chatSend', 'chat_send', (e) => (e ? { success: false, error: String(e) } : NO_CORE)),
    chatCancel: withPayload('chatCancel', 'chat_cancel', FAILED),

    // Conversation persistence: { cli, id } -> { exists } / { cli, cwd, sinceMs } -> { id }
    sessionLookup: withPayload('sessionLookup', 'session_lookup', Object.freeze({})),
    // Projects found in CLI transcripts / root folders: { roots, maxAgeDays } -> [{ path, sources, lastUsedMs }]
    discoverProjects: withPayload('discoverProjects', 'discover_projects', Object.freeze([])),
    // CLI history file of a conversation: { cli, id, cwd } -> { found, partial, path, messages }
    readTranscript: withPayload('readTranscript', 'read_transcript', Object.freeze({ found: false, messages: [] })),
    // [path] -> [bool] (folder still exists)
    pathsExist: (paths) => invoke('pathsExist', 'paths_exist', { paths }, null),
    // Browser panels (child webviews next to a session). rect: CSS px of the page.
    browserOpen: (payload) => invoke('browserOpen', 'browser_open', { payload }, null),
    browserBounds: (slot, rect) => invoke('browserBounds', 'browser_bounds', { slot, rect }, null),
    browserVisible: (visible) => invoke('browserVisible', 'browser_visible', { visible }, null),
    browserNavigate: (slot, url) => invoke('browserNavigate', 'browser_navigate', { slot, url }, null),
    browserHistory: (slot, action) => invoke('browserHistory', 'browser_history', { slot, action }, null),
    browserClose: (slot) => invoke('browserClose', 'browser_close', { slot }, null),
    // Extra CLI arguments (Playwright MCP) for a terminal launch with a browser panel
    browserLaunchArgs: (cli, slot) => invoke('browserLaunchArgs', 'browser_launch_args', { cli, slot }, ''),
    onBrowserNavigated: listener('browser:navigated'),

    // Chat image attachments: stored in the app's attachments folder, path returned
    saveAttachment: (name, data) => invoke('saveAttachment', 'save_attachment', { payload: { name, data } }, null),
    importAttachment: (path) => invoke('importAttachment', 'import_attachment', { path }, null),
    attachmentPreview: (path) => invoke('attachmentPreview', 'attachment_preview', { path }, null),
    openImages: async () => {
      const options = { multiple: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] };
      try {
        const plugin = window.__TAURI_PLUGIN_DIALOG__ || (window.__TAURI__ && window.__TAURI__.dialog);
        const picked = plugin && plugin.open
          ? await plugin.open(options)
          : await invoke('openImages', 'plugin:dialog|open', { options }, null);
        if (!picked) return [];
        return Array.isArray(picked) ? picked : [picked];
      } catch (e) {
        logError('openImages')(e);
        return [];
      }
    },
    // Files dragged from Explorer onto the window: { paths, position } (physical px)
    onFileDrop: listener('tauri://drag-drop'),
    onFileDragOver: listener('tauri://drag-over'),
    onFileDragLeave: listener('tauri://drag-leave'),

    // Status bar monitor: { cpu: % | null, memUsed, memTotal, appMem } (bytes)
    systemUsage: () => invoke('systemUsage', 'system_usage', undefined, null),
    // Slash commands for the chat palette: [{ name, description, source, content? }]
    listCliCommands: withPayload('listCliCommands', 'list_cli_commands', Object.freeze([])),

    // Event subscriptions
    onPtyData: listener('pty:data'),
    onPtyExit: listener('pty:exit'),
    onChatEvent: listener('chat:event'),
    onChatStderr: listener('chat:stderr'),
    onChatExit: listener('chat:exit'),
    onSaveBeforeQuit: (callback) => listenEvent('save-before-quit', () => callback()),

    confirmQuit: () => fire('confirmQuit', 'confirm_quit'),
  };
})();
