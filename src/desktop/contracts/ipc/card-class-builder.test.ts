import { describe, expect, it } from 'vitest'
import rawConfig from '../../../../config/card-class-colors.json'
import {
  CARD_CLASS_BUILDER_CLASSES,
  parseCardClassBuilderConfig
} from './card-class-builder'

describe('card class builder IPC', () => {
  it('defaults legacy premium offsets without changing existing values', () => {
    const { premium: _premium, ...offsets } = rawConfig.offsets
    const parsed = parseCardClassBuilderConfig({ ...rawConfig, offsets })
    expect(parsed.offsets.minion).toEqual(offsets.minion)
    expect(parsed.offsets.spell).toEqual(offsets.spell)
    expect(parsed.offsets.premium).toEqual({
      minion: { primary: { x: 0, y: 0 } },
      spell: { primary: { x: 0, y: 0 } }
    })
  })

  it('rejects invalid premium offsets and extra mask channels', () => {
    const invalid = structuredClone(rawConfig)
    invalid.offsets.premium.minion.primary.x = 201
    expect(() => parseCardClassBuilderConfig(invalid)).toThrow()
    const extra = structuredClone(rawConfig)
    Object.assign(extra.offsets.premium.minion, { secondary: { x: 0, y: 0 } })
    expect(() => parseCardClassBuilderConfig(extra)).toThrow()
  })

  it('accepts and clones the canonical configuration', () => {
    const parsed = parseCardClassBuilderConfig(rawConfig)
    expect(Object.keys(parsed.classes)).toEqual([...CARD_CLASS_BUILDER_CLASSES])
    expect(parsed).not.toBe(rawConfig)
  })

  it('rejects unsupported modes and incomplete class sets', () => {
    const unsupported = structuredClone(rawConfig)
    unsupported.classes.Druid.secondary.blendMode = 'unsupported-mode'
    expect(() => parseCardClassBuilderConfig(unsupported)).toThrow()

    const incomplete = structuredClone(rawConfig) as Record<string, unknown>
    const classes = incomplete.classes as Record<string, unknown>
    delete classes.Warrior
    expect(() => parseCardClassBuilderConfig(incomplete)).toThrow()
  })

  it('rejects unknown fields and out-of-range offsets', () => {
    const extra = structuredClone(rawConfig) as Record<string, unknown>
    extra.unexpected = true
    expect(() => parseCardClassBuilderConfig(extra)).toThrow()

    const invalidOffset = structuredClone(rawConfig)
    invalidOffset.offsets.minion.primary.x = 201
    expect(() => parseCardClassBuilderConfig(invalidOffset)).toThrow()
  })
})
