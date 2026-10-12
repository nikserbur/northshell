import { KeyRound, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { useState } from 'react'
import type { PromptRequest, PromptResponse } from '@shared/types'
import { useT } from '../../lib/useT'
import { useApp } from '../../store/appStore'
import { Modal } from '../Modal'

function respond(res: PromptResponse): void {
  useApp.getState().popPrompt(res.id)
  void window.xmt.prompts.respond(res)
}

function HostKeyPrompt({ req }: { req: Extract<PromptRequest, { kind: 'hostkey-new' | 'hostkey-changed' }> }) {
  const t = useT()
  const changed = req.kind === 'hostkey-changed'
  const host = `${req.host}:${req.port}`
  const cancel = (): void => respond({ id: req.id, accepted: false })
  return (
    <Modal
      size="narrow"
      title={changed ? t('hostKeyChangedTitle') : t('hostKeyNewTitle')}
      icon={
        changed ? (
          <ShieldAlert size={20} style={{ color: 'var(--danger)' }} />
        ) : (
          <ShieldQuestion size={20} style={{ color: 'var(--accent)' }} />
        )
      }
      onClose={cancel}
      footer={
        <>
          <button className="btn ghost" onClick={cancel} autoFocus={changed}>
            {t('cancel')}
          </button>
          <button
            className={`btn ${changed ? 'danger' : 'primary'}`}
            onClick={() => respond({ id: req.id, accepted: true })}
            autoFocus={!changed}
          >
            {changed ? t('replaceKey') : t('trustAndConnect')}
          </button>
        </>
      }
    >
      <div className={`callout ${changed ? 'danger' : ''}`}>
        {changed ? <ShieldAlert size={16} /> : <ShieldQuestion size={16} />}
        <span>{changed ? t('hostKeyChangedText', { host }) : t('hostKeyNewText', { host })}</span>
      </div>
      <div className="field">
        <span className="field-label">
          {t('fingerprint')} · <span className="mono">{req.keyType}</span>
        </span>
        <div className="fingerprint">{req.fingerprint}</div>
      </div>
      {req.kind === 'hostkey-changed' && (
        <div className="field">
          <span className="field-label">{t('previousFingerprint')}</span>
          <div className="fingerprint old">{req.previous}</div>
        </div>
      )}
    </Modal>
  )
}

function SecretPrompt({ req }: { req: Extract<PromptRequest, { kind: 'secret' }> }) {
  const t = useT()
  const [value, setValue] = useState('')
  const [remember, setRemember] = useState(false)
  const cancel = (): void => respond({ id: req.id, accepted: false })
  const submit = (): void => respond({ id: req.id, accepted: true, values: [value], remember })
  const title = req.purpose === 'password' ? t('passwordFor', { target: req.target }) : t('passphraseFor', { target: req.target })
  return (
    <Modal
      size="narrow"
      title={req.purpose === 'password' ? t('password') : t('passphrase')}
      icon={<KeyRound size={18} style={{ color: 'var(--accent)' }} />}
      onClose={cancel}
      footer={
        <>
          {req.canRemember && (
            <label className="left" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-1)' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t('remember')}
            </label>
          )}
          <button className="btn ghost" onClick={cancel}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={submit}>
            {t('connect')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="truncate mono" style={{ fontWeight: 500 }}>
          {title}
        </label>
        <input
          className={`input ${req.retry ? 'invalid' : ''}`}
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {req.retry && <span className="err">{t('wrongSecret')}</span>}
      </div>
    </Modal>
  )
}

function KeyboardInteractivePrompt({ req }: { req: Extract<PromptRequest, { kind: 'keyboard-interactive' }> }) {
  const t = useT()
  const [values, setValues] = useState<string[]>(() => req.prompts.map(() => ''))
  const cancel = (): void => respond({ id: req.id, accepted: false })
  const submit = (): void => respond({ id: req.id, accepted: true, values })
  return (
    <Modal
      size="narrow"
      title={req.title}
      icon={<KeyRound size={18} style={{ color: 'var(--accent)' }} />}
      onClose={cancel}
      footer={
        <>
          <button className="btn ghost" onClick={cancel}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={submit}>
            {t('ok')}
          </button>
        </>
      }
    >
      {req.instructions && <div className="callout">{req.instructions}</div>}
      {req.prompts.map((p, i) => (
        <div className="field" key={`${p.prompt}-${i}`}>
          <label>{p.prompt.trim()}</label>
          <input
            className="input"
            type={p.echo ? 'text' : 'password'}
            autoFocus={i === 0}
            value={values[i]}
            onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            onKeyDown={(e) => e.key === 'Enter' && i === req.prompts.length - 1 && submit()}
          />
        </div>
      ))}
    </Modal>
  )
}

/** Shows the oldest pending prompt coming from the main process. */
export function PromptHost() {
  const req = useApp((s) => s.prompts[0])
  if (!req) return null
  if (req.kind === 'hostkey-new' || req.kind === 'hostkey-changed') return <HostKeyPrompt key={req.id} req={req} />
  if (req.kind === 'secret') return <SecretPrompt key={req.id} req={req} />
  return <KeyboardInteractivePrompt key={req.id} req={req} />
}
