import { FolderOpen, Globe, KeyRound, Lock, Server, ShieldCheck } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { SESSION_COLORS } from '@shared/defaults'
import { endpointOf, normalizeBaseUrl, parseHeaders } from '@shared/httpEnv'
import { parseQuickConnect } from '@shared/quickConnect'
import type { AuthMethod, SessionConfig, SessionInput, SessionKind } from '@shared/types'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { openSession, reloadSessions } from '../../store/actions'
import { useApp } from '../../store/appStore'
import { Modal } from '../Modal'
import { HttpSessionFields } from './HttpSessionFields'

interface Form {
  kind: SessionKind
  name: string
  folder: string
  host: string
  port: string
  username: string
  auth: AuthMethod
  keyPath: string
  secret: string
  clearSecret: boolean
  color: string
  startupCommand: string
  monitoring: boolean
  sftp: boolean
  baseUrl: string
  headers: string
  insecure: boolean
}

function initialForm(session: SessionConfig | undefined, kind: SessionKind, defaultUser: string, colorIdx: number): Form {
  return {
    kind: session?.kind ?? kind,
    name: session?.name ?? '',
    folder: session?.folder ?? '',
    host: session?.host ?? '',
    port: String(session?.port ?? 22),
    username: session?.username ?? defaultUser,
    auth: session?.auth ?? 'password',
    keyPath: session?.keyPath ?? '',
    secret: '',
    clearSecret: false,
    color: session?.color ?? SESSION_COLORS[colorIdx % SESSION_COLORS.length],
    startupCommand: session?.startupCommand ?? '',
    monitoring: session?.monitoring ?? true,
    sftp: session?.sftp ?? true,
    baseUrl: session?.baseUrl ?? '',
    headers: session?.headers ?? '',
    insecure: session?.insecure ?? false
  }
}

function httpInput(form: Form, id: string | undefined): SessionInput {
  const baseUrl = normalizeBaseUrl(form.baseUrl) ?? form.baseUrl.trim()
  return {
    id,
    kind: 'http',
    name: form.name.trim() || endpointOf(baseUrl)?.host || baseUrl,
    folder: form.folder.trim(),
    host: '',
    port: 443,
    username: '',
    auth: 'password',
    keyPath: '',
    color: form.color,
    startupCommand: form.startupCommand,
    monitoring: false,
    sftp: false,
    baseUrl,
    headers: form.headers,
    insecure: form.insecure,
    secret: form.secret || undefined,
    clearSecret: form.clearSecret
  }
}

export function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <div className="switch-row">
      <div className="switch-text">
        <span>{label}</span>
        {hint && <span className="muted" style={{ fontSize: 11 }}>{hint}</span>}
      </div>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  )
}

