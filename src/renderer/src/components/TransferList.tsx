import { ArrowDown, ArrowUp, FolderSearch } from 'lucide-react'
import { formatBytes } from '@shared/format'
import { useT } from '../lib/useT'
import { useApp } from '../store/appStore'

export function TransferList({ tabId }: { tabId: string }) {
  const t = useT()
  const transfers = useApp((s) => s.transfers).filter((x) => x.tabId === tabId)
  const clear = useApp((s) => s.clearFinishedTransfers)
  if (transfers.length === 0) return null
  const recent = transfers.slice(-50).reverse()

  return (
    <div className="transfers">
      <div className="transfers-head">
        {t('transfers')} · {transfers.filter((x) => x.state === 'done').length}/{transfers.length}
        <button className="btn sm ghost" onClick={() => clear(tabId)}>
          {t('clearDone')}
        </button>
      </div>
      <div className="transfers-list">
        {recent.map((x) => {
          const pct = x.total > 0 ? Math.min(1, x.transferred / x.total) : x.state === 'done' ? 1 : 0
          return (
            <div key={x.id} className={`transfer ${x.state}`} title={x.error ?? `${x.remotePath} ⇄ ${x.localPath}`}>
              {x.direction === 'upload' ? <ArrowUp size={13} className="up" /> : <ArrowDown size={13} className="down" />}
              <span className="truncate">{x.name}</span>
              <span className="pct">
                {x.state === 'error' ? '✖' : x.state === 'done' ? formatBytes(x.total) : `${Math.round(pct * 100)}%`}
                {x.state === 'done' && x.direction === 'download' && (
                  <button
                    className="icon-btn sm"
                    style={{ marginLeft: 2, verticalAlign: 'middle' }}
                    title={t('showInFinder')}
                    onClick={() => void window.xmt.app.showInFolder(x.localPath)}
                  >
                    <FolderSearch size={12} />
                  </button>
                )}
              </span>
              <div className="bar">
                <i style={{ transform: `scaleX(${pct})` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
