import { Container, PerspectiveMesh, Sprite, type Texture } from 'pixi.js'
import type { PerspectiveCorners } from '../hand/hand-card-perspective'
import type { CardDefinition } from '../../../game-rules/content/cards'
import type { CardView } from '../../../visual-components/cards/card-view'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { CARD_PLAY_LAYOUT } from './card-play-layout'
import { completeTimeline } from './game-presentation-animation'
import { MINION_LAYOUT } from '../board/minion-layout'
import type { MinionView } from '../board/minion-view'

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

export interface CardPlayPose {
  readonly perspective?: PerspectiveCorners
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number
}

/** Owns local play visuals independently of the consumed hand card. */
export class CardPlayAnimation extends Actor {
  constructor(
    private readonly spellAura: Texture,
    private readonly spotlights: readonly Texture[],
    private readonly minionAura: Texture
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
      x: center.x,
      y: center.y,
      width: Math.hypot(right.x - left.x, right.y - left.y),
      height: Math.hypot(bottom.x - left.x, bottom.y - left.y),
      rotation: Math.atan2(right.y - left.y, right.x - left.x)
    }
  }

  present(type: CardDefinition['type'], pose: CardPlayPose): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    switch (type) {
      case 'Spell':
        return this.presentSpell(pose)
      case 'Minion':
        // Minions use the staged helpers below to preserve targeting previews.
        return Promise.resolve()
      case 'Weapon':
      case 'Hero':
        return Promise.resolve()
    }
  }

  /** Retains a stationary choice while its cast fades, independently of the selector. */
  async presentChoice(card: CardView, presentation: Container): Promise<void> {
    const pose = this.capture(card)
    this.reparentChild(presentation)
    presentation.eventMode = 'none'
    const aura = CARD_PLAY_LAYOUT.spell.aura
    try {
      await Promise.all([
        this.present('Spell', pose),
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
    const profile = CARD_PLAY_LAYOUT.minion.aura
    const aura = new Sprite(this.minionAura)
    aura.label = 'game.minion-play-aura'
    aura.eventMode = 'none'
    aura.anchor.set(0.5)
    aura.position.set(card.x + card.plan.width / 2, card.y + card.renderedHeight / 2)
    aura.width = card.plan.width * profile.widthMultiplier
    aura.height = card.renderedHeight * profile.heightMultiplier
    aura.alpha = profile.initialAlpha
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
    const cardArt = card
      .getChildByLabel(`${card.plan.cardId}:card.artwork`, true)
      ?.children.find((child): child is Sprite => child instanceof Sprite)
    const boardArt = view.getChildByLabel('minion.artwork-image', true)
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
    const profile: RisingParticleProfile =
      stage === 'charge'
        ? CARD_PLAY_LAYOUT.minion.chargeParticles
        : CARD_PLAY_LAYOUT.minion.settleParticles
    const particles = new Container()
    particles.label = `game.minion-play-${stage}-particles`
    particles.eventMode = 'none'
    particles.zIndex = 5
    layer.addChild(particles)
    for (let index = 0; index < profile.count; index++) {
      const particle = new Sprite(this.spotlights[index % this.spotlights.length])
      particle.label = `game.minion-play-${stage}-particle-${index}`
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
            const frame = MINION_LAYOUT.frame
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

  private async presentSpell(pose: CardPlayPose): Promise<void> {
    const profile = CARD_PLAY_LAYOUT.spell
    const effect = new Container()
    effect.label = 'game.spell-play'
    effect.position.set(pose.x, pose.y)
    effect.rotation = pose.rotation
    effect.eventMode = 'none'
    this.addChild(effect)

    const width = pose.width * profile.aura.widthMultiplier
    const height = pose.height * profile.aura.heightMultiplier
    const corners = pose.perspective ?? {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 1, y: 1 },
      bottomLeft: { x: 0, y: 1 }
    }
    // Center the captured quadrilateral on the cast pose. Scaling during the
    // fade preserves its perspective instead of easing it back to a rectangle.
    const aura = new PerspectiveMesh({
      texture: this.spellAura,
      verticesX: 10,
      verticesY: 10,
      x0: (corners.topLeft.x - 0.5) * width,
      y0: (corners.topLeft.y - 0.5) * height,
      x1: (corners.topRight.x - 0.5) * width,
      y1: (corners.topRight.y - 0.5) * height,
      x2: (corners.bottomRight.x - 0.5) * width,
      y2: (corners.bottomRight.y - 0.5) * height,
      x3: (corners.bottomLeft.x - 0.5) * width,
      y3: (corners.bottomLeft.y - 0.5) * height
    })
    aura.label = 'game.spell-play-aura'
    aura.alpha = profile.aura.initialAlpha
    aura.blendMode = 'add'
    effect.addChild(aura)
    const timeline = this.timeline()
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

    const particles = profile.particles
    const perimeter = 2 * (pose.width + pose.height)
    for (let index = 0; index < particles.count; index++) {
      const particle = new Sprite(this.spotlights[index % this.spotlights.length])
      particle.label = `game.spell-play-particle-${index}`
      particle.anchor.set(0.5)
      particle.tint = particles.tint
      particle.blendMode = 'add'
      particle.alpha = 0
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
      const start = particles.delay + Math.random() * particles.stagger
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
    try {
      await completeTimeline(timeline)
    } finally {
      if (!effect.destroyed) effect.destroy({ children: true })
    }
  }
}
