import { FolderOpen, Info, Network, Palette, SquareTerminal, HardDriveDownload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ACCENTS } from '@shared/defaults'
import type { AppSettings, CursorStyle, Language, UiTheme } from '@shared/types'
import { BRAND_HEAD, BRAND_TAIL } from '@shared/brand'
import type { I18nKey } from '../../lib/i18n'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { useApp } from '../../store/appStore'
import { TERMINAL_THEMES } from '../../terminal/themes'
import { Modal } from '../Modal'
import appIcon from '../../assets/icon-32.png'
import { Switch } from './SessionEditor'

type Section = 'appearance' | 'terminal' | 'ssh' | 'files' | 'about'

const SECTIONS: [Section, I18nKey, ReactNode][] = [
  ['appearance', 'appearance', <Palette size={15} key="a" />],
  ['terminal', 'terminal', <SquareTerminal size={15} key="t" />],
  ['ssh', 'ssh', <Network size={15} key="s" />],
  ['files', 'files', <HardDriveDownload size={15} key="f" />],
  ['about', 'about', <Info size={15} key="i" />]
]

interface ThemePreview {
  top: string
  side: string
  body: string
  accent: string
  status: string
}

const UI_THEMES: { id: UiTheme; label: I18nKey; preview: ThemePreview }[] = [
  { id: 'dark', label: 'themeDark', preview: { top: '#0d1016', side: '#141821', body: '#0b0e14', accent: '#5eead4', status: '#0d1016' } },
  { id: 'light', label: 'themeLight', preview: { top: '#ecebe6', side: '#f3f2ee', body: '#ffffff', accent: '#0d9488', status: '#ecebe6' } },
  {
    id: 'system',
    label: 'themeSystem',
    preview: { top: '#3a3d45', side: '#141821', body: 'linear-gradient(90deg, #0b0e14 50%, #fbfaf7 50%)', accent: '#5eead4', status: '#3a3d45' }
  },
  {
    id: 'vs',
    label: 'themeVs',
    preview: { top: '#2d2d30', side: '#252526', body: '#1e1e1e', accent: '#007acc', status: '#ca5100' }
  },
  {
    id: 'retro',
    label: 'themeRetro',
    preview: { top: 'linear-gradient(90deg, #000080, #1084d0)', side: '#c0c0c0', body: '#008080', accent: '#c0c0c0', status: '#c0c0c0' }
  }
]

/** Terminal colour scheme that goes with each branded UI theme. */
const BRANDED_TERMINAL: Partial<Record<UiTheme, string>> = { vs: 'visual-studio', retro: 'dos' }

