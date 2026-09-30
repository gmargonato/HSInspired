import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'
import {
  AnimatedOutline,
  type OutlinePaletteInput,
  type OutlineTuning
} from '../../../visual-components/effects/animated-outline'
import { MINION_CANVAS, MINION_HIT_AREA, MINION_LAYOUT } from './minion-layout'
import { attachShadow } from '../../../visual-components/effects/shadow-caster'
import { SleepingZs } from './sleeping-zs'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { killDisplayTweens } from '../../../visual-components/animation/kill-display-tweens'
import { minionAttackColor, minionHealthColor } from './minion-stat-presentation'
import {
  isPremiumEnabled,
  subscribeToPremiumAppearance
} from '../../../visual-components/cards/premium-appearance'
import { PremiumArtworkBreath } from '../../../visual-components/effects/premium-artwork-breath'
import {
  MINION_OUTLINE_SHAPE_KEY,
  createMinionOutlineProxy
} from './minion-outline-shape'

export interface MinionViewModel {
  readonly premiumSide?: 'local' | 'remote'
  readonly premium?: boolean
  readonly label: string
  readonly attack: number
  readonly health: number
  readonly maxHealth: number
  /** Printed Attack of the current card identity; Set and enchantments do not change it. */
  readonly baseAttack?: number
  /** Printed Health of the current card identity; Set and enchantments do not change it. */
  readonly baseHealth?: number
  readonly legendary: boolean
  readonly taunt: boolean
  readonly enraged: boolean
  readonly divineShield: boolean
  readonly frozen: boolean
  readonly stealth: boolean
  readonly deathrattle: boolean
  readonly poisonous: boolean
  readonly aura: boolean
  readonly trigger: boolean
  readonly inspire: boolean
  readonly windfury: boolean
  readonly spellDamage: boolean
  readonly lifesteal: boolean
  readonly elusive: boolean
  readonly immune: boolean
}

export interface MinionViewTextures {
  readonly windfury: Texture
  readonly spellDamage: Texture
  readonly lifesteal: Texture
  readonly aura: Texture
  readonly elusive: Texture
  readonly immune: Texture
  readonly frame: Texture
  readonly premiumFrame: Texture
  readonly legendaryFrame: Texture
  readonly premiumLegendaryFrame: Texture
  readonly taunt: Texture
  readonly premiumTaunt: Texture
  readonly battlecry: Texture
  readonly enrage: Texture
  readonly divineShield: Texture
  readonly frozen: Texture
  readonly stealth: Texture
  readonly trigger: Texture
  readonly inspire: Texture
  readonly deathrattle: Texture
  readonly poisonous: Texture
  readonly attack: Texture
  readonly health: Texture
}

export type MinionAbilityMarkerKind = 'trigger' | 'inspire' | 'deathrattle'

export interface AbilityMarkerSnapshot {
  readonly texture: Texture
  readonly globalPosition: { readonly x: number; readonly y: number }
  readonly worldScale: number
}

interface StatGroup {
  readonly group: Container
  readonly badge: Sprite
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
  value: number,
  valueOffset: { readonly x: number; readonly y: number }
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
  valueLabel.position.set(valueOffset.x, valueOffset.y)
  valueLabel.label = `${label}-value`
  group.addChild(valueLabel)
  return { group, badge, value: valueLabel }
}

