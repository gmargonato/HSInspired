export interface BoardRowConfig {
  readonly centerX: number
  readonly baselineY: number
  readonly maxSpan: number
  readonly maxStep: number
  readonly minionScale: number
}

export interface BoardMinionTransform {
  readonly x: number
  readonly y: number
  readonly scale: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.floor(count)
}

function rowStep(count: number, config: BoardRowConfig): number {
  return count <= 1 ? 0 : Math.min(config.maxStep, config.maxSpan / (count - 1))
}

/** Computes a symmetric row for any supported board size. */
export function layoutBoardRow(
  count: number,
  config: BoardRowConfig
): readonly BoardMinionTransform[] {
  const normalizedCount = normalizeCount(count)
  if (normalizedCount === 0) return []

  const step = rowStep(normalizedCount, config)
  const midpoint = (normalizedCount - 1) / 2
  return Array.from({ length: normalizedCount }, (_, index) => ({
    x: config.centerX + (index - midpoint) * step,
    y: config.baselineY,
    scale: config.minionScale
  }))
}

/** Resolves a pointer x-coordinate to the gap where a new minion would land. */
export function resolveBoardInsertionIndex(
  pointerX: number,
  count: number,
  config: BoardRowConfig
): number {
  const normalizedCount = normalizeCount(count)
  if (normalizedCount === 0) return 0

  const transforms = layoutBoardRow(normalizedCount, config)
  const first = transforms[0]
  const last = transforms[transforms.length - 1]
  if (!first || !last) return 0

  if (normalizedCount === 1) {
    return pointerX <= first.x ? 0 : 1
  }

  const step = rowStep(normalizedCount, config)
  const leftReach = first.x - step / 2
  const rightReach = last.x + step / 2
  const clampedX = clamp(pointerX, leftReach, rightReach)
  return clamp(Math.round((clampedX - leftReach) / step), 0, normalizedCount)
}

/** Tests a point against an inclusive design-canvas drop rectangle. */
export function isInDropZone(
  pointer: { readonly x: number; readonly y: number },
  zone: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
): boolean {
  return (
    pointer.x >= zone.x &&
    pointer.x <= zone.x + zone.width &&
    pointer.y >= zone.y &&
    pointer.y <= zone.y + zone.height
  )
}
