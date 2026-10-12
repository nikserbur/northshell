import { ArrowDown, ArrowUp, Radio, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/useT'
import { closeTab, connectTab, reconnectTab } from '../store/actions'
import { useApp, type Tab } from '../store/appStore'
import { registry } from '../terminal/registry'
import { Welcome } from './Welcome'

function TerminalView({ tabId, active }: { tabId: string; active: boolean }) {
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const entry = registry.attach(tabId, inner)
    if (!entry) return
    let raf = 0
    const scheduleFit = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => registry.fit(tabId))
    }
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(inner)
    const resizeSub = entry.term.onResize(({ cols, rows }) => window.xmt.term.resize(tabId, cols, rows))
    const selSub = entry.term.onSelectionChange(() => {
      if (useApp.getState().settings.copyOnSelect && entry.term.hasSelection()) {
        void navigator.clipboard.writeText(entry.term.getSelection())
      }
    })
    const onContext = (e: MouseEvent): void => {
      if (!useApp.getState().settings.rightClickPaste) return
      e.preventDefault()
      if (entry.term.hasSelection()) {
        void navigator.clipboard.writeText(entry.term.getSelection())
        entry.term.clearSelection()
      } else {
        void navigator.clipboard.readText().then((text) => text && entry.term.paste(text))
      }
    }
    inner.addEventListener('contextmenu', onContext)
    if (entry.needsConnect) {
      requestAnimationFrame(() => {
        registry.fit(tabId)
        connectTab(tabId)
      })
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      resizeSub.dispose()
      selSub.dispose()
      inner.removeEventListener('contextmenu', onContext)
    }
  }, [tabId])

  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      registry.fit(tabId)
      registry.focus(tabId)
    })
    return () => cancelAnimationFrame(raf)
  }, [active, tabId])

  return (
    <div className={`term-host ${active ? 'active' : ''}`} onMouseDown={() => registry.focus(tabId)}>
      <div ref={innerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function DisconnectedOverlay({ tab }: { tab: Tab }) {
  const t = useT()
  if (tab.status !== 'closed' && tab.status !== 'error') return null
  return (
    <div className="term-overlay">
      <span className={`dot ${tab.status}`} />
      <span className="msg truncate">{tab.message ?? t('sessionEnded')}</span>
      <button className="btn sm primary" onClick={() => reconnectTab(tab.id)}>
        <RotateCw size={13} /> {t('reconnect')}
      </button>
      <button className="btn sm ghost" onClick={() => closeTab(tab.id)} title={`${t('closeTab')} ⌘W`}>
        <X size={13} />
      </button>
    </div>
  )
}

function FindBar({ tabId }: { tabId: string }) {
  const t = useT()
  const setFindOpen = useApp((s) => s.setFindOpen)
  const [query, setQuery] = useState('')
  const search = registry.get(tabId)?.search
  const opts = {
    decorations: {
      matchBackground: '#fbbf2433',
      activeMatchBackground: '#fbbf24aa',
      matchOverviewRuler: '#fbbf24',
      activeMatchColorOverviewRuler: '#f59e0b'
    }
  }

  const close = (): void => {
    search?.clearDecorations()
    setFindOpen(false)
    registry.focus(tabId)
  }

  return (
    <div className="find-bar">
      <input
        autoFocus
        value={query}
        placeholder={t('findPlaceholder')}
        onChange={(e) => {
          setQuery(e.target.value)
          if (e.target.value) search?.findNext(e.target.value, { ...opts, incremental: true })
          else search?.clearDecorations()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && query) {
            if (e.shiftKey) search?.findPrevious(query, opts)
            else search?.findNext(query, opts)
          }
        }}
      />
      <button className="icon-btn sm" onClick={() => query && search?.findPrevious(query, opts)} title={`${t('findPrev')} ⇧↩`}>
        <ArrowUp size={13} />
      </button>
      <button className="icon-btn sm" onClick={() => query && search?.findNext(query, opts)} title={`${t('findNext')} ↩`}>
        <ArrowDown size={13} />
      </button>
      <button className="icon-btn sm" onClick={close} title={`${t('close')} esc`}>
        <X size={13} />
      </button>
    </div>
  )
}

export function TerminalArea() {
  const t = useT()
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const findOpen = useApp((s) => s.findOpen)
  const broadcast = useApp((s) => s.broadcast)
  const active = tabs.find((tab) => tab.id === activeId)

  return (
    <section className="terminal-area">
      {broadcast && (
        <div className="broadcast-banner">
          <Radio size={13} /> {t('broadcastOn')}
        </div>
      )}
      {tabs.map((tab) => (
        <TerminalView key={tab.id} tabId={tab.id} active={tab.id === activeId} />
      ))}
      {active && <DisconnectedOverlay tab={active} />}
      {active && findOpen && <FindBar tabId={active.id} />}
      {!active && <Welcome />}
    </section>
  )
}
