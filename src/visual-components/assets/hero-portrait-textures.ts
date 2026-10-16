import { Texture } from 'pixi.js'
import {
  HERO_ARTWORK_PLACEMENTS,
  HERO_PORTRAIT_CANVAS,
  HERO_PORTRAIT_LAYOUT
} from '../hero-portrait-layout'

export interface HeroPortraitLayers {
  readonly artwork: Texture
  readonly frame: Texture
  readonly premium: boolean
}

const layers = new WeakMap<Texture, HeroPortraitLayers>()
const premiumVariants = new WeakMap<Texture, Texture>()
export function premiumHeroPortrait(texture: Texture): Texture {
  return premiumVariants.get(texture) ?? texture
}
export const getHeroPortraitLayers = (
  texture: Texture
): HeroPortraitLayers | undefined => layers.get(texture)

function canvas(): HTMLCanvasElement {
  const result = document.createElement('canvas')
  result.width = HERO_PORTRAIT_CANVAS.width
  result.height = HERO_PORTRAIT_CANVAS.height
  return result
}

function source(texture: Texture): CanvasImageSource {
  return texture.source.resource as CanvasImageSource
}

/** Assemble once during bundle acquisition, before GPU uploads or outline warm-up.
 * Texture-only consumers receive the complete surface; live portraits reuse its layers.
 */
export function prepareHeroPortraitTextures(assets: Record<string, Texture>): {
  assets: Record<string, Texture>
  dispose: () => void
} {
  const result = { ...assets }
  const generated: Texture[] = []
  const frame = assets.heroPortraitFrame
  const premiumFrame = assets.heroPortraitPremiumFrame
  const mask = assets.heroPortraitMask
  try {
    for (const [key, placement] of Object.entries(HERO_ARTWORK_PLACEMENTS)) {
      const raw = assets[key]
      if (!raw) continue
      const artCanvas = canvas()
      const art = artCanvas.getContext('2d')!
      art.drawImage(source(raw), placement.position.x, placement.position.y)
      art.globalCompositeOperation = 'destination-in'
      art.drawImage(source(mask), 0, 0)
      const artwork = Texture.from(artCanvas)
      generated.push(artwork)

      const combined = canvas()
      const context = combined.getContext('2d')!
      context.drawImage(artCanvas, 0, 0)
      context.drawImage(
        source(frame),
        HERO_PORTRAIT_LAYOUT.frame.position.x,
        HERO_PORTRAIT_LAYOUT.frame.position.y
      )
      const texture = Texture.from(combined)
      generated.push(texture)
      layers.set(texture, { artwork, frame, premium: false })
      result[key] = texture
      if (premiumFrame) {
        const premiumCanvas = canvas()
        const premiumContext = premiumCanvas.getContext('2d')!
        premiumContext.drawImage(artCanvas, 0, 0)
        premiumContext.drawImage(
          source(premiumFrame),
          HERO_PORTRAIT_LAYOUT.frame.position.x,
          HERO_PORTRAIT_LAYOUT.frame.position.y
        )
        const premiumTexture = Texture.from(premiumCanvas)
        generated.push(premiumTexture)
        layers.set(premiumTexture, { artwork, frame: premiumFrame, premium: true })
        premiumVariants.set(texture, premiumTexture)
        result[`hero-premium:${key}`] = premiumTexture
      }
      // Include live layers in the existing upload/residency pass as well.
      result[`hero-artwork:${key}`] = artwork
    }
  } catch (error) {
    for (const texture of generated) texture.destroy(true)
    throw error
  }
  return {
    assets: result,
    dispose: () => {
      for (const texture of generated) {
        layers.delete(texture)
        premiumVariants.delete(texture)
        texture.destroy(true)
      }
    }
  }
}
