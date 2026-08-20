import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../../../game/content/cards'
import { HERO_CATALOG } from '../../../../game/content/heroes'
import { hasCardArtwork } from './card-asset-resolver'
import { HERO_ASSET_SOURCES } from './hero-assets'
import { ASSETS_MANIFEST, ASSET_DEFINITIONS, resolveAssetDefinition } from './index'

describe('runtime asset registry', () => {
  it('has unique semantic keys and manifest entries for every definition', () => {
    const keys = ASSET_DEFINITIONS.map((definition) => definition.key)
    expect(new Set(keys).size).toBe(keys.length)

    for (const definition of ASSET_DEFINITIONS) {
      expect(resolveAssetDefinition(definition.key)).toBe(definition)
      expect(definition.source.src).toEqual(expect.any(String))
      expect(definition.authoredWidth).toBeGreaterThan(0)
      expect(definition.authoredHeight).toBeGreaterThan(0)
    }

    const manifestEntries = ASSETS_MANIFEST.bundles.flatMap((bundle) => bundle.assets)
    expect(manifestEntries).toHaveLength(ASSET_DEFINITIONS.length)
  })

  it('resolves artwork by exact catalog card ID', () => {
    const cardWithArtwork = CARD_CATALOG.require('classic_abomination')
    expect(hasCardArtwork(cardWithArtwork.id)).toBe(true)
    expect(hasCardArtwork('classic-abomination')).toBe(false)
  })

  it('resolves every hero presentation asset reference', () => {
    for (const hero of HERO_CATALOG.all) {
      expect(HERO_ASSET_SOURCES[hero.presentationAssetKey]).toEqual(expect.any(String))
      expect(resolveAssetDefinition(`hero.${hero.presentationAssetKey}`)).toBeDefined()
    }
  })
})
