import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { HERO_POWER_PRESENTATION_LAYOUT } from './hero-power-layout'

export function heroPowerOutlineShapeKey(frame: Texture): string {
  return `hero-power-frame:${frame.uid}`
}

/** Keep the silhouette independent of power artwork and its premium animation. */
export function createHeroPowerOutlineProxy(texture: Texture): Container {
  const proxy = new Container()
  proxy.label = 'hero-power.outline-proxy'
  proxy.eventMode = 'none'
  proxy.visible = false
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
