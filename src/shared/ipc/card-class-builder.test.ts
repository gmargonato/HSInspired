import { describe, expect, it } from 'vitest'
import rawConfig from '../../../config/card-class-colors.json'
import {
  CARD_CLASS_BUILDER_CLASSES,
  parseCardClassBuilderConfig
} from './card-class-builder'

describe('card class builder IPC', () => {
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
