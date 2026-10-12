import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** Editor chrome driven by the app's CSS variables, so it follows dark/light theme and accent. */
const chrome = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface-0)', color: 'var(--text-0)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 24%, transparent) !important'
  },
  '.cm-gutters': { backgroundColor: 'var(--surface-0)', color: 'var(--text-3)', border: 'none', paddingRight: '6px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-1)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--text-0) 4%, transparent)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-3)', border: 'none', color: 'var(--text-1)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--warn) 30%, transparent)', outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--warn) 60%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--accent) 14%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in oklab, var(--accent) 22%, transparent)', outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text-0)', borderTop: '1px solid var(--line)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panel.cm-search': { padding: '8px 10px', fontFamily: 'var(--font-ui)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'var(--font-ui)', fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--surface-0)',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    color: 'var(--text-0)',
    padding: '3px 7px'
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface-3)',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    color: 'var(--text-0)'
  },
  '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--line-strong)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text-0)' }
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.heading], color: 'var(--syn-tag)', fontWeight: '600' },
  { tag: [t.definition(t.variableName), t.variableName], color: 'var(--text-0)' },
  { tag: [t.meta, t.processingInstruction, t.punctuation, t.bracket], color: 'var(--text-1)' },
  { tag: t.link, color: 'var(--info)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.invalid, color: 'var(--danger)' }
])

export const editorTheme: Extension = [chrome, syntaxHighlighting(highlight)]
