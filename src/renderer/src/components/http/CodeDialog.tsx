import { ClipboardCopy, Code2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CODE_TARGETS, CODE_TARGET_LABELS, generateCode, type CodeTarget } from '@shared/httpCodegen'
import { fillRequest } from '@shared/httpVars'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { EMPTY_HTTP_PANEL, useApp } from '../../store/appStore'
import { Modal } from '../Modal'
import { CodeView } from './CodeView'

const LANGUAGE: Record<CodeTarget, string> = { curl: 'cmd.sh', fetch: 'code.js', python: 'code.py', httpie: 'cmd.sh' }

/** The same request as a snippet for other tools, like Postman's Code panel. */
export function CodeDialog({ tabId }: { tabId: string }) {
  const t = useT()
  const openDialog = useApp((s) => s.openDialog)
  const toast = useApp((s) => s.toast)
  const panel = useApp((s) => s.httpPanels[tabId]) ?? EMPTY_HTTP_PANEL
  const session = useApp((s) => s.sessions.find((x) => x.id === s.tabs.find((y) => y.id === tabId)?.sessionId))
  const vars = useApp((s) => (session ? s.httpWorkspace.vars[session.id] : undefined))
  const [target, setTarget] = useState<CodeTarget>('curl')
  const code = useMemo(() => {
    try {
      return generateCode(target, fillRequest(panel.spec, vars ?? {}), { baseUrl: session?.baseUrl ?? '', envHeaders: session?.headers ?? '' })
    } catch (err) {
      return errorMessage(err)
    }
  }, [target, panel.spec, vars, session])
  const copy = (): void => {
    navigator.clipboard
      .writeText(code)
      .then(() => toast({ kind: 'success', text: t('copied') }))
      .catch((err: unknown) => toast({ kind: 'error', text: errorMessage(err) }))
  }
  return (
    <Modal
      size="wide"
      title={t('httpCodeTitle')}
      icon={<Code2 size={17} style={{ color: 'var(--accent)' }} />}
      onClose={() => openDialog(null)}
      footer={
        <button className="btn primary" onClick={copy}>
          <ClipboardCopy size={13} /> {t('httpCopyCode')}
        </button>
      }
    >
      <div className="segmented sm http-code-targets">
        {CODE_TARGETS.map((x) => (
          <button key={x} className={target === x ? 'on' : ''} onClick={() => setTarget(x)}>
            {CODE_TARGET_LABELS[x]}
          </button>
        ))}
      </div>
      <div className="http-code tall">
        <CodeView value={code} languageFile={LANGUAGE[target]} />
      </div>
      <p className="http-hint">{t('httpCodeHint')}</p>
    </Modal>
  )
}
