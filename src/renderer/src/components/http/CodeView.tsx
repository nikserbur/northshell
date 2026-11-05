import { openSearchPanel } from '@codemirror/search'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { editorTheme } from '../editor/editorTheme'
import { languageFor } from '../editor/languages'

interface Props {
  value: string
  /** Left out, the view is read-only (folding, selection and ⌘F still work). */
  onChange?: (value: string) => void
  /** File name standing in for the language, e.g. `body.json`. */
  languageFile?: string
  wrap?: boolean
  placeholder?: string
}

/**
 * ⌘F comes from the app menu, so it has to be routed here: the focused code view, or else the response
 * of a workspace that covers the terminal. False when neither is on screen.
 */
export function openCodeSearch(): boolean {
  const el = document.activeElement?.closest('.code-view .cm-editor') ?? document.querySelector('.http-panel.expanded .http-body .cm-editor')
  const view = el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
  if (!view) return false
  openSearchPanel(view)
  return true
}

/** CodeMirror for request and response bodies: highlighting, folding and search for free. */
export function CodeView({ value, onChange, languageFile, wrap = true, placeholder }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const lang = useRef(new Compartment())
  const wrapping = useRef(new Compartment())
  const readOnly = onChange === undefined

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          // ⌘↩ belongs to the panel (send), not to CodeMirror's "insert blank line".
          Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => true }])),
          editorTheme,
          lang.current.of([]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          EditorState.readOnly.of(readOnly),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeRef.current?.(u.state.doc.toString())
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Created once; the value, language and wrapping follow below.
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  useEffect(() => {
    let cancelled = false
    const info = languageFile ? languageFor(languageFile) : null
    if (!info) {
      viewRef.current?.dispatch({ effects: lang.current.reconfigure([]) })
      return
    }
    void info
      .load()
      .then((ext) => !cancelled && viewRef.current?.dispatch({ effects: lang.current.reconfigure(ext) }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [languageFile, readOnly])

  return <div ref={hostRef} className="code-view" />
}
