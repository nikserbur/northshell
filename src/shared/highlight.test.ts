import { describe, expect, it } from 'vitest'
import { OutputHighlighter } from './highlight'

const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

describe('OutputHighlighter', () => {
  it('colours IPv4 addresses, URLs and keywords in plain output', () => {
    const out = new OutputHighlighter().push('ssh to 192.168.5.22 failed, see https://ubuntu.com/esm ok\r\n')
    expect(out).toContain('\x1b[38;5;213m192.168.5.22\x1b[39m')
    expect(out).toContain('\x1b[1;38;5;203mfailed\x1b[22;39m')
    expect(out).toContain('\x1b[4;38;5;75mhttps://ubuntu.com/esm\x1b[24;39m')
    expect(out).toContain('\x1b[38;5;77mok\x1b[39m')
    expect(strip(out)).toBe('ssh to 192.168.5.22 failed, see https://ubuntu.com/esm ok\r\n')
  })

  it('does not treat version numbers or longer dotted strings as IPs', () => {
    const h = new OutputHighlighter()
    expect(h.push('Linux 6.8.0-138 and 1.2.3.4.5 and v10.0.0.1x')).toBe('Linux 6.8.0-138 and 1.2.3.4.5 and v10.0.0.1x')
  })

  it('leaves text alone while the program sets its own colours', () => {
    const h = new OutputHighlighter()
    const input = '\x1b[32mall ok 10.0.0.1\x1b[0m error'
    const out = h.push(input)
    expect(out.startsWith('\x1b[32mall ok 10.0.0.1\x1b[0m')).toBe(true)
    expect(out).toContain('\x1b[1;38;5;203merror\x1b[22;39m')
  })

  it('keeps escape sequences intact across chunk boundaries', () => {
    const h = new OutputHighlighter()
    const a = h.push('warning \x1b[3')
    const b = h.push('1mred\x1b[0m done')
    expect(a).toBe('\x1b[38;5;221mwarning\x1b[39m ')
    expect(b.startsWith('\x1b[31mred\x1b[0m')).toBe(true)
    expect(b).toContain('\x1b[38;5;77mdone\x1b[39m')
  })

  it('passes OSC sequences (window title) through untouched', () => {
    const h = new OutputHighlighter()
    expect(h.push('\x1b]0;user@10.0.0.1: ~\x07')).toBe('\x1b]0;user@10.0.0.1: ~\x07')
  })

  it('pauses inside full-screen apps (alternate screen)', () => {
    const h = new OutputHighlighter()
    expect(h.push('\x1b[?1049herror 10.0.0.1')).toBe('\x1b[?1049herror 10.0.0.1')
    expect(h.push('\x1b[?1049l error')).toContain('\x1b[1;38;5;203merror')
  })

  it('colours info words and command-line flags cyan', () => {
    const out = new OutputHighlighter().push('System information: run apt list --upgradable')
    expect(out).toContain('\x1b[38;5;80minformation\x1b[39m')
    expect(out).toContain('\x1b[38;5;80m--upgradable\x1b[39m')
  })

  it('flush returns a dangling partial sequence', () => {
    const h = new OutputHighlighter()
    h.push('abc\x1b[')
    expect(h.flush()).toBe('\x1b[')
  })
})
