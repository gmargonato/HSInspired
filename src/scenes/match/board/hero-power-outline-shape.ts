import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { HERO_POWER_PRESENTATION_LAYOUT } from './hero-power-layout'

export function heroPowerOutlineShapeKey(frame: Texture, mesh = false): string {
  return `hero-power-frame:${frame.uid}:${mesh ? 'mesh-v1' : 'icon'}`
}

/** Keep the silhouette independent of power artwork and its premium animation. */
export function createHeroPowerOutlineProxy(
  texture: Texture,
  mesh = false,
  premium = false
): Container {
  const proxy = new Container()
  proxy.label = 'hero-power.outline-proxy'
  proxy.eventMode = 'none'
  proxy.visible = false
  if (mesh) {
    const layout = HERO_POWER_PRESENTATION_LAYOUT.boardOutline
    const contour = new Graphics()
      .circle(layout.center.x, layout.center.y, layout.radius)
      .fill(0xffffff)
    if (premium) contour.poly([...layout.premiumCrown]).fill(0xffffff)
    contour.label = 'hero-power.outline-proxy.mesh-contour'
    proxy.addChild(contour)
    return proxy
  }
  const layout = HERO_POWER_PRESENTATION_LAYOUT.icon
  const frame = new Sprite(texture)
  applyAnchoredPlacement(frame, layout.frame)
  frame.label = 'hero-power.outline-proxy.frame'
  const aperture = new Graphics()
    .circle(layout.artwork.position.x, layout.artwork.position.y, layout.artworkRadius)
    .fill(0xffffff)
  aperture.label = 'hero-power.outline-proxy.aperture'
  proxy.addChild(frame, aperture)
  return proxy
}
