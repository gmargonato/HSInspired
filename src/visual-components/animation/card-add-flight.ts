export interface FlightPoint {
  readonly x: number
  readonly y: number
}

export interface CardAddFlightPath {
  readonly start: FlightPoint
  readonly control: FlightPoint
  readonly end: FlightPoint
}

export interface ScrollRange {
  readonly viewportTop: number
  readonly viewportHeight: number
  readonly contentOffset: number
  readonly maxScroll: number
  readonly rowTop: number
  readonly rowHeight: number
}

const MIN_ARCH_HEIGHT = 90
const MAX_ARCH_HEIGHT = 170

/** Builds the short, high arc used by a collection card flying into the deck. */
export function createCardAddFlightPath(
  start: FlightPoint,
  end: FlightPoint
): CardAddFlightPath {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const archHeight = Math.max(
    MIN_ARCH_HEIGHT,
    Math.min(MAX_ARCH_HEIGHT, distance * 0.22)
  )

  return {
    start,
    control: {
      x: start.x + (end.x - start.x) * 0.58,
      y: Math.min(start.y, end.y) - archHeight
    },
    end
  }
}

/** Resolves one point on a quadratic Bezier curve. */
export function resolveCardAddFlightPoint(
  path: CardAddFlightPath,
  progress: number
): FlightPoint {
  const t = Math.max(0, Math.min(1, progress))
  const inverse = 1 - t
  return {
    x:
      inverse * inverse * path.start.x +
      2 * inverse * t * path.control.x +
      t * t * path.end.x,
    y:
      inverse * inverse * path.start.y +
      2 * inverse * t * path.control.y +
      t * t * path.end.y
  }
}

/** Returns the smallest scroll change that exposes an arriving deck row. */
export function resolveCardAddScrollOffset(range: ScrollRange): number {
  const minOffset = -Math.max(0, range.maxScroll)
  const current = Math.max(minOffset, Math.min(0, range.contentOffset))
  const visibleTop = range.rowTop + current
  const visibleBottom = visibleTop + range.rowHeight
  const viewportBottom = range.viewportTop + range.viewportHeight

  if (visibleTop < range.viewportTop) {
    return Math.max(minOffset, Math.min(0, current + range.viewportTop - visibleTop))
  }
  if (visibleBottom > viewportBottom) {
    return Math.max(minOffset, Math.min(0, current - (visibleBottom - viewportBottom)))
  }
  return current
}
