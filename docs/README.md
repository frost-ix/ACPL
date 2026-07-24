# ACPL (AI CLI PowerShell Launcher)

[Ko](../README.md)

ACPL is a PowerShell-based launcher designed for Windows environments to manage various AI CLI tools—such as Claude Code, Antigravity, and Codex—by project folder and run multi-sessions simultaneously.

It was developed to eliminate the repetitive hassle of navigating between project directories, opening separate terminal windows, and repeatedly entering launch commands, allowing users to switch folder sessions and save conversation logs conveniently within a single interface.

---

## Key Features

- **Folder-based Session Management**: Register project folder paths and aliases, then start specified AI CLI sessions at that location with a single click.
- **Responsive Tab System**: Prominently displays active tabs when multiple sessions are running, and automatically resizes tab areas so initials remain identifiable even in compact states.
- **Automatic Quota Usage Refresh**: Automatically checks current plan quota limits (5-hour limit / weekly limit percentages) upon connecting to a Claude CLI session and displays them in real time on top tab badges.
- **Raw Chat Extraction (.md)**: Instantly save the entire conversation output currently in the terminal buffer as a raw Markdown (.md) file without consuming AI tokens.
- **PDF Report Generation**: Summarize conversation logs into key points and generate PDF documents in a specified folder.
- **Automatic Config Sync & Migration**: Configuration settings (`directory.json`) are safely stored in `%APPDATA%\ACPL` with dual synchronization to the executable path and automatic migration of legacy settings.
- **Safe Session Termination Protection**: Prompts a confirmation dialog when closing the app while sessions are active to prevent unexpected termination.

---

## Prerequisites

- Windows 10 or higher
- Node.js (v18 or higher recommended)
- Global installation and environment variable configuration for used AI CLI tools (e.g., Anthropic Claude Code, Antigravity, Codex)

---

## How to Run & Build

### Development Environment

```bash
# Install dependencies
npm install

# Run application
npm start
```

### Build Executable (.exe)

```bash
# Build portable and directory outputs
npm run build:exe
```

Once the build finishes, packaged executable files will be generated in the `dist/` directory.

---

## Developer Info

- **Author**: frost-ix
- **Inquiries / Feedback**: Please submit via Issues or the Repository.
