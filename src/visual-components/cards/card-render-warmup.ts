import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import { CARD_CATALOG, type CardDefinition } from '../../game-rules/content/cards'
import { CardAssetResolver } from '../assets/card-asset-resolver'
import { CARD_PROFILES } from './card-layout'
import { CardView } from './card-view'
import { isClassFrameClass } from './class-frame-colors'
import { AnimatedOutline } from '../effects/animated-outline'
import {
  acquireTradeableAura,
  tradeableAuraOcclusion,
  type TradeableAuraLease
} from './tradeable-aura'

/** One real class card per layout, rather than constructing the whole catalog. */
export function cardRenderSamples(): readonly CardDefinition[] {
  const cards = CARD_CATALOG.all
  return [
    ...(['Minion', 'Spell', 'Weapon', 'Hero'] as const).flatMap((type) => {
      const card = cards.find(
        (candidate) => candidate.type === type && isClassFrameClass(candidate.cardClass)
      )
      return card ? [card] : []
    }),
    CARD_CATALOG.require('classic_big_game_hunter')
  ]
}

/** Exercise actual curved text, masks, premium color passes and cache/outline shaders. */
export async function prewarmCardRenderPaths(
  renderer: Renderer,
  resolver: CardAssetResolver,
  cancelled: () => boolean,
  onProgress?: (progress: number) => Promise<void>
): Promise<void> {
  const cards = cardRenderSamples()
  for (const [index, definition] of cards.entries()) {
    if (cancelled()) return
    const root = new Container()
    root.label = 'cards.render-warmup'
    let target: RenderTexture | undefined
    let outline: AnimatedOutline | undefined
    let tradeableOutline: AnimatedOutline | undefined
    let tradeableAura: TradeableAuraLease | undefined
    try {
      const card = await CardView.create(definition, resolver, {
        artwork: Texture.WHITE,
        premium: false,
        ignorePremiumOverride: true,
        animatePremiumArtwork: true
      })
      root.addChild(card)
      if (cancelled()) return
      card.scale.set(0.1)
      card.enableTextureCache()
      const frame = new Sprite(
        await resolver.load(CARD_PROFILES[card.plan.template].frame)
      )
      if (cancelled()) {
        frame.destroy({ texture: false, textureSource: false })
        return
      }
      frame.scale.set(0.04)
      root.addChild(frame)
      outline = new AnimatedOutline(frame, {
        palette: 'green',
        preset: 'card',
        fillHolesForSmoothing: card.plan.template === 'minion'
      })
      outline.prebuild(renderer)
      if (card.tradeableTexture) {
        tradeableAura = acquireTradeableAura(renderer, card.tradeableTexture)
        const banner = new Sprite(tradeableAura.texture)
        banner.scale.set(0.1)
        banner.label = 'cards.tradeable-outline-warmup'
        root.addChild(banner)
        tradeableOutline = new AnimatedOutline(banner, {
          palette: 'green',
          preset: 'card',
          occlusion: () => tradeableAuraOcclusion(card.costIconTexture)
        })
        tradeableOutline.prebuild(renderer)
      }
      target = RenderTexture.create({ width: 128, height: 128, resolution: 1 })
      for (const premium of [false, true]) {
        card.setPremiumPresentation(premium)
        renderer.render({ container: root, target, clear: true })
      }
    } finally {
      outline?.dispose()
      tradeableOutline?.dispose()
      root.destroy({ children: true, texture: false, textureSource: false })
      tradeableAura?.release()
      target?.destroy(true)
    }
    if (onProgress) await onProgress((index + 1) / cards.length)
    else await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
