<div align="center">

<img src="docs/icon.png" width="112" height="112" alt="Northshell" />

# Northshell

A free, open-source MobaXterm alternative for macOS: an SSH client and terminal with an SFTP file browser, a built-in remote file editor and live server monitoring in one window.

[![Release](https://img.shields.io/github/v/release/nikserbur/northshell?label=release&color=3d8bff)](https://github.com/nikserbur/northshell/releases/latest)
[![Platform](https://img.shields.io/badge/macOS-13%2B%20·%20Apple%20Silicon-555)](#installation)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**[Installation](#installation)** · [Features](#features) · [Screenshots](#screenshots) · [Getting started](#getting-started) · [Version history](#version-history) · [Build from source](#building-from-source) · [Русский](README.ru.md)

<img src="docs/screenshots/main.png" alt="Northshell main window: sessions, SFTP browser, terminal, command library and server monitor" />

</div>

## Why Northshell

MobaXterm is a popular all-in-one SSH tool, but it only runs on Windows. Northshell brings the same workflow to the Mac: open a saved session, and the remote files appear in a panel next to the terminal while a status bar shows how the server is doing. Edit a config file in place, drag a backup to Finder, check disk usage, all without switching apps or installing anything on the server.

## Features

**Terminal**
- Local shell and SSH sessions in tabs, powered by xterm.js with GPU rendering, true colour and full Unicode.
- Find in output, clickable links, copy on select and right-click paste (optional).
- Broadcast input to every connected tab (MultiExec), one-click reconnect.
- Edit the command line like text: `⌘A` selects the command you are typing, `⌫` deletes it and typing replaces it (`⌘A` again selects all output); a part selected with the mouse is deleted or replaced the same way. `Ctrl+A` still jumps to the line start.
- Optional MobaXterm-style output highlighting (IP addresses, URLs, `error` / `warning` / `ok` keywords) and a session info box on connect.

**Sessions and authentication**
- Saved sessions with folders, colour tags and search; one-click import from `~/.ssh/config`.
- Quick connect with `user@host:port` or `ssh -p 2222 user@host`.
- Password, private key (with passphrase), ssh-agent and keyboard-interactive / 2FA authentication.
- Passwords and passphrases are encrypted with the macOS Keychain and never shown in the UI.
- Host keys are checked on every connection (SHA-256 fingerprints, warning if a key changes).

**Command library**
- Save frequent commands once and run them with a double-click from the side panel (`⇧⌘L`) or from the command palette (`⌘P`).
- Commands are **shared** (every connection) or **private** to one connection; *Run* presses Enter, *Insert* only types the command.
- Placeholders: `{{id}}` or `{{limit:20}}` ask for a value before the command runs.
- Stored in a plain `commands.json` you can edit by hand — changes appear in the app immediately; import and export to share a library between Macs or with your team.

**HTTP client (like Postman and Insomnia, on top of curl)**
- A connection type for APIs with no SSH at all: a request workspace that fills the window (`⇧⌘R` shows or hides it, one button puts the terminal back beside it). The terminal stays ready for hand-written `curl`: `$BASE_URL` and `$TOKEN` (token kept in the Keychain) are set, and your default headers are added to every `curl`.
- **Requests:** query parameters, headers and form fields as tables with an on/off switch per row (or as plain text); **auth** — Bearer, Basic, API key in a header or the query; **body** — JSON, XML, text, urlencoded form, multipart form with files, a whole file, GraphQL with variables; a timeout, `-k` and redirects per request.
- **Responses:** status, time and size, formatted body with folding and search (`⌘F`), raw view, preview of HTML (without scripts or external resources) and images, headers, cookies, a time breakdown (DNS, connect, TLS, waiting, download), curl's full log with credentials masked. Save the whole response to a file, whatever its size.
- **Collections and history:** folders of saved requests (`⌘S`), kept per environment or shared; history you can search. Import **Postman** v2 and **Insomnia** collections, export to Postman.
- **Variables:** `{{name}}` in any field, stored per environment, plus `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`. A value from a response can go into a variable — log in once, and the next requests use the token.
- **Checks and runs:** status, time, size, header and JSON-path checks for each request, no scripting needed; run a whole folder in order and get a report.
- **Cookies** are kept per environment like in a browser, and you can view and delete them. **Code** for curl, JavaScript fetch, Python requests and HTTPie; paste a curl command (e.g. “Copy as cURL” from dev tools) into the address field and the form fills itself.
- The environment's headers and token go only to its own host; other hosts and redirects to them don't get them.

**SFTP browser and editor**
- File panel next to the terminal with breadcrumbs, sorting by name, size or date, and a resizable width.
- The panel follows `cd` in the terminal of the same connection (toggle in the path bar); the terminal button there runs `cd` to the folder you are browsing. Nothing is typed into your shell to make this work.
- Instant filter for the current folder and recursive search on the server.
- Built-in editor with syntax highlighting for about 20 languages; `⌘S` saves straight to the server and warns if the file changed remotely in the meantime.
- Upload by dragging files from Finder, download queue with progress, new file / folder, rename, delete, permissions (chmod).

**Server monitoring**
- Status bar with CPU, memory, video memory (GPU), disk, network, load, uptime and users for the active connection.
- Monitor panel (`⇧⌘M`) with CPU, memory, video memory, network and **disk read/write speed** graphs, all disks and swap.
- **Who is loading the host:** top users by CPU, RAM, disk or network right in the panel, and a user picker that shows that user's share on every card and their processes.
- **Enlarge** (the ⤢ button) for an htop-like view: every process with sorting by any column, search, a process tree and the full command line; a table of users; and a disk page with the speed per device, who is reading and writing now, and **who takes up the space** on each volume.
- Disk speed comes from kernel counters on every update (every 3 seconds by default), so short bursts aren't lost and it costs next to nothing. Details per process are collected only while the panel is open.
- Space per user needs a walk over the files, so it runs when you press the button, at the lowest CPU and disk priority, and the result is kept with its time.
- What's visible depends on the server: on Linux, reads and writes of other users' processes are visible to root only (the kernel's rule), so connect as root to see everyone; traffic per user is counted from TCP connections (`ss`), so UDP isn't in it; macOS has no per-process disk counters, so only its total speed shows.
- Mac memory is counted like Activity Monitor's “Memory Used” (app + wired + compressed), the same for this Mac and for macOS servers.
- Video memory: NVIDIA (`nvidia-smi`) and AMD (`amdgpu`) on Linux, and Mac GPUs. Apple Silicon shares memory with the CPU, so the GPU's share is macOS's estimate (⅔ of RAM up to 36 GB, ¾ above, or `iogpu.wired_limit_mb`), marked with “≈”.
- No agent to install: statistics are read over the same SSH connection (Linux and macOS servers).

**Appearance**
- Six themes: Dark, Light, System, Visual Studio, MobaXterm and Windows 95.
- Nine terminal colour schemes, adjustable font, cursor and scrollback; English and Russian UI.

## Installation

You need macOS 13 Ventura or later and a Mac with Apple Silicon (M1, M2, M3 or M4).

### One command

Open Terminal (`⌘Space`, type “Terminal”), paste this and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/nikserbur/northshell/main/scripts/install.sh | bash
```

It downloads the latest version, checks its SHA-256, puts Northshell into Applications and starts it. macOS doesn't block the app, because that warning only applies to files downloaded through a browser. You can [read the script](scripts/install.sh) first.

### With the DMG

1. Download `Northshell-<version>-arm64.dmg` (about 112 MB) from the **Assets** list of the [latest release](https://github.com/nikserbur/northshell/releases/latest).
2. Open it and drag **Northshell** onto the **Applications** folder.
3. Eject the disk image, then allow the [first launch](#first-launch).

<img src="docs/screenshots/install-dmg.png" width="560" alt="Drag Northshell into Applications" />

To check the download, compare its SHA-256 with [SHA256SUMS.txt](https://github.com/nikserbur/northshell/releases/latest/download/SHA256SUMS.txt) from the same release:

```bash
shasum -a 256 ~/Downloads/Northshell-*-arm64.dmg
```

### First launch

Northshell isn't signed with a paid Apple Developer certificate, so macOS blocks a copy downloaded through a browser. This is the command that lifts the block; you only need it once:

```bash
xattr -dr com.apple.quarantine /Applications/Northshell.app
```

Without Terminal:

- **macOS 15 Sequoia and later:** open Northshell, close the warning, then go to **System Settings → Privacy & Security**, scroll down to the message about Northshell and click **Open Anyway**. Confirm with your password.
- **macOS 13–14:** in Finder, Control-click (or right-click) Northshell in Applications, choose **Open**, then click **Open** in the dialog.

When you save a password for the first time, macOS asks whether Northshell may use its Keychain item **Northshell Safe Storage**. Choose **Always Allow**. After installing a new version macOS may ask again.

### Updating

From 1.6.1 on, updates need no Terminal. Northshell tells you when a new version is out, and **Update and restart** downloads it, checks its SHA-256, replaces the app and starts the new version. Sessions and settings are kept, and it asks first if tabs are open.

It checks at launch and once a day, talking only to github.com; you can turn this off in **Settings → About**. To get to 1.6.1 from an older version, run the [one command](#one-command) once.

### Uninstalling

1. Quit Northshell and move it from Applications to the Trash.
2. Remove its data folder: `rm -rf ~/Library/Application\ Support/Northshell`
3. Optionally delete **Northshell Safe Storage** in Keychain Access.

## Screenshots

| HTTP workspace: collections, request and response | Variables and where the time went |
|---|---|
| ![HTTP workspace: collections, request and response](docs/screenshots/http-workspace.png) | ![Variables and where the time went](docs/screenshots/http-timing.png) |
| **Monitor: who is loading the server** | **Disks: who reads, writes and takes up the space** |
| ![Monitor: who is loading the server](docs/screenshots/monitor-users.png) | ![Disks: who reads, writes and takes up the space](docs/screenshots/monitor-disks.png) |
| **All processes, sorted like in htop** | **GPU memory next to CPU and RAM** |
| ![All processes, sorted like in htop](docs/screenshots/monitor-processes.png) | ![GPU memory next to CPU and RAM](docs/screenshots/monitor-gpu.png) |
| **Request panel beside the terminal** | **New HTTP environment** |
| ![Request panel beside the terminal](docs/screenshots/http-request.png) | ![New HTTP environment](docs/screenshots/http-environment.png) |
| **Command library** | **Start screen and recent sessions** |
| ![Command library](docs/screenshots/command-library.png) | ![Start screen and recent sessions](docs/screenshots/welcome.png) |
| **Remote file editor** | **File actions in the SFTP browser** |
| ![Remote file editor](docs/screenshots/editor.png) | ![File actions in the SFTP browser](docs/screenshots/sftp-menu.png) |
| **Recursive search on the server** | **New session** |
| ![Recursive search on the server](docs/screenshots/sftp-search.png) | ![New session](docs/screenshots/session-editor.png) |
| **Host key verification** | **Command palette** |
| ![Host key verification](docs/screenshots/hostkey.png) | ![Command palette](docs/screenshots/palette.png) |
| **Settings** | **MobaXterm theme with output highlighting** |
| ![Settings](docs/screenshots/settings.png) | ![MobaXterm theme with output highlighting](docs/screenshots/theme-moba.png) |
| **Visual Studio theme** | **Windows 95 theme** |
| ![Visual Studio theme](docs/screenshots/theme-vs.png) | ![Windows 95 theme](docs/screenshots/theme-retro.png) |
| **Light theme** |  |
| ![Light theme](docs/screenshots/light.png) |  |

Screenshots were taken against a demo project; host and user names are placeholders.

## Getting started

1. **Connect quickly.** On the start screen type `user@host` (or `ssh -p 2222 user@host`) and press Enter.
2. **Save a session.** Press `⌘N`, enter the host, user and authentication method, then **Save & connect**. Sessions can be grouped into folders.
3. **Import existing hosts.** Click **ssh config** at the bottom of the sidebar to import entries from `~/.ssh/config`.
4. **Confirm the server key.** On the first connection Northshell shows the server's fingerprint. Compare it with the one from your hosting provider or from `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server.
5. **Work with files.** Drag files from Finder onto the SFTP panel to upload, double-click a file to edit it, press `⌘S` to save. Type in the filter field and press Enter to search the whole folder tree.
6. **Watch the server.** The status bar shows live statistics; click it or press `⇧⌘M` for the full monitor.
7. **Save frequent commands.** Press `⇧⌘L` to open the command library, click **+**, and choose whether the command is shared or belongs to one connection. Double-click a command to run it.
8. **Work with an HTTP API.** Click **HTTP** at the bottom of the sidebar (or `⌥⌘N`), enter a base URL, an optional token and headers, then **Save & open**. Type a path, press `⌘↩`, and `⌘S` saves the request to a collection. Have a Postman or Insomnia collection? Import it with the button above the list. In the terminal `curl $BASE_URL/health` works too, with the headers added for you.
9. **Change the look.** Open **Settings → Appearance** (`⌘,`) to choose a theme and terminal colours.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New local terminal | `⌘T` |
| New SSH session | `⌘N` |
| New HTTP environment | `⌥⌘N` |
| Command library | `⇧⌘L` |
| HTTP workspace | `⇧⌘R` |
| Send the request / save it | `⌘↩` / `⌘S` |
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
- HTTP environments write their curl headers to a private temporary folder (owner-only permissions) that is deleted when the tab closes.
- The environment's token never reaches the interface or curl's command line, and the request log masks credentials. Collections, variables and cookies are stored owner-only but **not encrypted**, so keep secrets in `$TOKEN`; a token typed into a form is saved as typed.
- A collection file or a pasted curl command cannot choose a local file to send: the file has to be picked by hand.
- Updates come only from this repository's GitHub releases over HTTPS and must match the release's SHA-256 and the app's identifier and version, or the installed app stays as it is.

App data lives in `~/Library/Application Support/Northshell/` (`sessions.json`, `commands.json`, `settings.json`, `known_hosts.json`, `http-workspace.json`, `http-cookies/`).

## Northshell and other SSH clients for Mac

Tabby, Electerm and WindTerm are cross-platform terminals with SSH and SFTP. Termius and Royal TSX are commercial connection managers. iTerm2 is an excellent terminal without file transfer, and Cyberduck, Transmit or ForkLift handle files but not the shell.

Northshell focuses on the MobaXterm way of working on macOS:

- the SFTP browser sits next to the terminal of the same session, so there is no second login;
- remote files open in a built-in code editor and are saved back with `⌘S`;
- a live server monitor (CPU, memory, disks, network, load, users) runs over the same SSH connection with no agent on the server;
- it is free, open source (MIT) and stores secrets in the macOS Keychain.

## FAQ

**Is there a MobaXterm for Mac?**
MobaXterm itself is Windows-only. Northshell is a macOS app built around the same idea: SSH terminal, SFTP browser and server monitoring in one window. It does not include MobaXterm's X11 server or Windows tools.

**Is Northshell free?**
Yes. It is open source under the MIT license, with no account, subscription or telemetry.

**Does it run on Intel Macs?**
The published build is for Apple Silicon. Intel Macs can build it from source; a universal build is not published yet.

**Do I need to install anything on my servers?**
No. Monitoring uses standard commands (`/proc`, `ps` and `ss` on Linux; `sysctl`, `vm_stat` and `nettop` on macOS) over the existing SSH connection. SFTP needs the usual `sftp-server`, which is part of OpenSSH.

**Does it replace Postman or Insomnia?**
For everyday work with one API, yes: collections, variables, auth, every body type, checks, folder runs, cookies, and import of their collections. See [Limitations](#limitations) for what it doesn't do. Everything stays on your Mac, with no account.

**Which authentication methods are supported?**
Passwords, private keys (OpenSSH, with or without a passphrase), ssh-agent and keyboard-interactive prompts such as one-time codes. Hosts from `~/.ssh/config` can be imported.

**Where are my passwords stored?**
Encrypted with the macOS Keychain on your Mac. Nothing is sent anywhere else.

**Can I edit files on the server?**
Yes. Double-click a text file in the SFTP panel to open it in the built-in editor with syntax highlighting, then press `⌘S` to save. Files up to 5 MB are supported; larger or binary files can be downloaded.

**Why does macOS say the app cannot be opened?**
The app is not notarized by Apple. See [First launch](#first-launch) for the one-time steps.

## Limitations

- Apple Silicon build only; not signed or notarized by Apple.
- No X11 forwarding, RDP, VNC, serial connections, port forwarding or jump hosts yet.
- Server monitoring supports Linux and macOS hosts; on BusyBox-only systems some values may be missing.
- The HTTP client has checks and value capture instead of JavaScript scripts, and has no OAuth 2 sign-in flows, WebSocket or gRPC requests, mock servers or cloud sync.

## Version history

<details open>
<summary><b>1.6.1</b> · Nov 6, 2026 · One-command install and updates inside the app</summary>

- **Install with one command:** it downloads the latest version, checks it, puts it into Applications and starts it, and macOS doesn't block it.
- **Updates inside the app:** a new version offers itself, and one button installs it and restarts, with no Terminal and no “Open Anyway”. You can turn the check off in Settings.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.6.1)

</details>

<details>
<summary><b>1.6.0</b> · Nov 5, 2026 · Disk speed, who loads the server, a full HTTP client</summary>

- **Disk speed:** reads and writes per host and device, with a graph in the monitor panel.
- **Who is loading the host:** top users by CPU, RAM, disk and network, and a user picker in the monitor.
- **Enlarged monitor:** an htop-like process table with sorting, search and a tree; a table of users; a disk page with current reads and writes per user and space per user on each volume.
- **HTTP client on a par with Postman and Insomnia:** a full-window workspace, collections with folders, import from Postman and Insomnia, export to Postman, persistent history and variables, auth settings, every body type including multipart and GraphQL, cookies, checks and value capture, folder runs, a time breakdown, curl's log, HTML and image preview, saving responses, code for other tools.
- **Command line:** `⌘A` selects the command you are typing (again: all output); `⌫` deletes it and typing replaces it, and a part selected with the mouse works the same way. `Ctrl+A` jumps to the line start again.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.6.0)

</details>

<details>
<summary><b>1.5.1</b> · Nov 3, 2026 · HTTP request panel, GPU memory, SFTP follows cd</summary>

- **HTTP request panel** (`⇧⌘R`): a form instead of hand-written curl, with the response next to the terminal; a pasted curl command fills the form.
- **Video memory** in the status bar and the monitor: NVIDIA and AMD on Linux, the GPU of a Mac.
- **SFTP** follows `cd` in the terminal.
- **Fixed:** macOS servers showed about 1.5 GB less memory than Activity Monitor.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.5.1)

</details>

<details>
<summary><b>1.4.0</b> · Oct 16, 2026 · Command library and HTTP environments</summary>

- **Command library** (`⇧⌘L`): shared and per-connection commands, `{{placeholders}}`, a plain `commands.json`, import and export.
- **HTTP environments:** a local terminal with `$BASE_URL`, `$TOKEN` from the Keychain and default curl headers.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.4.0)

</details>

<details>
<summary><b>1.3.0</b> · Oct 12, 2026 · Termora is now Northshell</summary>

- New name; sessions and settings move over on first launch.
- Installation guide, FAQ, comparison with other Mac SSH clients.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.3.0)

</details>

<details>
<summary><b>1.2.0</b> · Oct 12, 2026 · MobaXterm theme</summary>

- MobaXterm theme, output highlighting and an info box on connect.
- A status bar that never clips, and icon-only buttons in narrow panels.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.2.0)

</details>

<details>
<summary><b>1.1.0</b> · Oct 12, 2026 · Visual Studio and Windows 95 themes</summary>

- Two new themes, a theme picker with previews, hover tooltips with shortcuts, resizable side panels.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.1.0)

