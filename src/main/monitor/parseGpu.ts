/** Parsers for GPU / video memory probes: nvidia-smi, amdgpu sysfs counters and macOS ioreg. */
import type { GpuUsage } from '@shared/types'

const MIB = 1024 * 1024
const GIB = 1024 * MIB
/** Above this much RAM macOS lets the GPU wire ¾ of it, otherwise ⅔ (Metal recommendedMaxWorkingSetSize). */
const APPLE_LARGE_RAM = 36 * GIB

function numOrNull(raw: string | undefined): number | null {
  const n = Number((raw ?? '').trim())
  return (raw ?? '').trim() !== '' && Number.isFinite(n) ? n : null
}

function gpu(name: string, memTotal: number, memUsed: number, util: number | null, shared: boolean): GpuUsage {
  return {
    name,
    memTotal,
    memUsed: Math.min(memTotal, Math.max(0, memUsed)),
    util: util === null ? null : Math.min(100, Math.max(0, util)),
    shared
  }
}

/** `nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits` (MiB). */
export function parseNvidiaSmi(lines: string[]): GpuUsage[] {
  const out: GpuUsage[] = []
  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 4) continue
    const [total, used, util] = parts.slice(-3).map(numOrNull)
    if (!total || total <= 0) continue
    out.push(gpu(parts.slice(0, -3).join(', '), total * MIB, (used ?? 0) * MIB, util, false))
  }
  return out
}

/** One `vram_total vram_used busy_percent` line per amdgpu card (bytes; `-` when the busy counter is missing). */
export function parseAmdSysfs(lines: string[]): GpuUsage[] {
  const out: GpuUsage[] = []
  for (const line of lines) {
    const [total, used, busy] = line.trim().split(/\s+/)
    const totalBytes = numOrNull(total)
    if (!totalBytes || totalBytes <= 0) continue
    out.push(gpu(out.length === 0 ? 'AMD GPU' : `AMD GPU ${out.length + 1}`, totalBytes, numOrNull(used) ?? 0, numOrNull(busy), false))
  }
  return out
}

/**
 * How much unified memory an Apple Silicon GPU may use: `iogpu.wired_limit_mb` when it is set,
 * otherwise macOS's default of ⅔ of RAM (≤ 36 GB) or ¾ (larger machines). An estimate, not a hard split.
 */
export function appleGpuLimit(memTotal: number, wiredLimitMb: number): number {
  if (wiredLimitMb > 0) return Math.min(memTotal, wiredLimitMb * MIB)
  return Math.round(memTotal > APPLE_LARGE_RAM ? (memTotal * 3) / 4 : (memTotal * 2) / 3)
}

function perfStat(stats: string, key: string): number | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return numOrNull(new RegExp(`"${escaped}"=(\\d+)`).exec(stats)?.[1])
}

/**
 * `ioreg -r -d 1 -w 0 -c IOAccelerator` filtered to `+-o`, "model" and "PerformanceStatistics" lines.
 * Apple Silicon reports the unified memory the GPU has in use; discrete GPUs report VRAM used/free.
 */
export function parseDarwinGpus(lines: string[], memTotal: number, wiredLimitMb: number): GpuUsage[] {
  const blocks: string[][] = []
  for (const line of lines) {
    if (line.trimStart().startsWith('+-o') || blocks.length === 0) blocks.push([])
    blocks[blocks.length - 1].push(line)
  }
  const out: GpuUsage[] = []
  for (const block of blocks) {
    const text = block.join('\n')
    const stats = /"PerformanceStatistics" = \{([^}]*)\}/.exec(text)?.[1]
    if (!stats) continue
    const name = /"model" = "([^"]*)"/.exec(text)?.[1] || /\+-o (\S+)/.exec(text)?.[1] || 'GPU'
    const util = perfStat(stats, 'Device Utilization %') ?? perfStat(stats, 'GPU Activity(%)')
    const vramUsed = perfStat(stats, 'vramUsedBytes')
    const vramFree = perfStat(stats, 'vramFreeBytes')
    const sharedUsed = perfStat(stats, 'In use system memory')
    if (vramUsed !== null && vramFree !== null && vramUsed + vramFree > 0) {
      out.push(gpu(name, vramUsed + vramFree, vramUsed, util, false))
    } else if (sharedUsed !== null && memTotal > 0) {
      out.push(gpu(name, appleGpuLimit(memTotal, wiredLimitMb), sharedUsed, util, true))
    }
  }
  return out
}
