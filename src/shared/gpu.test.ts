import { describe, expect, it } from 'vitest'
import { gpuTotals } from './gpu'

describe('gpuTotals', () => {
  it('returns null without GPUs (older snapshots have no gpus field)', () => {
    expect(gpuTotals([])).toBeNull()
    expect(gpuTotals(undefined)).toBeNull()
  })

  it('sums memory of every GPU and keeps the busiest utilization', () => {
    const totals = gpuTotals([
      { name: 'A', memTotal: 100, memUsed: 25, util: 10, shared: false },
      { name: 'B', memTotal: 300, memUsed: 75, util: null, shared: false },
      { name: 'C', memTotal: 100, memUsed: 0, util: 90, shared: false }
    ])
    expect(totals).toEqual({ used: 100, total: 500, pct: 20, util: 90, shared: false })
  })

  it('flags shared-memory estimates and reports unknown utilization as null', () => {
    expect(gpuTotals([{ name: 'Apple M2', memTotal: 0, memUsed: 0, util: null, shared: true }])).toEqual({
      used: 0,
      total: 0,
      pct: 0,
      util: null,
      shared: true
    })
  })
})
