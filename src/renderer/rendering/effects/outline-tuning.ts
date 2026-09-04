/** Names intentionally stay closed so gameplay callers select a semantic
 * budget instead of inventing a one-off outline material. */
export type OutlinePresetName = 'card' | 'bonus-card' | 'board' | 'button'

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
  'bonus-card': {
    ribbonWidth: 8,
    edgeSoftness: 2,
    rimWidth: 2,
    glowWidth: 5,
    glowStrength: 1,
    highlightStrength: 2,
    hotspotScale: 50,
    hotspotDensity: 1,
    edgeWobble: 8,
    motionSpeed: 1.4
  },
	board: {
	  ribbonWidth: 6.1,
	  edgeSoftness: 10,
	  rimWidth: 0,
	  glowWidth: 30,
	  glowStrength: 1.33,
	  highlightStrength: 5,
	  hotspotScale: 50,
	  hotspotDensity: 0,
	  edgeWobble: 4.9,
	  motionSpeed: 1.35
	},
  button: {
	  ribbonWidth: 6,
	  edgeSoftness: 10,
	  rimWidth: 7.1,
	  glowWidth: 30,
	  glowStrength: 0.88,
	  highlightStrength: 0.6,
	  hotspotScale: 46,
	  hotspotDensity: 1.3,
	  edgeWobble: 10.3,
	  motionSpeed: 1
	}
}
