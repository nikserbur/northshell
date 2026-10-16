import { Braces, CornerDownLeft, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { fillPlaceholders, placeholders } from '@shared/snippets'
import type { CommandSnippet } from '@shared/types'
import { useT } from '../../lib/useT'
import { sendCommand } from '../../store/actions'
import { useApp } from '../../store/appStore'
import { Modal } from '../Modal'

/** Values typed last time, per command and placeholder — kept until the app quits. */
const lastValues = new Map<string, string>()
const memoKey = (snippetId: string, name: string): string => `${snippetId}\0${name}`

export function CommandVarsDialog({ snippet, tabId }: { snippet: CommandSnippet; tabId: string }) {
  const t = useT()
  const openDialog = useApp((s) => s.openDialog)
  const connected = useApp((s) => s.tabs.find((x) => x.id === tabId)?.status === 'connected')
  const vars = useMemo(() => placeholders(snippet.command), [snippet.command])
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.name, lastValues.get(memoKey(snippet.id, v.name)) ?? v.fallback]))
  )
  const filled = fillPlaceholders(snippet.command, values)
  const close = (): void => openDialog(null)

  const submit = (run: boolean): void => {
    if (!connected) return
    for (const v of vars) lastValues.set(memoKey(snippet.id, v.name), values[v.name] ?? '')
    close()
    sendCommand(tabId, filled, run)
  }

  return (
    <Modal
      title={snippet.name}
      icon={<Braces size={17} style={{ color: 'var(--accent)' }} />}
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            {t('cancel')}
          </button>
          <button className="btn" disabled={!connected} onClick={() => submit(false)} title={t('insertCommand')}>
            <CornerDownLeft size={13} /> {t('insertCommand')}
          </button>
          <button className="btn primary" disabled={!connected} onClick={() => submit(true)}>
            <Play size={13} /> {t('runCommand')}
          </button>
        </>
      }
    >
      <span className="field-label">{t('commandParams')}</span>
      <div className="grid-2">
        {vars.map((v, i) => (
          <div className="field" key={v.name}>
            <label htmlFor={`var-${v.name}`} className="mono">
              {v.name}
            </label>
            <input
              id={`var-${v.name}`}
              className="input mono"
              autoFocus={i === 0}
              spellCheck={false}
              value={values[v.name] ?? ''}
              placeholder={v.fallback}
              onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit(true)}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <span className="field-label">{t('preview')}</span>
        <pre className="cmd-preview">{filled}</pre>
      </div>
      {!connected && <div className="callout">{t('needTerminal')}</div>}
    </Modal>
  )
}