/** Feature-agnostic board minion presentation. The caller owns its position. */
export class MinionView extends Container {
  readonly shadow = attachShadow(
    this,
    {
      x: MINION_LAYOUT.frame.position.x - MINION_LAYOUT.frame.size.width / 2,
      y: MINION_LAYOUT.frame.position.y - MINION_LAYOUT.frame.size.height / 2,
      ...MINION_LAYOUT.frame.size
    },
    { shape: 'ellipse' }
  )
  private readonly unsubscribePremium: () => void
  private readonly premiumSide: 'local' | 'remote'
  private premium: boolean
  private refreshPremium: () => void = () => undefined
  private readonly artworkBreath: PremiumArtworkBreath
  private readonly legendaryFrame: Sprite
  private readonly taunt: Sprite
  private readonly battlecryBanner: Sprite
  private readonly enrage: Sprite
  private readonly divineShield: Sprite
  private readonly windfury: Sprite
  private readonly spellDamage: Sprite
  private readonly lifesteal: Sprite
  private readonly aura: Sprite
  private readonly elusive: Sprite
  private readonly immune: Sprite
  private readonly frozen: Sprite
  private readonly stealth: Sprite
  private readonly deathrattle: Sprite
  private readonly poisonous: Sprite
  private readonly trigger: Sprite
  private readonly inspire: Sprite
  private readonly attackLabel: Text
  private readonly healthLabel: Text
  private readonly artworkImage: Sprite
  private readonly artworkPlaceholder: Graphics
  private readonly outlineProxy: Graphics
  private readonly attackOutline: AnimatedOutline
  private readonly targetingOutlineProxy: Graphics
  private readonly targetingOutline: AnimatedOutline
  private readonly hoverOutlineProxy: Graphics
  private readonly hoverOutline: AnimatedOutline
  private readonly sleepingZs: SleepingZs
  private readonly animationScope = new AnimationScope()
  private readonly activeAbilityPulses = new Set<Sprite>()
  private battlecryBannerTimeline: ReturnType<AnimationScope['timeline']> | null = null
  private settleBattlecryBanner: (() => void) | null = null
  private tauntPresented: boolean
  private baseAttack: number
  private baseHealth: number
  private maxHealth: number
  private canAttackEnabled = false
  private targetingOutlineEnabled = false
  private targetableEnabled = false
  private hoverableEnabled = false
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
    this.premiumSide = model.premiumSide ?? 'local'
    this.premium = model.premium ?? false
    this.tauntPresented = model.taunt
    this.label = model.label
    this.baseAttack = model.baseAttack ?? model.attack
    this.baseHealth = model.baseHealth ?? model.maxHealth
    this.maxHealth = model.maxHealth
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
    this.artworkBreath = new PremiumArtworkBreath(this.artworkImage)
    this.artworkBreath.setEnabled(
      (this.premium || isPremiumEnabled(this.premiumSide)) && artwork !== undefined
    )
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

    this.taunt = new Sprite(
      this.premium || isPremiumEnabled(this.premiumSide)
        ? textures.premiumTaunt
        : textures.taunt
    )
    applyAnchoredPlacement(this.taunt, MINION_LAYOUT.taunt)
    this.taunt.visible = model.taunt
    this.taunt.label = 'minion.taunt'
    this.addChild(this.taunt)

    this.battlecryBanner = new Sprite(textures.battlecry)
    applyAnchoredPlacement(this.battlecryBanner, MINION_LAYOUT.battlecry)
    this.battlecryBanner.visible = false
    this.battlecryBanner.alpha = 0
    this.battlecryBanner.label = 'minion.battlecry'
    this.battlecryBanner.eventMode = 'none'
    // Above Taunt and artwork, below Stealth and the frame.
    this.addChild(this.battlecryBanner)

    this.stealth = new Sprite(textures.stealth)
    applyAnchoredPlacement(this.stealth, MINION_LAYOUT.stealth)
    this.stealth.visible = model.stealth
    this.stealth.label = 'minion.stealth'
    this.addChild(this.stealth)

    const frame = new Sprite(
      this.premium || isPremiumEnabled(this.premiumSide)
        ? textures.premiumFrame
        : textures.frame
    )
    this.refreshPremium = () => {
      const enabled = this.premium || isPremiumEnabled(this.premiumSide)
      this.artworkBreath.setEnabled(enabled && this.artworkImage.visible)
      frame.texture = enabled ? textures.premiumFrame : textures.frame
      this.taunt.texture = enabled ? textures.premiumTaunt : textures.taunt
      this.legendaryFrame.texture = enabled
        ? textures.premiumLegendaryFrame
        : textures.legendaryFrame
      if (this.shadow.silhouette) this.shadow.silhouette.revision++
    }
    this.unsubscribePremium = subscribeToPremiumAppearance(this.refreshPremium)
    applyAnchoredPlacement(frame, MINION_LAYOUT.frame)
    frame.label = 'minion.frame'
    this.addChild(frame)

