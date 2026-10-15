import { Container, PerspectiveMesh, Sprite, type Texture } from 'pixi.js'
import type { PerspectiveCorners } from '../hand/hand-card-perspective'
import { CARD_CATALOG, type CardDefinition } from '../../../game-rules/content/cards'
import type { CardView } from '../../../visual-components/cards/card-view'
import { Actor } from '../../../visual-components/lifecycle/actor'
import {
  CARD_PLAY_AURA_TINT,
  CARD_PLAY_BURST,
  CARD_PLAY_LAYOUT
} from './card-play-layout'
import { completeTimeline } from './game-presentation-animation'
import { MINION_LAYOUT } from '../board/minion-layout'
import type { MinionView } from '../board/minion-view'
import type { WeaponView } from '../board/weapon-view'
import { WEAPON_LAYOUT } from '../board/weapon-layout'
import type { GameCardSlot } from '../hand/game-card-slot'

interface RisingParticleProfile {
  readonly count: number
  readonly stagger: number
  readonly duration: number
  readonly sizeMin: number
  readonly sizeMax: number
  readonly riseMin: number
  readonly riseMax: number
  readonly drift: number
  readonly tint: number
}

interface CardEffectFit {
  readonly widthMultiplier: number
  readonly heightMultiplier: number
  readonly centerY: number
}

export interface CardPlayPose {
  readonly legendary?: boolean
  readonly perspective?: PerspectiveCorners
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number
}

export interface CardPlayAuraTextures {
  readonly spell: Texture
  readonly legendarySpell: Texture
  readonly minion: Texture
  readonly legendaryMinion: Texture
  readonly weapon: Texture
  readonly hero: Texture
}

/** Owns local play visuals independently of the consumed hand card. */
export class CardPlayAnimation extends Actor {
  constructor(
    private readonly auras: CardPlayAuraTextures,
    private readonly spotlights: readonly Texture[],
    private readonly burstTexture: Texture
  ) {
    super()
    this.label = 'game.card-play-effects'
    this.eventMode = 'none'
  }

  capture(card: CardView): CardPlayPose {
    const center = this.toLocal(
      card.toGlobal({
        x: card.plan.width / 2,
        y: card.renderedHeight / 2
      })
    )
    const left = this.toLocal(card.toGlobal({ x: 0, y: 0 }))
    const right = this.toLocal(card.toGlobal({ x: card.plan.width, y: 0 }))
    const bottom = this.toLocal(card.toGlobal({ x: 0, y: card.renderedHeight }))
    return {
      legendary: CARD_CATALOG.get(card.plan.cardId)?.rarity === 'Legendary',
      x: center.x,
      y: center.y,
      width: Math.hypot(right.x - left.x, right.y - left.y),
      height: Math.hypot(bottom.x - left.x, bottom.y - left.y),
      rotation: Math.atan2(right.y - left.y, right.x - left.x)
    }
  }

