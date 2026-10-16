import { Activity, Command, Globe, House, PanelLeftOpen, Plus, Radio, ScrollText, Settings, SquareTerminal, X } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { useT } from '../lib/useT'
import { closeTab, openLocal, setPanelOpen } from '../store/actions'
import { useApp } from '../store/appStore'

export function TabBar({ sidebarOpen, onShowSidebar }: { sidebarOpen: boolean; onShowSidebar: () => void }) {
  const t = useT()
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)
  const moveTab = useApp((s) => s.moveTab)
  const broadcast = useApp((s) => s.broadcast)
  const setBroadcast = useApp((s) => s.setBroadcast)
  const monitorOpen = useApp((s) => s.monitorOpen)
  const setMonitorOpen = useApp((s) => s.setMonitorOpen)
  const setPalette = useApp((s) => s.setPalette)
  const openDialog = useApp((s) => s.openDialog)
  const commandsOpen = useApp((s) => s.settings.commandsPanelOpen)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const onDrop = (e: DragEvent, idx: number): void => {
    e.preventDefault()
    if (dragIdx !== null && dragIdx !== idx) moveTab(dragIdx, idx)
    setDragIdx(null)
  }

  return (
    <header className={`titlebar drag ${sidebarOpen ? '' : 'no-sidebar'}`}>
      {!sidebarOpen && (
        <button className="icon-btn no-drag" onClick={onShowSidebar} title={t('toggleSidebar')}>
          <PanelLeftOpen size={16} />
        </button>
      )}
      <nav className="tabs" aria-label="Tabs">
        <button
          className={`tab home no-drag ${activeId === null ? 'active' : ''}`}
          onClick={() => setActive(null)}
          title={t('home')}
        >
          <House size={14} />
        </button>
        {tabs.map((tab, idx) => (
          <div
            key={tab.id}
            data-id={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={`tab no-drag ${tab.id === activeId ? 'active' : ''} ${dragIdx === idx ? 'dragging' : ''}`}
            style={{ ['--tab-color' as string]: tab.color }}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, idx)}
            onDragEnd={() => setDragIdx(null)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                closeTab(tab.id)
              }
            }}
            onClick={() => setActive(tab.id)}
            title={tab.endpoint ?? tab.title}
          >
            {tab.kind === 'local' ? (
              <SquareTerminal size={13} style={{ flex: 'none', opacity: 0.7 }} />
            ) : tab.kind === 'http' ? (
              <Globe size={13} className={`tab-kind ${tab.status}`} />
            ) : (
              <span className={`dot ${tab.status}`} />
            )}
            <span className="tab-title truncate">{tab.title}</span>
            <button
              className="icon-btn sm tab-close"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              title={`${t('closeTab')} ⌘W`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="icon-btn no-drag" onClick={() => openLocal()} title={`${t('localTerminal')} ⌘T`}>
          <Plus size={16} />
        </button>
      </nav>
      <div className="titlebar-actions no-drag">
        <button
          className={`icon-btn ${broadcast ? 'on' : ''}`}
          onClick={() => setBroadcast(!broadcast)}
          title={t('broadcast')}
        >
          <Radio size={15} />
        </button>
        <button
          className={`icon-btn ${monitorOpen ? 'on' : ''}`}
          onClick={() => setMonitorOpen(!monitorOpen)}
          title={`${t('toggleMonitor')} ⇧⌘M`}
        >
          <Activity size={15} />
        </button>
        <button
          className={`icon-btn ${commandsOpen ? 'on' : ''}`}
          onClick={() => setPanelOpen('commandsPanelOpen', !commandsOpen)}
          title={`${t('commandLibrary')} ⇧⌘L`}
        >
          <ScrollText size={15} />
        </button>
        <button className="icon-btn" onClick={() => setPalette(true)} title={`${t('paletteHint')} ⌘P`}>
          <Command size={15} />
        </button>
        <button className="icon-btn" onClick={() => openDialog({ kind: 'settings' })} title={`${t('settings')} ⌘,`}>
          <Settings size={15} />
        </button>
      </div>
    </header>
  )
}
