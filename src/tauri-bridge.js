(function () {
  console.log('[ACPL Bridge] Initializing Tauri v2 API Bridge...');

  const getTauriCore = () => {
    return window.__TAURI__ && window.__TAURI__.core;
  };

  const getTauriEvent = () => {
    return window.__TAURI__ && window.__TAURI__.event;
  };

  window.api = {
    // Config API
    loadConfig: async () => {
      try {
        const core = getTauriCore();
        if (core) {
          const res = await core.invoke('config_load');
          if (res) return res;
        }
      } catch (e) {
        console.error('[ACPL Bridge] loadConfig failed:', e);
      }
      return {
        theme: 'dark',
        lang: 'ko',
        folders: [
          { id: 'folder_default', path: 'C:\\', alias: '', cli: 'claude', customCommand: '' }
        ]
      };
    },

    saveConfig: async (config) => {
      try {
        const core = getTauriCore();
        if (core) {
          return await core.invoke('config_save', { configData: config });
        }
      } catch (e) {
        console.error('[ACPL Bridge] saveConfig failed:', e);
      }
      return { success: false, error: 'Tauri core not available' };
    },

    // File Save Export API
    saveExportFile: async (payload) => {
      try {
        const core = getTauriCore();
        if (core) {
          return await core.invoke('save_export_file', { payload });
        }
      } catch (e) {
        console.error('[ACPL Bridge] saveExportFile failed:', e);
      }
      return { success: false, error: 'Tauri core not available' };
    },

    // Dialog API
    openFolder: async () => {
      try {
        if (window.__TAURI_PLUGIN_DIALOG__ && window.__TAURI_PLUGIN_DIALOG__.open) {
          return await window.__TAURI_PLUGIN_DIALOG__.open({ directory: true, multiple: false });
        } else if (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open) {
          return await window.__TAURI__.dialog.open({ directory: true, multiple: false });
        } else {
          const core = getTauriCore();
          if (core) {
            return await core.invoke('plugin:dialog|open', {
              options: { directory: true, multiple: false }
            });
          }
        }
      } catch (e) {
        console.error('[ACPL Bridge] openFolder failed:', e);
      }
      return null;
    },

    // Multi PTY API
    spawnPty: async (options) => {
      try {
        const core = getTauriCore();
        if (core) {
          return await core.invoke('pty_spawn', { payload: options });
        }
      } catch (e) {
        console.error('[ACPL Bridge] spawnPty failed:', e);
      }
      return { success: false, error: 'Tauri core not available' };
    },

    killPty: async (options) => {
      try {
        const core = getTauriCore();
        if (core) {
          return await core.invoke('pty_kill', { payload: options });
        }
      } catch (e) {
        console.error('[ACPL Bridge] killPty failed:', e);
      }
      return { success: false };
    },

    writePty: (payload) => {
      try {
        const core = getTauriCore();
        if (core) {
          core.invoke('pty_write', { payload });
        }
      } catch (e) {
        console.error('[ACPL Bridge] writePty failed:', e);
      }
    },

    resizePty: (payload) => {
      try {
        const core = getTauriCore();
        if (core) {
          core.invoke('pty_resize', { payload });
        }
      } catch (e) {
        console.error('[ACPL Bridge] resizePty failed:', e);
      }
    },

    // Event Subscriptions
    onPtyData: (callback) => {
      let unlisten = null;
      let isSubscribed = true;
      const setupListener = (retryCount = 0) => {
        if (!isSubscribed) return;
        const evt = getTauriEvent();
        if (evt) {
          evt.listen('pty:data', (event) => {
            if (isSubscribed) callback(event.payload);
          }).then((fn) => { unlisten = fn; });
        } else if (retryCount < 50) {
          setTimeout(() => setupListener(retryCount + 1), 100);
        }
      };
      setupListener();
      return () => {
        isSubscribed = false;
        if (unlisten) unlisten();
      };
    },

    onPtyExit: (callback) => {
      let unlisten = null;
      let isSubscribed = true;
      const setupListener = (retryCount = 0) => {
        if (!isSubscribed) return;
        const evt = getTauriEvent();
        if (evt) {
          evt.listen('pty:exit', (event) => {
            if (isSubscribed) callback(event.payload);
          }).then((fn) => { unlisten = fn; });
        } else if (retryCount < 50) {
          setTimeout(() => setupListener(retryCount + 1), 100);
        }
      };
      setupListener();
      return () => {
        isSubscribed = false;
        if (unlisten) unlisten();
      };
    },

    onSaveBeforeQuit: (callback) => {
      let unlisten = null;
      let isSubscribed = true;
      const setupListener = (retryCount = 0) => {
        if (!isSubscribed) return;
        const evt = getTauriEvent();
        if (evt) {
          evt.listen('save-before-quit', () => {
            if (isSubscribed) callback();
          }).then((fn) => { unlisten = fn; });
        } else if (retryCount < 50) {
          setTimeout(() => setupListener(retryCount + 1), 100);
        }
      };
      setupListener();
      return () => {
        isSubscribed = false;
        if (unlisten) unlisten();
      };
    },

    confirmQuit: () => {
      try {
        const core = getTauriCore();
        if (core) {
          core.invoke('confirm_quit');
        }
      } catch (e) {
        console.error('[ACPL Bridge] confirmQuit failed:', e);
      }
    },
  };
})();
