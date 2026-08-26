import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { AnimatedOutline } from '../effects/animated-outline'
import { AnimationScope } from '../../animation/animations'
import { HERO_CANVAS, HERO_LAYOUT } from './hero-layout'

export interface HeroViewModel {
  readonly label: string
  readonly attack: number
  readonly health: number
  readonly maxHealth: number
  readonly armor: number
}

export interface HeroViewTextures {
  readonly frame: Texture
  readonly attack: Texture
  readonly health: Texture
  readonly armor: Texture
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
  value: number,
  fontSize: number = HERO_LAYOUT.statText.fontSize
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
    style: { ...HERO_LAYOUT.statText, fontSize },
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
  private readonly healthGroup: Container
  private readonly healthLabel: Text
  private readonly armorGroup: Container
  private readonly armorLabel: Text
  private readonly outlineProxy: Graphics
  private readonly attackOutline: AnimatedOutline
  private readonly targetingOutlineProxy: Graphics
  private readonly targetingOutline: AnimatedOutline
  private readonly animationScope = new AnimationScope()
  private readonly maxHealth: number
  private canAttackEnabled = false
  private targetingOutlineEnabled = false
  private targetableEnabled = false
  private selected = false
  private baseScale = 1
  private healthVisible = false

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
    this.healthGroup = health.group
    this.healthLabel = health.value
    this.healthGroup.visible = false
    this.addChild(this.healthGroup)
    this.setHealthColor(model.health)

    const armor = createStatGroup(
      'hero.stat-armor',
      textures.armor,
      HERO_LAYOUT.armorBadge,
      model.armor,
      HERO_LAYOUT.armorLabelFontSize
    )
    this.armorGroup = armor.group
    this.armorLabel = armor.value
    this.armorGroup.visible = false
    this.addChild(this.armorGroup)

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
    this.attackOutline = new AnimatedOutline(this.outlineProxy, 'green', 'card')
    this.attackOutline.setEnabled(false)

    this.targetingOutlineProxy = new Graphics()
    this.targetingOutlineProxy.label = 'hero.targeting-outline-proxy'
    this.targetingOutlineProxy.eventMode = 'none'
    this.targetingOutlineProxy
      .ellipse(
        HERO_LAYOUT.attackOutline.position.x,
        HERO_LAYOUT.attackOutline.position.y,
        HERO_LAYOUT.attackOutline.size.width / 2,
        HERO_LAYOUT.attackOutline.size.height / 2
      )
      .fill({ color: 0xffffff })
    this.targetingOutlineProxy.visible = false
    this.addChildAt(this.targetingOutlineProxy, 0)
    this.targetingOutline = new AnimatedOutline(
      this.targetingOutlineProxy,
      'red',
      'card'
    )
    this.targetingOutline.setEnabled(false)

    this.hitArea = new Rectangle(0, 0, HERO_CANVAS.width, HERO_CANVAS.height)
    this.cursor = 'pointer'
    setEventModeNone(this)
    this.eventMode = 'none'
    this.baseScale = 1
  }

  static create(model: HeroViewModel, textures: HeroViewTextures): HeroView {
    return new HeroView(model, textures)
  }

  setStats(attack: number, health: number, armor: number): void {
    this.attackLabel.text = String(attack)
    this.attackGroup.visible = attack > 0
    this.healthLabel.text = String(health)
    this.setHealthColor(health)
    this.armorLabel.text = String(armor)
    this.armorGroup.visible = this.healthVisible && armor > 0
  }

  /** Controls whether the health badge is shown independently of its value. */
  setHealthVisible(visible: boolean): void {
    this.healthVisible = visible
    this.healthGroup.visible = visible
    this.armorGroup.visible = visible && Number(this.armorLabel.text) > 0
  }

  private setHealthColor(health: number): void {
    this.healthLabel.style.fill =
      health < this.maxHealth
        ? HERO_HEALTH_COLORS.damaged
        : health > this.maxHealth
          ? HERO_HEALTH_COLORS.increased
          : HERO_HEALTH_COLORS.normal
  }

  private syncOutlineState(): void {
    const showAttackOutline = this.canAttackEnabled && !this.targetingOutlineEnabled
    this.attackOutline.setEnabled(showAttackOutline)
    this.outlineProxy.visible = showAttackOutline
    this.targetingOutline.setEnabled(this.targetingOutlineEnabled)
    this.targetingOutlineProxy.visible = this.targetingOutlineEnabled
  }

  setCanAttack(enabled: boolean): void {
    this.canAttackEnabled = enabled
    this.syncOutlineState()
    if (!enabled && this.selected) this.setSelected(false)
  }

  /** Shows the red outline while this hero is a valid targeting destination. */
  setTargetingOutline(enabled: boolean): void {
    this.targetingOutlineEnabled = enabled
    this.syncOutlineState()
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
    this.targetingOutline.dispose()
    this.animationScope.kill()
    super.destroy(options)
  }
}
