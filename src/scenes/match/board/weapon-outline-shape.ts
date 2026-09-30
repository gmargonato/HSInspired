import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js'
import { prebuildSharedAuraShape } from '../../../visual-components/effects/aura-filter'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { WEAPON_LAYOUT } from './weapon-layout'

export function weaponOutlineShapeKey(texture: Texture): string {
  return `weapon-frame:${texture.uid}`
}

/** Fill the artwork aperture so the hover glow only traces the outer plate. */
export function createWeaponOutlineProxy(texture: Texture): Container {
  const proxy = new Container()
  proxy.label = 'weapon.hover-outline-proxy'
  proxy.eventMode = 'none'
  proxy.visible = false
  const frame = new Sprite(texture)
  applyAnchoredPlacement(frame, WEAPON_LAYOUT.frame)
  frame.label = 'weapon.hover-outline-proxy.frame'
  const aperture = new Graphics()
  aperture
    .ellipse(
      WEAPON_LAYOUT.artwork.position.x,
      WEAPON_LAYOUT.artwork.position.y,
      WEAPON_LAYOUT.artworkOval.radiusX,
      WEAPON_LAYOUT.artworkOval.radiusY
    )
    .fill({ color: 0xffffff })
  aperture.label = 'weapon.hover-outline-proxy.aperture'
  proxy.addChild(frame, aperture)
  return proxy
}

export function prebuildWeaponOutlineShape(renderer: Renderer, texture: Texture): void {
  const proxy = createWeaponOutlineProxy(texture)
  try {
    prebuildSharedAuraShape(renderer, weaponOutlineShapeKey(texture), proxy)
  } finally {
    proxy.destroy({ children: true })
  }
}
