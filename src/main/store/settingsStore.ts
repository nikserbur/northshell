import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { AppSettings } from '@shared/types'
import { JsonFile } from './jsonFile'
import { settingsPatchSchema, settingsShape } from './schemas'

/** Keeps every individually valid key, so one bad or obsolete key never resets all settings. */
function validKeys(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const shape = settingsShape.shape as Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const result = shape[key]?.safeParse(value)
    if (result?.success) out[key] = result.data
  }
  return out as Partial<AppSettings>
}

export class SettingsStore {
  private file: JsonFile<Partial<AppSettings>>
  private current: AppSettings

  constructor(path: string) {
    this.file = new JsonFile(path, () => ({}))
    this.current = { ...DEFAULT_SETTINGS, ...validKeys(this.file.read()) }
  }

  get(): AppSettings {
    return this.current
  }

  set(patch: unknown): AppSettings {
    const parsed = settingsPatchSchema.parse(patch)
    this.current = { ...this.current, ...parsed }
    this.file.write(this.current)
    return this.current
  }
}
