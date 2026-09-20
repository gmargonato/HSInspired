import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { createTemporaryAbilityBadge } from '../temporary-ability-badge'
import { AnimatedOutline } from '../effects/animated-outline'
import {
  WEAPON_CANVAS,
  WEAPON_LAYOUT,
  weaponTemporaryAbilityBadgePlacement
} from './weapon-layout'
import { AnimationScope } from '../../animation/animations'
import { attachShadow } from '../shadows/shadow-caster'
import { isPremiumEnabled, subscribeToPremiumAppearance } from '../premium-appearance'
import { PremiumArtworkBreath } from '../effects/premium-artwork-breath'

export interface WeaponViewModel {
  readonly premiumSide?: 'local' | 'remote'
  readonly premium?: boolean
  readonly label: string
  readonly attack: number
  readonly durability: number
  readonly printedDurability: number
  readonly deathrattle: boolean
  readonly trigger: boolean
  readonly temporaryAbilityLabels: readonly string[]
}

export interface WeaponViewTextures {
  readonly frame: Texture
  readonly premiumFrame: Texture
  readonly trigger: Texture
  readonly deathrattle: Texture
  readonly attack: Texture
  readonly durability: Texture
}

export type WeaponAbilityMarkerKind = 'trigger' | 'deathrattle'

export interface WeaponAbilityMarkerSnapshot {
  readonly texture: Texture
  readonly globalPosition: { readonly x: number; readonly y: number }
  readonly worldScale: number
}

interface StatGroup {
  readonly group: Container
  readonly value: Text
}

const WEAPON_DURABILITY_COLORS = {
  normal: 0xffffff,
  reduced: 0xff4a4a,
  increased: 0x6cff47
} as const

