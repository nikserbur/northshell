import { describe, expect, it } from 'vitest'
import { appleGpuLimit, parseAmdSysfs, parseDarwinGpus, parseNvidiaSmi } from './parseGpu'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

describe('parseNvidiaSmi', () => {
  it('reads name, memory in MiB and utilization for every GPU', () => {
    const gpus = parseNvidiaSmi(['NVIDIA GeForce RTX 3090, 24576, 1234, 7', 'NVIDIA A100-SXM4-80GB, 81920, 40960, 100'])
    expect(gpus).toEqual([
      { name: 'NVIDIA GeForce RTX 3090', memTotal: 24576 * MIB, memUsed: 1234 * MIB, util: 7, shared: false },
      { name: 'NVIDIA A100-SXM4-80GB', memTotal: 81920 * MIB, memUsed: 40960 * MIB, util: 100, shared: false }
    ])
  })

  it('keeps commas inside the GPU name and treats [N/A] utilization as unknown', () => {
    const [gpu] = parseNvidiaSmi(['Tesla T4, rev 2, 15360, 0, [N/A]'])
    expect(gpu.name).toBe('Tesla T4, rev 2')
    expect(gpu.memTotal).toBe(15360 * MIB)
    expect(gpu.util).toBeNull()
  })

  it('skips error output and lines without a memory size', () => {
    expect(parseNvidiaSmi(['NVIDIA-SMI has failed because it couldn\'t communicate with the NVIDIA driver.'])).toEqual([])
    expect(parseNvidiaSmi(['Some GPU, [N/A], [N/A], [N/A]'])).toEqual([])
  })

  it('never reports more used memory than the card has', () => {
    const [gpu] = parseNvidiaSmi(['Odd GPU, 1000, 5000, 3'])
    expect(gpu.memUsed).toBe(gpu.memTotal)
  })
})

describe('parseAmdSysfs', () => {
  it('reads byte counters and busy percentage of amdgpu cards', () => {
    expect(parseAmdSysfs(['17163091968 1073741824 12', '536870912 104857600 -'])).toEqual([
      { name: 'AMD GPU', memTotal: 17163091968, memUsed: 1073741824, util: 12, shared: false },
      { name: 'AMD GPU 2', memTotal: 536870912, memUsed: 104857600, util: null, shared: false }
    ])
  })

  it('ignores cards without VRAM counters', () => {
    expect(parseAmdSysfs(['0 0 -', 'garbage'])).toEqual([])
  })
})

describe('appleGpuLimit', () => {
  it('uses ⅔ of RAM up to 36 GB and ¾ above, like Metal recommendedMaxWorkingSetSize', () => {
    expect(appleGpuLimit(16 * GIB, 0)).toBeCloseTo((16 * GIB * 2) / 3, -1)
    expect(appleGpuLimit(36 * GIB, 0)).toBeCloseTo((36 * GIB * 2) / 3, -1)
    expect(appleGpuLimit(64 * GIB, 0)).toBe(48 * GIB)
  })

  it('honours iogpu.wired_limit_mb when it is set, never above physical memory', () => {
    expect(appleGpuLimit(64 * GIB, 57344)).toBe(57344 * MIB)
    expect(appleGpuLimit(16 * GIB, 999999)).toBe(16 * GIB)
  })
})

describe('parseDarwinGpus', () => {
  it('reads Apple Silicon GPU memory in use and estimates the shared limit', () => {
    const lines = [
      '+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X, id 0x1000004cd, registered, matched, active, busy 0 (0 ms), retain 104>',
      '    "PerformanceStatistics" = {"In use system memory (driver)"=441565184,"Alloc system memory"=3340386304,"Device Utilization %"=50,"In use system memory"=441565184}',
      '    "model" = "Apple M1 Pro"'
    ]
    expect(parseDarwinGpus(lines, 16 * GIB, 0)).toEqual([
      { name: 'Apple M1 Pro', memTotal: appleGpuLimit(16 * GIB, 0), memUsed: 441565184, util: 50, shared: true }
    ])
  })

  it('reads dedicated VRAM of discrete GPUs in Intel Macs', () => {
    const lines = [
      '+-o AMDRadeonX6000_AMDNavi14GraphicsAccelerator  <class AMDRadeonX6000_AMDNavi14GraphicsAccelerator, id 0x1000007a1>',
      '    "PerformanceStatistics" = {"vramUsedBytes"=1073741824,"vramFreeBytes"=3221225472,"Device Utilization %"=4}',
      '+-o IntelAccelerator  <class IntelAccelerator, id 0x100000699>',
      '    "PerformanceStatistics" = {"Device Utilization %"=1,"GPU Core Utilization"=0}'
    ]
    expect(parseDarwinGpus(lines, 32 * GIB, 0)).toEqual([
      { name: 'AMDRadeonX6000_AMDNavi14GraphicsAccelerator', memTotal: 4 * GIB, memUsed: GIB, util: 4, shared: false }
    ])
  })

  it('returns nothing without performance statistics', () => {
    expect(parseDarwinGpus([], 16 * GIB, 0)).toEqual([])
    expect(parseDarwinGpus(['+-o AGXAcceleratorG13X  <class X>', '    "model" = "Apple M2"'], 16 * GIB, 0)).toEqual([])
  })
})
