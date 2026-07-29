const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Strictly force App Name and UserData path to ACPL (Prevents Roaming\ACL from being created)
app.name = 'ACPL';
app.setPath('userData', path.join(app.getPath('appData'), 'ACPL'));

// --- High-Speed Startup & Hardware Optimization Switches ---
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('Failed to load node-pty:', e);
}

let mainWindow;
let isQuittingConfirmed = false;

// Map to hold multiple PTY processes by sessionId
const ptySessions = new Map();

// --- Config Path & Automatic Legacy Migration Engine ---
function getStandardAppDataDir() {
  return path.join(app.getPath('appData'), 'ACPL');
}

function getStandardConfigPath() {
  return path.join(getStandardAppDataDir(), 'directory.json');
}

function getLegacyDirectories() {
  const roamingDir = app.getPath('appData');
  return [
    path.join(roamingDir, 'ACL'),
    path.join(roamingDir, 'cli_maker'),
    path.join(roamingDir, 'AI CLI PowerShell Launcher'),
  ];
}

// Helper function for silent & safe recursive directory removal (skips locked files silently without warnings)
function safeRemoveDirectoryRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        safeRemoveDirectoryRecursive(fullPath);
      } else {
        try {
          fs.unlinkSync(fullPath);
        } catch (e) {
          // Silently ignore individual locked EBUSY files (e.g. Chromium spellchecker bdic)
        }
      }
    }

    // Try removing directory container once files inside are cleaned
    try {
      fs.rmdirSync(dirPath);
    } catch (e) {}
  } catch (e) {}
}

// Automatically migrates legacy config to %APPDATA%\ACPL\directory.json and silently cleans up past legacy folders
function migrateAndCleanUpLegacyConfigs() {
  const standardDir = getStandardAppDataDir();
  const standardPath = getStandardConfigPath();

  if (!fs.existsSync(standardDir)) {
    try {
      fs.mkdirSync(standardDir, { recursive: true });
    } catch (e) {}
  }

  // 1. If standard config does not exist or is empty, pull from legacy candidates
  let hasStandardConfig = fs.existsSync(standardPath) && fs.statSync(standardPath).size > 0;

  if (!hasStandardConfig) {
    const legacyDirs = getLegacyDirectories();
    const candidatePaths = [
      ...legacyDirs.map((d) => path.join(d, 'directory.json')),
      path.join(path.dirname(process.execPath), 'directory.json'),
      path.join(process.cwd(), 'directory.json'),
    ];

    for (const legacyPath of candidatePaths) {
      if (legacyPath !== standardPath && fs.existsSync(legacyPath)) {
        try {
          const rawData = fs.readFileSync(legacyPath, 'utf-8');
          if (rawData && rawData.trim().length > 0) {
            const parsed = JSON.parse(rawData);
            if (parsed && Array.isArray(parsed.folders) && parsed.folders.length > 0) {
              fs.writeFileSync(standardPath, JSON.stringify(parsed, null, 2), 'utf-8');
              hasStandardConfig = true;
              console.log(`[Config Migration] Successfully migrated legacy config to "${standardPath}"`);
              break;
            }
          }
        } catch (err) {
          console.error(`[Config Migration] Error reading from ${legacyPath}:`, err);
        }
      }
    }
  }

  // 2. Once standard config is secured, silently clean up legacy directory.json & folders
  if (hasStandardConfig) {
    const legacyDirs = getLegacyDirectories();
    for (const legacyDir of legacyDirs) {
      if (legacyDir !== standardDir && fs.existsSync(legacyDir)) {
        safeRemoveDirectoryRecursive(legacyDir);
      }
    }
  }
}

