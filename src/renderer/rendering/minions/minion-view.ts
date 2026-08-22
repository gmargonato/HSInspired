import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { MINION_CANVAS, MINION_LAYOUT } from './minion-layout'

export interface MinionViewModel {
  readonly label: string
  readonly attack: number
  readonly health: number
  readonly legendary: boolean
  readonly taunt: boolean
  readonly divineShield: boolean
}

export interface MinionViewTextures {
  readonly frame: Texture
  readonly legendaryFrame: Texture
  readonly taunt: Texture
  readonly divineShield: Texture
  readonly attack: Texture
  readonly health: Texture
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
  placement: typeof MINION_LAYOUT.attackBadge,
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
    style: MINION_LAYOUT.statText,
    anchor: 0.5
  })
  valueLabel.position.set(0, 0)
  valueLabel.label = `${label}-value`
  group.addChild(valueLabel)
  return { group, value: valueLabel }
}

/** Feature-agnostic board minion presentation. The caller owns its position. */
export class MinionView extends Container {
  private readonly legendaryFrame: Sprite
  private readonly taunt: Sprite
  private readonly divineShield: Sprite
  private readonly attackLabel: Text
  private readonly healthLabel: Text

  private constructor(
    model: MinionViewModel,
    textures: MinionViewTextures,
    artwork: Texture | undefined
  ) {
    super()
    this.label = model.label
    this.eventMode = 'none'
    this.pivot.set(MINION_CANVAS.width / 2, MINION_CANVAS.height / 2)

    const artworkLayer = new Container()
    applyPlacement(artworkLayer, MINION_LAYOUT.artwork)
    artworkLayer.label = 'minion.artwork'

    const { radiusX, radiusY, center } = MINION_LAYOUT.artworkOval
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
      image.label = 'minion.artwork-image'
      artworkLayer.addChild(image)
    } else {
      const placeholder = new Graphics()
      placeholder.ellipse(center.x, center.y, radiusX, radiusY).fill(0x535b65)
      placeholder.label = 'minion.artwork-placeholder'
      artworkLayer.addChild(placeholder)
    }

    const mask = new Graphics()
    mask.ellipse(center.x, center.y, radiusX, radiusY).fill(0xffffff)
    mask.label = 'minion.artwork-mask'
    artworkLayer.mask = mask
    artworkLayer.addChild(mask)
    this.addChild(artworkLayer)

    const frame = new Sprite(textures.frame)
    applyAnchoredPlacement(frame, MINION_LAYOUT.frame)
    frame.label = 'minion.frame'
    this.addChild(frame)

    this.legendaryFrame = new Sprite(textures.legendaryFrame)
    applyAnchoredPlacement(this.legendaryFrame, MINION_LAYOUT.legendaryFrame)
    this.legendaryFrame.visible = model.legendary
    this.legendaryFrame.label = 'minion.frame-legendary'
    this.addChild(this.legendaryFrame)

    this.taunt = new Sprite(textures.taunt)
    applyAnchoredPlacement(this.taunt, MINION_LAYOUT.taunt)
    this.taunt.visible = model.taunt
    this.taunt.label = 'minion.taunt'
    this.addChild(this.taunt)

    this.divineShield = new Sprite(textures.divineShield)
    applyAnchoredPlacement(this.divineShield, MINION_LAYOUT.divineShield)
    this.divineShield.visible = model.divineShield
    this.divineShield.label = 'minion.divine-shield'
    this.addChild(this.divineShield)

    const attack = createStatGroup(
      'minion.stat-attack',
      textures.attack,
      MINION_LAYOUT.attackBadge,
      model.attack
    )
    this.attackLabel = attack.value
    this.addChild(attack.group)

    const health = createStatGroup(
      'minion.stat-health',
      textures.health,
      MINION_LAYOUT.healthBadge,
      model.health
    )
    this.healthLabel = health.value
    this.addChild(health.group)

    setEventModeNone(this)
  }

  static async create(
    model: MinionViewModel,
    textures: MinionViewTextures,
    artwork: Texture | undefined
  ): Promise<MinionView> {
    return new MinionView(model, textures, artwork)
  }

  setStats(attack: number, health: number): void {
    this.attackLabel.text = String(attack)
    this.healthLabel.text = String(health)
  }

  setTaunt(visible: boolean): void {
    this.taunt.visible = visible
  }

  setDivineShield(visible: boolean): void {
    this.divineShield.visible = visible
  }
}