    this.legendaryFrame = new Sprite(
      this.premium || isPremiumEnabled(this.premiumSide)
        ? textures.premiumLegendaryFrame
        : textures.legendaryFrame
    )
    applyAnchoredPlacement(this.legendaryFrame, MINION_LAYOUT.legendaryFrame)
    this.legendaryFrame.visible = model.legendary
    this.legendaryFrame.label = 'minion.frame-legendary'
    this.addChild(this.legendaryFrame)

    this.frozen = new Sprite(textures.frozen)
    applyAnchoredPlacement(this.frozen, MINION_LAYOUT.frozen)
    this.frozen.visible = model.frozen
    this.frozen.label = 'minion.frozen'

    this.addChild(this.frozen)
    this.updateTauntOpacity()

    this.elusive = new Sprite(textures.elusive)
    applyAnchoredPlacement(this.elusive, MINION_LAYOUT.elusive)
    this.elusive.visible = model.elusive
    this.elusive.label = 'minion.elusive'
    this.addChild(this.elusive)

    this.immune = new Sprite(textures.immune)
    applyAnchoredPlacement(this.immune, MINION_LAYOUT.immune)
    this.immune.visible = model.immune
    this.immune.label = 'minion.immune'
    this.addChild(this.immune)

    this.enrage = new Sprite(textures.enrage)
    applyAnchoredPlacement(this.enrage, MINION_LAYOUT.enrage)
    this.enrage.visible = model.enraged
    this.enrage.label = 'minion.enrage'
    this.addChild(this.enrage)

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

    this.poisonous = new Sprite(textures.poisonous)
    applyAnchoredPlacement(this.poisonous, MINION_LAYOUT.poisonous)
    this.poisonous.label = 'minion.poisonous'
    this.poisonous.visible = model.poisonous
    this.addChild(this.poisonous)

    this.trigger = new Sprite(textures.trigger)
    applyAnchoredPlacement(this.trigger, MINION_LAYOUT.trigger)
    this.trigger.visible = model.trigger
    this.trigger.label = 'minion.trigger'
    this.addChild(this.trigger)

    this.inspire = new Sprite(textures.inspire)
    applyAnchoredPlacement(this.inspire, MINION_LAYOUT.inspire)
    this.inspire.visible = model.inspire
    this.inspire.label = 'minion.inspire'
    this.addChild(this.inspire)

    this.windfury = new Sprite(textures.windfury)
    applyAnchoredPlacement(this.windfury, MINION_LAYOUT.windfury)
    this.windfury.visible = model.windfury
    this.windfury.label = 'minion.windfury'
    this.addChild(this.windfury)

    this.spellDamage = new Sprite(textures.spellDamage)
    applyAnchoredPlacement(this.spellDamage, MINION_LAYOUT.spellDamage)
    this.spellDamage.visible = model.spellDamage
    this.spellDamage.label = 'minion.spell-damage'
    this.addChild(this.spellDamage)

    this.lifesteal = new Sprite(textures.lifesteal)
    applyAnchoredPlacement(this.lifesteal, MINION_LAYOUT.lifesteal)
    this.lifesteal.visible = model.lifesteal
    this.lifesteal.label = 'minion.lifesteal'
    this.addChild(this.lifesteal)

    const attack = createStatGroup(
      'minion.stat-attack',
      textures.attack,
      MINION_LAYOUT.attackBadge,
      model.attack,
      MINION_LAYOUT.statValueOffsets.attack
    )
    this.attackLabel = attack.value
    this.addChild(attack.group)

    const health = createStatGroup(
      'minion.stat-health',
      textures.health,
      MINION_LAYOUT.healthBadge,
      model.health,
      MINION_LAYOUT.statValueOffsets.health
    )
    this.healthLabel = health.value
    this.addChild(health.group)

    // Keep Aura as the final persistent marker layer so it remains above every
    // other board mark, including the stat badge groups.
    this.aura = new Sprite(textures.aura)
    applyAnchoredPlacement(this.aura, MINION_LAYOUT.aura)
    this.aura.visible = model.aura
    this.aura.label = 'minion.aura'
    this.addChild(this.aura)

