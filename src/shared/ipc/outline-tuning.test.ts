import { describe, expect, it } from 'vitest'
import rawConfig from '../../../config/outline-tunings.json'
import { OUTLINE_PRESET_NAMES, parseOutlineTuningConfig } from './outline-tuning'

describe('outline tuning IPC', () => {
  it('accepts and clones the canonical configuration', () => {
    const parsed = parseOutlineTuningConfig(rawConfig)

    expect(Object.keys(parsed.presets)).toEqual([...OUTLINE_PRESET_NAMES])
    expect(parsed).not.toBe(rawConfig)
    expect(parsed.presets.card).not.toBe(rawConfig.presets.card)
  })

  it('rejects unsupported versions and incomplete preset sets', () => {
    const unsupported = structuredClone(rawConfig) as Record<string, unknown>
    unsupported.version = 2
    expect(() => parseOutlineTuningConfig(unsupported)).toThrow()

    const incomplete = structuredClone(rawConfig) as Record<string, unknown>
    const presets = incomplete.presets as Record<string, unknown>
    delete presets.ghost
    expect(() => parseOutlineTuningConfig(incomplete)).toThrow()
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
  })
})
