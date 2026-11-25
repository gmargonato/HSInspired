import {
  Rectangle,
  type Container,
  type Renderer,
  type Sprite,
  type Texture
} from 'pixi.js'
import type { CardReveal, OpeningCard, PlayerId } from '../../../game-rules/match'
import type { GameCardSlot } from '../hand/game-card-slot'
import { applyPlacement } from '../../../visual-components/layout'
import {
  CardMotionVisual,
  bodyMotionCorners,
  deckMotionCorners,
  deckMotionSlot
} from './card-motion-visual'
import { CARD_MOTION_LAYOUT } from './card-motion-layout'
import { CARD_REVEAL_LAYOUT } from './card-reveal-layout'
import { completeTimeline } from './game-presentation-animation'

interface RevealHost {
  readonly renderer: Renderer
  readonly layer: Container
  readonly back: Texture
  readonly localId: PlayerId
  readonly slots: Set<GameCardSlot>
  readonly animations: Set<CardMotionVisual>
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
  const flights: CardMotionVisual[] = []
  const returns: Array<() => Promise<void>> = []
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
    const showDuration =
      CARD_MOTION_LAYOUT.revealOnly.show + CARD_MOTION_LAYOUT.revealOnly.flip
    const clock = { seconds: 0, pulse: 1 }
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
        const bounds = slot.card.getLocalBounds(),
          frame = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
        const flight = new CardMotionVisual(
          host.renderer,
          host.layer,
          slot,
          host.back,
          'reveal-only',
          bodyMotionCorners(host.layer, slot.card, frame),
          {
            start: deckMotionCorners(host.layer, deck),
            slot: deckMotionSlot(host.layer, deck),
            remote: !local
          }
        )
        flights.push(flight)
        host.animations.add(flight)
        updates.push(() =>
          flight.update(
            clock.seconds,
            reveal.comparison?.winnerId === entry.participantId ? clock.pulse : 1
          )
        )
        returns.push(async () => {
          if (host.destroyed()) return
          flight.dispose()
          host.animations.delete(flight)
          const returning = new CardMotionVisual(
            host.renderer,
            host.layer,
            slot,
            host.back,
            'reveal-return',
            deckMotionCorners(host.layer, deck),
            { remote: !local, slot: deckMotionSlot(host.layer, deck) }
          )
          flights.push(returning)
          host.animations.add(returning)
          const clock = { seconds: 0 }
          await completeTimeline(
            host.timeline().to(clock, {
              seconds: returning.playback.duration,
              duration: returning.playback.duration,
              ease: 'none',
              onUpdate: () => returning.update(clock.seconds)
            })
          )
          slot.alpha = 0
        })
      } else {
        const origin = host.handOrigin(entry.participantId, entry.card.instanceId)
        slot.position.set(origin.x, origin.y)
        timeline.to(
          slot,
          {
            x: layout.position.x,
            y: layout.position.y + (layout.size.height * layout.scale!.y) / 2,
            duration: showDuration,
            ease: 'power2.out'
          },
          0
        )
        returns.push(() =>
          completeTimeline(
            host.timeline().to(slot, {
              x: origin.x,
              y: origin.y,
              duration: CARD_MOTION_LAYOUT.revealOnly.hide,
              ease: 'power2.inOut'
            })
          )
        )
      }
    }
    const update = (): void => updates.forEach((apply) => apply())
    timeline.to(
      clock,
      {
        seconds: showDuration,
        duration: showDuration,
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
    timeline.to({}, { duration: CARD_MOTION_LAYOUT.revealOnly.hold })
    await Promise.race([completeTimeline(timeline), cancelled])
    if (!host.destroyed())
      await Promise.race([Promise.all(returns.map((fly) => fly())), cancelled])
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
