import type { WindfuryTuning } from '../../../desktop/contracts/ipc/windfury-tuning'
import { Container, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'
import {
  AnimatedOutline,
  type OutlinePaletteInput,
  type OutlineTuning
} from '../../../visual-components/effects/animated-outline'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { WindfuryEffect } from './windfury-effect'
import { createHealthPulse } from './health-pulse'
import { HERO_CANVAS, HERO_LAYOUT, HERO_SPELL_PLAY } from './hero-layout'
import { attachShadow } from '../../../visual-components/effects/shadow-caster'
import { HeroPortrait } from '../../../visual-components/hero-portrait'

export interface HeroViewModel {
  readonly label: string
  readonly attack: number
  readonly health: number
  readonly maxHealth: number
  readonly armor: number
  readonly frozen: boolean
  readonly immune: boolean
  readonly windfury?: boolean
}

export interface HeroViewTextures {
  readonly frame: Texture
  readonly attack: Texture
  readonly health: Texture
  readonly armor: Texture
  readonly frozen: Texture
  readonly immune: Texture
}

export const HERO_HEALTH_COLORS = {
  normal: 0xffffff,
  damaged: 0xff4a4a,
  increased: 0x6cff47
} as const

const HERO_REPLACEMENT_FLIP = {
  close: 0.2,
  open: 0.2
} as const

interface StatGroup {
  readonly group: Container
  readonly badge: Sprite
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
  return { group, badge, value: valueLabel }
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
  readonly shadow = attachShadow(
    this,
    { x: 0, y: 0, ...HERO_CANVAS },
    { restingHeight: 0 }
  )
  private readonly windfury: WindfuryEffect
  private readonly frame: HeroPortrait
  private readonly frozen: Sprite
  private readonly immune: Sprite
  private immuneVisible = false
  private transientImmune = false
  private readonly attackGroup: Container
  private readonly attackLabel: Text
  private readonly healthGroup: Container
  private readonly healthLabel: Text
  readonly pulseHealth: () => void
  private readonly armorGroup: Container
  private readonly armorLabel: Text
  private readonly outlineProxy: Sprite
  private readonly attackOutline: AnimatedOutline
  private readonly attentionProxy: Sprite
  private readonly attentionOutline: AnimatedOutline
  private aiAttention = false
  private attackWarning = false
  private readonly targetingOutlineProxy: Sprite
  private readonly targetingOutline: AnimatedOutline
  private readonly animationScope = new AnimationScope()
  private maxHealth: number
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

    this.windfury = new WindfuryEffect(HERO_LAYOUT.windfury, 'hero.windfury')
    this.windfury.setEnabled(model.windfury ?? false)
    this.addChild(this.windfury.rear)

    this.frame = new HeroPortrait(textures.frame)
    applyAnchoredPlacement(this.frame, HERO_LAYOUT.frame)
    this.frame.label = 'hero.frame'
    this.addChild(this.frame)

    this.frozen = new Sprite(textures.frozen)
    applyAnchoredPlacement(this.frozen, HERO_LAYOUT.frozen)
    this.frozen.visible = model.frozen
    this.frozen.label = 'hero.frozen'
    this.addChild(this.frozen)

    this.immune = new Sprite(textures.immune)
    applyAnchoredPlacement(this.immune, HERO_LAYOUT.immune)
    this.setImmune(model.immune)
    this.immune.label = 'hero.immune'
    this.addChild(this.immune)
    this.addChild(this.windfury.front)

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
    this.pulseHealth = createHealthPulse(health.group, this.animationScope)
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

    // Snapshot the complete portrait and badges, not the hollow frame layer.
    // Reuse that silhouette while the assembled hero moves.
    const surfaces = [this.frame, attack.badge, health.badge, armor.badge]
    this.shadow.silhouette = {
      revision: 0,
      create: () => {
        const body = new Container()
        body.label = 'hero.shadow-silhouette'
        for (const source of surfaces) {
          if (!source.visible || !source.parent?.visible) continue
          const copy = new Sprite(source.texture)
          copy.label = `${source.label}.shadow-surface`
          if (source === this.frame) {
            // The replacement animation briefly scales the live frame to zero.
            // Keep its baked footprint at the authored portrait placement.
            applyAnchoredPlacement(copy, HERO_LAYOUT.frame)
          } else {
            copy.anchor.copyFrom(source.anchor)
            source.updateLocalTransform()
            const transform = source.localTransform.clone()
            source.parent.updateLocalTransform()
            transform.prepend(source.parent.localTransform)
            copy.setFromMatrix(transform)
          }
          copy.tint = 0x000000
          body.addChild(copy)
        }
        return body
      }
    }

    // Use the hero-frame alpha as the outline silhouette. A generic oval makes
    // heroes read like minions, while this preserves the portrait's arched top
    // and squared base.
    this.outlineProxy = new Sprite(textures.frame)
    applyAnchoredPlacement(this.outlineProxy, HERO_LAYOUT.frame)
    this.outlineProxy.label = 'hero.attack-outline-proxy'
    this.outlineProxy.eventMode = 'none'
    this.outlineProxy.visible = false
    this.addChildAt(this.outlineProxy, 0)
    this.attackOutline = new AnimatedOutline(this.outlineProxy, {
      palette: 'green',
      preset: 'hero'
    })
    this.attackOutline.setEnabled(false)

    this.attentionProxy = new Sprite(textures.frame)
    applyAnchoredPlacement(this.attentionProxy, HERO_LAYOUT.frame)
    this.attentionProxy.label = 'hero.attention-outline-proxy'
    this.attentionProxy.eventMode = 'none'
    this.attentionProxy.visible = false
    this.addChildAt(this.attentionProxy, 0)
    this.attentionOutline = new AnimatedOutline(this.attentionProxy, {
      palette: 'white',
      preset: 'hero'
    })
    this.attentionOutline.setEnabled(false)

    this.targetingOutlineProxy = new Sprite(textures.frame)
    applyAnchoredPlacement(this.targetingOutlineProxy, HERO_LAYOUT.frame)
    this.targetingOutlineProxy.label = 'hero.targeting-outline-proxy'
    this.targetingOutlineProxy.eventMode = 'none'
    this.targetingOutlineProxy.visible = false
    this.addChildAt(this.targetingOutlineProxy, 0)
    this.targetingOutline = new AnimatedOutline(this.targetingOutlineProxy, {
      palette: 'red',
      preset: 'hero'
    })
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

  /** Decorative cast feedback; it never delays spell resolution. */
  playSpellPulse(texture: Texture): void {
    if (this.destroyed) return
    const pulse = new Sprite(texture)
    pulse.label = 'hero.spell-play'
    pulse.eventMode = 'none'
    pulse.blendMode = 'add'
    pulse.alpha = 0
    applyAnchoredPlacement(pulse, HERO_SPELL_PLAY.placement)
    const fullScale = pulse.scale.clone()
    pulse.scale.set(
      fullScale.x * HERO_SPELL_PLAY.initialScale,
      fullScale.y * HERO_SPELL_PLAY.initialScale
    )
    this.addChildAt(pulse, this.getChildIndex(this.attackGroup))
    const cleanup = (): void => {
      pulse.destroy()
    }
    this.animationScope
      .timeline({ onComplete: cleanup, onInterrupt: cleanup })
      .to(pulse, {
        alpha: HERO_SPELL_PLAY.peakAlpha,
        duration: HERO_SPELL_PLAY.brightenDuration,
        ease: 'power2.out'
      })
      .to(pulse, {
        alpha: 0,
        delay: HERO_SPELL_PLAY.holdDuration,
        duration: HERO_SPELL_PLAY.fadeDuration,
        ease: 'power2.out'
      })
      .to(
        pulse.scale,
        {
          x: fullScale.x,
          y: fullScale.y,
          duration: HERO_SPELL_PLAY.expandDuration,
          ease: 'power2.out'
        },
        0
      )
  }

  pauseAnimations(): void {
    this.animationScope.pause()
  }

  resumeAnimations(): void {
    this.animationScope.resume()
  }

  /** Independent current portrait/frame, without combat UI. */
  createPortrait(): Container {
    const portrait = new Container()
    portrait.label = 'hero.portrait-copy'
    portrait.pivot.set(HERO_CANVAS.width / 2, HERO_CANVAS.height / 2)
    portrait.eventMode = 'none'
    const frame = new HeroPortrait(this.frame.texture)
    frame.label = 'hero.portrait-copy.frame'
    applyAnchoredPlacement(frame, HERO_LAYOUT.frame)
    portrait.addChild(frame)
    return portrait
  }

  setAttack(attack: number): void {
    this.attackLabel.text = String(attack)
    if (this.attackGroup.visible !== attack > 0) this.shadow.silhouette!.revision++
    this.attackGroup.visible = attack > 0
  }

  setStats(attack: number, health: number, armor: number, maxHealth: number): void {
    this.setAttack(attack)
    this.setHealthAndArmor(health, armor, maxHealth)
  }

  /** Updates hero health and armor without changing attack badge visibility. */
  setHealthAndArmor(health: number, armor: number, maxHealth: number): void {
    this.maxHealth = maxHealth
    this.healthLabel.text = String(health)
    this.setHealthColor(health)
    this.armorLabel.text = String(armor)
    if (this.armorGroup.visible !== (this.healthVisible && armor > 0))
      this.shadow.silhouette!.revision++
    this.armorGroup.visible = this.healthVisible && armor > 0
  }

  /** Replaces both portrait layers while preserving the hero's board state. */
  setFrame(texture: Texture): void {
    this.frame.texture = texture
    this.outlineProxy.texture = texture
    this.attentionProxy.texture = texture
    this.targetingOutlineProxy.texture = texture
    this.shadow.silhouette!.revision++
  }

  /** Flips the portrait assembly, swapping identity edge-on without flipping stats. */
  replaceFrame(texture: Texture): Promise<void> {
    const baseScaleX = this.frame.scale.x
    const timeline = this.animationScope.timeline()
    let swapped = false
    const applyReplacement = (): void => {
      if (swapped) return
      swapped = true
      this.setFrame(texture)
    }
    timeline.to(this.frame.scale, {
      x: 0,
      duration: HERO_REPLACEMENT_FLIP.close,
      ease: 'power2.in'
    })
    timeline.call(applyReplacement)
    timeline.to(this.frame.scale, {
      x: baseScaleX,
      duration: HERO_REPLACEMENT_FLIP.open,
      ease: 'power2.out'
    })
    return new Promise((resolve) => {
      const finish = (): void => {
        applyReplacement()
        this.frame.scale.x = baseScaleX
        resolve()
      }
      timeline.eventCallback('onComplete', finish)
      timeline.eventCallback('onInterrupt', finish)
    })
  }

  setWindfury(enabled: boolean): void {
    this.windfury.setEnabled(enabled)
  }

  setWindfuryTuning(tuning: WindfuryTuning): void {
    this.windfury.setTuning(tuning)
  }

  setFrozen(visible: boolean): void {
    this.frozen.visible = visible
  }

  setImmune(visible: boolean): void {
    this.immuneVisible = visible
    this.immune.visible = visible || this.transientImmune
  }

  /** Keeps brief immunity visible while an animation outlives its domain state. */
  setTransientImmune(visible: boolean): void {
    this.transientImmune = visible
    this.immune.visible = this.immuneVisible || visible
  }

  /** Controls whether the health badge is shown independently of its value. */
  setHealthVisible(visible: boolean): void {
    this.healthVisible = visible
    if (this.healthGroup.visible !== visible) this.shadow.silhouette!.revision++
    this.healthGroup.visible = visible
    const armorVisible = visible && Number(this.armorLabel.text) > 0
    if (this.armorGroup.visible !== armorVisible) this.shadow.silhouette!.revision++
    this.armorGroup.visible = armorVisible
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

  setOutlineAppearance(palette: OutlinePaletteInput, tuning: OutlineTuning): void {
    this.attentionOutline.setTuning(tuning)
    this.attackOutline.setPalette(palette)
    this.attackOutline.setTuning(tuning)
    this.targetingOutline.setTuning(tuning)
  }

  /** Shows the red outline while this hero is a valid targeting destination. */
  setTargetingOutline(enabled: boolean): void {
    this.targetingOutlineEnabled = enabled
    this.syncOutlineState()
  }

  setAiAttention(enabled: boolean): void {
    this.aiAttention = enabled
    this.attentionOutline.setEnabled(this.aiAttention || this.attackWarning)
  }

  setAttackWarning(enabled: boolean): void {
    this.attackWarning = enabled
    this.attentionOutline.setEnabled(this.aiAttention || this.attackWarning)
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
    this.shadow.restingScale = scale
    this.scale.set(scale * (this.selected ? HERO_LAYOUT.selectionScale : 1))
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.attackOutline.dispose()
    this.attentionOutline.dispose()
    this.targetingOutline.dispose()
    this.animationScope.kill()
    this.windfury.destroy()
    super.destroy(options)
  }
}
