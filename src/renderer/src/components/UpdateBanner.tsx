import { AlertTriangle, ArrowUpCircle, ExternalLink, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../lib/useT'
import { errorMessage } from '../lib/util'
import { useApp } from '../store/appStore'

const DISMISSED_KEY = 'xmt.update.dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

/** Offers a new version under the tabs. "Later" hides that version until the next one comes out. */
export function UpdateBanner() {
  const t = useT()
  const status = useApp((s) => s.update)
  const openTabs = useApp((s) => s.tabs.filter((tab) => tab.status === 'connected' || tab.status === 'connecting').length)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [dismissed, setDismissed] = useState(readDismissed)

  if (status.state === 'idle') return null
  if (status.state === 'available' && dismissed === status.version) return null

  const openPage = (): void => void window.xmt.app.openExternal(status.url)
  const install = (): void => {
    void window.xmt.update.install().catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }
  const confirmInstall = (): void => {
    if (openTabs === 0) return install()
    openDialog({ kind: 'confirm', text: t('updateConfirm', { n: openTabs }), confirmLabel: t('updateInstall'), onConfirm: install })
  }
  const later = (): void => {
    setDismissed(status.version)
    try {
      localStorage.setItem(DISMISSED_KEY, status.version)
    } catch {
      /* it only comes back on the next launch */
    }
    if (status.state === 'error') useApp.getState().setUpdate({ state: 'idle' })
  }

  if (status.state === 'downloading' || status.state === 'installing') {
    const progress = status.state === 'downloading' ? status.progress : null
    return (
      <div className="update-banner" role="status">
        <Loader2 size={14} className="spin" />
        <span className="truncate">{t(status.state === 'downloading' ? 'updateDownloading' : 'updateInstalling', { version: status.version })}</span>
        {progress !== null && (
          <>
            <span className="update-track">
              <i style={{ transform: `scaleX(${progress / 100})` }} />
            </span>
            <span className="update-percent">{progress}%</span>
          </>
        )}
      </div>
    )
  }

  if (status.state === 'error') {
    return (
      <div className="update-banner failed" role="alert">
        <AlertTriangle size={14} />
        <span className="truncate" title={status.message}>
          {t('updateFailed', { message: status.message })}
        </span>
        {status.canInstall && (
          <button className="btn sm" onClick={confirmInstall}>
            {t('updateRetry')}
          </button>
        )}
        <button className="btn sm ghost" onClick={openPage}>
          <ExternalLink size={12} /> {t('updateOpenPage')}
        </button>
        <button className="icon-btn sm" onClick={later} title={t('updateLater')}>
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="update-banner" role="status">
      <ArrowUpCircle size={14} />
      <span className="truncate">{t('updateAvailable', { version: status.version })}</span>
      <button className="btn sm primary" onClick={status.canInstall ? confirmInstall : openPage}>
        {status.canInstall ? t('updateInstall') : t('updateDownload')}
      </button>
      {status.canInstall && (
        <button className="btn sm ghost" onClick={openPage}>
          {t('updateWhatsNew')}
        </button>
      )}
      <button className="icon-btn sm" onClick={later} title={t('updateLater')}>
        <X size={13} />
      </button>
    </div>
  )
}
