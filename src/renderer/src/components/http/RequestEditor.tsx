import { FolderOpen, KeyRound, Plus, WandSparkles, X } from 'lucide-react'
import { useState } from 'react'
import { BODY_KINDS, bodyKindOf, headerRowsText, parseHeaderRows, parseQuery, withQuery, type BodyKind, type RequestAuth } from '@shared/httpBody'
import { formatJson, looksLikeJson, type HttpRequestSpec } from '@shared/httpRequest'
import { TEST_OPS, TEST_TARGETS, type ExtractRule, type TestOp, type TestRule, type TestTarget } from '@shared/httpTests'
import type { SessionConfig } from '@shared/types'
import type { I18nKey } from '../../lib/i18n'
import { useT } from '../../lib/useT'
import { CodeView } from './CodeView'
import { KeyValueTable, type KeyValueRow } from './KeyValueTable'

const COMMON_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-None-Match',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Api-Key',
  'X-Request-Id'
] as const

const BODY_LABELS: Record<BodyKind, I18nKey | 'JSON' | 'XML' | 'GraphQL'> = {
  none: 'bodyNone',
  json: 'JSON',
  xml: 'XML',
  text: 'bodyText',
  form: 'bodyForm',
  multipart: 'bodyMultipart',
  file: 'bodyFile',
  graphql: 'GraphQL'
}
const TARGET_LABELS: Record<TestTarget, I18nKey> = { status: 'testStatus', time: 'testTime', size: 'testSize', header: 'testHeader', json: 'testJson', body: 'testBody' }
const OP_LABELS: Record<TestOp, I18nKey> = { eq: 'opEq', ne: 'opNe', gt: 'opGt', lt: 'opLt', contains: 'opContains', exists: 'opExists', matches: 'opMatches' }

export type RequestSection = 'params' | 'auth' | 'headers' | 'body' | 'tests' | 'settings'

interface Props {
  spec: HttpRequestSpec
  setSpec: (patch: Partial<HttpRequestSpec>) => void
  session: SessionConfig
  envHeaders: string[]
  section: RequestSection
}

function ParamsSection({ spec, setSpec }: Pick<Props, 'spec' | 'setSpec'>) {
  const { base, params, hash } = parseQuery(spec.url)
  const rows: KeyValueRow[] = [...params.map((p) => ({ ...p, enabled: true })), ...(spec.disabledParams ?? []).map((p) => ({ ...p, enabled: false }))]
  const change = (next: KeyValueRow[]): void => {
    setSpec({
      url: withQuery(base, next.filter((r) => r.enabled).map(({ name, value }) => ({ name, value })), hash),
      disabledParams: next.filter((r) => !r.enabled).map(({ name, value }) => ({ name, value }))
    })
  }
  return <KeyValueTable rows={rows} onChange={change} />
}

function HeadersSection({ spec, setSpec, envHeaders }: Pick<Props, 'spec' | 'setSpec' | 'envHeaders'>) {
  const t = useT()
  const [bulk, setBulk] = useState(false)
  return (
    <>
      <div className="http-section-tools">
        {envHeaders.length > 0 && <span className="http-hint truncate">{t('envAddsHeaders', { names: envHeaders.join(', ') })}</span>}
        <button className="btn sm ghost" onClick={() => setBulk(!bulk)}>
          {bulk ? t('headerTable') : t('headerBulk')}
        </button>
      </div>
      {bulk ? (
        <textarea
          className="input mono http-text"
          rows={6}
          value={spec.headers}
          spellCheck={false}
          placeholder={'X-Request-Id: 42\nAuthorization: Bearer $TOKEN'}
          onChange={(e) => setSpec({ headers: e.target.value })}
        />
      ) : (
        <KeyValueTable rows={parseHeaderRows(spec.headers)} names={COMMON_HEADERS} onChange={(rows) => setSpec({ headers: headerRowsText(rows) })} />
      )}
    </>
  )
}