  /** Charge the hand card, then exchange it for its equipped board body. */
  async presentWeaponEntrance(
    slot: GameCardSlot,
    view: WeaponView,
    destinationLayer: Container,
    equip: () => void
  ): Promise<void> {
    const profile = CARD_PLAY_LAYOUT.weapon
    const resting = { x: view.x, y: view.y, scaleX: view.scale.x, scaleY: view.scale.y }
    const center = this.toLocal(destinationLayer.toGlobal(resting))
    // Hand removal and remote flight may already have transferred ownership.
    // Pixi's reparentChild cannot append a child to its current parent.
    if (slot.parent !== this) this.reparentChild(slot)
    slot.beginMinionPlayTransition()
    slot.eventMode = 'none'
    const aura = this.createWeaponAura(slot.card, slot)
    const charge = this.timeline()
    charge.to(
      slot,
      {
        x: center.x,
        y: center.y + (slot.card.renderedHeight * profile.cardScale) / 2,
        rotation: 0,
        duration: profile.snapDuration,
        ease: 'power2.out'
      },
      0
    )
    charge.to(
      slot.scale,
      {
        x: profile.cardScale,
        y: profile.cardScale,
        duration: profile.snapDuration,
        ease: 'power2.out'
      },
      0
    )
    charge.to(
      slot.scale,
      {
        x: profile.chargedCardScale,
        y: profile.chargedCardScale,
        duration: profile.chargeDuration,
        ease: 'sine.inOut'
      },
      profile.snapDuration
    )
    charge.to(
      aura,
      {
        alpha: profile.aura.peakAlpha,
        duration: profile.snapDuration + profile.chargeDuration,
        ease: 'power2.in'
      },
      0
    )
    const burst = this.createCardBurst(slot.card, slot, charge)
    const chargeParticles = this.emitWeaponParticles(charge, this, slot.card, 'charge')
    let settleParticles: Container | undefined
    let settle: gsap.core.Timeline | undefined
    let equipped = false
    try {
      await completeTimeline(charge)
      if (this.destroyed || slot.destroyed || view.destroyed) return
      this.detachMinionAura(aura, this)
      equip()
      equipped = true
      view.alpha = 1
      view.position.set(resting.x, resting.y + profile.fallbackStartYOffset)
      view.scale.set(
        resting.scaleX * profile.fallbackStartScaleMultiplier,
        resting.scaleY * profile.fallbackStartScaleMultiplier
      )
      this.alignWeaponArtwork(slot.card, view, destinationLayer)
      slot.alpha = 0
      settle = this.timeline()
      settle.to(
        aura,
        { alpha: 0, duration: profile.aura.fadeDuration, ease: 'power2.in' },
        0
      )
      settle.to(
        view,
        {
          x: resting.x,
          y: resting.y,
          duration: profile.settleDuration,
          ease: 'power2.in'
        },
        0
      )
      settle.to(
        view.scale,
        {
          x: resting.scaleX,
          y: resting.scaleY,
          duration: profile.settleDuration,
          ease: 'power2.in'
        },
        0
      )
      settleParticles = this.emitWeaponParticles(settle, this, view, 'settle')
      await completeTimeline(settle)
    } finally {
      charge.kill()
      settle?.kill()
      if (!aura.destroyed) aura.destroy()
      if (!burst.destroyed) burst.destroy()
      if (!chargeParticles.destroyed) chargeParticles.destroy({ children: true })
      if (settleParticles && !settleParticles.destroyed)
        settleParticles.destroy({ children: true })
      if (!slot.destroyed) slot.destroy({ children: true })
      if (!equipped && !view.destroyed) view.destroy({ children: true })
    }
  }

