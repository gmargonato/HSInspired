import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { WEAPON_CANVAS, WEAPON_LAYOUT } from './weapon-layout'

export interface WeaponViewModel {
  readonly label: string
  readonly attack: number
  readonly durability: number
}

export interface WeaponViewTextures {
  readonly frame: Texture
  readonly attack: Texture
  readonly durability: Texture
}

interface StatGroup {
  readonly group: Container
  readonly value: Text
}

function setEventModeNone(container: Container): void {
  container.eventMode = 'none'
  for (const child of container.children) {
    child.eventMode = 'none'
    if (child instanceof Container) setEventModeNone(child)
  }
}

function createStatGroup(
  label: string,
  texture: Texture,
  placement: typeof WEAPON_LAYOUT.attackBadge,
  value: number
): StatGroup {
  const group = new Container()
  applyPlacement(group, placement)
  group.label = label

  const badge = new Sprite(texture)
  badge.anchor.set(0.5)
  badge.position.set(0, 0)
  badge.label = `${label}-badge`
  group.addChild(badge)

  const valueLabel = new Text({
    text: String(value),
    style: WEAPON_LAYOUT.statText,
    anchor: 0.5
  })
  valueLabel.position.set(0, 0)
  valueLabel.label = `${label}-value`
  group.addChild(valueLabel)
  return { group, value: valueLabel }
}

/** Feature-agnostic equipped weapon presentation. The caller owns its position. */
export class WeaponView extends Container {
  private readonly attackLabel: Text
  private readonly durabilityLabel: Text

  private constructor(
    model: WeaponViewModel,
    textures: WeaponViewTextures,
    artwork: Texture | undefined
  ) {
    super()
    this.label = model.label
    this.eventMode = 'none'
    this.pivot.set(WEAPON_CANVAS.width / 2, WEAPON_CANVAS.height / 2)

    const artworkLayer = new Container()
    applyPlacement(artworkLayer, WEAPON_LAYOUT.artwork)
    artworkLayer.label = 'weapon.artwork'

    const { radiusX, radiusY, center } = WEAPON_LAYOUT.artworkOval
    if (artwork) {
      const image = new Sprite(artwork)
      image.anchor.set(0.5)
      image.position.set(center.x, center.y)
      const artworkWidth = Math.max(1, artwork.width)
      const artworkHeight = Math.max(1, artwork.height)
      const coverScale = Math.max(
        (radiusX * 2) / artworkWidth,
        (radiusY * 2) / artworkHeight
      )
      image.scale.set(coverScale)
      image.label = 'weapon.artwork-image'
      artworkLayer.addChild(image)
    } else {
      const placeholder = new Graphics()
      placeholder.ellipse(center.x, center.y, radiusX, radiusY).fill(0x535b65)
      placeholder.label = 'weapon.artwork-placeholder'
      artworkLayer.addChild(placeholder)
    }

    const mask = new Graphics()
    mask.ellipse(center.x, center.y, radiusX, radiusY).fill(0xffffff)
    mask.label = 'weapon.artwork-mask'
    artworkLayer.mask = mask
    artworkLayer.addChild(mask)
    this.addChild(artworkLayer)

    const frame = new Sprite(textures.frame)
    applyAnchoredPlacement(frame, WEAPON_LAYOUT.frame)
    frame.label = 'weapon.frame'
    this.addChild(frame)

    const attack = createStatGroup(
      'weapon.stat-attack',
      textures.attack,
      WEAPON_LAYOUT.attackBadge,
      model.attack
    )
    this.attackLabel = attack.value
    this.addChild(attack.group)

    const durability = createStatGroup(
      'weapon.stat-durability',
      textures.durability,
      WEAPON_LAYOUT.durabilityBadge,
      model.durability
    )
    this.durabilityLabel = durability.value
    this.addChild(durability.group)

    this.hitArea = new Rectangle(0, 0, WEAPON_CANVAS.width, WEAPON_CANVAS.height)
    setEventModeNone(this)
  }

  static async create(
    model: WeaponViewModel,
    textures: WeaponViewTextures,
    artwork: Texture | undefined
  ): Promise<WeaponView> {
    return new WeaponView(model, textures, artwork)
  }

  setStats(attack: number, durability: number): void {
    this.attackLabel.text = String(attack)
    this.durabilityLabel.text = String(durability)
  }
}