</details>

<details>
<summary><b>1.0.0</b> · Oct 12, 2026 · First release</summary>

- Saved sessions; password, key, agent and 2FA login; Keychain secrets and host key checks.
- Terminal tabs with MultiExec, an SFTP browser with a built-in editor, server monitoring with no agent.

[Release page](https://github.com/nikserbur/northshell/releases/tag/v1.0.0)

</details>

## Building from source

Requires macOS, Node.js 22 or later and the Xcode Command Line Tools.

```bash
git clone https://github.com/nikserbur/northshell.git
cd northshell
npm install
npm run dev      # run with hot reload
npm test         # unit tests
npm run dist     # build the DMG into dist/
```

End-to-end tests drive the built app with Playwright: run `npm run build && npm run e2e`. Set `XMT_E2E_SSH_HOST`, `XMT_E2E_SSH_PORT`, `XMT_E2E_SSH_USER` and `XMT_E2E_SSH_KEY` to include the SSH and SFTP scenarios; with them `npm test` also runs the monitor against that server.

Built with Electron, React, TypeScript, xterm.js, ssh2, node-pty and CodeMirror.

## Questions and bug reports

Found a bug or have a question? [Open an issue](https://github.com/nikserbur/northshell/issues).

## License

[MIT](LICENSE)
