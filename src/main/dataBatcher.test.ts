import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBatcher } from './dataBatcher'

describe('DataBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces chunks per id until the flush interval', () => {
    const flushed: [string, string][] = []
    const b = new DataBatcher((id, data) => flushed.push([id, Buffer.from(data).toString()]), 10, 1024)
    b.push('a', Buffer.from('he'))
    b.push('a', 'llo')
    b.push('b', 'x')
    expect(flushed).toEqual([])
    vi.advanceTimersByTime(10)
    expect(flushed).toEqual([['a', 'hello'], ['b', 'x']])
  })

  it('flushes immediately when the size limit is reached', () => {
    const flushed: number[] = []
    const b = new DataBatcher((_id, data) => flushed.push(data.length), 1000, 4)
    b.push('a', 'abcdef')
    expect(flushed).toEqual([6])
  })

  it('flushes a single id on demand', () => {
    const flushed: string[] = []
    const b = new DataBatcher((id, data) => flushed.push(`${id}:${Buffer.from(data).toString()}`), 1000, 1024)
    b.push('a', 'x')
    b.push('b', 'y')
    b.flushNow('a')
    expect(flushed).toEqual(['a:x'])
  })

  it('drops pending data for a discarded id', () => {
    const flushed: string[] = []
    const b = new DataBatcher((id) => flushed.push(id), 10, 1024)
    b.push('a', 'zzz')
    b.discard('a')
    vi.advanceTimersByTime(20)
    expect(flushed).toEqual([])
  })
})