    this.setAttackColor(model.attack)
    this.setHealthColor(model.health)

    // Copy only physical surfaces into an offstage silhouette. Artwork motion,
    // numbers, magical overlays and animated UI never invalidate this cache.
    const surfaces = [
      frame,
      this.taunt,
      this.legendaryFrame,
      this.frozen,
      this.deathrattle,
      this.trigger,
      this.inspire,
      this.poisonous,
      attack.badge,
      health.badge
    ]
    this.shadow.silhouette = {
      revision: 0,
      create: () => {
        const body = new Container()
        body.label = 'minion.shadow-silhouette'
        const portrait = new Graphics()
        portrait.label = 'minion.shadow-portrait'
        portrait.ellipse(center.x, center.y, radiusX, radiusY).fill(0x000000)
        applyPlacement(portrait, MINION_LAYOUT.artwork)
        body.addChild(portrait)
        for (const source of surfaces) {
          if (!source?.visible) continue
          const copy = new Sprite(source.texture)
          copy.label = `${source.label}.shadow-surface`
          copy.anchor.copyFrom(source.anchor)
          source.updateLocalTransform()
          const transform = source.localTransform.clone()
          // Stat badges are nested one level beneath their placement container.
          if (source.parent && source.parent !== this) {
            source.parent.updateLocalTransform()
            transform.prepend(source.parent.localTransform)
          }
          copy.setFromMatrix(transform)
          copy.tint = 0x000000
          body.addChild(copy)
        }
        return body
      }
    }

    // Green attack-ready outline: solid oval proxy so the hollow frame does not create an inner glow.
    // The filter draws only the exterior glow; the white interior is discarded by the shader.
    this.outlineProxy = createMinionOutlineProxy('minion.attack-outline-proxy')
    // Keep every outline above Taunt but below the minion frame. The Taunt ring
    // is larger than the frame and would otherwise obscure the glow.
    this.addChildAt(this.outlineProxy, this.getChildIndex(frame))
    this.attackOutline = new AnimatedOutline(this.outlineProxy, {
      palette: 'green',
      preset: 'minion',
      sharedShapeKey: MINION_OUTLINE_SHAPE_KEY
    })
    this.attackOutline.setEnabled(false)

    this.targetingOutlineProxy = createMinionOutlineProxy(
      'minion.targeting-outline-proxy'
    )
    this.addChildAt(this.targetingOutlineProxy, this.getChildIndex(frame))
    this.targetingOutline = new AnimatedOutline(this.targetingOutlineProxy, {
      palette: 'red',
      preset: 'minion',
      sharedShapeKey: MINION_OUTLINE_SHAPE_KEY
    })
    this.targetingOutline.setEnabled(false)

    this.hoverOutlineProxy = createMinionOutlineProxy('minion.hover-outline-proxy')
    this.addChildAt(this.hoverOutlineProxy, this.getChildIndex(frame))
    this.hoverOutline = new AnimatedOutline(this.hoverOutlineProxy, {
      palette: 'white',
      preset: 'minion',
      sharedShapeKey: MINION_OUTLINE_SHAPE_KEY
    })
    this.hoverOutline.setEnabled(false)

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

  setStats(attack: number, health: number, maxHealth = this.maxHealth): void {
    this.maxHealth = maxHealth
    this.attackLabel.text = String(attack)
    this.healthLabel.text = String(health)
    this.setAttackColor(attack)
    this.setHealthColor(health)
    if (health <= 0) this.setCanAttack(false)
  }

  setBaseStats(attack: number, health: number): void {
    this.baseAttack = attack
    this.baseHealth = health
    this.setStats(attack, health, health)
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
    this.artworkBreath.setEnabled(this.premium || isPremiumEnabled(this.premiumSide))
    this.artworkPlaceholder.visible = false
  }

  setPremium(premium: boolean): void {
    if (premium === this.premium) return
    this.premium = premium
    this.refreshPremium()
  }

