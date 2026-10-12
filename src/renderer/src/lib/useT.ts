import { useMemo } from 'react'
import { useApp } from '../store/appStore'
import { makeT, type Translate } from './i18n'

export function useT(): Translate {
  const lang = useApp((s) => s.settings.language)
  return useMemo(() => makeT(lang), [lang])
}
