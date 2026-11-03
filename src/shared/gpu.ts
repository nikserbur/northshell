import type { GpuUsage } from './types'

export interface GpuTotals {
  used: number
  total: number
  /** Share of video memory in use, 0–100. */
  pct: number
  /** Busiest GPU, when any reports utilization. */
  util: number | null
  /** At least one GPU shares memory with the CPU, so `total` is an estimate. */
  shared: boolean
}

/** Video memory of all GPUs together (status bar, history graph); null when the host reports none. */
export function gpuTotals(gpus: GpuUsage[] | undefined): GpuTotals | null {
  if (!gpus || gpus.length === 0) return null
  const used = gpus.reduce((sum, g) => sum + g.memUsed, 0)
  const total = gpus.reduce((sum, g) => sum + g.memTotal, 0)
  const utils = gpus.map((g) => g.util).filter((u): u is number => u !== null)
  return {
    used,
    total,
    pct: total > 0 ? Math.min(100, (used / total) * 100) : 0,
    util: utils.length > 0 ? Math.max(...utils) : null,
    shared: gpus.some((g) => g.shared)
  }
}