function AuthSection({ spec, setSpec, session, envHeaders }: Omit<Props, 'section'>) {
  const t = useT()
  const auth: RequestAuth = spec.auth ?? { type: 'none' }
  const setAuth = (next: RequestAuth): void => setSpec({ auth: next })
  const field = (label: string, value: string, onChange: (v: string) => void, secret = false) => (
    <label className="http-field">
      <span>{label}</span>
      <input className="input mono" type={secret ? 'password' : 'text'} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
  return (
    <div className="http-form-grid">
      <label className="http-field">
        <span>{t('httpTabAuth')}</span>
        <select
          className="input"
          value={auth.type}
          onChange={(e) => {
            const type = e.target.value as RequestAuth['type']
            if (type === 'none') setAuth({ type })
            if (type === 'bearer') setAuth({ type, token: '' })
            if (type === 'basic') setAuth({ type, username: '', password: '' })
            if (type === 'apikey') setAuth({ type, name: 'X-Api-Key', value: '', in: 'header' })
          }}
        >
          <option value="none">{t('authNone')}</option>
          <option value="bearer">{t('authBearer')}</option>
          <option value="basic">{t('authBasic')}</option>
          <option value="apikey">{t('authApiKey')}</option>
        </select>
      </label>
      {auth.type === 'bearer' && (
        <>
          {field(t('authToken'), auth.token, (token) => setAuth({ ...auth, token }))}
          {session.hasSecret && (
            <button className="btn sm ghost http-field-action" onClick={() => setAuth({ ...auth, token: '$TOKEN' })}>
              <KeyRound size={13} /> {t('authUseEnvToken')}
            </button>
          )}
        </>
      )}
      {auth.type === 'basic' && (
        <>
          {field(t('authUsername'), auth.username, (username) => setAuth({ ...auth, username }))}
          {field(t('authPassword'), auth.password, (password) => setAuth({ ...auth, password }), true)}
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          {field(t('authKeyName'), auth.name, (name) => setAuth({ ...auth, name }))}
          {field(t('authKeyValue'), auth.value, (value) => setAuth({ ...auth, value }))}
          <label className="http-field">
            <span />
            <select className="input" value={auth.in} onChange={(e) => setAuth({ ...auth, in: e.target.value as 'header' | 'query' })}>
              <option value="header">{t('authInHeader')}</option>
              <option value="query">{t('authInQuery')}</option>
            </select>
          </label>
        </>
      )}
      {auth.type !== 'none' && <p className="http-hint">{t('authHint')}</p>}
      {auth.type === 'bearer' && envHeaders.some((n) => n.toLowerCase() === 'authorization') && <p className="http-hint">{t('authEnvHint')}</p>}
    </div>
  )
}

function BodySection({ spec, setSpec }: Pick<Props, 'spec' | 'setSpec'>) {
  const t = useT()
  const kind = bodyKindOf(spec)
  const label = (k: BodyKind): string => {
    const key = BODY_LABELS[k]
    return key === 'JSON' || key === 'XML' || key === 'GraphQL' ? key : t(key)
  }
  const pickFile = (): Promise<string | null> => window.xmt.http.pickFile()
  const pickBodyFile = async (): Promise<void> => {
    const path = await pickFile()
    if (path) setSpec({ filePath: path })
  }
  const setKind = (next: BodyKind): void => setSpec({ bodyKind: next, ...(next === 'graphql' && spec.method === 'GET' ? { method: 'POST' } : {}) })
  const formatBody = (): void => {
    const formatted = formatJson(spec.body)
    if (formatted !== null) setSpec({ body: formatted })
  }
  const variablesOk = !spec.graphqlVariables?.trim() || looksLikeJson(spec.graphqlVariables)
  return (
    <>
      <div className="http-section-tools">
        <select className="input http-body-kind" value={kind} aria-label={t('requestBody')} disabled={spec.method === 'HEAD'} onChange={(e) => setKind(e.target.value as BodyKind)}>
          {BODY_KINDS.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
        {kind === 'json' && looksLikeJson(spec.body) && (
          <button className="btn sm ghost" onClick={formatBody} title={t('formatJson')}>
            <WandSparkles size={12} /> {t('formatJson')}
          </button>
        )}
        {kind === 'json' && spec.body.trim() && !looksLikeJson(spec.body) && !spec.body.includes('{{') && <span className="http-hint warn">{t('notJsonBody')}</span>}
      </div>
      {(kind === 'json' || kind === 'xml' || kind === 'text') && (
        <div className="http-code">
          <CodeView
            value={spec.body}
            languageFile={kind === 'json' ? 'body.json' : kind === 'xml' ? 'body.xml' : undefined}
            placeholder={kind === 'json' ? '{\n  "name": "value"\n}' : undefined}
            onChange={(body) => setSpec({ body, bodyKind: kind })}
          />
        </div>
      )}
      {kind === 'form' && <KeyValueTable rows={spec.form ?? []} onChange={(form) => setSpec({ form })} />}
      {kind === 'multipart' && <KeyValueTable rows={spec.form ?? []} allowFiles onPickFile={pickFile} onChange={(form) => setSpec({ form })} />}
      {kind === 'file' && (
        <button className="btn sm http-file-pick" onClick={() => void pickBodyFile()}>
          <FolderOpen size={13} /> <span className="truncate">{spec.filePath || t('bodyPickFile')}</span>
        </button>
      )}
      {kind === 'graphql' && (
        <div className="http-graphql">
          <span className="field-label">{t('graphqlQuery')}</span>
          <div className="http-code">
            <CodeView value={spec.body} placeholder={'query {\n  me { id name }\n}'} onChange={(body) => setSpec({ body })} />
          </div>
          <span className="field-label">
            {t('graphqlVariables')} {!variablesOk && <span className="http-hint warn">{t('graphqlBadVariables')}</span>}
          </span>
          <div className="http-code small">
            <CodeView value={spec.graphqlVariables ?? ''} languageFile="vars.json" onChange={(graphqlVariables) => setSpec({ graphqlVariables })} />
          </div>
        </div>
      )}
    </>
  )
}

function TestsSection({ spec, setSpec }: Pick<Props, 'spec' | 'setSpec'>) {
  const t = useT()
  const tests = spec.tests ?? []
  const extract = spec.extract ?? []
  const setTest = (i: number, patch: Partial<TestRule>): void => setSpec({ tests: tests.map((r, n) => (n === i ? { ...r, ...patch } : r)) })
  const setExtract = (i: number, patch: Partial<ExtractRule>): void => setSpec({ extract: extract.map((r, n) => (n === i ? { ...r, ...patch } : r)) })
  return (
    <div className="http-tests">
      <span className="field-label">{t('testsTitle')}</span>
      <p className="http-hint">{t('testsHint')}</p>
      {tests.map((r, i) => (
        <div key={i} className={`test-row ${r.enabled ? '' : 'off'}`}>
          <input type="checkbox" checked={r.enabled} aria-label={t('testsTitle')} onChange={(e) => setTest(i, { enabled: e.target.checked })} />
          <select className="input" value={r.target} aria-label={t('testsTitle')} onChange={(e) => setTest(i, { target: e.target.value as TestTarget })}>
            {TEST_TARGETS.map((k) => (
              <option key={k} value={k}>
                {t(TARGET_LABELS[k])}
              </option>
            ))}
          </select>
          {(r.target === 'header' || r.target === 'json') && (
            <input
              className="input mono"
              value={r.path}
              spellCheck={false}
              placeholder={r.target === 'json' ? t('testPathPlaceholder') : 'Content-Type'}
              onChange={(e) => setTest(i, { path: e.target.value })}
            />
          )}
          <select className="input" value={r.op} aria-label={t('testsTitle')} onChange={(e) => setTest(i, { op: e.target.value as TestOp })}>
            {TEST_OPS.map((k) => (
              <option key={k} value={k}>
                {t(OP_LABELS[k])}
              </option>
            ))}
          </select>
          {r.op !== 'exists' && <input className="input mono" value={r.value} spellCheck={false} placeholder="200" onChange={(e) => setTest(i, { value: e.target.value })} />}
          <button className="icon-btn sm" onClick={() => setSpec({ tests: tests.filter((_, n) => n !== i) })} title={t('paramDelete')}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn sm ghost http-add" onClick={() => setSpec({ tests: [...tests, { target: 'status', path: '', op: 'eq', value: '200', enabled: true }] })}>
        <Plus size={13} /> {t('testAdd')}
      </button>

      <span className="field-label">{t('extractTitle')}</span>
      <p className="http-hint">{t('extractHint')}</p>
      {extract.map((r, i) => (
        <div key={i} className={`test-row ${r.enabled ? '' : 'off'}`}>
          <input type="checkbox" checked={r.enabled} aria-label={t('extractTitle')} onChange={(e) => setExtract(i, { enabled: e.target.checked })} />
          <select className="input" value={r.source} aria-label={t('extractTitle')} onChange={(e) => setExtract(i, { source: e.target.value as 'json' | 'header' })}>
            <option value="json">{t('testJson')}</option>
            <option value="header">{t('testHeader')}</option>
          </select>
          <input
            className="input mono"
            value={r.path}
            spellCheck={false}
            placeholder={r.source === 'json' ? '$.token' : 'X-Request-Id'}
            onChange={(e) => setExtract(i, { path: e.target.value })}
          />
          <span className="test-arrow">→</span>
          <input className="input mono" value={r.variable} spellCheck={false} placeholder={t('extractVariable')} onChange={(e) => setExtract(i, { variable: e.target.value })} />
          <button className="icon-btn sm" onClick={() => setSpec({ extract: extract.filter((_, n) => n !== i) })} title={t('paramDelete')}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn sm ghost http-add" onClick={() => setSpec({ extract: [...extract, { source: 'json', path: '', variable: '', enabled: true }] })}>
        <Plus size={13} /> {t('extractAdd')}
      </button>
    </div>
  )
}

function SettingsSection({ spec, setSpec }: Pick<Props, 'spec' | 'setSpec'>) {
  const t = useT()
  return (
    <div className="http-form-grid">
      <label className="http-check">
        <input type="checkbox" checked={spec.followRedirects} onChange={(e) => setSpec({ followRedirects: e.target.checked })} />
        {t('followRedirects')}
      </label>
      <label className="http-check">
        <input type="checkbox" checked={spec.saveCookies !== false} onChange={(e) => setSpec({ saveCookies: e.target.checked })} />
        {t('settingCookies')}
      </label>
      <label className="http-check">
        <input type="checkbox" checked={spec.insecure === true} onChange={(e) => setSpec({ insecure: e.target.checked })} />
        {t('settingInsecure')}
      </label>
      <label className="http-field">
        <span>{t('settingTimeout')}</span>
        <input
          className="input mono http-number"
          type="number"
          min={1}
          max={3600}
          value={spec.timeoutSec ?? ''}
          placeholder="60"
          onChange={(e) => {
            const value = Math.min(3600, Math.max(1, Math.floor(Number(e.target.value))))
            setSpec({ timeoutSec: e.target.value && Number.isFinite(value) ? value : undefined })
          }}
        />
      </label>
    </div>
  )
}

/** The request's tabs: everything Postman and Insomnia put around the address bar. */
export function RequestEditor({ spec, setSpec, session, envHeaders, section }: Props) {
  return (
    <div className="http-section">
      {section === 'params' && <ParamsSection spec={spec} setSpec={setSpec} />}
      {section === 'auth' && <AuthSection spec={spec} setSpec={setSpec} session={session} envHeaders={envHeaders} />}
      {section === 'headers' && <HeadersSection spec={spec} setSpec={setSpec} envHeaders={envHeaders} />}
      {section === 'body' && <BodySection spec={spec} setSpec={setSpec} />}
      {section === 'tests' && <TestsSection spec={spec} setSpec={setSpec} />}
      {section === 'settings' && <SettingsSection spec={spec} setSpec={setSpec} />}
    </div>
  )
}
