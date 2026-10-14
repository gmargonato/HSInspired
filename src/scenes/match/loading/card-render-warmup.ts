import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import { CARD_CATALOG, type CardDefinition } from '../../../game-rules/content/cards'
import { CardAssetResolver } from '../../../visual-components/assets/card-asset-resolver'
import { CARD_PROFILES } from '../../../visual-components/cards/card-layout'
import { CardView } from '../../../visual-components/cards/card-view'
import { isClassFrameClass } from '../../../visual-components/cards/class-frame-colors'
import { AnimatedOutline } from '../../../visual-components/effects/animated-outline'

/** One real class card per layout, rather than constructing the whole catalog. */
export function matchCardRenderSamples(): readonly CardDefinition[] {
  const cards = CARD_CATALOG.all
  return (['Minion', 'Spell', 'Weapon', 'Hero'] as const).flatMap((type) => {
    const card = cards.find(
      (candidate) => candidate.type === type && isClassFrameClass(candidate.cardClass)
    )
    return card ? [card] : []
  })
}

/** Exercise actual curved text, masks, premium color passes and cache/outline shaders. */
export async function prewarmCardRenderPaths(
  renderer: Renderer,
  resolver: CardAssetResolver,
  cancelled: () => boolean,
  onProgress?: (progress: number) => Promise<void>
): Promise<void> {
  const cards = matchCardRenderSamples()
  for (const [index, definition] of cards.entries()) {
    if (cancelled()) return
    const root = new Container()
    root.label = 'game.card-render-warmup'
    let target: RenderTexture | undefined
    let outline: AnimatedOutline | undefined
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
      outline = new AnimatedOutline(frame, { palette: 'green', preset: 'card' })
      outline.prebuild(renderer)
      target = RenderTexture.create({ width: 128, height: 128, resolution: 1 })
      for (const premium of [false, true]) {
        card.setPremiumPresentation(premium)
        renderer.render({ container: root, target, clear: true })
      }
    } finally {
      outline?.dispose()
      root.destroy({ children: true, texture: false, textureSource: false })
      target?.destroy(true)
    }
    if (onProgress) await onProgress((index + 1) / cards.length)
    else await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

/** Warm the actual opening strings/caches even while their mulligan slots are hidden. */
export function prewarmOpeningCard(renderer: Renderer, card: CardView): void {
  // generateTexture renders this card as its own root, bypassing its alpha-zero
  // slot. Its retained cache survives; the temporary output does not.
  const snapshot = card.createAppearanceSnapshot(renderer)
  snapshot.destroy(true)
}
