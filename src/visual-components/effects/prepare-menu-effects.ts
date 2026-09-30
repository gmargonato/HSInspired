import {
  AlphaFilter,
  BlurFilter,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer
} from 'pixi.js'
import { createHingedDoorMesh } from './hinged-door'
import { createManaHighlightFilter } from './highlight'
import { PremiumArtworkBreath } from './premium-artwork-breath'
import { AnimatedOutline, type OutlinePresetName } from './animated-outline'
import { acquireAuraField, type AuraFieldLease } from './aura-field-cache'

/** Retain the expensive silhouette field and compile its shader before navigation. */
export function prepareMenuOutline(
  renderer: Renderer,
  texture: Texture,
  preset: OutlinePresetName
): AuraFieldLease {
  const field = acquireAuraField(renderer, texture)
  const root = new Container()
  root.label = 'startup.outline-warmup'
  const sprite = new Sprite(texture)
  sprite.label = `startup.outline-${preset}`
  sprite.position.set(16, 16)
  sprite.scale.set(32 / Math.max(texture.width, texture.height))
  root.addChild(sprite)
  const outline = new AnimatedOutline(sprite, { palette: 'blue', preset })
  const target = RenderTexture.create({ width: 64, height: 64, resolution: 1 })
  try {
    outline.prebuild(renderer)
    renderer.render({ container: root, target, clear: true })
    return field
  } catch (error) {
    field.release()
    throw error
  } finally {
    outline.dispose()
    root.destroy({ children: true })
    target.destroy(true)
  }
}

/** Exercise menu rendering paths without creating scenes or loading card artwork. */
export function prepareMenuEffects(renderer: Renderer): void {
  const root = new Container()
  root.label = 'startup.shader-warmup'
  const target = RenderTexture.create({ width: 64, height: 64, resolution: 1 })
  const filters = [
    new BlurFilter({ strength: 2, quality: 2 }),
    new AlphaFilter({ alpha: 0.5 }),
    createManaHighlightFilter()
  ]
  const sample = (): Sprite => {
    const sprite = new Sprite(Texture.WHITE)
    sprite.width = sprite.height = 32
    root.addChild(sprite)
    return sprite
  }
  const artwork = sample()
  const premium = new PremiumArtworkBreath(artwork)

  try {
    for (const filter of filters) sample().filters = [filter]
    premium.setEnabled(true)

    // Both card-art geometry masks and card-frame alpha masks have separate paths.
    const clipped = sample()
    const stencil = new Graphics().ellipse(16, 16, 16, 12).fill(0xffffff)
    root.addChild(stencil)
    clipped.mask = stencil
    const framed = sample()
    framed.mask = sample()

    const lid = createHingedDoorMesh(Texture.WHITE, 'left', { x: 0, y: 0 })
    root.addChild(lid)
    renderer.render({ container: root, target, clear: true })
  } finally {
    premium.destroy()
    root.destroy({ children: true })
    // Keep the shared shader programs and asset textures alive in Pixi's caches.
    for (const filter of filters) filter.destroy()
    target.destroy(true)
  }
}
