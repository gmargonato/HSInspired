import { afterEach, describe, expect, it } from 'vitest'
import rawConfig from '../../../config/outline-tunings.json'
import { parseOutlineTuningConfig } from '../../desktop/contracts/ipc/outline-tuning'
import {
  getOutlineTuning,
  getOutlineTuningConfig,
  OUTLINE_PALETTES,
  OUTLINE_TUNINGS,
  GHOST_AURA_CONFIG,
  SHATTER_CONFIG,
  updateOutlineTuningConfig
} from './outline-tuning'
import { inverseAuraProjection } from './aura-projection'
const initialConfig = parseOutlineTuningConfig(rawConfig)
describe('shader tuning registry', () => {
  afterEach(() => updateOutlineTuningConfig(initialConfig))
  it('updates Aura and Ghost registries without crossing configurations', () => {
    const updated = structuredClone(rawConfig)
    updated.aura.presets.card.speed = 0.37
    updated.aura.palettes.blue.glowColor = 0x123456
    updated.ghost.tuning.particleWindStrength = 1.5
    updated.shatter.duration = 2.4
    updated.shatter.seed = 23
    updateOutlineTuningConfig(parseOutlineTuningConfig(updated))
    expect(getOutlineTuning('card').speed).toBe(0.37)
    expect(OUTLINE_TUNINGS.card.speed).toBe(0.37)
    expect(OUTLINE_PALETTES.blue.glowColor).toBe(0x123456)
    expect(GHOST_AURA_CONFIG.tuning.particleWindStrength).toBe(1.5)
    expect(GHOST_AURA_CONFIG.palette).toEqual(initialConfig.ghost.palette)
    expect(SHATTER_CONFIG).toEqual(updated.shatter)
    expect(getOutlineTuningConfig()).toEqual(updated)
  })
})
describe('Aura perspective projection', () => {
  it.each([
    [0, 0, 100, 0, 100, 200, 0, 200],
    [-40, 30, 80, 0, 120, 160, -20, 190]
  ])(
    'maps corners and projective interior back into the source silhouette: %j',
    (...corners) => {
      const m = inverseAuraProjection(corners)
      for (const [index, uv] of [
        [0, [0, 0]],
        [2, [1, 0]],
        [4, [1, 1]],
        [6, [0, 1]]
      ] as const) {
        const x = corners[index],
          y = corners[index + 1],
          w = m[6] * x + m[7] * y + m[8]
        expect((m[0] * x + m[1] * y + m[2]) / w).toBeCloseTo(uv[0], 6)
        expect((m[3] * x + m[4] * y + m[5]) / w).toBeCloseTo(uv[1], 6)
      }
    }
  )
  it('returns finite coefficients for a fully collapsed flip', () => {
    expect(
      inverseAuraProjection([0, 0, 0, 0, 0, 100, 0, 100]).every(Number.isFinite)
    ).toBe(true)
  })
})
