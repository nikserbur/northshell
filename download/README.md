# Download Northshell

| File | Platform | Size |
|---|---|---|
| [`Northshell-<version>-arm64.dmg`](https://github.com/nikserbur/northshell/releases/latest) | macOS 13+ · Apple Silicon | ~112 MB |

1. Open the [latest release](https://github.com/nikserbur/northshell/releases/latest) and download the DMG from the **Assets** list.
2. Open the DMG and drag **Northshell** into **Applications**.
3. On first launch macOS may block the app because it is not signed with an Apple Developer certificate. Allow it in **System Settings → Privacy & Security → Open Anyway**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Northshell.app
```

Verify the file: `shasum -a 256 ~/Downloads/Northshell-*-arm64.dmg` must match the hash in [SHA256SUMS.txt](https://github.com/nikserbur/northshell/releases/latest/download/SHA256SUMS.txt) from the same release.

Full installation guide: [README → Installation](../README.md#installation).
