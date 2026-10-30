import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js'
import { applyAnchoredPlacement } from '../layout'
import { acquireAuraField, type AuraFieldLease } from '../effects/aura-field-cache'
import type { AuraOcclusion } from '../effects/aura-filter'
import {
  CARD_STATS,
  CARD_TRADEABLE_AURA_LAYOUT,
  CARD_TRADEABLE_LAYOUT
} from './card-layout'

interface SharedAura {
  readonly texture: Texture
  readonly field: AuraFieldLease
  references: number
}
export interface TradeableAuraLease {
  readonly texture: Texture
  release(): void
}
const sharedAuras = new WeakMap<Renderer, Map<Texture, SharedAura>>()

/** CPU-backed silhouette survives GPU eviction/context restoration; shared by all copies. */
export function acquireTradeableAura(
  renderer: Renderer,
  banner: Texture
): TradeableAuraLease {
  let cache = sharedAuras.get(renderer)
  if (!cache) {
    cache = new Map()
    sharedAuras.set(renderer, cache)
  }
  let entry = cache.get(banner)
  if (!entry) {
    const root = new Container()
    root.label = 'card.tradeable-silhouette'
    const sprite = new Sprite(banner)
    sprite.label = 'card.tradeable-silhouette-banner'
    applyAnchoredPlacement(sprite, CARD_TRADEABLE_LAYOUT)
    root.addChild(sprite)
    const { position, size } = CARD_TRADEABLE_AURA_LAYOUT
    let texture: Texture | undefined
    try {
      const canvas = renderer.extract.canvas({
        target: root,
        frame: new Rectangle(position.x, position.y, size.width, size.height),
        resolution: 1,
        antialias: true
      })
      texture = Texture.from(canvas)
      texture.source.autoGarbageCollect = false
      entry = { texture, field: acquireAuraField(renderer, texture), references: 0 }
      cache.set(banner, entry)
    } catch (error) {
      texture?.destroy(true)
      throw error
    } finally {
      root.destroy({ children: true, texture: false, textureSource: false })
    }
  }
  const acquired = entry
  acquired.references++
  let released = false
  return {
    texture: acquired.texture,
    release(): void {
      if (released) return
      released = true
      if (--acquired.references > 0) return
      cache.delete(banner)
      acquired.field.release()
      acquired.texture.destroy(true)
    }
  }
}

/** Cost icon rectangle expressed in the aura silhouette's normalized coordinates. */
export function tradeableAuraOcclusion(
  texture: Texture | undefined
): AuraOcclusion | undefined {
  if (!texture) return undefined
  const { position, size } = CARD_TRADEABLE_AURA_LAYOUT
  const icon = CARD_STATS.mana.icon
  const stat = CARD_STATS.mana.position
  // Cost-resource replacement preserves the sprite's native scale, not mana's size.
  const width = texture.orig.width * (icon.scale?.x ?? 1)
  const height = texture.orig.height * (icon.scale?.y ?? 1)
  return {
    texture,
    bounds: new Rectangle(
      (stat.x + icon.position.x - icon.anchor.x * width - position.x) / size.width,
      (stat.y + icon.position.y - icon.anchor.y * height - position.y) / size.height,
      width / size.width,
      height / size.height
    )
  }
}
