import { ClipboardPaste } from 'lucide-react'
import { useMemo, useState } from 'react'
import { parseCurlCommand } from '@shared/httpRequest'
import { useT } from '../../lib/useT'
import { loadCurlIntoPanel } from '../../store/actions'
import { useApp } from '../../store/appStore'
import { Modal } from '../Modal'

/** Paste a curl command (e.g. "Copy as cURL" from browser dev tools) to fill the request panel. */
export function CurlImportDialog({ tabId }: { tabId: string }) {
  const t = useT()
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const baseUrl = useApp((s) => {
    const tab = s.tabs.find((x) => x.id === tabId)
    return s.sessions.find((x) => x.id === tab?.sessionId)?.baseUrl ?? ''
  })
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseCurlCommand(text, baseUrl) : null), [text, baseUrl])
  const close = (): void => openDialog(null)

  const submit = (): void => {
    if (!parsed) return
    const warnings = loadCurlIntoPanel(tabId, text)
    close()
    if (warnings && warnings.length > 0) toast({ kind: 'info', text: t('importCurlWarnings', { opts: warnings.join(', ') }) })
  }

  return (
    <Modal
      title={t('importCurlTitle')}
      icon={<ClipboardPaste size={17} style={{ color: 'var(--accent)' }} />}
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            {t('cancel')}
          </button>
          <button className="btn primary" disabled={!parsed} onClick={submit}>
            {t('importAction')}
          </button>
        </>
      }
    >
      <div className="field">
        <textarea
          className={`input mono cmd-textarea ${text.trim() && !parsed ? 'invalid' : ''}`}
          rows={9}
          autoFocus
          spellCheck={false}
          value={text}
          placeholder={"curl 'https://api.example.com/v1/users' \\\n  -H 'accept: application/json'"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
        />
        {text.trim() && !parsed ? (
          <span className="err">{t('importCurlInvalid')}</span>
        ) : parsed ? (
          <span className="hint mono">
            {parsed.spec.method} {parsed.spec.url || '/'}
            {parsed.warnings.length > 0 && ` · ${t('importCurlWarnings', { opts: parsed.warnings.join(', ') })}`}
          </span>
        ) : (
          <span className="hint">{t('importCurlHint')}</span>
        )}
      </div>
    </Modal>
  )
}
