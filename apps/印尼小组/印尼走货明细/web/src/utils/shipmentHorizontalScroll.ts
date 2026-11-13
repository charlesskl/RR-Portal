interface ScrollElement { scrollLeft: number; scrollWidth: number; clientWidth: number }
interface ScrollPorts {
  elements: () => { header: ScrollElement | null; rail: ScrollElement | null }
  // Return true when the virtual body owns header synchronization as well.
  scrollBody: (left: number) => boolean | void
  requestFrame: (callback: () => void) => number
  cancelFrame: (frame: number) => void
}

/** Synchronize the native top rail with rc-virtual-list's logical position. */
export function createShipmentHorizontalScroll(ports: ScrollPorts) {
  let frame: number | null = null, pending: number | null = null
  let mirroredRail: number | null = null, disposed = false
  let maxLeft: number | null = null, commandedLeft: number | null = null, appliedLeft: number | null = null
  const clamp = (left: number) => {
    if (maxLeft == null) {
      const { header, rail } = ports.elements()
      const target = header || rail
      maxLeft = target ? Math.max(0, target.scrollWidth - target.clientWidth) : 0
    }
    return Math.max(0, Math.min(maxLeft, Number.isFinite(left) ? left : 0))
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
    if (appliedLeft === value) return
    commandedLeft = value
    appliedLeft = value
    // The header can already be correct while virtual rows still lag behind.
    // Always update the list through its public proxy, never native holder X.
    const virtualSync = ports.scrollBody(value)
    // rc-table synchronizes its header from the virtual body's callback. A
    // second native header write starts another competing scroll/update loop.
    if (!virtualSync && header && Math.abs(header.scrollLeft - value) > .5) header.scrollLeft = value
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
      if (disposed || pending != null) return
      const value = clamp(left)
      if (commandedLeft != null && Math.abs(value - commandedLeft) > .5) return
      commandedLeft = null
      mirror(value)
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
      maxLeft = null; appliedLeft = null
      const { header } = ports.elements()
      this.scrollTo(pending ?? header?.scrollLeft ?? 0)
    },
    cancelPending() {
      if (frame != null) ports.cancelFrame(frame)
      frame = null; pending = null; mirroredRail = null; commandedLeft = null; appliedLeft = null
    },
    dispose() {
      disposed = true
      if (frame != null) ports.cancelFrame(frame)
      frame = null; pending = null
    },
  }
}
