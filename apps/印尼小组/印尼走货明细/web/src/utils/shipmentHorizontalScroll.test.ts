import { expect, it, vi } from 'vitest'
import { createShipmentHorizontalScroll } from './shipmentHorizontalScroll'

function setup() {
  const header = { scrollLeft: 0, scrollWidth: 5000, clientWidth: 1000 }
  const rail = { ...header }
  const frames = new Map<number, () => void>()
  let id = 0, bodyLeft = 0
  const scrollBody = vi.fn((left: number) => { bodyLeft = left })
  const sync = createShipmentHorizontalScroll({ elements: () => ({ header, rail }), scrollBody,
    requestFrame: callback => { frames.set(++id, callback); return id }, cancelFrame: frame => { frames.delete(frame) } })
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()) }
  return { header, rail, sync, frames, scrollBody, flush, body: () => bodyLeft }
}

it('top rail repairs a lagging virtual body even when the header is already at the requested offset', () => {
  const t = setup()
  t.header.scrollLeft = t.rail.scrollLeft = 500
  t.sync.railScroll(500); t.flush()
  expect(t.body()).toBe(500)
  expect(t.scrollBody).toHaveBeenCalledExactlyOnceWith(500)
})

it('rapid drag and reversal update the virtual body once per frame at the latest offset', () => {
  const t = setup()
  for (const left of [100, 200, 700, 300, 110]) { t.rail.scrollLeft = left; t.sync.railScroll(left) }
  expect(t.frames.size).toBe(1)
  expect(t.scrollBody).not.toHaveBeenCalled()
  t.flush()
  expect(t.scrollBody).toHaveBeenCalledExactlyOnceWith(110)
  expect(t.header.scrollLeft).toBe(110)
  expect(t.rail.scrollLeft).toBe(110)
})

it('older header events cannot pull an in-progress top rail movement backwards', () => {
  const t = setup()
  t.rail.scrollLeft = 900; t.sync.railScroll(900)
  t.sync.headerScroll(200)
  expect(t.rail.scrollLeft).toBe(900)
  t.flush()
  expect(t.body()).toBe(900)
})

it('native trackpad header changes mirror the rail without feeding another body scroll back', () => {
  const t = setup()
  t.header.scrollLeft = 320; t.sync.headerScroll(320)
  expect(t.rail.scrollLeft).toBe(320)
  t.sync.railScroll(t.rail.scrollLeft); t.flush()
  expect(t.scrollBody).not.toHaveBeenCalled()
  // The next actual user action still reaches the virtual body.
  t.rail.scrollLeft = 410; t.sync.railScroll(410); t.flush()
  expect(t.body()).toBe(410)
})

it('keyboard navigation supersedes pending rail movement and synchronizes all positions immediately', () => {
  const t = setup()
  t.sync.railScroll(900)
  t.sync.scrollTo(1400); t.flush()
  expect(t.scrollBody).toHaveBeenCalledExactlyOnceWith(1400)
  expect([t.header.scrollLeft, t.rail.scrollLeft, t.body()]).toEqual([1400, 1400, 1400])
})

it('resizing clamps to the new bounds and synchronizes a body that still uses the old range', () => {
  const t = setup()
  t.sync.scrollTo(3900)
  t.header.scrollWidth = 1800
  t.sync.resize()
  expect([t.header.scrollLeft, t.rail.scrollLeft, t.body()]).toEqual([800, 800, 800])
  t.sync.scrollTo(-55)
  expect(t.body()).toBe(0)
  t.sync.scrollTo(Number.NaN)
  expect(t.body()).toBe(0)
})

it('a new body gesture cancels an old queued rail event rather than overriding trackpad input', () => {
  const t = setup()
  t.sync.railScroll(1200); t.sync.cancelPending()
  t.header.scrollLeft = 300; t.sync.headerScroll(300); t.flush()
  expect(t.rail.scrollLeft).toBe(300)
  expect(t.scrollBody).not.toHaveBeenCalled()
})

it('unmount cancels queued work and performs no later DOM/body writes', () => {
  const t = setup()
  t.sync.railScroll(900); t.sync.dispose(); t.flush()
  t.sync.scrollTo(500); t.sync.headerScroll(500); t.sync.railScroll(500)
  expect(t.scrollBody).not.toHaveBeenCalled()
  expect(t.frames.size).toBe(0)
})

it('a delayed virtual header callback cannot reverse a newer drag after its frame has applied', () => {
  const header = { scrollLeft: 0, scrollWidth: 5000, clientWidth: 1000 }
  const rail = { ...header }
  let frame: (() => void) | undefined
  const scrollBody = vi.fn(() => true)
  const sync = createShipmentHorizontalScroll({ elements: () => ({ header, rail }), scrollBody,
    requestFrame: callback => { frame = callback; return 1 }, cancelFrame: () => {} })
  for (const left of [200, 800]) {
    rail.scrollLeft = left; sync.railScroll(left); frame!()
  }
  // Only the virtual body may update the header; no competing native write.
  expect(header.scrollLeft).toBe(0)
  sync.headerScroll(200)
  expect(rail.scrollLeft).toBe(800)
  header.scrollLeft = 800; sync.headerScroll(800)
  expect(rail.scrollLeft).toBe(800)
  sync.cancelPending() // A real trackpad gesture takes ownership.
  header.scrollLeft = 450; sync.headerScroll(450)
  expect(rail.scrollLeft).toBe(450)
  sync.dispose()
})

it('a long drag caches geometry between resizes and avoids duplicate virtual updates at the same position', () => {
  let reads = 0, width = 5000
  const header = { scrollLeft: 0, get scrollWidth() { reads++; return width }, get clientWidth() { reads++; return 1000 } }
  const rail = { scrollLeft: 0, scrollWidth: 5000, clientWidth: 1000 }
  let frame: (() => void) | undefined
  const scrollBody = vi.fn()
  const sync = createShipmentHorizontalScroll({ elements: () => ({ header, rail }), scrollBody,
    requestFrame: callback => { frame = callback; return 1 }, cancelFrame: () => {} })
  for (let left = 1; left <= 100; left++) {
    rail.scrollLeft = left; sync.railScroll(left); frame!()
    sync.headerScroll(left)
  }
  expect(reads).toBe(2) // No forced geometry reads for each scroll event/frame.
  expect(scrollBody).toHaveBeenCalledTimes(100)
  sync.railScroll(100); frame!()
  expect(scrollBody).toHaveBeenCalledTimes(100)
  width = 1050; sync.resize()
  expect(reads).toBe(4)
  expect(scrollBody).toHaveBeenLastCalledWith(50)
  expect(rail.scrollLeft).toBe(50)
})
