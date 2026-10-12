import { indentWithTab } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { FileCode2, Loader2, Save, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes } from '@shared/format'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { useApp, type EditorDoc } from '../../store/appStore'
import { editorBridge } from './editorBridge'
import { editorTheme } from './editorTheme'
import { languageFor } from './languages'

const CONFLICT = 'REMOTE_CHANGED'

function EditorWindow({ doc }: { doc: EditorDoc }) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const mtimeRef = useRef(doc.mtime)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [size, setSize] = useState(doc.size)
  const language = languageFor(doc.path)
  const saveRef = useRef<() => void>(() => undefined)

  const close = useCallback((): void => {
    const store = useApp.getState()
    if (!dirty) return store.setEditor(null)
    store.openDialog({
      kind: 'confirm',
      text: t('unsavedClose', { name: doc.name }),
      confirmLabel: t('discard'),
      danger: true,
      onConfirm: () => useApp.getState().setEditor(null)
    })
  }, [dirty, doc.name, t])

  const write = useCallback(
    async (force: boolean): Promise<void> => {
      const view = viewRef.current
      if (!view) return
      const store = useApp.getState()
      const content = view.state.doc.toString()
      setSaving(true)
      try {
        mtimeRef.current = await window.xmt.sftp.writeFile(doc.tabId, doc.path, content, doc.encoding, force ? null : mtimeRef.current)
        setDirty(viewRef.current?.state.doc.toString() !== content)
        setSize(new TextEncoder().encode(content).length)
        store.bumpSftp()
        store.toast({ kind: 'success', text: t('savedFile', { name: doc.name }) })
      } catch (err) {
        if (errorMessage(err).includes(CONFLICT)) {
          store.openDialog({
            kind: 'confirm',
            text: t('remoteChanged', { name: doc.name }),
            confirmLabel: t('overwrite'),
            danger: true,
            onConfirm: () => void write(true)
          })
        } else {
          store.toast({ kind: 'error', text: errorMessage(err) })
        }
      } finally {
        setSaving(false)
      }
    },
    [doc, t]
  )

  saveRef.current = () => void write(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const lang = new Compartment()
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: doc.content,
        extensions: [
          basicSetup,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (saveRef.current(), true) },
            indentWithTab
          ]),
          editorTheme,
          lang.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setDirty(true)
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head
              const line = u.state.doc.lineAt(head)
              setCursor({ line: line.number, col: head - line.from + 1 })
            }
          })
        ]
      })
    })
    viewRef.current = view
    view.focus()
    let cancelled = false
    void language
      ?.load()
      .then((ext) => !cancelled && view.dispatch({ effects: lang.reconfigure(ext) }))
      .catch(() => undefined)
    return () => {
      cancelled = true
      view.destroy()
      viewRef.current = null
    }
    // The editor is created once per opened document.
  }, [doc])

  useEffect(
    () =>
      editorBridge.register({
        find: () => viewRef.current && openSearchPanel(viewRef.current),
        requestClose: close
      }),
    [close]
  )

  return (
    <div className="editor-sheet" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="editor-window" role="dialog" aria-label={doc.name}>
        <header className="editor-head">
          <FileCode2 size={17} style={{ color: 'var(--accent-fg)' }} />
          <span className="editor-name">
            {doc.name}
            {dirty && <i className="dirty-dot" title={t('unsaved')} />}
          </span>
          <span className="editor-path mono truncate">{doc.path}</span>
          <span className="editor-chip">{language?.label ?? 'Plain text'}</span>
          <button className="btn sm primary" disabled={!dirty || saving} onClick={() => void write(false)}>
            {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} {t('save')}
            <span className="kbd" style={{ marginLeft: 2 }}>⌘S</span>
          </button>
          <button className="icon-btn" onClick={close} title={`${t('closeTab')} ⌘W`}>
            <X size={16} />
          </button>
        </header>
        <div className="editor-body" ref={hostRef} />
        <footer className="editor-foot mono">
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span>{doc.encoding === 'utf8' ? 'UTF-8' : 'Latin-1'}</span>
          <span>{formatBytes(size)}</span>
          <span className="sb-spacer" />
          <span>⌘F {t('find').toLowerCase()}</span>
          <span>⌘S {t('save').toLowerCase()}</span>
        </footer>
      </div>
    </div>
  )
}

export function FileEditor() {
  const doc = useApp((s) => s.editor)
  if (!doc) return null
  return <EditorWindow key={`${doc.tabId}:${doc.path}`} doc={doc} />
}
