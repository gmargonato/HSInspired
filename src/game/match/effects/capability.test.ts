import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, CAPABILITY_OWNERSHIP } from '../../content/cards'
import { RUNTIME_CAPABILITY_REGISTRY } from './capability'
import { inspectCardCapabilities, UnsupportedEffectCapabilityError } from './capability'

describe('effect capability reporting', () => {
  it('makes an authored effect visibly unsupported until a handler is registered', () => {
    const card = CARD_CATALOG.require('basic_fireball')
    const report = inspectCardCapabilities(card)
    expect(report.supported).toBe(false)
    expect(
      report.capabilities.some(
        (entry) => entry.family === 'action' && entry.name === 'damage'
      )
    ).toBe(true)
    expect(() => {
      throw new UnsupportedEffectCapabilityError(report)
    }).toThrow(/basic_fireball.*damage/u)
  })

  it('accepts registered nested capabilities', () => {
    const card = CARD_CATALOG.require('basic_fireball')
    const initial = inspectCardCapabilities(card)
    const registered = new Set(
      initial.capabilities.map((entry) => `${entry.family}:${entry.name}`)
    )
    const report = inspectCardCapabilities(card, registered)
    expect(report.supported).toBe(true)
    expect(report.capabilities).toEqual([])
  })
  it('requires an explicit runtime owner for every schema capability', () => {
    expect(RUNTIME_CAPABILITY_REGISTRY).toHaveLength(CAPABILITY_OWNERSHIP.length)
    expect(
      new Set(
        RUNTIME_CAPABILITY_REGISTRY.map((entry) => `${entry.family}:${entry.name}`)
      ).size
    ).toBe(CAPABILITY_OWNERSHIP.length)
  })
})
