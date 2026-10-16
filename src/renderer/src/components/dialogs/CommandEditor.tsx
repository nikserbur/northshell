import { ScrollText, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { placeholders } from '@shared/snippets'
import type { CommandSnippet, CommandSnippetInput } from '@shared/types'
import { useT } from '../../lib/useT'
import { removeCommand, saveCommand } from '../../store/actions'
import { useApp } from '../../store/appStore'
import { Modal } from '../Modal'

/** Select value that keeps a command tied to a connection this machine does not have. */
const KEEP_MISSING = '__missing__'
const NAME_FROM_COMMAND_MAX = 48

function initialScope(snippet: CommandSnippet | undefined, sessionId: string | undefined, known: Set<string>): string {
  if (!snippet) return sessionId ?? ''
  if (snippet.sessionId && known.has(snippet.sessionId)) return snippet.sessionId
  return snippet.sessionId || snippet.sessionName ? KEEP_MISSING : ''
}

export function CommandEditor({ snippet, sessionId }: { snippet?: CommandSnippet; sessionId?: string }) {
  const t = useT()
  const sessions = useApp((s) => s.sessions)
  const openDialog = useApp((s) => s.openDialog)
  const known = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions])
  const sorted = useMemo(() => [...sessions].sort((a, b) => a.name.localeCompare(b.name)), [sessions])
  const [name, setName] = useState(snippet?.name ?? '')
  const [command, setCommand] = useState(snippet?.command ?? '')
  const [scope, setScope] = useState(() => initialScope(snippet, sessionId, known))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const scopeSession = sessions.find((s) => s.id === scope)
  const isHttp = scopeSession?.kind === 'http'
  const vars = placeholders(command)
  const commandError = touched && !command.trim() ? t('required') : null
  const close = (): void => openDialog(null)

  const scopeInput = (): Pick<CommandSnippetInput, 'sessionId' | 'sessionName'> => {
    if (scope === KEEP_MISSING) return { sessionId: snippet?.sessionId, sessionName: snippet?.sessionName }
    return scope ? { sessionId: scope } : {}
  }

  const save = async (): Promise<void> => {
    setTouched(true)
    if (saving || !command.trim()) return
    setSaving(true)
    const fallbackName = command.trim().split('\n')[0].slice(0, NAME_FROM_COMMAND_MAX)
    const ok = await saveCommand({ id: snippet?.id, name: name.trim() || fallbackName, command, ...scopeInput() })
    setSaving(false)
    if (ok) close()
  }

  const remove = (): void => {
    if (!snippet) return
    openDialog({
      kind: 'confirm',
      text: t('deleteCommandConfirm', { name: snippet.name }),
      confirmLabel: t('delete'),
      danger: true,
      onConfirm: () => void removeCommand(snippet.id)
    })
  }

  return (
    <Modal
      title={snippet ? t('editCommand') : t('newCommand')}
      icon={<ScrollText size={18} style={{ color: 'var(--accent)' }} />}
      onClose={close}
      footer={
        <>
          {snippet && (
            <button className="btn ghost left" onClick={remove}>
              <Trash2 size={13} /> {t('delete')}
            </button>
          )}
          <button className="btn ghost" onClick={close}>
            {t('cancel')}
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            {t('save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cmd-name">{t('commandName')}</label>
        <input
          id="cmd-name"
          className="input"
          value={name}
          autoFocus
          placeholder={t('commandNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </div>

      <div className="field">
        <label htmlFor="cmd-text">{t('commandText')}</label>
        <textarea
          id="cmd-text"
          className={`input mono cmd-textarea ${commandError ? 'invalid' : ''}`}
          value={command}
          rows={4}
          spellCheck={false}
          placeholder={isHttp ? 'curl -s $BASE_URL/users/{{id}}' : 'tail -n 200 -f /var/log/nginx/access.log'}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.metaKey && void save()}
        />
        {commandError && <span className="err">{commandError}</span>}
        <span className="hint">{t('commandHint')}</span>
        {isHttp && <span className="hint">{t('commandHttpHint')}</span>}
        {vars.length > 0 && (
          <div className="cmd-vars">
            {vars.map((v) => (
              <span key={v.name} className="cmd-var mono">
                {v.name}
                {v.fallback && <em>={v.fallback}</em>}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="cmd-scope">{t('commandScope')}</label>
        <select id="cmd-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">{t('scopeShared')}</option>
          {scope === KEEP_MISSING && (
            <option value={KEEP_MISSING}>{t('scopeMissing', { name: snippet?.sessionName ?? '?' })}</option>
          )}
          {sorted.length > 0 && (
            <optgroup label={t('sessions')}>
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.kind === 'http' ? ' · HTTP' : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </Modal>
  )
}
