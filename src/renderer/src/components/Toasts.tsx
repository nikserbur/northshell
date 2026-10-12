import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp } from '../store/appStore'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          {toast.kind === 'success' ? <CheckCircle2 size={16} /> : toast.kind === 'error' ? <XCircle size={16} /> : <Info size={16} />}
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="btn sm"
              onClick={() => {
                toast.action?.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="icon-btn sm" onClick={() => dismiss(toast.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
