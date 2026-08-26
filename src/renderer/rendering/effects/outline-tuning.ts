/** Names intentionally stay closed so gameplay callers select a semantic
 * budget instead of inventing a one-off outline material. */
export type OutlinePresetName = 'card' | 'button'

export interface OutlineTuning {
  readonly ribbonWidth: number
  readonly edgeSoftness: number
  readonly rimWidth: number
  readonly glowWidth: number
  readonly glowStrength: number
  readonly highlightStrength: number
  readonly hotspotScale: number
  readonly hotspotDensity: number
  readonly edgeWobble: number
  readonly motionSpeed: number
}

/** Approved Arcane Filament material used by every production outline. */
export const OUTLINE_TUNINGS: Record<OutlinePresetName, OutlineTuning> = {
  card: {
    ribbonWidth: 6,
    edgeSoftness: 2,
    rimWidth: 2,
    glowWidth: 5,
    glowStrength: 1,
    highlightStrength: 2,
    hotspotScale: 50,
    hotspotDensity: 1,
    edgeWobble: 4,
    motionSpeed: 0.7
  },
  button: {
    ribbonWidth: 8,
    edgeSoftness: 2.5,
    rimWidth: 3,
    glowWidth: 10,
    glowStrength: 0.66,
    highlightStrength: 1.05,
    hotspotScale: 50,
    hotspotDensity: 1,
    edgeWobble: 4,
    motionSpeed: 1.05
  }
}
