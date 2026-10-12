# Download Termora

| File | Platform | Size |
|---|---|---|
| [Termora-1.2.0-arm64.dmg](Termora-1.2.0-arm64.dmg) | macOS 13+ · Apple Silicon | ~112 MB |

1. Open `Termora-1.2.0-arm64.dmg` above and use the download button (**Download raw file**).
2. Open the DMG and drag **Termora** into **Applications**.
3. On first launch macOS may block the app because it is not signed with an Apple Developer certificate. Allow it in **System Settings → Privacy & Security → Open Anyway**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Termora.app
```

Verify the file: `shasum -a 256 Termora-1.2.0-arm64.dmg` must match [SHA256SUMS.txt](SHA256SUMS.txt).

Full installation guide: [README → Installation](../README.md#installation).
