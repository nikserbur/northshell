import { AlertTriangle, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../../lib/useT'
import { useApp, type Dialog } from '../../store/appStore'
import { Modal } from '../Modal'
import { SessionEditor } from './SessionEditor'
import { SettingsDialog } from './SettingsDialog'

function ConfirmDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'confirm' }> }) {
  const t = useT()
  const close = useApp((s) => s.openDialog)
  return (
    <Modal
      size="narrow"
      title={dialog.text}
      icon={<AlertTriangle size={18} style={{ color: dialog.danger ? 'var(--danger)' : 'var(--warn)' }} />}
      onClose={() => close(null)}
      bodyless
      footer={
        <>
          <button className="btn ghost" onClick={() => close(null)}>
            {t('cancel')}
          </button>
          <button
            className={`btn ${dialog.danger ? 'danger' : 'primary'}`}
            autoFocus
            onClick={() => {
              close(null)
              dialog.onConfirm()
            }}
          >
            {dialog.confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ height: 12 }} />
    </Modal>
  )
}

function InputDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'input' }> }) {
  const t = useT()
  const close = useApp((s) => s.openDialog)
  const [value, setValue] = useState(dialog.value)
  const submit = (): void => {
    close(null)
    dialog.onSubmit(value)
  }
  return (
    <Modal
      size="narrow"
      title={dialog.title}
      icon={<Pencil size={16} style={{ color: 'var(--accent)' }} />}
      onClose={() => close(null)}
      footer={
        <>
          <button className="btn ghost" onClick={() => close(null)}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={!value.trim()}>
            {dialog.confirmLabel}
          </button>
        </>
      }
    >
      <input
        className="input mono"
        autoFocus
        value={value}
        spellCheck={false}
        onFocus={(e) => {
          const dot = e.target.value.lastIndexOf('.')
          e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && submit()}
      />
    </Modal>
  )
}

export function DialogHost() {
  const dialog = useApp((s) => s.dialog)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'session-editor':
      return <SessionEditor key={dialog.session?.id ?? 'new'} session={dialog.session} />
    case 'settings':
      return <SettingsDialog />
    case 'confirm':
      return <ConfirmDialog dialog={dialog} />
    case 'input':
      return <InputDialog dialog={dialog} />
  }
}
