import { ArrowRight, Download, Globe, Plus, SquareTerminal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { parseQuickConnect } from '@shared/quickConnect'
import type { I18nKey } from '../lib/i18n'
import iconMark from '../assets/icon-32.png'
import { useT } from '../lib/useT'
import { errorMessage, monogram, relativeTime, sessionSubtitle } from '../lib/util'
import { openLocal, openQuick, openSession, reloadSessions } from '../store/actions'
import { useApp } from '../store/appStore'

const SHORTCUTS: [I18nKey, string[]][] = [
  ['localTerminal', ['⌘', 'T']],
  ['newSession', ['⌘', 'N']],
  ['paletteHint', ['⌘', 'P']],
  ['toggleSftp', ['⇧', '⌘', 'F']],
  ['toggleMonitor', ['⇧', '⌘', 'M']],
  ['commandLibrary', ['⇧', '⌘', 'L']],
  ['find', ['⌘', 'F']],
  ['clear', ['⌘', 'K']],
  ['toggleSidebar', ['⌘', 'B']]
]

export function Welcome() {
  const t = useT()
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [quick, setQuick] = useState('')
  const [invalid, setInvalid] = useState(false)

  const recent = useMemo(() => {
    const used = sessions.filter((s) => s.lastUsedAt > 0).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    const rest = sessions.filter((s) => s.lastUsedAt === 0).sort((a, b) => b.createdAt - a.createdAt)
    return [...used, ...rest].slice(0, 9)
  }, [sessions])

  const submit = (): void => {
    const target = parseQuickConnect(quick, settings.defaultUsername)
    if (!target) {
      setInvalid(true)
      return
    }
    setQuick('')
    openQuick(target)
  }

  const importConfig = async (): Promise<void> => {
    try {
      const n = await window.xmt.sessions.importSshConfig()
      await reloadSessions()
      toast(n > 0 ? { kind: 'success', text: t('imported', { n }) } : { kind: 'info', text: t('nothingToImport') })
    } catch (err) {
      toast({ kind: 'error', text: errorMessage(err) })
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div>
          <img className="pixel welcome-mark" src={iconMark} width={64} height={64} alt="" />
          <h1>
            {t('welcomeTitle').split(' ').slice(0, -1).join(' ')} <span>{t('welcomeTitle').split(' ').slice(-1)}</span>
            <i className="cursor-block" aria-hidden />
          </h1>
          <p className="lede">{t('welcomeSubtitle')}</p>
        </div>

        <div>
          <form
            className="quick"
            style={invalid ? { boxShadow: 'inset 0 0 0 1px var(--danger)' } : undefined}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <span className="prompt">❯</span>
            <input
              autoFocus
              value={quick}
              spellCheck={false}
              placeholder={`ssh ${t('quickConnect')}`}
              onChange={(e) => {
                setQuick(e.target.value)
                setInvalid(false)
              }}
            />
            <button className="btn primary" type="submit" disabled={!quick.trim()}>
              {t('connect')} <ArrowRight size={14} />
            </button>
          </form>
          <div className="welcome-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => openDialog({ kind: 'session-editor' })}>
              <Plus size={14} /> {t('newSession')}
            </button>
            <button className="btn" onClick={() => openLocal()}>
              <SquareTerminal size={14} /> {t('localTerminal')}
            </button>
            <button className="btn" onClick={() => openDialog({ kind: 'session-editor', sessionKind: 'http' })}>
              <Globe size={14} /> {t('newHttpEnv')}
            </button>
            <button className="btn ghost" onClick={() => void importConfig()}>
              <Download size={14} /> {t('importSshConfig')}
            </button>
          </div>
        </div>

        {recent.length > 0 && (
          <div>
            <div className="section-title">{t('recent')}</div>
            <div className="cards">
              {recent.map((s) => (
                <button
                  key={s.id}
                  className="card"
                  style={{ ['--mono-color' as string]: s.color }}
                  onClick={() => openSession(s)}
                >
                  <div className="monogram" style={{ ['--mono-color' as string]: s.color }}>
                    {monogram(s.name)}
                  </div>
                  <div className="session-meta">
                    <span className="session-name truncate">{s.name}</span>
                    <span className="session-host truncate">{sessionSubtitle(s)}</span>
                  </div>
                  {s.lastUsedAt > 0 && <span className="when">{relativeTime(s.lastUsedAt, settings.language)}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="section-title">{t('shortcuts')}</div>
          <div className="shortcuts">
            {SHORTCUTS.map(([key, keys]) => (
              <div key={key}>
                <span>{t(key)}</span>
                <span className="keys">
                  {keys.map((k) => (
                    <span key={k} className="kbd">
                      {k}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
