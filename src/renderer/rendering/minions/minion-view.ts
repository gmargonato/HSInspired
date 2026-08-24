import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { AnimatedOutline, OUTLINE_PROFILES } from '../effects/animated-outline'
import { MINION_CANVAS, MINION_LAYOUT } from './minion-layout'
import { SleepingZs } from './sleeping-zs'
import { AnimationScope } from '../../animation/animations'

export interface MinionViewModel {
  readonly label: string
  readonly attack: number
  readonly health: number
  /** Original card health used to tint current health after damage/healing. */
  readonly originalHealth?: number
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

export const MINION_HEALTH_COLORS = {
  normal: 0xffffff,
  damaged: 0xff4a4a,
  increased: 0x6cff47
} as const

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
  private readonly outlineProxy: Graphics
  private readonly attackOutline: AnimatedOutline
  private readonly sleepingZs: SleepingZs
  private readonly animationScope = new AnimationScope()
  private readonly originalHealth: number
  private canAttackEnabled = false
  private targetableEnabled = false
  private selected = false
  private baseScale = 1
  /** External owner id for attack checks (set by feature). */
  public ownerId: string | null = null
  public instanceId: string | null = null

  private constructor(
    model: MinionViewModel,
    textures: MinionViewTextures,
    artwork: Texture | undefined
  ) {
    super()
    this.label = model.label
    this.originalHealth = model.originalHealth ?? model.health
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
    this.setHealthColor(model.health)

    // Green attack-ready outline: solid oval proxy so the hollow frame does not create an inner glow.
    // The filter draws only the exterior glow; the white interior is discarded by the shader.
    this.outlineProxy = new Graphics()
    this.outlineProxy.label = 'minion.attack-outline-proxy'
    this.outlineProxy.eventMode = 'none'
    this.outlineProxy.ellipse(80, 90, 58, 79).fill({ color: 0xffffff })
    this.outlineProxy.visible = false
    // Place behind the frame so the glow appears outside the oval, not covering badges.
    this.addChildAt(this.outlineProxy, 1)
    this.attackOutline = new AnimatedOutline(
      this.outlineProxy,
      MINION_LAYOUT.canAttackOutline.color,
      OUTLINE_PROFILES.card
    )
    this.attackOutline.setEnabled(false)

    this.sleepingZs = new SleepingZs()
    this.sleepingZs.label = 'minion.sleeping-zs-root'
    this.addChild(this.sleepingZs)

    this.hitArea = new Rectangle(0, 0, MINION_CANVAS.width, MINION_CANVAS.height)
    this.cursor = 'pointer'

    setEventModeNone(this)
    // Restore interactivity host after children were forced to none.
    this.eventMode = 'none'
    this.baseScale = 1
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
    this.setHealthColor(health)
  }

  private setHealthColor(health: number): void {
    this.healthLabel.style.fill =
      health < this.originalHealth
        ? MINION_HEALTH_COLORS.damaged
        : health > this.originalHealth
          ? MINION_HEALTH_COLORS.increased
          : MINION_HEALTH_COLORS.normal
  }

  setTaunt(visible: boolean): void {
    this.taunt.visible = visible
  }

  setDivineShield(visible: boolean): void {
    this.divineShield.visible = visible
  }

  setCanAttack(enabled: boolean): void {
    this.canAttackEnabled = enabled
    this.attackOutline.setEnabled(enabled)
    this.outlineProxy.visible = enabled
    if (!enabled && this.selected) this.setSelected(false)
  }

  isCanAttack(): boolean {
    return this.canAttackEnabled
  }

  /** Enables pointer input independently of the green attacker-ready state. */
  setTargetable(enabled: boolean): void {
    this.targetableEnabled = enabled
    this.eventMode = enabled ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'
  }

  isTargetable(): boolean {
    return this.targetableEnabled
  }

  isSelected(): boolean {
    return this.selected
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return
    this.selected = selected
    const targetScale = this.baseScale * (selected ? MINION_LAYOUT.selectionScale : 1)
    this.animationScope.kill(this.scale)
    if (selected) {
      this.animationScope.to(this.scale, {
        x: targetScale,
        y: targetScale,
        duration: 0.22,
        ease: 'back.out(1.4)',
        overwrite: 'auto'
      })
    } else {
      this.animationScope.to(this.scale, {
        x: targetScale,
        y: targetScale,
        duration: 0.18,
        ease: 'power2.inOut',
        overwrite: 'auto'
      })
    }
  }

  setBaseScale(scale: number): void {
    this.baseScale = scale
    const targetScale = this.selected ? scale * MINION_LAYOUT.selectionScale : scale
    // Board reflow should feel snappy; selected keeps its lift via scale.
    this.animationScope.kill(this.scale)
    this.animationScope.to(this.scale, {
      x: targetScale,
      y: targetScale,
      duration: 0.25,
      ease: 'power2.out',
      overwrite: 'auto'
    })
  }

  setSleeping(sleeping: boolean): void {
    if (sleeping) this.sleepingZs.start()
    else this.sleepingZs.stop()
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.animationScope.kill()
    this.attackOutline.dispose()
    this.sleepingZs.dispose()
    super.destroy(options)
  }
}