const FONTS = ['JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'Fira Code', 'Cascadia Code']

function NumberField({ label, value, min, max, step = 1, onCommit }: { label: string; value: number; min: number; max: number; step?: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Number(draft)
    if (!Number.isFinite(n)) return setDraft(String(value))
    const clamped = Math.min(max, Math.max(min, step < 1 ? n : Math.round(n)))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input mono"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </div>
  )
}

function TextField({ label, value, placeholder, hint, onCommit, children }: { label: string; value: string; placeholder?: string; hint?: string; onCommit: (v: string) => void; children?: ReactNode }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input
          className="input mono grow"
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft.trim())}
          onKeyDown={(e) => e.key === 'Enter' && draft !== value && onCommit(draft.trim())}
        />
        {children}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function SettingsDialog() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [section, setSection] = useState<Section>('appearance')
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.xmt.app.info().then((i) => setVersion(i.version))
  }, [])

  const update = (patch: Partial<AppSettings>): void => {
    setSettings({ ...useApp.getState().settings, ...patch })
    window.xmt.settings
      .set(patch)
      .then(setSettings)
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }

  const pickDownloadDir = async (): Promise<void> => {
    const dir = await window.xmt.app.pickDir()
    if (dir) update({ downloadDir: dir })
  }

  const pickTheme = (theme: UiTheme): void => {
    const branded = BRANDED_TERMINAL[theme]
    const leavingBranded = Object.values(BRANDED_TERMINAL).includes(settings.terminalTheme)
    const terminalTheme = branded ?? (leavingBranded ? (theme === 'light' ? 'paper' : 'moda-night') : settings.terminalTheme)
    update({ uiTheme: theme, terminalTheme })
  }
  const fixedPalette = settings.uiTheme === 'vs' || settings.uiTheme === 'retro'

  const appearance = (
    <>
      <div className="field">
        <span className="field-label">{t('language')}</span>
        <div className="segmented">
          {(['ru', 'en'] as Language[]).map((l) => (
            <button key={l} className={settings.language === l ? 'on' : ''} onClick={() => update({ language: l })}>
              {l === 'ru' ? 'Русский' : 'English'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t('theme')}</span>
        <div className="ui-theme-grid">
          {UI_THEMES.map(({ id, label, preview }) => (
            <button key={id} className={`ui-theme-card ${settings.uiTheme === id ? 'on' : ''}`} onClick={() => pickTheme(id)}>
              <span className="tc-preview" style={{ background: preview.body }}>
                <i className="tc-top" style={{ background: preview.top }} />
                <i className="tc-side" style={{ background: preview.side }} />
                <i className="tc-accent" style={{ background: preview.accent }} />
                <i className="tc-status" style={{ background: preview.status }} />
              </span>
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={fixedPalette ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
        <span className="field-label">{t('accent')}</span>
        {fixedPalette && <span className="hint">{t('themeFixedAccent')}</span>}
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button
              key={c}
              className={`swatch ${settings.accent === c ? 'on' : ''}`}
              style={{ ['--sw' as string]: c }}
              onClick={() => update({ accent: c })}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t('terminalTheme')}</span>
        <div className="theme-grid">
          {TERMINAL_THEMES.map((theme) => (
            <button
              key={theme.id}
              className={`theme-chip ${settings.terminalTheme === theme.id ? 'on' : ''}`}
              onClick={() => update({ terminalTheme: theme.id })}
            >
              <div className="preview" style={{ background: theme.theme.background, color: theme.theme.foreground }}>
                <span style={{ color: theme.theme.green }}>user@host</span>:<span style={{ color: theme.theme.blue }}>~</span>$ ls
                <br />
                <span style={{ color: theme.theme.cyan }}>src</span> <span style={{ color: theme.theme.yellow }}>build.sh</span>{' '}
                <span style={{ color: theme.theme.red }}>err.log</span>
              </div>
              {theme.name}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  const terminal = (
    <>
      <div className="grid-2">
        <div className="field">
          <label>{t('font')}</label>
          <select className="input" value={settings.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <NumberField label={t('fontSize')} value={settings.fontSize} min={8} max={32} onCommit={(v) => update({ fontSize: v })} />
        <NumberField label={t('lineHeight')} value={settings.lineHeight} min={1} max={2} step={0.05} onCommit={(v) => update({ lineHeight: v })} />
        <NumberField label={t('scrollback')} value={settings.scrollback} min={100} max={200000} onCommit={(v) => update({ scrollback: v })} />
      </div>
      <div className="field">
        <span className="field-label">{t('cursor')}</span>
        <div className="segmented">
          {(['bar', 'block', 'underline'] as CursorStyle[]).map((c) => (
            <button key={c} className={settings.cursorStyle === c ? 'on' : ''} onClick={() => update({ cursorStyle: c })}>
              {c === 'bar' ? '▏ bar' : c === 'block' ? '█ block' : '▁ underline'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Switch on={settings.cursorBlink} onChange={(v) => update({ cursorBlink: v })} label={t('cursorBlink')} />
        <Switch on={settings.copyOnSelect} onChange={(v) => update({ copyOnSelect: v })} label={t('copyOnSelect')} />
        <Switch on={settings.rightClickPaste} onChange={(v) => update({ rightClickPaste: v })} label={t('rightClickPaste')} />
      </div>
      <TextField label={t('localShell')} value={settings.localShell} placeholder="/bin/zsh" hint={t('localShellHint')} onCommit={(v) => update({ localShell: v })} />
    </>
  )

  const ssh = (
    <>
      <TextField label={t('defaultUsername')} value={settings.defaultUsername} placeholder="root" onCommit={(v) => update({ defaultUsername: v })} />
      <div className="grid-2">
        <NumberField label={t('keepalive')} value={settings.keepaliveInterval} min={0} max={600} onCommit={(v) => update({ keepaliveInterval: v })} />
        <NumberField label={t('connectTimeout')} value={settings.connectTimeout} min={3} max={120} onCommit={(v) => update({ connectTimeout: v })} />
      </div>
      <div className="callout">
        <Info size={16} />
        {t('dataStored')}
      </div>
    </>
  )

  const files = (
    <>
      <TextField label={t('downloadDir')} value={settings.downloadDir} placeholder="~/Downloads" hint={t('downloadDirHint')} onCommit={(v) => update({ downloadDir: v })}>
        <button className="btn" onClick={() => void pickDownloadDir()}>
          <FolderOpen size={14} /> {t('choose')}
        </button>
      </TextField>
      <div>
        <Switch on={settings.showHiddenFiles} onChange={(v) => update({ showHiddenFiles: v })} label={t('showHidden')} />
        <Switch on={settings.confirmDelete} onChange={(v) => update({ confirmDelete: v })} label={t('confirmDelete')} />
        <Switch on={settings.monitorEnabled} onChange={(v) => update({ monitorEnabled: v })} label={t('monitorEnabled')} />
      </div>
      <NumberField label={t('monitorInterval')} value={settings.monitorInterval} min={1} max={60} onCommit={(v) => update({ monitorInterval: v })} />
    </>
  )

  const about = (
    <div className="about">
      <img className="pixel" src={appIcon} width={96} height={96} alt="" />
      <div>
        <div className="brand-name" style={{ fontSize: 20 }}>
          {BRAND_HEAD}
          <em>{BRAND_TAIL}</em>
        </div>
        <div className="muted mono">v{version}</div>
      </div>
      <p style={{ margin: 0, color: 'var(--text-1)' }}>{t('aboutText')}</p>
      <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 12 }}>{t('dataStored')}</p>
    </div>
  )

  const panes: Record<Section, ReactNode> = { appearance, terminal, ssh, files, about }

  return (
    <Modal title={t('settings')} size="wide" onClose={() => openDialog(null)} bodyless>
      <div className="settings">
        <nav className="settings-nav">
          {SECTIONS.map(([id, key, icon]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {icon}
              {t(key)}
            </button>
          ))}
        </nav>
        <div className="settings-pane">{panes[section]}</div>
      </div>
    </Modal>
  )
}