function weaponDurabilityColor(current: number, printed: number): number {
  if (current < printed) return WEAPON_DURABILITY_COLORS.reduced
  if (current > printed) return WEAPON_DURABILITY_COLORS.increased
  return WEAPON_DURABILITY_COLORS.normal
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
  readonly shadow = attachShadow(
    this,
    {
      x: WEAPON_LAYOUT.frame.position.x - WEAPON_LAYOUT.frame.size.width / 2,
      y: WEAPON_LAYOUT.frame.position.y - WEAPON_LAYOUT.frame.size.height / 2,
      ...WEAPON_LAYOUT.frame.size
    },
    { shape: 'ellipse' }
  )
  private readonly unsubscribePremium: () => void
  private readonly artworkBreath: PremiumArtworkBreath | null
  private readonly attackLabel: Text
  private readonly durabilityLabel: Text
  private readonly printedDurability: number
  private readonly deathrattle: Sprite
  private readonly trigger: Sprite
  private readonly hoverOutlineProxy: Container
  private readonly hoverOutlineFrame: Sprite
  private readonly hoverOutline: AnimatedOutline
  private readonly animationScope = new AnimationScope()
  private readonly activeAbilityPulses = new Set<Sprite>()
  public instanceId: string | null = null
  public ownerId: string | null = null

  private constructor(
    model: WeaponViewModel,
    textures: WeaponViewTextures,
    artwork: Texture | undefined
  ) {
    super()
    this.label = model.label
    this.eventMode = 'none'
    this.pivot.set(WEAPON_CANVAS.width / 2, WEAPON_CANVAS.height / 2)
    this.printedDurability = model.printedDurability

    const artworkLayer = new Container()
    applyPlacement(artworkLayer, WEAPON_LAYOUT.artwork)
    artworkLayer.label = 'weapon.artwork'
    this.artworkBreath = artwork ? new PremiumArtworkBreath(artworkLayer) : null
    this.artworkBreath?.setEnabled(
      model.premium === true || isPremiumEnabled(model.premiumSide)
    )

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

    const frame = new Sprite(
      model.premium || isPremiumEnabled(model.premiumSide)
        ? textures.premiumFrame
        : textures.frame
    )
    applyAnchoredPlacement(frame, WEAPON_LAYOUT.frame)
    frame.label = 'weapon.frame'
    this.addChild(frame)

    // The hover aura must trace the full frame plate. The frame texture is
    // hollow at the artwork aperture, and the outline filter paints exterior
    // glow into that hole over the artwork unless the silhouette is solid.
    // A solid oval matching the artwork aperture completes the silhouette,
    // mirroring the minion hover outline's aperture fill.
    this.hoverOutlineProxy = new Container()
    this.hoverOutlineProxy.label = 'weapon.hover-outline-proxy'
    this.hoverOutlineProxy.eventMode = 'none'
    this.hoverOutlineProxy.visible = false
    this.hoverOutlineFrame = new Sprite(frame.texture)
    applyAnchoredPlacement(this.hoverOutlineFrame, WEAPON_LAYOUT.frame)
    this.hoverOutlineFrame.label = 'weapon.hover-outline-proxy.frame'
    this.hoverOutlineProxy.addChild(this.hoverOutlineFrame)
    const outlineAperture = new Graphics()
    outlineAperture
      .ellipse(
        WEAPON_LAYOUT.artwork.position.x,
        WEAPON_LAYOUT.artwork.position.y,
        WEAPON_LAYOUT.artworkOval.radiusX,
        WEAPON_LAYOUT.artworkOval.radiusY
      )
      .fill({ color: 0xffffff })
    outlineAperture.label = 'weapon.hover-outline-proxy.aperture'
    this.hoverOutlineProxy.addChild(outlineAperture)
    this.addChildAt(this.hoverOutlineProxy, this.getChildIndex(frame))
    this.hoverOutline = new AnimatedOutline(this.hoverOutlineProxy, {
      palette: 'white',
      preset: 'board'
    })
    this.hoverOutline.setEnabled(false)

    this.unsubscribePremium = subscribeToPremiumAppearance(() => {
      const enabled = model.premium === true || isPremiumEnabled(model.premiumSide)
      frame.texture = enabled ? textures.premiumFrame : textures.frame
      this.hoverOutlineFrame.texture = frame.texture
      this.artworkBreath?.setEnabled(enabled)
    })

    // Pixi renders later children on top: add the large Deathrattle badge first.
    // Keep hidden markers mounted so a runtime trigger can pulse the same
    // artwork without rebuilding the equipped weapon.
    this.deathrattle = new Sprite(textures.deathrattle)
    applyAnchoredPlacement(this.deathrattle, WEAPON_LAYOUT.deathrattle)
    this.deathrattle.visible = model.deathrattle
    this.deathrattle.label = 'weapon.deathrattle'
    this.addChild(this.deathrattle)

    this.trigger = new Sprite(textures.trigger)
    applyAnchoredPlacement(this.trigger, WEAPON_LAYOUT.trigger)
    this.trigger.visible = model.trigger
    this.trigger.label = 'weapon.trigger'
    this.addChild(this.trigger)

    model.temporaryAbilityLabels.forEach((text, index) => {
      const badge = createTemporaryAbilityBadge(
        text,
        weaponTemporaryAbilityBadgePlacement(
          index,
          model.temporaryAbilityLabels.length
        ),
        `weapon.temporary-ability-${index}`
      )
      this.addChild(badge)
    })

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
    this.setDurabilityLabel(model.durability)
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
    this.setDurabilityLabel(durability)
  }

  setAttack(attack: number): void {
    this.attackLabel.text = String(attack)
  }

  setDurability(durability: number): void {
    this.setDurabilityLabel(durability)
  }

  private setDurabilityLabel(durability: number): void {
    this.durabilityLabel.text = String(durability)
    this.durabilityLabel.style.fill = weaponDurabilityColor(
      durability,
      this.printedDurability
    )
  }

  setDeathrattle(visible: boolean): void {
    this.deathrattle.visible = visible
  }

  setTrigger(visible: boolean): void {
    this.trigger.visible = visible
  }

  setHoverAura(enabled: boolean): void {
    this.hoverOutline.setEnabled(enabled)
  }

  getAbilityMarkerSnapshot(
    kind: WeaponAbilityMarkerKind
  ): WeaponAbilityMarkerSnapshot | null {
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
  presentAbilityPulse(kind: WeaponAbilityMarkerKind, duration: number): Promise<void> {
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
    pulse.label = `weapon.${kind}.pulse`
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
        duration,
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

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.unsubscribePremium()
    this.artworkBreath?.destroy()
    this.animationScope.kill()
    this.hoverOutline.dispose()
    for (const pulse of this.activeAbilityPulses) {
      if (!pulse.destroyed) pulse.destroy({ children: true })
    }
    this.activeAbilityPulses.clear()
    super.destroy(options)
  }
}
