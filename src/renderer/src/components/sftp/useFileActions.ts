import { useMemo } from 'react'
import { modeToOctal, parseOctal } from '@shared/fileMode'
import type { SftpEntry } from '@shared/types'
import { useT } from '../../lib/useT'
import { errorMessage } from '../../lib/util'
import { useApp } from '../../store/appStore'

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

export function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx)
}

function validName(name: string): boolean {
  const n = name.trim()
  return n.length > 0 && n !== '.' && n !== '..' && !n.includes('/')
}

/** All remote file operations of the SFTP panel, with confirmations and error toasts. */
export function useFileActions(tabId: string, path: string | undefined, reload: () => void) {
  const t = useT()
  const confirmDelete = useApp((s) => s.settings.confirmDelete)

  return useMemo(() => {
    const api = window.xmt.sftp
    const store = (): ReturnType<typeof useApp.getState> => useApp.getState()
    const fail = (err: unknown): void => store().toast({ kind: 'error', text: errorMessage(err) })
    const ask = (title: string, value: string, onSubmit: (v: string) => void): void =>
      store().openDialog({ kind: 'input', title, value, confirmLabel: t('save'), onSubmit })

    const download = (items: SftpEntry[], askDir: boolean): void => {
      if (items.length > 0) api.download(tabId, items.map((i) => i.path), askDir).catch(fail)
    }

    const upload = (localPaths: string[]): void => {
      if (path && localPaths.length > 0) api.upload(tabId, path, localPaths).catch(fail)
    }

    const remove = (items: SftpEntry[]): void => {
      if (items.length === 0) return
      const run = async (): Promise<void> => {
        try {
          for (const item of items) await api.remove(tabId, item.path)
        } catch (err) {
          fail(err)
        }
        reload()
      }
      if (!confirmDelete) return void run()
      store().openDialog({
        kind: 'confirm',
        text: items.length === 1 ? t('deleteConfirm', { name: items[0].name }) : t('deleteManyConfirm', { n: items.length }),
        confirmLabel: t('delete'),
        danger: true,
        onConfirm: () => void run()
      })
    }

    const mkdir = (): void => {
      if (!path) return
      ask(t('newFolder'), '', (name) => {
        if (validName(name)) api.mkdir(tabId, joinPath(path, name.trim())).then(reload).catch(fail)
      })
    }

    const openInEditor = async (filePath: string, name: string): Promise<void> => {
      try {
        const file = await api.readFile(tabId, filePath)
        store().setEditor({ ...file, tabId, name })
      } catch (err) {
        store().toast({ kind: 'error', text: `${name}: ${errorMessage(err)}` })
      }
    }

    const newFile = (): void => {
      if (!path) return
      ask(t('newFile'), '', (name) => {
        if (!validName(name)) return
        const target = joinPath(path, name.trim())
        api
          .createFile(tabId, target)
          .then(() => {
            reload()
            return openInEditor(target, name.trim())
          })
          .catch(fail)
      })
    }

    const rename = (item: SftpEntry): void => {
      if (!path) return
      ask(t('rename'), item.name, (name) => {
        if (validName(name) && name.trim() !== item.name) {
          api.rename(tabId, item.path, joinPath(parentOf(item.path), name.trim())).then(reload).catch(fail)
        }
      })
    }

    const chmod = (item: SftpEntry): void => {
      ask(`${t('permissions')} — ${item.name}`, modeToOctal(item.mode), (value) => {
        const mode = parseOctal(value)
        if (mode === null) return store().toast({ kind: 'error', text: t('invalidMode') })
        api.chmod(tabId, item.path, mode).then(reload).catch(fail)
      })
    }

    const copyPaths = (items: SftpEntry[]): void => {
      void navigator.clipboard.writeText(items.map((i) => i.path).join('\n'))
      store().toast({ kind: 'info', text: t('copied') })
    }

    return { download, upload, remove, mkdir, newFile, rename, chmod, openInEditor, copyPaths }
  }, [tabId, path, reload, t, confirmDelete])
}
