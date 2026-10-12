import { describe, expect, it } from 'vitest'
import { modeToOctal, parseOctal } from './fileMode'

describe('modeToOctal', () => {
  it('converts ls-style permission strings', () => {
    expect(modeToOctal('-rwxr-xr-x')).toBe('755')
    expect(modeToOctal('drw-r-----')).toBe('640')
    expect(modeToOctal('-rw-r--r--')).toBe('644')
    expect(modeToOctal('bad')).toBe('644')
  })
})

describe('parseOctal', () => {
  it('accepts 3-4 octal digits only', () => {
    expect(parseOctal('755')).toBe(0o755)
    expect(parseOctal('0644')).toBe(0o644)
    expect(parseOctal(' 2775 ')).toBe(0o2775)
    expect(parseOctal('8')).toBeNull()
    expect(parseOctal('rwx')).toBeNull()
    expect(parseOctal('77777')).toBeNull()
  })
})
