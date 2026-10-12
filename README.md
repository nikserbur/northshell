<div align="center">

<img src="docs/icon.png" width="112" height="112" alt="Termora" />

# Termora

A MobaXterm-style SSH client for macOS: saved sessions, an SFTP browser with a built-in editor, and live server monitoring in one window.

[![Release](https://img.shields.io/github/v/release/nikserbur/termora?label=release&color=3d8bff)](https://github.com/nikserbur/termora/releases/latest)
[![Platform](https://img.shields.io/badge/macOS-13%2B%20·%20Apple%20Silicon-555)](#requirements)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[Download](#installation) · [Features](#features) · [Screenshots](#screenshots) · [Getting started](#getting-started) · [Build from source](#building-from-source) · [Русский](README.ru.md)

<img src="docs/screenshots/main.png" alt="Termora main window: sessions, SFTP browser, terminal and server monitor" />

</div>

## Features

**Terminal**
- Local shell and SSH sessions in tabs, powered by xterm.js with GPU rendering, true colour and full Unicode.
- Find in output, clickable links, copy on select and right-click paste (optional).
- Broadcast input to every connected tab (MultiExec), one-click reconnect.
- Optional MobaXterm-style output highlighting (IP addresses, URLs, `error` / `warning` / `ok` keywords) and a session info box on connect.

**Sessions and authentication**
- Saved sessions with folders, colour tags and search; one-click import from `~/.ssh/config`.
- Quick connect with `user@host:port` or `ssh -p 2222 user@host`.
- Password, private key (with passphrase), ssh-agent and keyboard-interactive / 2FA authentication.
- Passwords and passphrases are encrypted with the macOS Keychain and never shown in the UI.
- Host keys are checked on every connection (SHA-256 fingerprints, warning if a key changes).

**SFTP browser and editor**
- File panel next to the terminal with breadcrumbs, sorting by name, size or date, and a resizable width.
- Instant filter for the current folder and recursive search on the server.
- Built-in editor with syntax highlighting for about 20 languages; `⌘S` saves straight to the server and warns if the file changed remotely in the meantime.
- Upload by dragging files from Finder, download queue with progress, new file / folder, rename, delete, permissions (chmod).

**Server monitoring**
- Status bar with CPU, memory, disk, network, load, uptime and users for the active connection.
- Monitor panel (`⇧⌘M`) with CPU, memory and network graphs, all disks, swap and top processes.
- No agent to install: statistics are read over the same SSH connection (Linux and macOS servers).

**Appearance**
- Six themes: Dark, Light, System, Visual Studio, MobaXterm and Windows 95.
- Nine terminal colour schemes, adjustable font, cursor and scrollback; English and Russian UI.

## Screenshots

| Start screen and recent sessions | Remote file editor |
|---|---|
| ![Start screen](docs/screenshots/welcome.png) | ![Editor](docs/screenshots/editor.png) |
| **File actions in the SFTP browser** | **Recursive search on the server** |
| ![SFTP menu](docs/screenshots/sftp-menu.png) | ![Search](docs/screenshots/sftp-search.png) |
| **New session** | **Host key verification** |
| ![New session](docs/screenshots/session-editor.png) | ![Host key](docs/screenshots/hostkey.png) |
| **Command palette** | **Settings** |
| ![Palette](docs/screenshots/palette.png) | ![Settings](docs/screenshots/settings.png) |
| **MobaXterm theme with output highlighting** | **Visual Studio theme** |
| ![MobaXterm theme](docs/screenshots/theme-moba.png) | ![Visual Studio theme](docs/screenshots/theme-vs.png) |
| **Windows 95 theme** | **Light theme** |
| ![Windows 95 theme](docs/screenshots/theme-retro.png) | ![Light theme](docs/screenshots/light.png) |

Screenshots were taken against a demo project; host and user names are placeholders.

## Installation

### Requirements

- macOS 13 Ventura or later
- A Mac with Apple Silicon (M1, M2, M3 or M4)

### Download

| File | Size |
|---|---|
| [download/Termora-1.2.0-arm64.dmg](download/) | ~112 MB |

The same file is attached to the [latest release](https://github.com/nikserbur/termora/releases/latest). To check the download, compare its SHA-256 with [download/SHA256SUMS.txt](download/SHA256SUMS.txt):

```bash
shasum -a 256 ~/Downloads/Termora-1.2.0-arm64.dmg
```

### Install

1. Open the downloaded `Termora-1.2.0-arm64.dmg`.
2. Drag **Termora** onto the **Applications** folder in the window that appears.
3. Eject the disk image (drag it to the Trash or press `⌘E` in Finder).
4. Start Termora from Applications, Launchpad or Spotlight.

<img src="docs/screenshots/install-dmg.png" width="560" alt="Drag Termora into Applications" />

### First launch

Termora is not signed with a paid Apple Developer certificate, so macOS blocks the first launch of the downloaded copy. Allow it once in one of these ways:

- **macOS 15 Sequoia and later:** open Termora, close the warning, then go to **System Settings → Privacy & Security**, scroll down to the message about Termora and click **Open Anyway**. Confirm with your password.
- **macOS 13–14:** in Finder, Control-click (or right-click) Termora in Applications, choose **Open**, then click **Open** in the dialog.
- **Any version, from Terminal:**

  ```bash
  xattr -dr com.apple.quarantine /Applications/Termora.app
  ```

After that the app opens normally.

When you save a password for the first time, macOS asks whether Termora may use its Keychain item **Termora Safe Storage**. Choose **Always Allow**. After installing a new version macOS may ask again.

### Updating

Download the new DMG and drag Termora into Applications again, replacing the old copy. Sessions, settings and known hosts are kept.

### Uninstalling

1. Quit Termora and move it from Applications to the Trash.
2. Remove its data folder: `rm -rf ~/Library/Application\ Support/Termora`
3. Optionally delete **Termora Safe Storage** in Keychain Access.

## Getting started

1. **Connect quickly.** On the start screen type `user@host` (or `ssh -p 2222 user@host`) and press Enter.
2. **Save a session.** Press `⌘N`, enter the host, user and authentication method, then **Save & connect**. Sessions can be grouped into folders.
3. **Import existing hosts.** Click **ssh config** at the bottom of the sidebar to import entries from `~/.ssh/config`.
4. **Confirm the server key.** On the first connection Termora shows the server's fingerprint. Compare it with the one from your hosting provider or from `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server.
5. **Work with files.** Drag files from Finder onto the SFTP panel to upload, double-click a file to edit it, press `⌘S` to save. Type in the filter field and press Enter to search the whole folder tree.
6. **Watch the server.** The status bar shows live statistics; click it or press `⇧⌘M` for the full monitor.
7. **Change the look.** Open **Settings → Appearance** (`⌘,`) to choose a theme and terminal colours.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New local terminal | `⌘T` |
| New SSH session | `⌘N` |
| Command palette | `⌘P` |
| Close tab or editor | `⌘W` |
| Switch tab | `⌘1` … `⌘9`, `⌃Tab`, `⌃⇧Tab` |
| Find in terminal or editor | `⌘F` |
| Clear terminal | `⌘K` |
| Save file in editor | `⌘S` |
| Show / hide sessions, SFTP, monitor | `⌘B`, `⇧⌘F`, `⇧⌘M` |
| Settings | `⌘,` |

## Security

- Host keys are verified on every connection; a changed key blocks the connection until you decide.
- Secrets are encrypted with Electron `safeStorage` (macOS Keychain) and never sent to the interface.
- The interface runs sandboxed with context isolation and a strict Content Security Policy; every request to the main process is validated.
- Remote commands for monitoring and search are fixed scripts with quoted arguments; a server-side search stops on its own after 13 seconds.
- SFTP downloads never overwrite existing files and reject unsafe names; deleting a symlink never touches its target.

App data lives in `~/Library/Application Support/Termora/` (`sessions.json`, `settings.json`, `known_hosts.json`).

## Building from source

Requires macOS, Node.js 22 or later and the Xcode Command Line Tools.

```bash
git clone https://github.com/nikserbur/termora.git
cd termora
npm install
npm run dev      # run with hot reload
npm test         # unit tests
npm run dist     # build the DMG into dist/
```

End-to-end tests drive the built app with Playwright: run `npm run build && npm run e2e`. Set `XMT_E2E_SSH_HOST`, `XMT_E2E_SSH_PORT`, `XMT_E2E_SSH_USER` and `XMT_E2E_SSH_KEY` to include the SSH and SFTP scenarios.

Built with Electron, React, TypeScript, xterm.js, ssh2, node-pty and CodeMirror.

## License

[MIT](LICENSE)
