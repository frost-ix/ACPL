# ACPL (AI CLI PowerShell Launcher)

[Ko](../README.md)

ACPL is a lightweight and high-performance desktop interface built on **Tauri v2 (Rust Engine)** designed for Windows environments to manage various AI CLI tools—such as Claude Code, Antigravity, and Codex—by project folder and run multi-sessions simultaneously.

With the engine fully migrated from Electron to **Tauri v2**, startup performance has drastically increased, while memory usage (~20MB) and binary size (~9MB) have been reduced by over 90%.

---

## ⚡ Key Features & Performance

- **Lightweight & High-Performance Engine**: Tauri v2 & Rust backend cuts memory footprint by ~90% and provides instant startup (<0.2s).
- **Folder-based Session Management**: Register project folder paths and aliases, then start specified AI CLI sessions with a single click.
- **Responsive Tab System**: Prominently displays active tabs when multiple sessions are running, keeping initials recognizable even in compact views.
- **Automatic Quota Usage Refresh**: Automatically checks current plan quota limits (5-hour limit / weekly limit percentages) upon connecting to a Claude CLI session and displays them on tab badges.
- **Raw Chat Extraction (.md)**: Instantly save terminal buffer outputs as raw Markdown (.md) files without consuming AI tokens.
- **PDF Report Generation**: Summarize conversation logs into key points and generate PDF documents in a specified folder.
- **Automatic Config Sync & Dual Preservation**: Configuration settings (`directory.json`) are safely stored in `%APPDATA%\ACPL` with dual synchronization to the executable path.
- **Safe Session Termination Protection**: Prompts the native Windows TaskDialog confirmation dialog (`[Save & Exit]`, `[Exit Without Saving]`, `[Cancel]`) when closing the app while sessions are active.

---

## 🛠️ Prerequisites

- Windows 10 or higher (64-bit)
- Node.js (v18 or higher recommended)
- Rust toolchain (`rustup`, `cargo`)
- Global installation and environment variable configuration for used AI CLI tools (e.g., Anthropic Claude Code, Antigravity, Codex)

---

## 🚀 How to Run & Build

### Development Environment

```bash
# Install dependencies
npm install

# Run Tauri v2 development server
npm start
# or
npm run tauri:dev
```

### Build Executable (.exe & Setup Installer)

```bash
# Build production bundle
npm run tauri:build
```

Once the build finishes, binaries will be generated at:
- **Standalone Executable**: `src-tauri/target/release/acpl.exe` (~9MB)
- **Setup Installer (.exe)**: `src-tauri/target/release/bundle/nsis/ACPL_1.0.2_x64-setup.exe` (~2MB)
- **MSI Package**: `src-tauri/target/release/bundle/msi/ACPL_1.0.2_x64_en-US.msi`

---

## 👨‍💻 Developer Info

- **Author**: frost-ix
- **GitHub**: https://github.com/frost-ix
- **Inquiries / Feedback**: Please submit via Issues or the Repository.
