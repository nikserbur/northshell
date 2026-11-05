import { Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useT } from '../../lib/useT'
import { updateHttpWorkspace } from '../../store/actions'
import { EMPTY_HTTP_PANEL, useApp } from '../../store/appStore'
import { Modal } from '../Modal'

/** Names a request and puts it into a collection. */
export function SaveRequestDialog({ tabId }: { tabId: string }) {
  const t = useT()
  const openDialog = useApp((s) => s.openDialog)
  const panel = useApp((s) => s.httpPanels[tabId]) ?? EMPTY_HTTP_PANEL
  const patch = useApp((s) => s.patchHttpPanel)
  const sessionId = useApp((s) => s.tabs.find((x) => x.id === tabId)?.sessionId)
  const requests = useApp((s) => s.httpWorkspace.requests)
  const current = requests.find((r) => r.id === panel.savedId)
  const [name, setName] = useState(current?.name ?? `${panel.spec.method} ${panel.spec.url.trim() || '/'}`.slice(0, 80))
  const [folder, setFolder] = useState(current?.folder ?? '')
  const [shared, setShared] = useState(current ? !current.sessionId : false)
  const folders = useMemo(() => [...new Set(requests.map((r) => r.folder).filter(Boolean))].sort(), [requests])
  const close = (): void => openDialog(null)

  const submit = (): void => {
    if (!name.trim()) return
    void (async () => {
      const saved = await window.xmt.http.saveRequest({ name, folder, ...(shared || !sessionId ? {} : { sessionId }), spec: panel.spec })
      await updateHttpWorkspace(Promise.resolve(saved.workspace))
      patch(tabId, { savedId: saved.id })
      close()
    })().catch((err: unknown) => useApp.getState().toast({ kind: 'error', text: err instanceof Error ? err.message : String(err) }))
  }

  return (
    <Modal
      size="narrow"
      title={t('httpSaveTitle')}
      icon={<Save size={17} style={{ color: 'var(--accent)' }} />}
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            {t('cancel')}
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={submit}>
            {t('httpSave')}
          </button>
        </>
      }
    >
      <form
        className="http-save-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="field-label" htmlFor="http-save-name">
          {t('httpRequestName')}
        </label>
        <input id="http-save-name" className="input" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <label className="field-label" htmlFor="http-save-folder">
          {t('httpFolder')}
        </label>
        <input id="http-save-folder" className="input" list="http-save-folders" value={folder} maxLength={400} onChange={(e) => setFolder(e.target.value)} />
        <datalist id="http-save-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <span className="http-hint">{t('httpFolderHint')}</span>
        <label className="http-check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t('httpSharedRequest')}
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
