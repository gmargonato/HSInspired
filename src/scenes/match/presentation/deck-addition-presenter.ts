import { Container, Sprite, type Texture } from 'pixi.js'
import type { DeckAddition, OpeningCard, PlayerId } from '../../../game-rules/match'
import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'
import type { GameCardSlot } from '../hand/game-card-slot'
import { DECK_ADDITION_LAYOUT } from './deck-addition-layout'
import { completeTimeline } from './game-presentation-animation'
import { CARD_PLAY_AURA_TINT, CARD_PLAY_LAYOUT } from './card-play-layout'

interface DeckAdditionHost {
  readonly layer: Container
  readonly back: Texture
  readonly backAura: Texture
  readonly viewerId: PlayerId
  readonly bodies: Set<Container>
  readonly slots: Set<GameCardSlot>
  readonly origin: { x: number; y: number }
  destroyed(): boolean
  createSlot(card: OpeningCard): Promise<GameCardSlot>
  aura(slot: GameCardSlot): Sprite
  timeline(): gsap.core.Timeline
  fly(body: Container, participantId: PlayerId, index: number): Promise<void>
}

/** All cards share one clock, including hidden faces represented only by backs. */
export async function presentDeckAddition(
  addition: DeckAddition,
  host: DeckAdditionHost
): Promise<void> {
  if (!addition.cards.length || host.destroyed()) return
  const bodies: Container[] = []
  const slots: GameCardSlot[] = []
  const auras = new Map<Container, Sprite>()
  let stopped = false
  let timeline: gsap.core.Timeline | undefined
  let cancel!: () => void
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => resolve(null)
  })
  host.layer.once('destroyed', cancel)
  try {
    const preparing = Promise.allSettled(
      addition.cards.map(async ({ card, visibleTo }, index) => {
        const visible = visibleTo === 'all' || visibleTo.includes(host.viewerId)
        const slot = visible ? await host.createSlot(card) : undefined
        if (stopped || host.destroyed()) {
          slot?.destroy({ children: true })
          return
        }
        const body = new Container()
        body.label = `game.deck-addition.${addition.id}.${index}`
        body.eventMode = 'none'
        body.visible = false
        body.position.copyFrom(host.origin)
        host.bodies.add(body)
        bodies[index] = body
        host.layer.addChild(body)
        if (slot) {
          slots.push(slot)
          host.slots.add(slot)
          slot.eventMode = 'none'
          slot.setMulliganInteractionEnabled(false)
          slot.suppressPlayableOutline(true)
          slot.position.set(0, CARD_CANVAS.height / 2)
          slot.scale.set(1)
          body.addChild(slot)
          const aura = host.aura(slot)
          aura.label = 'game.deck-addition.glow'
          auras.set(body, aura)
        } else {
          const back = new Sprite(host.back)
          back.label = 'game.deck-addition.back'
          back.anchor.set(0.5)
          back.width = CARD_CANVAS.width
          back.height = CARD_CANVAS.height
          body.addChild(back)
          const profile = CARD_PLAY_LAYOUT.minion.aura
          const aura = new Sprite(host.backAura)
          aura.label = 'game.deck-addition.glow'
          aura.anchor.set(0.5)
          aura.y = CARD_CANVAS.height * (profile.centerY - 0.5)
          aura.width = CARD_CANVAS.width * profile.widthMultiplier
          aura.height = CARD_CANVAS.height * profile.heightMultiplier
          aura.tint = CARD_PLAY_AURA_TINT
          aura.blendMode = 'add'
          body.addChild(aura)
          auras.set(body, aura)
        }
      })
    )
    const prepared = await Promise.race([preparing, cancelled])
    if (!prepared || host.destroyed()) return
    for (const result of prepared) if (result.status === 'rejected') throw result.reason
    const layout = DECK_ADDITION_LAYOUT
    timeline = host.timeline()
    const flights: Promise<void>[] = []
    const failures: unknown[] = []
    for (const [index, body] of bodies.entries()) {
      const start = index * layout.stagger
      body.scale.set(layout.scale * layout.initialScale)
      timeline.set(body, { visible: true }, start)
      timeline.to(
        body.scale,
        {
          x: layout.scale,
          y: layout.scale,
          duration: layout.growDuration,
          ease: 'power2.out'
        },
        start
      )
      const aura = auras.get(body)
      if (aura) {
        aura.alpha = 1
        timeline.to(
          aura,
          { alpha: 0, duration: layout.growDuration + layout.holdDuration },
          start
        )
      }
      timeline.call(
        () => {
          if (stopped || host.destroyed()) return
          // Observe rejection immediately; collect it after every flight has settled.
          try {
            flights.push(
              host.fly(body, addition.participantId, index).then(
                () => undefined,
                (error: unknown) => {
                  failures.push(error)
                }
              )
            )
          } catch (error) {
            failures.push(error)
          }
        },
        [],
        start + layout.growDuration + layout.holdDuration
      )
    }
    await Promise.race([completeTimeline(timeline), cancelled])
    if (!host.destroyed()) await Promise.race([Promise.all(flights), cancelled])
    if (failures.length) throw failures[0]
  } finally {
    stopped = true
    timeline?.kill()
    host.layer.off('destroyed', cancel)
    for (const body of bodies) {
      if (!body) continue
      host.bodies.delete(body)
      if (!body.destroyed) body.destroy({ children: true })
    }
    for (const slot of slots) {
      host.slots.delete(slot)
      if (!slot.destroyed) slot.destroy({ children: true })
    }
  }
}
