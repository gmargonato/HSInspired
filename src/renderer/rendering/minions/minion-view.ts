import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { AnimatedOutline } from '../effects/animated-outline'
import { createTemporaryAbilityBadge } from '../temporary-ability-badge'
import {
  MINION_CANVAS,
  MINION_HIT_AREA,
  MINION_LAYOUT,
  minionTemporaryAbilityBadgePlacement
} from './minion-layout'
import { SleepingZs } from './sleeping-zs'
import { AnimationScope } from '../../animation/animations'
import { minionStatColor } from './minion-stat-presentation'

export interface MinionViewModel {
  readonly label: string
  readonly attack: number
  readonly health: number
  /** Original card attack used to tint current attack after buffs/debuffs. */
  readonly originalAttack?: number
  /** Original card health used to tint current health after damage/healing. */
  readonly originalHealth?: number
  readonly legendary: boolean
  readonly taunt: boolean
  readonly divineShield: boolean
  readonly frozen: boolean
  readonly stealth: boolean
  readonly deathrattle: boolean
  readonly poisonous: boolean
  readonly trigger: boolean
  readonly temporaryAbilityLabels: readonly string[]
}

export interface MinionViewTextures {
  readonly frame: Texture
  readonly legendaryFrame: Texture
  readonly taunt: Texture
  readonly divineShield: Texture
  readonly frozen: Texture
  readonly stealth: Texture
  readonly trigger: Texture
  readonly deathrattle: Texture
  readonly poisonous: Texture
  readonly attack: Texture
  readonly health: Texture
}

export type MinionAbilityMarkerKind = 'trigger' | 'deathrattle'

export interface AbilityMarkerSnapshot {
  readonly texture: Texture
  readonly globalPosition: { readonly x: number; readonly y: number }
  readonly worldScale: number
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
  private readonly frozen: Sprite
  private readonly stealth: Sprite
  private readonly deathrattle: Sprite
  private readonly trigger: Sprite
  private readonly attackLabel: Text
  private readonly healthLabel: Text
  private readonly artworkImage: Sprite
  private readonly artworkPlaceholder: Graphics
  private readonly outlineProxy: Graphics
  private readonly attackOutline: AnimatedOutline
  private readonly targetingOutlineProxy: Graphics
  private readonly targetingOutline: AnimatedOutline
  private readonly sleepingZs: SleepingZs
  private readonly animationScope = new AnimationScope()
  private readonly activeAbilityPulses = new Set<Sprite>()
  private originalAttack: number
  private originalHealth: number
  private canAttackEnabled = false
  private targetingOutlineEnabled = false
  private targetableEnabled = false
  private selected = false
  private baseScale = 1
  /** External owner id for attack checks (set by feature). */
  public ownerId: string | null = null
  public instanceId: string | null = null
  public cardId: string | null = null