function loadConfig() {
  migrateAndCleanUpLegacyConfigs();

  const standardPath = getStandardConfigPath();
  if (fs.existsSync(standardPath)) {
    try {
      const rawData = fs.readFileSync(standardPath, 'utf-8');
      if (rawData && rawData.trim().length > 0) {
        const parsed = JSON.parse(rawData);
        if (parsed && Array.isArray(parsed.folders) && parsed.folders.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.error(`Error reading standard config from ${standardPath}:`, err);
    }
  }

  // Default initial configuration fallback
  return {
    theme: 'dark',
    folders: [
      { id: 'folder_default', path: 'C:\\', alias: '', cli: 'claude', customCommand: '' }
    ]
  };
}

// Atomic Write Implementation to Standard AppData (%APPDATA%\ACPL\directory.json)
function saveConfig(configData) {
  const standardPath = getStandardConfigPath();
  const exeDir = path.dirname(process.execPath);
  const exeConfigPath = path.join(exeDir, 'directory.json');

  let successCount = 0;
  let lastError = null;

  const saveToLocation = (targetPath) => {
    if (!targetPath) return;
    const tempPath = `${targetPath}.tmp`;
    try {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const jsonString = JSON.stringify(configData, null, 2);
      fs.writeFileSync(tempPath, jsonString, 'utf-8');
      fs.renameSync(tempPath, targetPath);
      successCount++;
    } catch (err) {
      lastError = err.message;
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (e) {}
    }
  };

  saveToLocation(standardPath);
  saveToLocation(exeConfigPath);

  if (successCount > 0) {
    return { success: true, path: standardPath };
  } else {
    return { success: false, error: lastError };
  }
}

function createWindow() {
  const appIconPath = path.join(__dirname, 'public', 'acl_icon.png');

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 850,
    minWidth: 980,
    minHeight: 650,
    title: 'ACPL',
    icon: appIconPath,
    show: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // App Close Interception & Safety Warning / Config Save Alert Dialog
  mainWindow.on('close', (e) => {
    if (!isQuittingConfirmed) {
      e.preventDefault();

      const activeCount = ptySessions.size;
      const detailMsg = activeCount > 0
        ? `현재 ${activeCount}개의 세션이 구동 중입니다.\n실행 중인 모든 세션도 함께 종료됩니다.\n\n현재 폴더구성을 저장하시겠습니까?`
        : `현재 폴더구성을 저장하시겠습니까?`;

      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['저장 후 종료', '저장하지 않고 종료', '취소'],
        defaultId: 0,
        cancelId: 2,
        title: '프로그램 종료 및 설정 저장',
        message: '프로그램을 종료합니다.',
        detail: detailMsg,
        noLink: true,
      });

      if (choice === 0) {
        mainWindow.webContents.send('save-before-quit');
      } else if (choice === 1) {
        isQuittingConfirmed = true;
        mainWindow.close();
      }
    }
  });
}

ipcMain.on('confirm-quit', () => {
  isQuittingConfirmed = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  for (const [id, ptyProcess] of ptySessions.entries()) {
    try {
      if (ptyProcess) ptyProcess.kill();
    } catch (e) {}
  }
  ptySessions.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers (Matching preload.js EXACT Channels) ---

// 1. Config Load & Save
ipcMain.handle('config:load', async () => {
  return loadConfig();
});

ipcMain.handle('config:save', async (event, configData) => {
  return saveConfig(configData);
});

// File Save Export (.md / raw text)
ipcMain.handle('save:exportFile', async (event, { folderPath, filename, content }) => {
  try {
    const fullPath = path.join(folderPath, filename);
    fs.writeFileSync(fullPath, content, 'utf-8');
    return { success: true, filePath: fullPath };
  } catch (err) {
    console.error('Error saving export file:', err);
    return { success: false, error: err.message };
  }
});

// 2. Dialog Open Folder
ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// 3. Multi PTY API Handlers
ipcMain.handle('pty:spawn', async (event, { sessionId, folderPath, commandToRun, cols, rows }) => {
  try {
    if (ptySessions.has(sessionId)) {
      const existing = ptySessions.get(sessionId);
      try {
        if (existing.removeAllListeners) {
          existing.removeAllListeners('exit');
          existing.removeAllListeners('data');
        }
        existing.kill();
      } catch (e) {}
      ptySessions.delete(sessionId);
    }

    const shell = 'powershell.exe';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 30,
      cwd: folderPath || process.cwd(),
      env: process.env,
    });

    ptySessions.set(sessionId, ptyProcess);

    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:data', { sessionId, data });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      ptySessions.delete(sessionId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:exit', { sessionId, exitCode });
      }
    });

    if (commandToRun && commandToRun.trim().length > 0) {
      setTimeout(() => {
        if (ptySessions.has(sessionId)) {
          ptyProcess.write(`${commandToRun.trim()}\r\n`);
        }
      }, 500);
    }

    return { success: true };
  } catch (err) {
    console.error(`Failed to spawn PTY for session ${sessionId}:`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pty:kill', async (event, { sessionId }) => {
  const ptyProcess = ptySessions.get(sessionId);
  if (ptyProcess) {
    try {
      if (ptyProcess.removeAllListeners) {
        ptyProcess.removeAllListeners('exit');
        ptyProcess.removeAllListeners('data');
      }
      ptyProcess.kill();
      ptySessions.delete(sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: true };
});

// Listener for pty:write (from ipcRenderer.send)
ipcMain.on('pty:write', (event, { sessionId, data }) => {
  const ptyProcess = ptySessions.get(sessionId);
  if (ptyProcess) {
    try {
      ptyProcess.write(data);
    } catch (err) {
      console.error(`Error writing to pty session ${sessionId}:`, err);
    }
  }
});

// Listener for pty:resize (from ipcRenderer.send)
ipcMain.on('pty:resize', (event, { sessionId, cols, rows }) => {
  const ptyProcess = ptySessions.get(sessionId);
  if (ptyProcess && cols > 0 && rows > 0) {
    try {
      ptyProcess.resize(cols, rows);
    } catch (err) {
      console.error(`Error resizing pty session ${sessionId}:`, err);
    }
  }
});