  setAttack(attack: number): void {
    this.attackLabel.text = String(attack)
    this.setAttackColor(attack)
  }

  setHealth(health: number, maxHealth = this.maxHealth): void {
    this.maxHealth = maxHealth
    this.healthLabel.text = String(health)
    this.setHealthColor(health)
    if (health <= 0) this.setCanAttack(false)
  }

  private setAttackColor(attack: number): void {
    this.attackLabel.style.fill = minionAttackColor(attack, this.baseAttack)
  }

  private setHealthColor(health: number): void {
    this.healthLabel.style.fill = minionHealthColor(
      health,
      this.maxHealth,
      this.baseHealth
    )
  }

  setAbilityEffects(
    markers: Pick<
      MinionViewModel,
      | 'windfury'
      | 'spellDamage'
      | 'lifesteal'
      | 'aura'
      | 'elusive'
      | 'immune'
      | 'poisonous'
    >
  ): void {
    this.invalidateShadowVisibility(this.poisonous, markers.poisonous)
    this.poisonous.visible = markers.poisonous
    this.windfury.visible = markers.windfury
    this.spellDamage.visible = markers.spellDamage
    this.lifesteal.visible = markers.lifesteal
    this.aura.visible = markers.aura
    this.elusive.visible = markers.elusive
    this.immune.visible = markers.immune
  }

  setTaunt(visible: boolean): void {
    const gained = visible && !this.tauntPresented
    this.tauntPresented = visible
    this.invalidateShadowVisibility(this.taunt, visible)
    this.taunt.visible = visible
    this.updateTauntOpacity()
    if (gained) this.presentTauntPop()
  }

  /**
   * Plays the taunt shield pop: grows from zero past authored scale, then
   * settles back. Optional startDelay lets callers hold the shield collapsed
   * while the minion entrance impact finishes.
   */
  presentTauntPop(startDelay = 0): void {
    const shield = this.taunt
    if (shield.destroyed || !shield.visible) return
    const timing = MINION_LAYOUT.tauntPop
    this.animationScope.kill(shield.scale)
    shield.scale.set(0)
    if (this.shadow.silhouette) this.shadow.silhouette.revision++
    const timeline = this.animationScope.timeline()
    timeline.to(
      shield.scale,
      {
        x: timing.overshootScale,
        y: timing.overshootScale,
        duration: timing.growDuration,
        ease: 'power2.out'
      },
      startDelay
    )
    timeline.to(shield.scale, {
      x: 1,
      y: 1,
      duration: timing.settleDuration,
      ease: 'power2.inOut',
      onComplete: () => {
        if (this.shadow.silhouette) this.shadow.silhouette.revision++
      }
    })
  }

  setEnraged(visible: boolean): void {
    this.enrage.visible = visible
  }

  setDivineShield(visible: boolean): void {
    this.divineShield.visible = visible
  }

  setFrozen(visible: boolean): void {
    this.invalidateShadowVisibility(this.frozen, visible)
    this.frozen.visible = visible
  }

  setStealth(visible: boolean): void {
    this.stealth.visible = visible
    this.updateTauntOpacity()
  }

  private updateTauntOpacity(): void {
    this.taunt.alpha = this.taunt.visible && this.stealth.visible ? 0.5 : 1
  }

  setDeathrattle(visible: boolean): void {
    this.invalidateShadowVisibility(this.deathrattle, visible)
    this.deathrattle.visible = visible
  }

  setTrigger(visible: boolean): void {
    this.invalidateShadowVisibility(this.trigger, visible)
    this.trigger.visible = visible
  }

  setInspire(visible: boolean): void {
    this.invalidateShadowVisibility(this.inspire, visible)
    this.inspire.visible = visible
  }

  private invalidateShadowVisibility(surface: Sprite, visible: boolean): void {
    if (surface.visible !== visible && this.shadow.silhouette)
      this.shadow.silhouette.revision++
  }

  private abilityMarker(kind: MinionAbilityMarkerKind): Sprite {
    if (kind === 'deathrattle') return this.deathrattle
    if (kind === 'inspire') return this.inspire
    return this.trigger
  }

