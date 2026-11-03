import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { remoteMonitorCommand } from './remoteScript'

describe('remoteMonitorCommand', () => {
  const command = remoteMonitorCommand(3)
  const body = command.slice("exec sh -c '".length, -1)

  it('keeps single quotes out of the body so the sh -c wrapper stays intact', () => {
    expect(command.startsWith("exec sh -c '")).toBe(true)
    expect(body).not.toContain("'")
  })

  it('is valid POSIX shell', () => {
    const res = spawnSync('/bin/sh', ['-n', '-c', body], { encoding: 'utf8' })
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })

  it('probes video memory on Linux and macOS hosts', () => {
    expect(body).toContain('@@nvsmi')
    expect(body).toContain('timeout 5')
    expect(body).toContain('mem_info_vram_total')
    expect(body).toContain('@@gpu; ioreg')
  })

  it('clamps the interval', () => {
    expect(remoteMonitorCommand(0)).toContain('sleep 1')
    expect(remoteMonitorCommand(600)).toContain('sleep 60')
  })
})
