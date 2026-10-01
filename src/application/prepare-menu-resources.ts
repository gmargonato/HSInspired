import type { Renderer, Texture, TextureSource } from 'pixi.js'
import { ASSET_BUNDLE_IDS } from '../visual-components/assets'
import { AssetScope } from '../visual-components/assets/asset-scope'
import { configureCardTexture } from '../visual-components/assets/card-asset-resolver'
import {
  prepareMenuEffects,
  prepareMenuOutline,
  prepareRewardGhostAura
} from '../visual-components/effects/prepare-menu-effects'
import type { AuraFieldLease } from '../visual-components/effects/aura-field-cache'
import type { OutlinePresetName } from '../visual-components/effects/animated-outline'
import { warmMainMenuEffects } from './prepare-main-menu-effects'

// Deliberate allowlist: adding a match bundle must never make it a boot dependency.
export const MENU_STARTUP_BUNDLES = [
  // Configure card mipmaps first, including sources shared with other bundles.
  ASSET_BUNDLE_IDS.cardRendering,
  ASSET_BUNDLE_IDS.mainMenu,
  ASSET_BUNDLE_IDS.arena,
  ASSET_BUNDLE_IDS.tavernBrawl,
  ASSET_BUNDLE_IDS.deckSelection,
  ASSET_BUNDLE_IDS.deckPresentation,
  ASSET_BUNDLE_IDS.collection,
  ASSET_BUNDLE_IDS.cardPreview,
  ASSET_BUNDLE_IDS.menuSettings,
  ASSET_BUNDLE_IDS.sharedUI
] as const

/** Application ownership keeps menu assets resident while scenes come and go. */
export class MenuStartupResources {
  private readonly scope = new AssetScope()
  private readonly sources = new Map<TextureSource, boolean>()
  private readonly outlineFields: AuraFieldLease[] = []

  async prepare(renderer: Renderer): Promise<void> {
    // Settle all work before failure cleanup can release its resources.
    const results = await Promise.allSettled([
      document.fonts.load('700 24px Belwe'),
      document.fonts.load('400 24px "Franklin Gothic Condensed"'),
      document.fonts.load('700 24px "Franklin Gothic Condensed"'),
      document.fonts.load('400 48px Fraps'),
      this.prepareBundles(renderer)
    ])
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
    prepareMenuEffects(renderer)
  }

  private async prepareBundles(renderer: Renderer): Promise<void> {
    // Overlap decoding in pairs, keeping card mipmaps before any shared upload.
    for (let offset = 0; offset < MENU_STARTUP_BUNDLES.length; offset += 2) {
      const bundles = MENU_STARTUP_BUNDLES.slice(offset, offset + 2)
      const results = await Promise.allSettled(
        bundles.map((bundle) => this.scope.acquire<Record<string, Texture>>(bundle))
      )
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') throw result.reason
        const bundle = bundles[index]
        const assets = result.value
        if (bundle === ASSET_BUNDLE_IDS.cardRendering) {
          Object.values(assets).forEach(configureCardTexture)
        }
        const textures = Object.values(assets).filter((texture) => {
          const source = texture.source
          if (this.sources.has(source)) return false
          this.sources.set(source, source.autoGarbageCollect)
          source.autoGarbageCollect = false
          return true
        })
        // Pixi spreads uploads over frames; only one upload queue runs at a time.
        await renderer.prepare.upload(textures)
        if (bundle === ASSET_BUNDLE_IDS.mainMenu) {
          warmMainMenuEffects(renderer, {
            dustRound: assets.dustRound,
            dustTriangle: assets.dustTriangle
          })
        } else if (bundle === ASSET_BUNDLE_IDS.arena) {
          prepareRewardGhostAura(renderer, {
            confirmReward: assets.confirmReward,
            burnNoise: assets.burnNoise,
            ghostDissolve: assets.ghostDissolve,
            ghostSpotlight: assets.ghostSpotlight
          })
        } else if (bundle === ASSET_BUNDLE_IDS.deckSelection) {
          this.prepareOutline(renderer, assets.playButton, 'play-button')
        } else if (bundle === ASSET_BUNDLE_IDS.deckPresentation) {
          this.prepareOutline(renderer, assets.deckButtonFrame, 'deck-frame')
        } else if (bundle === ASSET_BUNDLE_IDS.collection) {
          this.prepareOutline(renderer, assets.expansionToggle, 'expansion-toggle')
        }
      }
    }
  }

  private prepareOutline(
    renderer: Renderer,
    texture: Texture,
    preset: OutlinePresetName
  ): void {
    const field = prepareMenuOutline(renderer, texture, preset)
    this.outlineFields.push(field)
    const source = field.field.texture.source
    this.sources.set(source, source.autoGarbageCollect)
    source.autoGarbageCollect = false
  }

  async release(): Promise<void> {
    for (const [source, automatic] of this.sources) {
      source.autoGarbageCollect = automatic
    }
    this.sources.clear()
    for (const field of this.outlineFields) field.release()
    this.outlineFields.length = 0
    await this.scope.releaseAll()
  }
}