  getAbilityMarkerSnapshot(
    kind: MinionAbilityMarkerKind
  ): AbilityMarkerSnapshot | null {
    const marker = this.abilityMarker(kind)
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
    const marker = this.abilityMarker(kind)
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

  /**
   * Plays the Battlecry banner: grows from small and transparent to authored
   * scale at full opacity, then fades away as the trigger resolves. The
   * returned promise settles once the grow phase completes (the moment the
   * Battlecry becomes visible to the board) while the fade keeps running.
   * Repeated calls, one per Battlecry repetition, replay the whole cycle.
   */
  presentBattlecryBanner(): Promise<void> {
    const banner = this.battlecryBanner
    if (banner.destroyed) return Promise.resolve()
    this.settleBattlecryBanner?.()
    if (this.battlecryBannerTimeline)
      this.animationScope.cancel(this.battlecryBannerTimeline)
    this.battlecryBannerTimeline = null
    this.settleBattlecryBanner = null

    const timing = MINION_LAYOUT.battlecryBanner
    banner.visible = true
    banner.alpha = 0
    banner.scale.set(timing.startScale)

    const timeline = this.animationScope.timeline()
    this.battlecryBannerTimeline = timeline
    timeline.to(banner, {
      alpha: 1,
      duration: timing.growDuration,
      ease: 'power2.out'
    })
    timeline.to(
      banner.scale,
      { x: 1, y: 1, duration: timing.growDuration, ease: 'power2.out' },
      0
    )
    timeline.to(banner, {
      alpha: 0,
      duration: timing.fadeDuration,
      ease: 'power2.in',
      // The fade beginning marks the trigger moment: the caller stops waiting.
      onStart: () => this.settleBattlecryBanner?.(),
      onComplete: () => {
        banner.visible = false
      }
    })
    return new Promise<void>((resolve) => {
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        this.settleBattlecryBanner = null
        resolve()
      }
      this.settleBattlecryBanner = settle
      timeline.eventCallback('onComplete', settle)
      timeline.eventCallback('onInterrupt', settle)
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

  setOutlineAppearance(
    palette: OutlinePaletteInput,
    tuning: OutlineTuning,
    hoverPalette?: OutlinePaletteInput
  ): void {
    this.attackOutline.setPalette(palette)
    if (hoverPalette) this.hoverOutline.setPalette(hoverPalette)
    for (const outline of [
      this.attackOutline,
      this.targetingOutline,
      this.hoverOutline
    ]) {
      outline.setTuning(tuning)
    }
  }

  /** Shows the red outline while this minion is a valid targeting destination. */
  setTargetingOutline(enabled: boolean): void {
    this.targetingOutlineEnabled = enabled
    this.syncOutlineState()
  }

  setHoverAura(enabled: boolean): void {
    this.hoverOutline.setEnabled(enabled)
  }

  isCanAttack(): boolean {
    return this.canAttackEnabled
  }

  /** Enables pointer input independently of the green attacker-ready state. */
  setTargetable(enabled: boolean): void {
    this.targetableEnabled = enabled
    this.syncPointerInputState()
  }

  /** Keeps pointer enter/leave available without granting click targetability. */
  setHoverable(enabled: boolean): void {
    this.hoverableEnabled = enabled
    this.syncPointerInputState()
  }

  private syncPointerInputState(): void {
    this.eventMode = this.targetableEnabled || this.hoverableEnabled ? 'static' : 'none'
    this.cursor = this.targetableEnabled ? 'pointer' : 'default'
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
    this.shadow.restingScale = scale
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
    killDisplayTweens(this)
    this.unsubscribePremium()
    this.artworkBreath.destroy()
    // Release any pending banner waiter so presentation sequences cannot stall.
    this.settleBattlecryBanner?.()
    this.animationScope.kill()
    for (const pulse of this.activeAbilityPulses) {
      if (!pulse.destroyed) pulse.destroy({ children: true })
    }
    this.activeAbilityPulses.clear()
    this.attackOutline.dispose()
    this.targetingOutline.dispose()
    this.hoverOutline.dispose()
    this.sleepingZs.dispose()
    super.destroy(options)
  }
}
