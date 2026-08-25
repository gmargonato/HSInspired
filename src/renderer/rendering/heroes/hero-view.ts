import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { AnimatedOutline, OUTLINE_PROFILES } from '../effects/animated-outline'
import { AnimationScope } from '../../animation/animations'
import { HERO_CANVAS, HERO_LAYOUT } from './hero-layout'

export interface HeroViewModel {
  readonly label: string
  readonly attack: number
  readonly health: number
  readonly maxHealth: number
}

export interface HeroViewTextures {
  readonly frame: Texture
  readonly attack: Texture
  readonly health: Texture
}

export const HERO_HEALTH_COLORS = {
  normal: 0xffffff,
  damaged: 0xff4a4a,
  increased: 0x6cff47
} as const

interface StatGroup {
  readonly group: Container
  readonly value: Text
}

function createStatGroup(
  label: string,
  texture: Texture,
  placement: typeof HERO_LAYOUT.attackBadge,
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
    style: HERO_LAYOUT.statText,
    anchor: 0.5
  })
  valueLabel.position.set(0, 0)
  valueLabel.label = `${label}-value`
  group.addChild(valueLabel)
  return { group, value: valueLabel }
}

function setEventModeNone(container: Container): void {
  container.eventMode = 'none'
  for (const child of container.children) {
    child.eventMode = 'none'
    if (child instanceof Container) setEventModeNone(child)
  }
}

/** Feature-agnostic board hero presentation. The feature owns its position. */
export class HeroView extends Container {
  private readonly attackGroup: Container
  private readonly attackLabel: Text
  private readonly healthLabel: Text
  private readonly outlineProxy: Graphics
  private readonly attackOutline: AnimatedOutline
  private readonly animationScope = new AnimationScope()
  private readonly maxHealth: number
  private canAttackEnabled = false
  private targetableEnabled = false
  private selected = false
  private baseScale = 1

  public ownerId: string | null = null

  private constructor(model: HeroViewModel, textures: HeroViewTextures) {
    super()
    this.label = model.label
    this.maxHealth = model.maxHealth
    this.eventMode = 'none'
    this.pivot.set(HERO_CANVAS.width / 2, HERO_CANVAS.height / 2)

    const frame = new Sprite(textures.frame)
    applyAnchoredPlacement(frame, HERO_LAYOUT.frame)
    frame.label = 'hero.frame'
    this.addChild(frame)

    const attack = createStatGroup(
      'hero.stat-attack',
      textures.attack,
      HERO_LAYOUT.attackBadge,
      model.attack
    )
    this.attackGroup = attack.group
    this.attackLabel = attack.value
    this.attackGroup.visible = model.attack > 0
    this.addChild(this.attackGroup)

    const health = createStatGroup(
      'hero.stat-health',
      textures.health,
      HERO_LAYOUT.healthBadge,
      model.health
    )
    this.healthLabel = health.value
    this.addChild(health.group)
    this.setHealthColor(model.health)

    this.outlineProxy = new Graphics()
    this.outlineProxy.label = 'hero.attack-outline-proxy'
    this.outlineProxy.eventMode = 'none'
    this.outlineProxy
      .ellipse(
        HERO_LAYOUT.attackOutline.position.x,
        HERO_LAYOUT.attackOutline.position.y,
        HERO_LAYOUT.attackOutline.size.width / 2,
        HERO_LAYOUT.attackOutline.size.height / 2
      )
      .fill({ color: 0xffffff })
    this.outlineProxy.visible = false
    this.addChildAt(this.outlineProxy, 0)
    this.attackOutline = new AnimatedOutline(
      this.outlineProxy,
      HERO_LAYOUT.attackOutline.color,
      OUTLINE_PROFILES.card
    )
    this.attackOutline.setEnabled(false)

    this.hitArea = new Rectangle(0, 0, HERO_CANVAS.width, HERO_CANVAS.height)
    this.cursor = 'pointer'
    setEventModeNone(this)
    this.eventMode = 'none'
    this.baseScale = 1
  }

  static create(model: HeroViewModel, textures: HeroViewTextures): HeroView {
    return new HeroView(model, textures)
  }

  setStats(attack: number, health: number): void {
    this.attackLabel.text = String(attack)
    this.attackGroup.visible = attack > 0
    this.healthLabel.text = String(health)
    this.setHealthColor(health)
  }

  private setHealthColor(health: number): void {
    this.healthLabel.style.fill =
      health < this.maxHealth
        ? HERO_HEALTH_COLORS.damaged
        : health > this.maxHealth
          ? HERO_HEALTH_COLORS.increased
          : HERO_HEALTH_COLORS.normal
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
    const targetScale = this.baseScale * (selected ? HERO_LAYOUT.selectionScale : 1)
    this.animationScope.kill(this.scale)
    this.animationScope.to(this.scale, {
      x: targetScale,
      y: targetScale,
      duration: 0.18,
      ease: 'back.out(1.2)',
      overwrite: 'auto'
    })
  }

  setBaseScale(scale: number): void {
    this.baseScale = scale
    this.scale.set(scale * (this.selected ? HERO_LAYOUT.selectionScale : 1))
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.attackOutline.dispose()
    this.animationScope.kill()
    super.destroy(options)
  }
}
