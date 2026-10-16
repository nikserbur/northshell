import { Globe } from 'lucide-react'
import type { SessionConfig } from '@shared/types'
import { useT } from '../../lib/useT'

export interface HttpForm {
  name: string
  baseUrl: string
  headers: string
  secret: string
  clearSecret: boolean
}

interface Props<F extends HttpForm> {
  form: F
  session?: SessionConfig
  errors: { baseUrl: string | null; headers: string | null }
  touched: boolean
  set: <K extends keyof HttpForm>(key: K, value: F[K]) => void
  onSubmit: () => void
}

/** Connection part of the session editor for an HTTP environment (no SSH: base URL, token, headers). */
export function HttpSessionFields<F extends HttpForm>({ form, session, errors, touched, set, onSubmit }: Props<F>) {
  const t = useT()
  const tokenSaved = Boolean(session?.hasSecret) && !form.clearSecret
  return (
    <>
      <div className="callout">
        <Globe size={16} />
        {t('httpEnvHint')}
      </div>

      <div className="field">
        <label htmlFor="http-base-url">{t('baseUrl')}</label>
        <input
          id="http-base-url"
          className={`input mono ${touched && errors.baseUrl ? 'invalid' : ''}`}
          value={form.baseUrl}
          autoFocus
          spellCheck={false}
          placeholder="https://api.example.com/v1"
          onChange={(e) => set('baseUrl', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
        {touched && errors.baseUrl ? <span className="err">{errors.baseUrl}</span> : <span className="hint">{t('baseUrlHint')}</span>}
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="http-name">{t('sessionName')}</label>
          <input id="http-name" className="input" value={form.name} placeholder="api-prod" onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="http-token">{t('token')}</label>
          <div className="row">
            <input
              id="http-token"
              className="input grow"
              type="password"
              value={form.secret}
              placeholder={tokenSaved ? '••••••••' : ''}
              autoComplete="new-password"
              onChange={(e) => set('secret', e.target.value)}
            />
            {tokenSaved && (
              <button className="btn ghost" onClick={() => set('clearSecret', true)} title={t('forgetSecret')}>
                {t('forgetSecret')}
              </button>
            )}
          </div>
          <span className="hint">{tokenSaved ? t('tokenSaved') : t('tokenHint')}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="http-headers">{t('headers')}</label>
        <textarea
          id="http-headers"
          className={`input mono cmd-textarea ${touched && errors.headers ? 'invalid' : ''}`}
          value={form.headers}
          rows={3}
          spellCheck={false}
          placeholder={'Accept: application/json\nAuthorization: Bearer $TOKEN'}
          onChange={(e) => set('headers', e.target.value)}
        />
        {touched && errors.headers ? <span className="err">{errors.headers}</span> : <span className="hint">{t('headersHint')}</span>}
      </div>
    </>
  )
}
