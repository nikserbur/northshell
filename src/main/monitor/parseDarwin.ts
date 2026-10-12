/** Parsers for the macOS branch of the remote monitor script (sysctl, vm_stat, netstat, top). */

function num(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const SIZE_UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

function parseSize(raw: string | undefined): number {
  const m = /^([\d.]+)([KMGT])?$/.exec(raw ?? '')
  return m ? Number(m[1]) * (SIZE_UNITS[m[2] ?? ''] ?? 1) : 0
}

/** "CPU usage: 5.20% user, 5.3% sys, 89.50% idle" → busy percentage. */
export function parseTopCpu(lines: string[]): number | null {
  const m = /([\d.]+)%\s+idle/.exec(lines.join(' '))
  return m ? Math.max(0, 100 - Number(m[1])) : null
}

export function parseDarwinMemory(
  memsize: string[],
  vmstat: string[],
  swap: string[]
): { memTotal: number; memUsed: number; swapTotal: number; swapUsed: number } {
  const pageSize = num(/page size of (\d+) bytes/.exec(vmstat.join('\n'))?.[1]) || 4096
  const pages = new Map<string, number>()
  for (const line of vmstat) {
    const m = /^"?([^":]+)"?:\s+(\d+)\.?$/.exec(line.trim())
    if (m) pages.set(m[1], Number(m[2]))
  }
  const usedPages =
    (pages.get('Pages active') ?? 0) + (pages.get('Pages wired down') ?? 0) + (pages.get('Pages occupied by compressor') ?? 0)
  const swapLine = swap.join(' ')
  return {
    memTotal: num(memsize[0]?.trim()),
    memUsed: usedPages * pageSize,
    swapTotal: parseSize(/total = ([\d.]+[KMGT]?)/.exec(swapLine)?.[1]),
    swapUsed: parseSize(/used = ([\d.]+[KMGT]?)/.exec(swapLine)?.[1])
  }
}

/** Sums byte counters of physical (en*) interfaces from `netstat -ib` link-level rows. */
export function parseNetstat(lines: string[]): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 10 || !parts[0].startsWith('en') || !parts[2]?.startsWith('<Link#')) continue
    const n = parts.length
    rx += num(parts[n - 5])
    tx += num(parts[n - 2])
  }
  return { rx, tx }
}
