import { Container, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type { AnimationScope } from '../../animation/animations'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'
import type { MinionView } from '../../rendering/minions/minion-view'
import { attachShadow } from '../../rendering/shadows/shadow-caster'
import type { CardPlayAnimation } from './card-play-animation'
import { CARD_PLAY_LAYOUT } from './card-play-layout'
import { CARD_DEPARTURE_LAYOUT } from './card-departure-layout'
import type { GameCardSlot } from './game-card-slot'
import { completeTimeline } from './game-presentation-animation'
import { Burn } from '../../rendering/effects/burn'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'

/** Temporary board bodies are owned here; the caller owns the resulting card. */
export class CardDepartureAnimation {
  private disposed = false
  private readonly bodies = new Set<Container>()

  constructor(
    private readonly renderer: Renderer,
    private readonly animations: AnimationScope,
    private readonly layer: Container,
    private readonly play: CardPlayAnimation
  ) {}

  async materialize(
    source: MinionView,
    slot: GameCardSlot,
    releaseSource: () => void,
    delay = 0
  ): Promise<boolean> {
    if (this.disposed || source.destroyed || slot.destroyed) return false
    const bounds = source.getLocalBounds()
    const texture = this.renderer.generateTexture({
      target: source,
      frame: new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
    })
    const body = new Container()
    body.label = `game.departing-minion.${slot.instanceId}`
    body.eventMode = 'none'
    const sprite = new Sprite(texture)
    sprite.label = 'game.departing-minion-image'
    sprite.position.set(bounds.x, bounds.y)
    body.addChild(sprite)
    body.once('destroyed', () => texture.destroy(true))
    this.bodies.add(body)
    this.layer.addChild(body)
    const origin = this.layer.toLocal(source.toGlobal({ x: 0, y: 0 }))
    const right = this.layer.toLocal(source.toGlobal({ x: 1, y: 0 }))
    const startScale = Math.hypot(right.x - origin.x, right.y - origin.y)
    body.position.copyFrom(origin)
    body.scale.set(startScale)
    const startRotation = Math.atan2(right.y - origin.y, right.x - origin.x)
    const shadow = attachShadow(body, source.shadow.bounds, {
      shape: 'ellipse',
      restingScale: startScale
    })
    shadow.height = source.shadow.height

    const profile = CARD_PLAY_LAYOUT.minion
    const maximumHeight = slot.shadow.maximumHeight
    slot.eventMode = 'none'
    slot.suppressPlayableOutline(true)
    slot.shadow.maximumHeight = Infinity
    slot.alpha = 0
    slot.position.set(origin.x, origin.y + (CARD_CANVAS.height * profile.cardScale) / 2)
    slot.rotation = 0
    slot.scale.set(profile.chargedCardScale)
    this.layer.addChild(slot)
    if (!this.play.alignMinionArtwork(slot.card, source, this.layer, body)) {
      body.position.set(origin.x, origin.y + profile.fallbackStartYOffset)
      body.scale.set(startScale * profile.fallbackStartScaleMultiplier)
    }
    const lifted = { x: body.x, y: body.y, scale: body.scale.x }
    body.position.copyFrom(origin)
    body.scale.set(startScale)
    body.rotation = startRotation
    body.visible = false
    const aura = this.play.createMinionAura(slot.card, slot)
    const lift = this.animations.timeline()
    lift.call(
      () => {
        if (this.disposed || body.destroyed) return
        body.visible = true
        releaseSource()
      },
      [],
      delay
    )
    lift.to(
      body,
      {
        x: lifted.x,
        y: lifted.y,
        rotation: 0,
        duration: CARD_DEPARTURE_LAYOUT.liftDuration,
        ease: 'power2.out'
      },
      delay
    )
    lift.to(
      body.scale,
      {
        x: lifted.scale,
        y: lifted.scale,
        duration: CARD_DEPARTURE_LAYOUT.liftDuration,
        ease: 'power2.out'
      },
      delay
    )
    try {
      await completeTimeline(lift)
      if (this.disposed || slot.destroyed || body.destroyed) return false
      slot.shadow.height = shadow.height
      body.visible = false
      slot.alpha = 1
      aura.alpha = profile.aura.peakAlpha
      const reveal = this.animations.timeline()
      reveal.to(aura, {
        alpha: 0,
        duration: CARD_DEPARTURE_LAYOUT.materializeDuration,
        ease: 'power2.out'
      })
      reveal.to(
        slot.scale,
        {
          x: profile.cardScale,
          y: profile.cardScale,
          duration: CARD_DEPARTURE_LAYOUT.materializeDuration,
          ease: 'sine.inOut'
        },
        0
      )
      await completeTimeline(reveal)
      return !this.disposed && !slot.destroyed
    } finally {
      if (!slot.destroyed) slot.shadow.maximumHeight = maximumHeight
      this.bodies.delete(body)
      if (!body.destroyed) body.destroy({ children: true })
      if (!aura.destroyed) aura.destroy()
    }
  }

  async destroyCard(slot: GameCardSlot): Promise<void> {
    if (this.disposed || slot.destroyed) return
    const profile = CARD_DEPARTURE_LAYOUT.destroy
    const aura = this.play.createMinionAura(slot.card, slot)
    const timeline = this.animations.timeline()
    const particles = this.play.emitMinionParticles(
      timeline,
      this.layer,
      slot.card,
      'charge'
    )
    this.bodies.add(particles)
    timeline.to(aura, { alpha: 1, duration: profile.flashDuration }, 0)
    timeline.to(
      slot,
      { alpha: 0, duration: profile.fadeDuration },
      profile.flashDuration
    )
    timeline.to(
      slot.scale,
      {
        x: slot.scale.x * profile.scaleMultiplier,
        y: slot.scale.y * profile.scaleMultiplier,
        duration: profile.fadeDuration,
        ease: 'power2.in'
      },
      profile.flashDuration
    )
    try {
      await completeTimeline(timeline)
    } finally {
      this.bodies.delete(particles)
      if (!particles.destroyed) particles.destroy({ children: true })
      if (!aura.destroyed) aura.destroy()
    }
  }

  async burnCard(slot: GameCardSlot, noise: Sprite['texture']): Promise<void> {
    if (this.disposed || slot.destroyed) return
    const burn = new Burn(noise)
    const hiddenShadow = new Container()
    hiddenShadow.visible = false
    const previousVisual = slot.shadow.visual
    slot.shadow.visual = hiddenShadow
    slot.card.filters = [...(slot.card.filters ?? []), burn.filter]
    const progress = { value: 0 }
    try {
      await completeTimeline(
        this.animations.timeline().to(progress, {
          value: 1,
          duration: CARD_DRAW_LAYOUT.localReveal.burnDuration,
          ease: 'none',
          onUpdate: () => burn.setProgress(progress.value)
        })
      )
      if (!slot.destroyed) slot.alpha = 0
    } finally {
      if (!slot.card.destroyed)
        slot.card.filters = (slot.card.filters ?? []).filter(
          (filter) => filter !== burn.filter
        )
      slot.shadow.visual = previousVisual
      hiddenShadow.destroy()
      burn.destroy()
    }
  }

  dispose(): void {
    this.disposed = true
    for (const body of this.bodies)
      if (!body.destroyed) body.destroy({ children: true })
    this.bodies.clear()
  }
}
