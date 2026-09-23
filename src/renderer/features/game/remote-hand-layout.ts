import { GAME_BOARD_LAYOUT } from './game-scene-layout'

/** Preserve the remote hand's count-dependent spacing and card-back size. */
export function remoteHandMetrics(count: number): { gap: number; scale: number } {
  const layout = GAME_BOARD_LAYOUT.remoteHand
  const start = Math.max(1, layout.compactStartCount)
  const full = Math.max(start, layout.compactFullCount)
  const progress =
    count <= start ? 0 : Math.min(1, (count - start) / Math.max(1, full - start))
  return {
    gap: layout.gap + (layout.compactGap - layout.gap) * progress,
    scale: layout.scale + (layout.compactScale - layout.scale) * progress
  }
}

/** Bottom-center poses on a centered parabolic arc, shared by rest and dealing. */
export function remoteHandTransform(
  index: number,
  count: number
): { x: number; y: number; rotation: number; scale: number } {
  const layout = GAME_BOARD_LAYOUT.remoteHand
  const midpoint = Math.max(0, (count - 1) / 2)
  const normalized = midpoint === 0 ? 0 : (index - midpoint) / midpoint
  const { gap, scale } = remoteHandMetrics(count)
  const progress = Math.max(
    0,
    Math.min(
      1,
      (count - layout.compactStartCount) /
        Math.max(1, layout.compactFullCount - layout.compactStartCount)
    )
  )
  // Match the local fan's ease-out, with a gentle rotation ramp for small hands.
  const blend = 1 - (1 - progress) ** 3
  const smallHandRamp = Math.max(
    0,
    Math.min(1, (count - 1) / Math.max(1, layout.compactStartCount - 1))
  )
  const outerRotation =
    (layout.maxRotation + (layout.compactMaxRotation - layout.maxRotation) * blend) *
    smallHandRamp
  const edgeTuck = layout.edgeTuck + (layout.compactEdgeTuck - layout.edgeTuck) * blend
  return {
    x: layout.centerX + (index - midpoint) * gap,
    y: layout.baselineY - edgeTuck * normalized ** 2,
    rotation: -normalized * outerRotation,
    scale
  }
}
