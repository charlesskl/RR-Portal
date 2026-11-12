interface ScrollElement { scrollLeft: number; scrollWidth: number; clientWidth: number }
interface ScrollPorts {
  elements: () => { header: ScrollElement | null; rail: ScrollElement | null }
  scrollBody: (left: number) => void
  requestFrame: (callback: () => void) => number
  cancelFrame: (frame: number) => void
}

/** Synchronize the native top rail with rc-virtual-list's logical position. */
export function createShipmentHorizontalScroll(ports: ScrollPorts) {
  let frame: number | null = null, pending: number | null = null
  let mirroredRail: number | null = null, disposed = false
  const clamp = (left: number) => {
    const { header, rail } = ports.elements()
    const target = header || rail
    const max = target ? Math.max(0, target.scrollWidth - target.clientWidth) : 0
    return Math.max(0, Math.min(max, Number.isFinite(left) ? left : 0))
  }
  const mirror = (left: number) => {
    const { rail } = ports.elements()
    if (rail && Math.abs(rail.scrollLeft - left) > .5) {
      mirroredRail = left
      rail.scrollLeft = left
    }
  }
  const apply = (left: number) => {
    const { header } = ports.elements()
    const value = clamp(left)
    if (header && Math.abs(header.scrollLeft - value) > .5) header.scrollLeft = value
    // The header can already be correct while virtual rows still lag behind.
    // Always update the list through its public proxy, never native holder X.
    ports.scrollBody(value)
    mirror(value)
  }
  return {
    railScroll(left: number) {
      if (disposed) return
      // Native events caused by mirroring are acknowledgements, not new input.
      if (mirroredRail != null && Math.abs(left - mirroredRail) <= .5) {
        mirroredRail = null
        return
      }
      mirroredRail = null
      pending = clamp(left)
      if (frame == null) frame = ports.requestFrame(() => {
        frame = null
        const value = pending
        if (value == null || disposed) return
        apply(value)
        pending = null
      })
    },
    headerScroll(left: number) {
      // An earlier header event must not pull a newer rail drag backwards.
      if (!disposed && pending == null) mirror(clamp(left))
    },
    scrollTo(left: number) {
      if (disposed) return
      if (frame != null) ports.cancelFrame(frame)
      frame = null
      pending = clamp(left)
      apply(pending)
      pending = null
    },
    resize() {
      if (disposed) return
      const { header } = ports.elements()
      this.scrollTo(pending ?? header?.scrollLeft ?? 0)
    },
    cancelPending() {
      if (frame != null) ports.cancelFrame(frame)
      frame = null; pending = null; mirroredRail = null
    },
    dispose() {
      disposed = true
      if (frame != null) ports.cancelFrame(frame)
      frame = null; pending = null
    },
  }
}
