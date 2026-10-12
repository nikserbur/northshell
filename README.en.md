<div align="center">

<img src="docs/icon.png" width="128" height="128" alt="Termora icon" />

# Termora

**A modern, MobaXterm-style SSH terminal for macOS** — saved sessions, an SFTP browser with a built-in file editor, and live server monitoring in one beautiful window.

[![macOS](https://img.shields.io/badge/macOS-13%2B-111?logo=apple&logoColor=white)](#-download)
[![Apple Silicon](https://img.shields.io/badge/Apple%20Silicon-arm64-5eead4)](#-download)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[**⬇️ Download DMG**](download/) · [Features](#-features) · [Install](#-install) · [Shortcuts](#-keyboard-shortcuts) · [Build](#-build-from-source) · [Русский](README.md)

<img src="docs/screenshots/main.png" alt="Termora: sessions, SFTP, terminal and monitoring" />

</div>

---

## ✨ Features

**Terminal** — local shell and SSH sessions in draggable tabs; xterm.js with WebGL, truecolor, Unicode 11; find (`⌘F`), clear (`⌘K`), clickable links, copy-on-select and right-click paste; **MultiExec** broadcast input to every connected tab; one-click reconnect.

**Sessions** — folders, colour tags, search and recents; password, private key (with passphrase), ssh-agent and keyboard-interactive / 2FA auth; secrets encrypted with the **macOS Keychain**; one-click **`~/.ssh/config` import**; quick connect with `user@host:port` or `ssh -p 2222 user@host`; startup command per session.

**SFTP & file editor** — breadcrumb navigation, resizable panel; **sort by name, size or date**; instant filter (with `*.log`-style globs) and **recursive server-side search** on `Enter`; built-in **CodeMirror 6 editor** with syntax highlighting for ~20 languages and `⌘S` save straight to the server (with a guard if the file changed remotely); drag-and-drop upload from Finder, downloads with a transfer queue; new file/folder, rename, delete, **chmod**, copy path, multi-select.

**Server monitoring** — a MobaXterm-like status bar (CPU, RAM, disk, network ↓/↑, load, uptime, users) and a monitor drawer (`⇧⌘M`) with CPU/memory/network sparklines, all disks, swap, top processes and OS info. Agentless: stats are read over the same SSH connection from `/proc` (Linux) or `sysctl`/`vm_stat` (macOS).

**UI & themes** — five themes: dark, light, system, **Visual Studio** (VS 2019 Dark look: blue active tab, orange status bar, VS syntax colours) and an old-school **Windows 95** theme (silver bevels, navy title bars, teal desktop, Task-Manager graphs); 8 terminal colour schemes; hover tooltips with shortcuts on every button; **drag-to-resize** sessions and SFTP panels; a 90s pixel-art icon; command palette (`⌘P`); Russian and English UI.

<details>
<summary><b>📸 More screenshots</b></summary>

| Welcome | File editor |
|---|---|
| ![Welcome](docs/screenshots/welcome.png) | ![Editor](docs/screenshots/editor.png) |
| **Server search** | **Light theme** |
| ![Search](docs/screenshots/sftp-search.png) | ![Light](docs/screenshots/light.png) |
| **Visual Studio theme** | **Windows 95 theme** |
| ![Visual Studio](docs/screenshots/theme-vs.png) | ![Windows 95](docs/screenshots/theme-retro.png) |

<sub>Screenshots use a demo project; host and user names are replaced with demo values.</sub>
</details>

## ⬇️ Download

| File | Platform |
|---|---|
| [**download/Termora-1.1.1-arm64.dmg**](download/) | macOS 13+ · Apple Silicon |

The same DMG is attached to the [latest release](../../releases/latest).

## 📦 Install

Open the DMG and drag **Termora** into **Applications**.

### 🔓 Allowing the app in macOS Gatekeeper

The app is not signed with a paid Apple Developer certificate, so on first launch macOS may say the developer *cannot be verified* or that the app *is damaged*. Add an exception in **any** of these ways:

- **Finder:** right-click `Termora.app` → **Open** → **Open** again in the dialog.
- **System Settings → Privacy & Security** → “Termora was blocked” → **Open Anyway**.
- **Terminal, one command:**

```bash
xattr -dr com.apple.quarantine /Applications/Termora.app
```

## ⌨️ Keyboard shortcuts

| Action | Keys |
|---|---|
| New local terminal / SSH session | `⌘T` / `⌘N` |
| Command palette | `⌘P` |
| Close tab or editor | `⌘W` |
| Switch tab | `⌘1…⌘9`, `⌃Tab` |
| Find / clear terminal | `⌘F` / `⌘K` |
| Save file in editor | `⌘S` |
| Toggle sessions / SFTP / monitor | `⌘B` / `⇧⌘F` / `⇧⌘M` |
| Settings | `⌘,` |

## 🔐 Security

- **Host-key verification (TOFU)** with SHA256 fingerprints and a blocking warning when a key changes.
- **Secrets in the Keychain** via Electron `safeStorage`; the UI only ever sees a “saved” flag.
- **Hardened renderer:** context isolation, sandbox, no Node integration, strict CSP, blocked navigation, trusted-sender checks and `zod` validation on every IPC call.
- **Injection-safe remote commands:** the monitor script is static; server search is fed to `sh -s` through stdin with POSIX quoting and a watchdog that stops it after 13 s.
- **Safe SFTP:** server-supplied names are validated, downloads never overwrite files, symlinks are never followed on delete.

App data lives in `~/Library/Application Support/Termora/`.

## 🛠 Build from source

Requirements: macOS, **Node.js 22+**, Xcode Command Line Tools.

```bash
git clone https://github.com/nikserbur/termora.git && cd termora
npm install      # deps + node-pty permission fix
npm run dev      # dev mode with hot reload
npm test         # unit tests (vitest)
npm run build && npm run e2e   # Playwright E2E against the real app
npm run dist     # DMG → dist/Termora-<version>-arm64.dmg
```

**Stack:** Electron 44 · React 19 · TypeScript · xterm.js 6 · ssh2 · node-pty · CodeMirror 6 · zustand · zod · systeminformation · electron-vite · electron-builder · Vitest · Playwright.

## 📄 License

[MIT](LICENSE)
