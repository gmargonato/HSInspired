import { Rectangle, Texture } from 'pixi.js'
import type { HeroPowerAssetKey } from './hero-power-asset-keys'

const ARTWORK_ZOOM = 1.1
// These native portraits expose unfinished edges inside the power frame.
// Keep one centered crop and leave the other portraits at their original framing.
const ZOOMED_ARTWORKS = [
  'hero-power-rogue',
  'hero-power-shaman',
  'hero-power-ancient-blades',
  'hero-power-obelisks-eye'
] as const satisfies readonly HeroPowerAssetKey[]

/** Share the framing across 2D icons, 3D controls and card previews.
 * Texture frames reference the original pixels without changing the PNGs.
 */
export function prepareHeroPowerTextures(assets: Record<string, Texture>): {
  assets: Record<string, Texture>
  dispose: () => void
} {
  const result = { ...assets }
  const generated: Texture[] = []
  for (const key of ZOOMED_ARTWORKS) {
    const raw = assets[key]
    if (!raw) continue
    const { x, y, width, height } = raw.frame
    const croppedWidth = width / ARTWORK_ZOOM
    const croppedHeight = height / ARTWORK_ZOOM
    const texture = new Texture({
      source: raw.source,
      frame: new Rectangle(
        x + (width - croppedWidth) / 2,
        y + (height - croppedHeight) / 2,
        croppedWidth,
        croppedHeight
      )
    })
    generated.push(texture)
    result[key] = texture
  }
  return {
    assets: result,
    dispose: () => {
      // The asset bundle owns the shared sources and disposes them separately.
      for (const texture of generated) texture.destroy(false)
    }
  }
}