  private constructor(
    model: MinionViewModel,
    textures: MinionViewTextures,
    artwork: Texture | undefined
  ) {
    super()
    this.label = model.label
    this.originalAttack = model.originalAttack ?? model.attack
    this.originalHealth = model.originalHealth ?? model.health
    this.eventMode = 'none'
    this.pivot.set(MINION_CANVAS.width / 2, MINION_CANVAS.height / 2)

    const artworkLayer = new Container()
    applyPlacement(artworkLayer, MINION_LAYOUT.artwork)
    artworkLayer.label = 'minion.artwork'

    const { radiusX, radiusY, center } = MINION_LAYOUT.artworkOval
    this.artworkImage = new Sprite(artwork ?? Texture.EMPTY)
    this.artworkImage.anchor.set(0.5)
    this.artworkImage.position.set(center.x, center.y)
    this.artworkImage.visible = artwork !== undefined
    if (artwork) {
      const artworkWidth = Math.max(1, artwork.width)
      const artworkHeight = Math.max(1, artwork.height)
      const coverScale = Math.max(
        (radiusX * 2) / artworkWidth,
        (radiusY * 2) / artworkHeight
      )
      this.artworkImage.scale.set(coverScale)
    }
    this.artworkImage.label = 'minion.artwork-image'
    artworkLayer.addChild(this.artworkImage)
    this.artworkPlaceholder = new Graphics()
    this.artworkPlaceholder.ellipse(center.x, center.y, radiusX, radiusY).fill(0x535b65)
    this.artworkPlaceholder.label = 'minion.artwork-placeholder'
    this.artworkPlaceholder.visible = artwork === undefined
    artworkLayer.addChild(this.artworkPlaceholder)

    const mask = new Graphics()
    mask.ellipse(center.x, center.y, radiusX, radiusY).fill(0xffffff)
    mask.label = 'minion.artwork-mask'
    artworkLayer.mask = mask
    artworkLayer.addChild(mask)
    this.addChild(artworkLayer)

    this.taunt = new Sprite(textures.taunt)
    applyAnchoredPlacement(this.taunt, MINION_LAYOUT.taunt)
    this.taunt.visible = model.taunt
    this.taunt.label = 'minion.taunt'
    this.addChild(this.taunt)

    const frame = new Sprite(textures.frame)
    applyAnchoredPlacement(frame, MINION_LAYOUT.frame)
    frame.label = 'minion.frame'
    this.addChild(frame)

    this.legendaryFrame = new Sprite(textures.legendaryFrame)
    applyAnchoredPlacement(this.legendaryFrame, MINION_LAYOUT.legendaryFrame)
    this.legendaryFrame.visible = model.legendary
    this.legendaryFrame.label = 'minion.frame-legendary'
    this.addChild(this.legendaryFrame)

    this.frozen = new Sprite(textures.frozen)
    applyAnchoredPlacement(this.frozen, MINION_LAYOUT.frozen)
    this.frozen.visible = model.frozen
    this.frozen.label = 'minion.frozen'
    this.addChild(this.frozen)

    this.stealth = new Sprite(textures.stealth)
    applyAnchoredPlacement(this.stealth, MINION_LAYOUT.stealth)
    this.stealth.visible = model.stealth
    this.stealth.label = 'minion.stealth'
    this.addChild(this.stealth)

    this.divineShield = new Sprite(textures.divineShield)
    applyAnchoredPlacement(this.divineShield, MINION_LAYOUT.divineShield)
    this.divineShield.visible = model.divineShield
    this.divineShield.label = 'minion.divine-shield'
    this.addChild(this.divineShield)

    // Pixi renders later children on top: add the large Deathrattle badge first.
    // Keep both ability sprites mounted even when hidden so runtime-granted
    // triggers/deathrattles can reveal the same marker without rebuilding the
    // minion view.
    this.deathrattle = new Sprite(textures.deathrattle)
    applyAnchoredPlacement(this.deathrattle, MINION_LAYOUT.deathrattle)
    this.deathrattle.visible = model.deathrattle
    this.deathrattle.label = 'minion.deathrattle'
    this.addChild(this.deathrattle)

    if (model.poisonous) {
      const poisonous = new Sprite(textures.poisonous)
      applyAnchoredPlacement(poisonous, MINION_LAYOUT.poisonous)
      poisonous.label = 'minion.poisonous'
      this.addChild(poisonous)
    }

    this.trigger = new Sprite(textures.trigger)
    applyAnchoredPlacement(this.trigger, MINION_LAYOUT.trigger)
    this.trigger.visible = model.trigger
    this.trigger.label = 'minion.trigger'
    this.addChild(this.trigger)

    model.temporaryAbilityLabels.forEach((text, index) => {
      const badge = createTemporaryAbilityBadge(
        text,
        minionTemporaryAbilityBadgePlacement(
          index,
          model.temporaryAbilityLabels.length
        ),
        `minion.temporary-ability-${index}`
      )
      this.addChild(badge)
    })

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
    this.setAttackColor(model.attack)
    this.setHealthColor(model.health)

    // Green attack-ready outline: solid oval proxy so the hollow frame does not create an inner glow.
    // The filter draws only the exterior glow; the white interior is discarded by the shader.
    this.outlineProxy = new Graphics()
    this.outlineProxy.label = 'minion.attack-outline-proxy'
    this.outlineProxy.eventMode = 'none'
    this.outlineProxy.ellipse(80, 90, 58, 79).fill({ color: 0xffffff })
    this.outlineProxy.visible = false
    // Keep every outline above Taunt but below the minion frame. The Taunt ring
    // is larger than the frame and would otherwise obscure the glow.
    this.addChildAt(this.outlineProxy, this.getChildIndex(frame))
    this.attackOutline = new AnimatedOutline(this.outlineProxy, 'green', 'card')
    this.attackOutline.setEnabled(false)

    this.targetingOutlineProxy = new Graphics()
    this.targetingOutlineProxy.label = 'minion.targeting-outline-proxy'
    this.targetingOutlineProxy.eventMode = 'none'
    this.targetingOutlineProxy.ellipse(80, 90, 58, 79).fill({ color: 0xffffff })
    this.targetingOutlineProxy.visible = false
    this.addChildAt(this.targetingOutlineProxy, this.getChildIndex(frame))
    this.targetingOutline = new AnimatedOutline(
      this.targetingOutlineProxy,
      'red',
      'card'
    )
    this.targetingOutline.setEnabled(false)

    this.sleepingZs = new SleepingZs()
    this.sleepingZs.label = 'minion.sleeping-zs-root'
    this.addChild(this.sleepingZs)

    this.hitArea = new Rectangle(
      MINION_HIT_AREA.x,
      MINION_HIT_AREA.y,
      MINION_HIT_AREA.width,
      MINION_HIT_AREA.height
    )
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
    this.setAttackColor(attack)
    this.setHealthColor(health)
  }

