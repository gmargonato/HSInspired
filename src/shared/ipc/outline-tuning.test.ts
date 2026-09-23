import { describe, expect, it } from 'vitest'
import rawConfig from '../../../config/outline-tunings.json'
import {
  OUTLINE_PALETTE_NAMES,
  OUTLINE_PRESET_NAMES,
  parseOutlineTuningConfig
} from './outline-tuning'
describe('shader tuning IPC', () => {
  it('clones both shaders without sharing mutable nested values', () => {
    const parsed = parseOutlineTuningConfig(rawConfig)
    expect(parsed).toEqual(rawConfig)
    expect(Object.keys(parsed.aura.presets)).toEqual([...OUTLINE_PRESET_NAMES])
    expect(Object.keys(parsed.aura.palettes)).toEqual([...OUTLINE_PALETTE_NAMES])
    expect(parsed.aura.presets.card).not.toBe(rawConfig.aura.presets.card)
    expect(parsed.ghost.tuning).not.toBe(rawConfig.ghost.tuning)
    expect(parsed.ghost.palette).not.toBe(rawConfig.ghost.palette)
  })
  it('rejects incompatible shapes and versions', () => {
    for (const version of [3, 5])
      expect(() => parseOutlineTuningConfig({ ...rawConfig, version })).toThrow()
    const missing = structuredClone(rawConfig) as unknown as {
      aura: { presets: Record<string, unknown> }
    }
    delete missing.aura.presets.board
    expect(() => parseOutlineTuningConfig(missing)).toThrow()
    expect(() => parseOutlineTuningConfig({ ...rawConfig, ghost: undefined })).toThrow()
    expect(() => parseOutlineTuningConfig({ ...rawConfig, extra: true })).toThrow()
  })
  it('validates fractional controls, integer blob counts and boolean toggles', () => {
    for (const [key, value] of [
      ['speed', NaN],
      ['speed', 1.01],
      ['speed', -0.01],
      ['hotCount', 3.5],
      ['hotCount', 17],
      ['smoothOutline', 1],
      ['unexpected', true]
    ]) {
      const config = structuredClone(rawConfig)
      Object.assign(config.aura.presets.card, { [key as string]: value })
      expect(() => parseOutlineTuningConfig(config)).toThrow()
    }
    const config = structuredClone(rawConfig)
    Object.assign(config.aura.presets.card, {
      speed: 0.37,
      smoothOutline: false,
      hotCount: 0
    })
    expect(parseOutlineTuningConfig(config).aura.presets.card).toMatchObject({
      speed: 0.37,
      smoothOutline: false,
      hotCount: 0
    })
  })
  it('validates Aura and Ghost color channels independently', () => {
    for (const palette of ['aura', 'ghost'] as const)
      for (const value of [-1, 0x1000000, 1.5, NaN, 'red']) {
        const config = structuredClone(rawConfig)
        const target =
          palette === 'aura' ? config.aura.palettes.green : config.ghost.palette
        Object.assign(target, { baseColor: value })
        expect(() => parseOutlineTuningConfig(config)).toThrow()
      }
  })
  it('keeps Ghost tuning isolated and validates its original ranges', () => {
    const config = structuredClone(rawConfig)
    config.aura.presets.card.wobble = 20
    config.aura.palettes.purple.baseColor = 123
    expect(parseOutlineTuningConfig(config).ghost).toEqual(rawConfig.ghost)
    config.ghost.tuning.edgeWobble = 17
    expect(() => parseOutlineTuningConfig(config)).toThrow()
  })
})
