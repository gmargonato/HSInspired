import { describe, expect, it } from 'vitest'
import rawConfig from '../../../config/outline-tunings.json'
import {
  OUTLINE_PALETTE_NAMES,
  OUTLINE_PRESET_NAMES,
  parseOutlineTuningConfig
} from './outline-tuning'

describe('outline tuning IPC', () => {
  it('accepts and clones the canonical configuration', () => {
    const parsed = parseOutlineTuningConfig(rawConfig)

    expect(Object.keys(parsed.presets)).toEqual([...OUTLINE_PRESET_NAMES])
    expect(Object.keys(parsed.palettes)).toEqual([...OUTLINE_PALETTE_NAMES])
    expect(parsed).not.toBe(rawConfig)
    expect(parsed.presets.card).not.toBe(rawConfig.presets.card)
    expect(parsed.palettes.blue).not.toBe(rawConfig.palettes.blue)
  })

  it('rejects unsupported versions and incomplete preset sets', () => {
    const unsupported = structuredClone(rawConfig) as Record<string, unknown>
    unsupported.version = 4
    expect(() => parseOutlineTuningConfig(unsupported)).toThrow()

    const incomplete = structuredClone(rawConfig) as Record<string, unknown>
    const presets = incomplete.presets as Record<string, unknown>
    delete presets.ghost
    expect(() => parseOutlineTuningConfig(incomplete)).toThrow()

    const incompletePalette = structuredClone(rawConfig) as Record<string, unknown>
    delete (incompletePalette.palettes as Record<string, unknown>).white
    expect(() => parseOutlineTuningConfig(incompletePalette)).toThrow()
  })

  it('rejects unknown, non-finite, and out-of-range tuning values', () => {
    const extra = structuredClone(rawConfig) as Record<string, unknown>
    const presets = extra.presets as Record<string, Record<string, unknown>>
    presets.card.unexpected = true
    expect(() => parseOutlineTuningConfig(extra)).toThrow()

    const nonFinite = structuredClone(rawConfig)
    nonFinite.presets.board.glowStrength = Number.NaN
    expect(() => parseOutlineTuningConfig(nonFinite)).toThrow()

    const outOfRange = structuredClone(rawConfig)
    outOfRange.presets.button.ribbonWidth = 20.1
    expect(() => parseOutlineTuningConfig(outOfRange)).toThrow()

    for (const saturation of [-0.01, 2.01, Number.NaN]) {
      const invalid = structuredClone(rawConfig)
      invalid.presets.card.saturation = saturation
      expect(() => parseOutlineTuningConfig(invalid)).toThrow()
    }
  })

  it('rejects invalid palette channels', () => {
    for (const value of [-1, 0x1000000, 1.5, Number.NaN, 'red']) {
      const invalid = structuredClone(rawConfig) as unknown as Record<string, unknown>
      const palettes = invalid.palettes as Record<string, Record<string, unknown>>
      palettes.blue.baseColor = value
      expect(() => parseOutlineTuningConfig(invalid)).toThrow()
    }

    const extra = structuredClone(rawConfig) as unknown as Record<string, unknown>
    const palettes = extra.palettes as Record<string, Record<string, unknown>>
    palettes.green.unexpected = 0
    expect(() => parseOutlineTuningConfig(extra)).toThrow()
  })
})
