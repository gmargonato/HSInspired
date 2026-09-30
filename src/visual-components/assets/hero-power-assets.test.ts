import { describe, expect, it } from 'vitest'
import { HERO_POWER_DEFINITIONS } from '../../game-rules/content/hero-powers'
import { HERO_POWER_ASSET_KEYS } from './hero-power-asset-keys'

describe('hero power asset sources', () => {
  it('registers artwork for every catalog hero power', () => {
    const registeredKeys = new Set<string>(HERO_POWER_ASSET_KEYS)
    const missingKeys = HERO_POWER_DEFINITIONS.map(
      (definition) => definition.presentationAssetKey
    ).filter((key) => !registeredKeys.has(key))

    expect(missingKeys).toEqual([])
  })
})
