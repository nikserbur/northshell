# ⬇️ Скачать Termora

| Файл | Платформа | Размер |
|---|---|---|
| [**Termora-1.2.0-arm64.dmg**](Termora-1.2.0-arm64.dmg) | macOS 13+ · Apple Silicon | ~114 МБ |

1. Нажмите на `Termora-1.2.0-arm64.dmg` → кнопка **Download raw file** (иконка ⬇︎ справа).
2. Откройте DMG и перетащите **Termora** в **Applications**.
3. Если macOS блокирует запуск (приложение не подписано Apple): правый клик → **Открыть**, или выполните

```bash
xattr -dr com.apple.quarantine /Applications/Termora.app
```

Проверка целостности: `shasum -a 256 Termora-1.2.0-arm64.dmg` должен совпасть с [SHA256SUMS.txt](SHA256SUMS.txt).