  present(type: CardDefinition['type'], pose: CardPlayPose): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    switch (type) {
      case 'Spell':
        return this.presentCast(pose, 'spell')
      case 'Hero':
        return this.presentCast(pose, 'hero')
      case 'Minion':
        // Minions use the staged helpers below to preserve targeting previews.
        return Promise.resolve()
      case 'Weapon':
        return Promise.resolve()
    }
  }

  /** Retains a stationary choice while its cast fades, independently of the selector. */
  async presentChoice(
    card: CardView,
    presentation: Container,
    type: 'Spell' | 'Hero' = 'Spell'
  ): Promise<void> {
    const pose = this.capture(card)
    this.reparentChild(presentation)
    presentation.eventMode = 'none'
    const aura = CARD_PLAY_LAYOUT[type === 'Hero' ? 'hero' : 'spell'].aura
    try {
      await Promise.all([
        this.present(type, pose),
        completeTimeline(
          this.timeline().to(presentation, {
            alpha: 0,
            delay: aura.brightenDuration + aura.holdDuration,
            duration: aura.fadeDuration
          })
        )
      ])
    } finally {
      if (!presentation.destroyed) presentation.destroy({ children: true })
    }
  }

  createMinionAura(card: CardView, parent: Container): Sprite {
    return this.createCardAura(card, parent, 'minion')
  }

  createWeaponAura(card: CardView, parent: Container): Sprite {
    return this.createCardAura(card, parent, 'weapon')
  }

  /** Remote previews carry their burst, aura, and particles throughout the flight. */
  createPreviewAura(card: CardView, timeline: gsap.core.Timeline): Sprite {
    const aura = this.createCardAura(card, card, card.plan.template)
    this.createCardBurst(card, card, timeline)
    const particles = new Container()
    particles.label = 'game.card-play-preview-particles'
    particles.position.set(card.plan.width / 2, card.renderedHeight / 2)
    particles.eventMode = 'none'
    particles.zIndex = 15
    card.addChild(particles)
    this.emitCastParticles(
      timeline,
      particles,
      { x: 0, y: 0, width: card.plan.width, height: card.renderedHeight, rotation: 0 },
      card.plan.cardType === 'Hero' ? 'hero' : 'spell'
    )
    return aura
  }

  createCardBurst(
    card: CardView,
    parent: Container,
    timeline: gsap.core.Timeline
  ): Sprite {
    const burst = new Sprite(this.burstTexture)
    burst.label = 'game.card-play-burst'
    burst.eventMode = 'none'
    burst.anchor.set(0.5)
    burst.position.set(
      (parent === card ? 0 : card.x) + card.plan.width / 2,
      (parent === card ? 0 : card.y) + card.renderedHeight * CARD_PLAY_BURST.centerY
    )
    burst.width = card.plan.width * CARD_PLAY_BURST.widthMultiplier
    burst.height = card.renderedHeight * CARD_PLAY_BURST.heightMultiplier
    burst.zIndex = 20
    parent.addChild(burst)
    this.animateBurst(timeline, burst)
    return burst
  }

  private animateBurst(timeline: gsap.core.Timeline, burst: Container): void {
    burst.tint = CARD_PLAY_AURA_TINT
    burst.blendMode = 'add'
    burst.alpha = CARD_PLAY_BURST.initialAlpha
    timeline.to(
      burst,
      {
        alpha: CARD_PLAY_BURST.peakAlpha,
        duration: CARD_PLAY_BURST.brightenDuration,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      burst,
      {
        alpha: 0,
        duration: CARD_PLAY_BURST.fadeDuration,
        ease: 'power2.in'
      },
      CARD_PLAY_BURST.brightenDuration
    )
    timeline.call(
      () => {
        if (!burst.destroyed) burst.destroy()
      },
      [],
      CARD_PLAY_BURST.brightenDuration + CARD_PLAY_BURST.fadeDuration
    )
  }

  private auraTexture(
    kind: 'minion' | 'weapon' | 'spell' | 'hero',
    legendary: boolean
  ): Texture {
    if (legendary && kind === 'minion') return this.auras.legendaryMinion
    if (legendary && kind === 'spell') return this.auras.legendarySpell
    return this.auras[kind]
  }

  private createCardAura(
    card: CardView,
    parent: Container,
    kind: 'minion' | 'weapon' | 'spell' | 'hero'
  ): Sprite {
    const profile = CARD_PLAY_LAYOUT[kind].aura
    const legendary = CARD_CATALOG.get(card.plan.cardId)?.rarity === 'Legendary'
    const aura = new Sprite(this.auraTexture(kind, legendary))
    aura.label = `game.${kind}-play-aura`
    aura.eventMode = 'none'
    aura.anchor.set(0.5)
    aura.position.set(
      (parent === card ? 0 : card.x) + card.plan.width / 2,
      (parent === card ? 0 : card.y) + card.renderedHeight * profile.centerY
    )
    aura.width = card.plan.width * profile.widthMultiplier
    aura.height = card.renderedHeight * profile.heightMultiplier
    aura.alpha = profile.initialAlpha
    aura.tint = CARD_PLAY_AURA_TINT
    // Additive blending brightens the blue outline and leaves solid black unchanged.
    aura.blendMode = 'add'
    aura.zIndex = 10
    parent.addChild(aura)
    return aura
  }

  /** Sample live transforms: the last charge tween may precede Pixi's render tick. */
  detachMinionAura(aura: Sprite, layer: Container): void {
    const center = layer.toLocal(aura.toGlobal({ x: 0, y: 0 }))
    const right = layer.toLocal(aura.toGlobal({ x: 1, y: 0 }))
    const bottom = layer.toLocal(aura.toGlobal({ x: 0, y: 1 }))
    layer.addChild(aura)
    aura.position.copyFrom(center)
    aura.rotation = Math.atan2(right.y - center.y, right.x - center.x)
    aura.scale.set(
      Math.hypot(right.x - center.x, right.y - center.y),
      Math.hypot(bottom.x - center.x, bottom.y - center.y)
    )
  }

  /** Match the actual image center and magnification across the two frames. */
  alignMinionArtwork(
    card: CardView,
    view: MinionView,
    layer: Container,
    presentation: Container = view
  ): boolean {
    return this.alignBoardArtwork(card, view, layer, presentation, 'minion')
  }

  alignWeaponArtwork(card: CardView, view: WeaponView, layer: Container): boolean {
    return this.alignBoardArtwork(card, view, layer, view, 'weapon')
  }

  private alignBoardArtwork(
    card: CardView,
    view: MinionView | WeaponView,
    layer: Container,
    presentation: Container,
    kind: 'minion' | 'weapon'
  ): boolean {
    const cardArt = card
      .getChildByLabel(`${card.plan.cardId}:card.artwork`, true)
      ?.children.find((child): child is Sprite => child instanceof Sprite)
    const boardArt = view.getChildByLabel(`${kind}.artwork-image`, true)
    if (cardArt && boardArt instanceof Sprite) {
      const center = { x: cardArt.texture.width / 2, y: cardArt.texture.height / 2 }
      const source = layer.toLocal(cardArt.toGlobal(center))
      const sourceTop = layer.toLocal(cardArt.toGlobal({ x: 0, y: 0 }))
      const sourceBottom = layer.toLocal(
        cardArt.toGlobal({ x: 0, y: cardArt.texture.height })
      )
      const boardTop = layer.toLocal(
        boardArt.toGlobal({ x: 0, y: -boardArt.texture.height / 2 })
      )
      const boardBottom = layer.toLocal(
        boardArt.toGlobal({ x: 0, y: boardArt.texture.height / 2 })
      )
      const ratio =
        Math.hypot(sourceBottom.x - sourceTop.x, sourceBottom.y - sourceTop.y) /
        Math.max(
          0.001,
          Math.hypot(boardBottom.x - boardTop.x, boardBottom.y - boardTop.y)
        )
      presentation.scale.set(presentation.scale.x * ratio)
      // A snapshot uses the same minion-local artwork point, transformed by
      // its own pose. The live source can remain stationary during copying.
      const artworkPoint = view.toLocal(boardArt.toGlobal({ x: 0, y: 0 }))
      const destination = layer.toLocal(presentation.toGlobal(artworkPoint))
      presentation.position.set(
        presentation.x + source.x - destination.x,
        presentation.y + source.y - destination.y
      )
      return true
    }
    return false
  }

  /** Samples the moving source at emission; released particles rise independently. */
  emitMinionParticles(
    timeline: gsap.core.Timeline,
    layer: Container,
    source: CardView | MinionView,
    stage: 'charge' | 'settle'
  ): Container {
    return this.emitPlayParticles(timeline, layer, source, stage, 'minion')
  }

  emitWeaponParticles(
    timeline: gsap.core.Timeline,
    layer: Container,
    source: CardView | WeaponView,
    stage: 'charge' | 'settle'
  ): Container {
    return this.emitPlayParticles(timeline, layer, source, stage, 'weapon')
  }

  private emitPlayParticles(
    timeline: gsap.core.Timeline,
    layer: Container,
    source: CardView | MinionView | WeaponView,
    stage: 'charge' | 'settle',
    kind: 'minion' | 'weapon'
  ): Container {
    const profile: RisingParticleProfile =
      stage === 'charge'
        ? CARD_PLAY_LAYOUT[kind].chargeParticles
        : CARD_PLAY_LAYOUT[kind].settleParticles
    const particles = new Container()
    particles.label = `game.${kind}-play-${stage}-particles`
    particles.eventMode = 'none'
    particles.zIndex = 5
    layer.addChild(particles)
    for (let index = 0; index < profile.count; index++) {
      const particle = new Sprite(this.spotlights[index % this.spotlights.length])
      particle.label = `game.${kind}-play-${stage}-particle-${index}`
      particle.anchor.set(0.5)
      particle.width = particle.height =
        profile.sizeMin + Math.random() * (profile.sizeMax - profile.sizeMin)
      particle.tint = profile.tint
      particle.blendMode = 'add'
      particle.alpha = 0
      particles.addChild(particle)
      const angle = ((index + Math.random()) / profile.count) * Math.PI * 2
      const start = (index / profile.count) * profile.stagger
      const rise = profile.riseMin + Math.random() * (profile.riseMax - profile.riseMin)
      const drift = (Math.random() - 0.5) * 2 * profile.drift
      timeline.call(
        () => {
          if (source.destroyed || particle.destroyed) return
          let point: { x: number; y: number }
          if (stage === 'charge') {
            const card = source as CardView
            point = {
              x: card.plan.width * (0.5 + Math.cos(angle) * 0.48),
              y: card.renderedHeight * (0.5 + Math.sin(angle) * 0.48)
            }
          } else {
            const frame = kind === 'minion' ? MINION_LAYOUT.frame : WEAPON_LAYOUT.frame
            point = {
              x: frame.position.x + (Math.cos(angle) * frame.size.width) / 2,
              y: frame.position.y + (Math.sin(angle) * frame.size.height) / 2
            }
          }
          particle.position.copyFrom(particles.toLocal(source.toGlobal(point)))
        },
        [],
        start
      )
      timeline.to(particle, { alpha: 1, duration: 0.04 }, start)
      timeline.to(
        particle,
        {
          x: () => particle.x + drift,
          y: () => particle.y - rise,
          duration: profile.duration,
          ease: 'power1.out'
        },
        start
      )
      timeline.to(
        particle,
        {
          alpha: 0,
          duration: profile.duration * 0.7,
          ease: 'sine.in'
        },
        start + profile.duration * 0.3
      )
    }
    return particles
  }

  private createCastMesh(
    texture: Texture,
    pose: CardPlayPose,
    fit: CardEffectFit
  ): PerspectiveMesh {
    const width = pose.width * fit.widthMultiplier
    const height = pose.height * fit.heightMultiplier
    const centerYOffset = pose.height * (fit.centerY - 0.5)
    const corners = pose.perspective ?? {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 1, y: 1 },
      bottomLeft: { x: 0, y: 1 }
    }
    // Center the captured quadrilateral on the cast pose. Scaling during the
    // fade preserves its perspective instead of easing it back to a rectangle.
    return new PerspectiveMesh({
      texture,
      verticesX: 10,
      verticesY: 10,
      x0: (corners.topLeft.x - 0.5) * width,
      y0: (corners.topLeft.y - 0.5) * height + centerYOffset,
      x1: (corners.topRight.x - 0.5) * width,
      y1: (corners.topRight.y - 0.5) * height + centerYOffset,
      x2: (corners.bottomRight.x - 0.5) * width,
      y2: (corners.bottomRight.y - 0.5) * height + centerYOffset,
      x3: (corners.bottomLeft.x - 0.5) * width,
      y3: (corners.bottomLeft.y - 0.5) * height + centerYOffset
    })
  }

  private async presentCast(pose: CardPlayPose, kind: 'spell' | 'hero'): Promise<void> {
    const profile = CARD_PLAY_LAYOUT[kind]
    const effect = new Container()
    effect.label = `game.${kind}-play`
    effect.position.set(pose.x, pose.y)
    effect.rotation = pose.rotation
    effect.eventMode = 'none'
    effect.sortableChildren = true
    this.addChild(effect)

    const aura = this.createCastMesh(
      this.auraTexture(kind, pose.legendary === true),
      pose,
      profile.aura
    )
    aura.label = `game.${kind}-play-aura`
    aura.alpha = profile.aura.initialAlpha
    aura.tint = CARD_PLAY_AURA_TINT
    aura.blendMode = 'add'
    aura.zIndex = 10
    effect.addChild(aura)
    const timeline = this.timeline()
    const burst = this.createCastMesh(this.burstTexture, pose, CARD_PLAY_BURST)
    burst.label = 'game.card-play-burst'
    burst.eventMode = 'none'
    burst.zIndex = 20
    effect.addChild(burst)
    this.animateBurst(timeline, burst)
    timeline.to(
      aura,
      {
        alpha: profile.aura.peakAlpha,
        duration: profile.aura.brightenDuration,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      aura,
      {
        alpha: 0,
        duration: profile.aura.fadeDuration,
        ease: 'power2.in'
      },
      profile.aura.brightenDuration + profile.aura.holdDuration
    )
    timeline.to(
      aura.scale,
      {
        x: aura.scale.x * profile.aura.expansion,
        y: aura.scale.y * profile.aura.expansion,
        duration:
          profile.aura.brightenDuration +
          profile.aura.holdDuration +
          profile.aura.fadeDuration,
        ease: 'sine.out'
      },
      0
    )

    this.emitCastParticles(timeline, effect, pose, kind)
    try {
      await completeTimeline(timeline)
    } finally {
      if (!effect.destroyed) effect.destroy({ children: true })
    }
  }

  private emitCastParticles(
    timeline: gsap.core.Timeline,
    effect: Container,
    pose: CardPlayPose,
    kind: 'spell' | 'hero'
  ): void {
    const particles = CARD_PLAY_LAYOUT[kind].particles
    const perimeter = 2 * (pose.width + pose.height)
    for (let index = 0; index < particles.count; index++) {
      const particle = new Sprite(this.spotlights[index % this.spotlights.length])
      particle.label = `game.${kind}-play-particle-${index}`
      particle.anchor.set(0.5)
      particle.tint = particles.tint
      particle.blendMode = 'add'
      particle.alpha = 0
      particle.zIndex = 15
      // Stratified samples cover all four edges, weighted by their lengths.
      const distance = ((index + Math.random()) / particles.count) * perimeter
      let x: number
      let y: number
      if (distance < pose.width) {
        x = distance - pose.width / 2
        y = -pose.height / 2
      } else if (distance < pose.width + pose.height) {
        x = pose.width / 2
        y = distance - pose.width - pose.height / 2
      } else if (distance < 2 * pose.width + pose.height) {
        x = pose.width / 2 - (distance - pose.width - pose.height)
        y = pose.height / 2
      } else {
        x = -pose.width / 2
        y = pose.height / 2 - (distance - 2 * pose.width - pose.height)
      }
      particle.position.set(x, y)
      const size =
        pose.width *
        (particles.sizeMin + Math.random() * (particles.sizeMax - particles.sizeMin))
      particle.width = size
      particle.height = size
      particle.rotation = Math.random() * Math.PI * 2
      effect.addChild(particle)
      const travel =
        pose.width *
        (particles.travelMin +
          Math.random() * (particles.travelMax - particles.travelMin))
      const length = Math.hypot(x, y) || 1
      const start = particles.delay + (index / particles.count) * particles.stagger
      timeline.to(particle, { alpha: 1, duration: 0.06 }, start)
      timeline.to(
        particle,
        {
          x: x + (x / length) * travel,
          y: y + (y / length) * travel,
          rotation: particle.rotation + (Math.random() - 0.5) * 3,
          duration: particles.duration,
          ease: 'power2.out'
        },
        start
      )
      timeline.to(
        particle,
        {
          alpha: 0,
          duration: particles.duration * 0.75,
          ease: 'sine.in'
        },
        start + particles.duration * 0.25
      )
    }
  }
}