  setBaseStats(attack: number, health: number): void {
    this.originalAttack = attack
    this.originalHealth = health
    this.setStats(attack, health)
  }

  setArtwork(texture: Texture): void {
    this.artworkImage.texture = texture
    const { radiusX, radiusY } = MINION_LAYOUT.artworkOval
    const coverScale = Math.max(
      (radiusX * 2) / Math.max(1, texture.width),
      (radiusY * 2) / Math.max(1, texture.height)
    )
    this.artworkImage.scale.set(coverScale)
    this.artworkImage.visible = true
    this.artworkPlaceholder.visible = false
  }

  setAttack(attack: number): void {
    this.attackLabel.text = String(attack)
    this.setAttackColor(attack)
  }

  setHealth(health: number): void {
    this.healthLabel.text = String(health)
    this.setHealthColor(health)
  }

  private setAttackColor(attack: number): void {
    this.attackLabel.style.fill = minionStatColor(attack, this.originalAttack)
  }

  private setHealthColor(health: number): void {
    this.healthLabel.style.fill = minionStatColor(health, this.originalHealth)
  }

  setTaunt(visible: boolean): void {
    this.taunt.visible = visible
  }

  setDivineShield(visible: boolean): void {
    this.divineShield.visible = visible
  }

  setFrozen(visible: boolean): void {
    this.frozen.visible = visible
  }

  setStealth(visible: boolean): void {
    this.stealth.visible = visible
  }

  setDeathrattle(visible: boolean): void {
    this.deathrattle.visible = visible
  }

  setTrigger(visible: boolean): void {
    this.trigger.visible = visible
  }

  getAbilityMarkerSnapshot(
    kind: MinionAbilityMarkerKind
  ): AbilityMarkerSnapshot | null {
    const marker = kind === 'trigger' ? this.trigger : this.deathrattle
    if (marker.destroyed) return null
    const global = marker.getGlobalPosition()
    return {
      texture: marker.texture,
      globalPosition: { x: global.x, y: global.y },
      worldScale: Math.max(
        0.001,
        Math.hypot(marker.worldTransform.a, marker.worldTransform.b)
      )
    }
  }

  /** Pulses the existing board ability icon without introducing a new asset. */
  presentAbilityPulse(kind: MinionAbilityMarkerKind, duration: number): Promise<void> {
    const marker = kind === 'trigger' ? this.trigger : this.deathrattle
    if (marker.destroyed) return Promise.resolve()
    const pulse = new Sprite(marker.texture)
    pulse.anchor.set(marker.anchor.x, marker.anchor.y)
    pulse.position.set(marker.x, marker.y)
    pulse.scale.set(marker.scale.x * 0.82, marker.scale.y * 0.82)
    pulse.alpha = 0
    pulse.tint = 0xffffff
    pulse.blendMode = 'add'
    pulse.zIndex = marker.zIndex + 1
    pulse.label = `minion.${kind}.pulse`
    pulse.eventMode = 'none'
    this.addChild(pulse)
    this.activeAbilityPulses.add(pulse)

    const cleanup = (): void => {
      this.activeAbilityPulses.delete(pulse)
      if (!pulse.destroyed) pulse.destroy({ children: true })
    }
    const timeline = this.animationScope.timeline()
    const half = Math.max(0.01, duration / 2)
    timeline.to(pulse, {
      alpha: 1,
      duration: half,
      ease: 'sine.inOut'
    })
    timeline.to(
      pulse.scale,
      {
        x: marker.scale.x * 1.18,
        y: marker.scale.y * 1.18,
        duration: duration,
        ease: 'sine.inOut'
      },
      0
    )
    timeline.to(pulse, {
      alpha: 0,
      duration: half,
      ease: 'sine.inOut',
      onComplete: cleanup
    })
    return new Promise((resolve) => {
      timeline.eventCallback('onComplete', () => {
        cleanup()
        resolve()
      })
      timeline.eventCallback('onInterrupt', () => {
        cleanup()
        resolve()
      })
    })
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

  /** Shows the red outline while this minion is a valid targeting destination. */
  setTargetingOutline(enabled: boolean): void {
    this.targetingOutlineEnabled = enabled
    this.syncOutlineState()
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
    for (const pulse of this.activeAbilityPulses) {
      if (!pulse.destroyed) pulse.destroy({ children: true })
    }
    this.activeAbilityPulses.clear()
    this.attackOutline.dispose()
    this.targetingOutline.dispose()
    this.sleepingZs.dispose()
    super.destroy(options)
  }
}