export function SessionEditor({ session, sessionKind = 'ssh' }: { session?: SessionConfig; sessionKind?: SessionKind }) {
  const t = useT()
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const [form, setForm] = useState<Form>(() => initialForm(session, sessionKind, settings.defaultUsername, sessions.length))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const folders = useMemo(() => [...new Set(sessions.map((s) => s.folder).filter(Boolean))].sort(), [sessions])

  const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((f) => ({ ...f, [key]: value }))
  const port = Number(form.port)
  const isHttp = form.kind === 'http'
  const badHeader = parseHeaders(form.headers).invalid[0]
  const errors = {
    host: !form.host.trim() ? t('required') : null,
    port: !Number.isInteger(port) || port < 1 || port > 65535 ? t('invalidPort') : null,
    baseUrl: normalizeBaseUrl(form.baseUrl) ? null : t('invalidUrl'),
    headers: badHeader ? t('invalidHeaderLine', { n: badHeader }) : null
  }
  const valid = isHttp ? !errors.baseUrl && !errors.headers : !errors.host && !errors.port
  const close = (): void => openDialog(null)

  const expandHost = (): void => {
    if (!/[@:\s]/.test(form.host)) return
    const parsed = parseQuickConnect(form.host, form.username || 'root')
    if (parsed) setForm((f) => ({ ...f, host: parsed.host, port: String(parsed.port), username: parsed.username }))
  }

  const save = async (connect: boolean): Promise<void> => {
    setTouched(true)
    if (!valid) return
    setSaving(true)
    const input: SessionInput = isHttp ? httpInput(form, session?.id) : {
      id: session?.id,
      kind: 'ssh',
      name: form.name.trim() || form.host.trim(),
      folder: form.folder.trim(),
      host: form.host.trim(),
      port,
      username: form.username.trim(),
      auth: form.auth,
      keyPath: form.auth === 'key' ? form.keyPath.trim() : '',
      color: form.color,
      startupCommand: form.startupCommand,
      monitoring: form.monitoring,
      sftp: form.sftp,
      baseUrl: '',
      headers: '',
      insecure: false,
      secret: form.auth === 'agent' ? undefined : form.secret || undefined,
      clearSecret: form.clearSecret || form.auth === 'agent' || (Boolean(session) && session?.auth !== form.auth && !form.secret)
    }
    try {
      const saved = await window.xmt.sessions.save(input)
      await reloadSessions()
      close()
      if (connect) openSession(saved)
    } catch (err) {
      toast({ kind: 'error', text: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const pickKey = async (): Promise<void> => {
    const path = await window.xmt.app.pickFile(t('privateKey'))
    if (path) set('keyPath', path)
  }

  const secretLabel = form.auth === 'key' ? t('passphrase') : t('password')
  const secretHint = session?.hasSecret && !form.clearSecret ? t('passwordSaved') : t('passwordHint')

  const title = isHttp ? (session ? t('editHttpEnv') : t('newHttpEnv')) : session ? t('editSession') : t('newSession')

  return (
    <Modal
      title={title}
      icon={isHttp ? <Globe size={18} style={{ color: 'var(--accent)' }} /> : <Server size={18} style={{ color: 'var(--accent)' }} />}
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            {t('cancel')}
          </button>
          <button className="btn" disabled={saving} onClick={() => void save(false)}>
            {t('save')}
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save(true)}>
            {isHttp ? t('saveAndOpen') : t('saveAndConnect')}
          </button>
        </>
      }
    >
      {!session && (
        <div className="segmented session-kind">
          {(
            [
              ['ssh', t('kindSsh'), <Server size={13} key="s" />],
              ['http', t('kindHttp'), <Globe size={13} key="h" />]
            ] as [SessionKind, string, ReactNode][]
          ).map(([value, label, icon]) => (
            <button key={value} className={form.kind === value ? 'on' : ''} onClick={() => set('kind', value)}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}

      {isHttp ? (
        <HttpSessionFields form={form} session={session} errors={errors} touched={touched} set={set} onSubmit={() => void save(true)} />
      ) : (
        <>
          <div className="row">
            <div className="field grow">
              <label>{t('host')}</label>
              <input
                className={`input mono ${touched && errors.host ? 'invalid' : ''}`}
                value={form.host}
                autoFocus
                spellCheck={false}
                placeholder="192.168.1.10 / example.com"
                onChange={(e) => set('host', e.target.value)}
                onBlur={expandHost}
                onKeyDown={(e) => e.key === 'Enter' && void save(true)}
              />
              {touched && errors.host && <span className="err">{errors.host}</span>}
            </div>
            <div className="field" style={{ width: 92 }}>
              <label>{t('port')}</label>
              <input
                className={`input mono ${touched && errors.port ? 'invalid' : ''}`}
                value={form.port}
                inputMode="numeric"
                onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>{t('username')}</label>
              <input className="input mono" value={form.username} spellCheck={false} placeholder="root" onChange={(e) => set('username', e.target.value)} />
            </div>
            <div className="field">
              <label>{t('sessionName')}</label>
              <input className="input" value={form.name} placeholder={form.host || 'prod-web-01'} onChange={(e) => set('name', e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t('authentication')}</span>
            <div className="segmented">
              {(
                [
                  ['password', t('authPassword'), <Lock size={13} key="p" />],
                  ['key', t('authKey'), <KeyRound size={13} key="k" />],
                  ['agent', t('authAgent'), <ShieldCheck size={13} key="a" />]
                ] as [AuthMethod, string, ReactNode][]
              ).map(([value, label, icon]) => (
                <button key={value} className={form.auth === value ? 'on' : ''} onClick={() => set('auth', value)}>
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {form.auth === 'key' && (
            <div className="field">
              <label>{t('privateKey')}</label>
              <div className="row">
                <input
                  className="input mono grow"
                  value={form.keyPath}
                  spellCheck={false}
                  placeholder="~/.ssh/id_ed25519"
                  onChange={(e) => set('keyPath', e.target.value)}
                />
                <button className="btn" onClick={() => void pickKey()}>
                  <FolderOpen size={14} /> {t('choose')}
                </button>
              </div>
              <span className="hint">{t('privateKeyHint')}</span>
            </div>
          )}

          {form.auth !== 'agent' ? (
            <div className="field">
              <label>{secretLabel}</label>
              <div className="row">
                <input
                  className="input grow"
                  type="password"
                  value={form.secret}
                  placeholder={session?.hasSecret && !form.clearSecret ? '••••••••' : ''}
                  autoComplete="new-password"
                  onChange={(e) => set('secret', e.target.value)}
                />
                {session?.hasSecret && !form.clearSecret && (
                  <button className="btn ghost" onClick={() => set('clearSecret', true)}>
                    {t('forgetSecret')}
                  </button>
                )}
              </div>
              <span className="hint">{secretHint}</span>
            </div>
          ) : (
            <div className="callout">
              <ShieldCheck size={16} />
              {t('agentHint')}
            </div>
          )}
        </>
      )}

      <div className="grid-2">
        <div className="field">
          <label>{t('folder')}</label>
          <input className="input" list="xmt-folders" value={form.folder} placeholder="prod / staging" onChange={(e) => set('folder', e.target.value)} />
          <datalist id="xmt-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <span className="field-label">{t('color')}</span>
          <div className="swatches" style={{ height: 34, alignItems: 'center' }}>
            {SESSION_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${form.color === c ? 'on' : ''}`}
                style={{ ['--sw' as string]: c }}
                onClick={() => set('color', c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <label>{t('startupCommand')}</label>
        <input
          className="input mono"
          value={form.startupCommand}
          spellCheck={false}
          placeholder={t('startupCommandHint')}
          onChange={(e) => set('startupCommand', e.target.value)}
        />
      </div>

      {isHttp ? (
        <Switch on={form.insecure} onChange={(v) => set('insecure', v)} label={t('insecureTls')} hint={t('insecureTlsHint')} />
      ) : (
        <div>
          <Switch on={form.monitoring} onChange={(v) => set('monitoring', v)} label={t('enableMonitoring')} />
          <Switch on={form.sftp} onChange={(v) => set('sftp', v)} label={t('enableSftp')} />
        </div>
      )}
    </Modal>
  )
}
