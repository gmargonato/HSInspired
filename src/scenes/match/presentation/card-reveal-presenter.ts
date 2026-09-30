import type { Container, Renderer, Sprite, Texture } from 'pixi.js'
import type { CardReveal, OpeningCard, PlayerId } from '../../../game-rules/match'
import type { GameCardSlot } from '../hand/game-card-slot'
import { applyPlacement } from '../../../visual-components/layout'
import { CardDrawAnimation } from './card-draw-animation'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'
import { CARD_REVEAL_LAYOUT } from './card-reveal-layout'
import { completeTimeline } from './game-presentation-animation'

interface RevealHost {
  readonly renderer: Renderer
  readonly layer: Container
  readonly back: Texture
  readonly localId: PlayerId
  readonly slots: Set<GameCardSlot>
  readonly animations: Set<CardDrawAnimation>
  destroyed(): boolean
  createSlot(card: OpeningCard): Promise<GameCardSlot>
  deck(participantId: PlayerId): Sprite | undefined
  handOrigin(participantId: PlayerId, instanceId: string): { x: number; y: number }
  timeline(): gsap.core.Timeline
}

/** Prepare every face before starting the shared ascent and comparison clock. */
export async function presentCardReveal(
  reveal: CardReveal,
  host: RevealHost
): Promise<void> {
  if (!reveal.cards.length || host.destroyed()) return
  const slots: GameCardSlot[] = []
  const flights: CardDrawAnimation[] = []
  let stopped = false
  let timeline: gsap.core.Timeline | undefined
  let cancel!: () => void
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => resolve(null)
  })
  host.layer.once('destroyed', cancel)
  try {
    const preparing = Promise.allSettled(
      reveal.cards.map(async (entry) => {
        const slot = await host.createSlot({
          ...entry.card,
          ownerId: entry.participantId
        })
        if (stopped || host.destroyed()) {
          slot.destroy({ children: true })
          return slot
        }
        slots.push(slot)
        host.slots.add(slot)
        return slot
      })
    )
    const prepared = await Promise.race([preparing, cancelled])
    if (!prepared || host.destroyed()) return
    for (const result of prepared) if (result.status === 'rejected') throw result.reason
    const peak =
      CARD_DRAW_LAYOUT.localReveal.reveal.at(-1)!.at /
      CARD_DRAW_LAYOUT.localReveal.duration
    const clock = { progress: 0, pulse: 1 }
    const updates: Array<() => void> = []
    timeline = host.timeline()
    for (const [index, entry] of reveal.cards.entries()) {
      const result = prepared[index]
      if (result.status !== 'fulfilled') continue
      const slot = result.value
      const local = entry.participantId === host.localId
      const layout = local ? CARD_REVEAL_LAYOUT.local : CARD_REVEAL_LAYOUT.remote
      slot.label = `game.reveal.${local ? 'local' : 'remote'}.${index}`
      slot.eventMode = 'none'
      slot.setMulliganInteractionEnabled(false)
      applyPlacement(slot, layout)
      // Card slots use a bottom-center origin; the reveal placement describes the face center.
      slot.y += (layout.size.height * layout.scale!.y) / 2
      host.layer.addChild(slot)
      const deck = host.deck(entry.participantId)
      if (entry.origin === 'deck' && deck) {
        const flight = new CardDrawAnimation(
          host.renderer,
          host.layer,
          deck,
          slot,
          host.back,
          slot,
          local ? 'local-reveal' : 'remote-reveal',
          { ...layout.position, scale: layout.scale!.x }
        )
        flights.push(flight)
        host.animations.add(flight)
        updates.push(() =>
          flight.update(
            clock.progress,
            reveal.comparison?.winnerId === entry.participantId ? clock.pulse : 1
          )
        )
      } else {
        const origin = host.handOrigin(entry.participantId, entry.card.instanceId)
        slot.position.set(origin.x, origin.y)
        timeline.to(
          slot,
          {
            x: layout.position.x,
            y: layout.position.y + (layout.size.height * layout.scale!.y) / 2,
            duration: CARD_DRAW_LAYOUT.localReveal.normalAscentDuration,
            ease: 'power2.out'
          },
          0
        )
      }
    }
    const update = (): void => updates.forEach((apply) => apply())
    timeline.to(
      clock,
      {
        progress: peak,
        duration: CARD_DRAW_LAYOUT.localReveal.normalAscentDuration,
        ease: 'none',
        onUpdate: update
      },
      0
    )
    if (reveal.comparison?.winnerId) {
      timeline.to(clock, {
        pulse: CARD_REVEAL_LAYOUT.pulseScale,
        duration: CARD_REVEAL_LAYOUT.pulseHalfDuration,
        ease: 'power2.out',
        onUpdate: update
      })
      timeline.to(clock, {
        pulse: 1,
        duration: CARD_REVEAL_LAYOUT.pulseHalfDuration,
        ease: 'power2.in',
        onUpdate: update
      })
    }
    timeline.to({}, { duration: CARD_REVEAL_LAYOUT.hold })
    await completeTimeline(timeline)
  } finally {
    stopped = true
    host.layer.off('destroyed', cancel)
    timeline?.kill()
    for (const flight of flights) {
      flight.dispose()
      host.animations.delete(flight)
    }
    for (const slot of slots) {
      host.slots.delete(slot)
      if (!slot.destroyed) slot.destroy({ children: true })
    }
  }
}
