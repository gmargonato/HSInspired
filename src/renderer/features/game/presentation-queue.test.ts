import { summonPresentationBatch } from './summon-presentation'
import { PresentationQueue } from './presentation-queue'
import { randomSpellPresentationStates } from './random-spell-presentation'
import type { RemoteCardPlayPreview } from './remote-card-play-preview'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Container,
  Graphics,
  Sprite,
  Texture,
  DOMAdapter,
  RenderTexture,
  PerspectiveMesh,
  type FederatedPointerEvent
} from 'pixi.js'
import { GameMulliganView } from './game-mulligan-view'
import type { GameHandView } from './game-hand-view'
import { HAND_PREPARATION_DWELL_MS } from './game-hand-drag'
import type { GameCardTargeting } from './game-card-targeting'
import type { GameCombatPresentation } from './game-combat-presentation'
import { Button } from '../../ui/components/button'
import { GameBoardView, type GameBoardViewOptions } from './game-board-view'
import { gsap, type AnimationScope } from '../../animation/animations'
import { createMatchScenario } from '../../../game/match/testing/match-scenario-builder'
import { GameBoardSession } from './game-board-session'
import type {
  OpeningCard,
  OpeningMatchEvent,
  OpeningMatchState,
  PlayerId
} from '../../../game/match'
import { HeroView } from '../../rendering/heroes/hero-view'
import type { GameCardSlot } from './game-card-slot'
import { TargetGestureController } from './target-gesture'
import { asCardId } from '../../../game/content/cards'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { OPENING_TIMING, RESOLUTION_TIMING } from './game-presentation-timing'
import { DEFAULT_HAND_LAYOUT, layoutHand } from './hand-layout'
import { attachShadow, getShadowCaster } from '../../rendering/shadows/shadow-caster'
import { layoutBoardRow } from './board-layout'
import type { BoardPositionController } from './board-position-controller'
import type { HandEntry } from './game-hand-entry'
import type { PlayCardInput } from '../../../game/match'
import {
  MinionView,
  type MinionViewTextures
} from '../../rendering/minions/minion-view'
import type { MinionPreviewPresentation } from './game-card-targeting-types'
import type { CardSelectionOverlay } from './card-selection-overlay'
import { CardDepartureAnimation } from './card-departure-animation'
import { CARD_DEPARTURE_LAYOUT } from './card-departure-layout'
import { HandCardPerspectivePool } from './hand-card-perspective-pool'
import { CardView } from '../../rendering/cards/card-view'
import { SecretRevealView, SecretZoneView } from './secret-view'
import { SECRET_LAYOUT } from './secret-layout'
import type { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { CardPlayAnimation } from './card-play-animation'
import {
  CardDrawAnimation,
  createLocalDrawFlight,
  drawFlightPose,
  type DrawCorners
} from './card-draw-animation'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'
import { CARD_REVEAL_LAYOUT } from './card-reveal-layout'
import type { MinionCardMovement } from '../../../game/match'

describe('engine-driven minion card departures', () => {
  function departureSlot(instanceId: string): GameCardSlot {
    const slot = mulliganSlot(instanceId)
    const card = Object.assign(new Container(), {
      plan: { width: 620, cardId: 'basic_bloodfen_raptor' },
      renderedHeight: 900,
      setManaCost: vi.fn(),
      setManaCostColor: vi.fn()
    })
    card.position.set(-310, -900)
    const artwork = new Container()
    artwork.label = 'basic_bloodfen_raptor:card.artwork'
    const image = new Sprite(Texture.WHITE)
    image.scale.set(300)
    artwork.addChild(image)
    artwork.position.set(150, 100)
    card.addChild(artwork)
    slot.addChild(card)
    return Object.assign(slot, {
      card,
      suppressPlayableOutline: vi.fn()
    }) as unknown as GameCardSlot
  }

  function setup() {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      hand: GameHandView
      animationScope: AnimationScope
      boardPositions: BoardPositionController
      cardDepartureAnimation: CardDepartureAnimation
      cardPlayAnimation: CardPlayAnimation
      summonLayer: Container
      remoteBacks: Sprite[]
      remoteBackCount: number
      localMinionViews: readonly MinionView[]
      activeDepartureSlots: Set<GameCardSlot>
      createSlot(card: OpeningCard): Promise<GameCardSlot>
      presentEffectResolved(event: OpeningMatchEvent): Promise<void>
      presentMinionCardMovement(movement: MinionCardMovement): Promise<void>
      reconcileEffectMovement(state: OpeningMatchState): Promise<void>
      presentDraw(participantId: PlayerId, card: OpeningCard): Promise<void>
      animateSlotToDeck(
        slot: GameCardSlot,
        deck: unknown,
        sequence: number
      ): Promise<void>
    }
    const source = Object.assign(new Container(), {
      instanceId: 'departure-source',
      cardId: asCardId('basic_bloodfen_raptor'),
      ownerId: internal.session.localParticipantId
    }) as unknown as MinionView
    Object.assign(source, {
      shadow: attachShadow(source, { x: -90, y: -120, width: 180, height: 240 })
    })
    const art = new Sprite(Texture.WHITE)
    art.label = 'minion.artwork-image'
    art.anchor.set(0.5)
    art.scale.set(180)
    source.addChild(art)
    internal.boardPositions.insert('local', 0, source)
    source.position.set(850, 670)
    source.scale.set(0.8)
    vi.spyOn(internal, 'createSlot').mockImplementation(async (card) =>
      departureSlot(card.instanceId)
    )
    vi.spyOn(internal.hand, 'configureSlot').mockImplementation(() => undefined)
    const animations: gsap.core.Animation[] = []
    const original = internal.animationScope.timeline.bind(internal.animationScope)
    vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
      const timeline = original(vars)
      animations.push(timeline)
      return timeline
    })
    const finish = async (job: Promise<unknown>) => {
      let done = false
      void job.then(() => {
        done = true
      })
      for (let pass = 0; pass < 100 && !done; pass++) {
        for (const animation of animations)
          if (animation.progress() < 1) animation.progress(1)
        await Promise.resolve()
      }
      expect(done).toBe(true)
      await job
    }
    const movement = (
      destination: MinionCardMovement['destination'],
      copy = false,
      count = 1
    ): MinionCardMovement => ({
      sourceInstanceId: source.instanceId!,
      participantId: internal.session.localParticipantId,
      destination,
      copy,
      cards: Array.from({ length: count }, (_, index) => ({
        instanceId: copy ? `departing-copy-${index}` : source.instanceId!,
        cardId: asCardId('basic_bloodfen_raptor'),
        zone: destination
      }))
    })
    return { value, internal, source, animations, finish, movement }
  }

  it('lifts, swaps to an artwork-aligned card, and inserts at the right without a second draw', async () => {
    const { internal, source, animations, finish, movement } = setup()
    const existing = departureSlot('existing')
    internal.hand.layer.addChild(existing)
    internal.hand.append({
      card: { instanceId: 'existing', cardId: asCardId('basic_bloodfen_raptor') },
      slot: existing,
      restTransform: undefined,
      displaced: false
    })
    const cue = movement('hand')
    const job = internal.presentEffectResolved({
      type: 'effect-resolved',
      revision: 1,
      sourceInstanceId: 'arbitrary-source',
      sourceCardId: null,
      controllerId: cue.participantId,
      action: 'future-effect',
      actionPath: 'fixture',
      cardMovement: cue
    })
    for (let pass = 0; pass < 5; pass++) await Promise.resolve()
    const slot = [...internal.activeDepartureSlots][0]
    expect(slot.alpha).toBe(0)
    const start = { x: source.x, y: source.y }
    animations[0].progress(0.5)
    expect(source.destroyed).toBe(true)
    const body = internal.summonLayer.getChildByLabel(
      'game.departing-minion.departure-source'
    )!
    expect(body.y).not.toBe(start.y)
    expect(slot.alpha).toBe(0)
    animations[0].progress(1)
    await Promise.resolve()
    expect(slot.alpha).toBe(1)
    expect(body.visible).toBe(false)
    const cardImage = slot.card.getChildByLabel('basic_bloodfen_raptor:card.artwork')!
      .children[0]
    const cardCenter = cardImage.toGlobal({ x: 0.5, y: 0.5 })
    const minionCenter = body.toGlobal({ x: 0, y: 0 })
    expect(minionCenter.x).toBeCloseTo(cardCenter.x)
    expect(minionCenter.y).toBeCloseTo(cardCenter.y)
    await finish(job)
    expect(internal.hand.entries.map((entry) => entry.card.instanceId)).toEqual([
      'existing',
      'departure-source'
    ])
    expect(slot.parent).toBe(internal.hand.layer)
    expect(internal.activeDepartureSlots.size).toBe(0)
    expect(internal.summonLayer.children).toHaveLength(0)
    const draw = vi.spyOn(internal, 'presentDraw').mockResolvedValue()
    const state = internal.session.getState()
    await internal.reconcileEffectMovement({
      ...state,
      players: state.players.map((player) => ({
        ...player,
        board: [],
        hand:
          player.participantId === cue.participantId
            ? internal.hand.entries.map((entry) => entry.card)
            : []
      })) as unknown as OpeningMatchState['players']
    })
    expect(draw).not.toHaveBeenCalled()
  })

  it('destroys a full-hand return above the board without hand or deck travel', async () => {
    const { internal, source, finish, movement } = setup()
    const destroy = vi.spyOn(internal.cardDepartureAnimation, 'destroyCard')
    const deck = vi.spyOn(internal, 'animateSlotToDeck')
    const hand = vi.spyOn(internal.hand, 'applyLayout')
    await finish(internal.presentMinionCardMovement(movement('discarded')))
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(deck).not.toHaveBeenCalled()
    expect(hand).not.toHaveBeenCalled()
    expect(source.destroyed).toBe(true)
    expect(internal.hand.entries).toHaveLength(0)
    expect(internal.summonLayer.children).toHaveLength(0)
  })

  it.each([false, true])(
    'uses the destination deck and keeps only copied sources (copy=%s)',
    async (copy) => {
      const { internal, source, finish, movement } = setup()
      const pose = { x: source.x, y: source.y, scale: source.scale.x }
      const materialize = vi.spyOn(internal.cardDepartureAnimation, 'materialize')
      const deck = vi.spyOn(internal, 'animateSlotToDeck')
      const cue = {
        ...movement('deck', copy, copy ? 3 : 1),
        participantId: internal.session.remoteParticipantId
      }
      await finish(internal.presentMinionCardMovement(cue))
      expect(deck).toHaveBeenCalledTimes(cue.cards.length)
      for (const [index, call] of deck.mock.calls.entries()) {
        expect(call[1]).toBe(GAME_BOARD_LAYOUT.decks.remote)
        expect(materialize.mock.calls[index][3]).toBe(
          copy ? index * CARD_DEPARTURE_LAYOUT.copyStagger : 0
        )
        expect(call[0].destroyed).toBe(true)
      }
      expect(source.destroyed).toBe(!copy)
      if (copy)
        expect({ x: source.x, y: source.y, scale: source.scale.x }).toEqual(pose)
      expect(internal.activeDepartureSlots.size).toBe(0)
    }
  )

  it('turns a public returning minion into a back in the opponent hand', async () => {
    const { internal, finish, movement } = setup()
    const count = internal.remoteBackCount
    await finish(
      internal.presentMinionCardMovement({
        ...movement('hand'),
        participantId: internal.session.remoteParticipantId
      })
    )
    expect(internal.remoteBackCount).toBe(count + 1)
    expect(internal.remoteBacks[count].alpha).toBe(1)
    expect(internal.hand.entries).toHaveLength(0)
    expect(internal.activeDepartureSlots.size).toBe(0)
  })

  it('cleans up an interrupted lift and releases the awaiting presentation', async () => {
    const { value, internal, animations, movement } = setup()
    const job = internal.presentMinionCardMovement(movement('deck', true, 3))
    for (let pass = 0; pass < 10; pass++) await Promise.resolve()
    for (const animation of animations) animation.progress(0.4)
    const slots = [...internal.activeDepartureSlots]
    expect(slots).toHaveLength(3)
    value.dispose()
    await job
    expect(slots.every((slot) => slot.destroyed)).toBe(true)
    expect(internal.activeDepartureSlots.size).toBe(0)
  })

  it('destroys cards whose artwork finishes loading after disposal', async () => {
    const { value, internal, movement } = setup()
    let complete!: (slot: GameCardSlot) => void
    vi.mocked(internal.createSlot).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const job = internal.presentMinionCardMovement(movement('hand'))
    value.dispose()
    const slot = departureSlot('late-card')
    complete(slot)
    await job
    expect(slot.destroyed).toBe(true)
  })

  it('retains the replaced hand slot for generic board/hand swaps', async () => {
    const { internal, finish, movement } = setup()
    const replaced = departureSlot('replaced')
    const last = departureSlot('last')
    for (const slot of [replaced, last]) {
      internal.hand.layer.addChild(slot)
      internal.hand.append({
        card: {
          instanceId: slot.instanceId,
          cardId: asCardId('basic_bloodfen_raptor')
        },
        slot,
        restTransform: undefined,
        displaced: false
      })
    }
    await finish(
      internal.presentMinionCardMovement({
        ...movement('hand'),
        replacedHandCard: {
          participantId: internal.session.localParticipantId,
          instanceId: 'replaced'
        },
        handIndex: 0
      })
    )
    expect(replaced.destroyed).toBe(true)
    expect(internal.hand.entries.map((entry) => entry.card.instanceId)).toEqual([
      'departure-source',
      'last'
    ])
  })
})

function mulliganSlot(instanceId: string): GameCardSlot {
  const slot = new Container()
  return Object.assign(slot, {
    shadow: attachShadow(
      slot,
      { x: 0, y: 0, width: 620, height: 900 },
      {
        restingScale: DEFAULT_HAND_LAYOUT.cardScale
      }
    ),
    instanceId,
    setSelected: vi.fn(),
    setPlayableOutlineEnabled: vi.fn(),
    setPlayableOutlineEnhanced: vi.fn(),
    setMulliganInteractionEnabled: vi.fn(),
    prepareCardReplacement: vi.fn(),
    flipToCardReplacement: vi.fn().mockResolvedValue(undefined),
    disposePlayableOutline: vi.fn()
  }) as unknown as GameCardSlot
}

const boards: GameBoardView[] = []
function board() {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { search: '' }
  })
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({
    getContext: () => null
  } as unknown as HTMLCanvasElement)
  const scenario = createMatchScenario()
  const assets = new Proxy({}, { get: () => Texture.WHITE })
  const value = new GameBoardView({
    gameAssets: assets,
    heroAssets: assets,
    renderer: {
      canvas: {
        parentElement: null,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 })
      },
      width: 1920,
      height: 1080,
      resolution: 1,
      screen: { width: 1920, height: 1080 },
      render: vi.fn(),
      generateTexture: () => RenderTexture.create({ width: 620, height: 900 })
    },
    route: { setup: scenario.setup },
    decks: scenario.decks
  } as unknown as GameBoardViewOptions)
  Object.assign(value, { session: new GameBoardSession(scenario) })
  boards.push(value)
  return value
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const value of boards.splice(0)) if (!value.destroyed) value.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('local draw profiles', () => {
  it('flies continuously from the deck to a face-up hand card without growing past hand size', () => {
    const start: DrawCorners = [
      { x: 1700, y: 650 },
      { x: 1740, y: 640 },
      { x: 1742, y: 810 },
      { x: 1700, y: 800 }
    ]
    const end: DrawCorners = [
      { x: 1000, y: 880 },
      { x: 1186, y: 880 },
      { x: 1186, y: 1150 },
      { x: 1000, y: 1150 }
    ]
    const first = drawFlightPose(start, end, 0, true)
    first.corners.forEach((point, index) => {
      expect(point.x).toBeCloseTo(start[index].x)
      expect(point.y).toBeCloseTo(start[index].y)
    })
    expect(first.front).toBe(false)
    const frames = [0.2, 0.4, 0.6, 0.8].map((progress) =>
      drawFlightPose(start, end, progress, true)
    )
    frames.forEach((pose, index) => {
      expect(pose.magnification).toBeLessThanOrEqual(1)
      if (index > 0) expect(pose.corners).not.toEqual(frames[index - 1].corners)
    })
    expect(frames[2].front).toBe(true)
    expect(drawFlightPose(start, end, 1, true)).toMatchObject({
      corners: end,
      front: true,
      magnification: 1
    })
  })

  it.each([0, 9])(
    'inserts a fast draw into a hand of %i cards without a departure delay',
    async (count) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        hand: GameHandView
        drawOrigins: WeakMap<Container, Sprite>
        createSlot(card: OpeningCard): Promise<GameCardSlot>
        prepareSlotAtDeck(slot: GameCardSlot): void
        addLocalCard(card: OpeningCard, sourceDeck: PlayerId): Promise<void>
        animateDeckDeparture(
          slot: GameCardSlot,
          duration: number,
          delay: number,
          profile: string
        ): Promise<void>
      }
      for (let i = 0; i < count; i++) {
        const slot = mulliganSlot(`existing-${i}`)
        internal.hand.layer.addChild(slot)
        internal.hand.append({
          card: { instanceId: `existing-${i}`, cardId: asCardId('classic_wisp') },
          slot,
          restTransform: undefined,
          displaced: false
        })
      }
      const card = { instanceId: 'fast-draw', cardId: asCardId('classic_wisp') }
      const incoming = mulliganSlot(card.instanceId)
      const deck = new Sprite(Texture.WHITE)
      vi.spyOn(internal, 'createSlot').mockResolvedValue(incoming)
      vi.spyOn(internal, 'prepareSlotAtDeck').mockImplementation((slot) => {
        internal.drawOrigins.set(slot, deck)
      })
      vi.spyOn(internal.hand, 'configureSlot').mockImplementation(() => {})
      const depart = vi.spyOn(internal, 'animateDeckDeparture').mockResolvedValue()
      const layout = vi.spyOn(internal.hand, 'applyLayout')
      await internal.addLocalCard(card, internal.session.localParticipantId)
      expect(layout).toHaveBeenCalledWith(
        expect.objectContaining({
          positionDuration: OPENING_TIMING.cardDeal,
          scaleDuration: OPENING_TIMING.cardDeal
        })
      )
      expect(depart).toHaveBeenCalledWith(
        incoming,
        OPENING_TIMING.cardDeal,
        0,
        'direct'
      )
      expect(incoming.parent).toBe(internal.hand.layer)
      expect(internal.hand.entries).toHaveLength(count + 1)
      deck.destroy()
    }
  )

  it.each(['default', 'turn-start', 'opening', 'public'] as const)(
    'routes the %s draw and pauses only for the automatic reveal',
    async (kind) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        presentEvent(event: OpeningMatchEvent): Promise<void>
        addLocalCard(
          card: OpeningCard,
          sourceDeck?: PlayerId,
          profile?: string
        ): Promise<void>
        syncTurnHud(): void
        wait(duration: number): Promise<void>
      }
      const participantId = internal.session.localParticipantId
      const card = { instanceId: 'draw-profile', cardId: asCardId('classic_wisp') }
      const add = vi.spyOn(internal, 'addLocalCard').mockResolvedValue()
      vi.spyOn(internal, 'syncTurnHud').mockImplementation(() => {})
      const wait = vi.spyOn(internal, 'wait').mockResolvedValue()
      await internal.presentEvent(
        kind === 'opening'
          ? { type: 'opening-card-drawn', participantId, card }
          : {
              type: 'card-drawn',
              participantId,
              card,
              origin: 'deck',
              ...(kind === 'public' ? { publicReveal: true } : {}),
              ...(kind === 'turn-start' ? { reason: 'turn-start' as const } : {})
            }
      )
      expect(add).toHaveBeenCalledWith(
        card,
        participantId,
        kind === 'default'
          ? 'direct'
          : kind === 'public'
            ? 'public-reveal'
            : 'local-reveal'
      )
      expect(wait).toHaveBeenCalledTimes(kind === 'default' ? 0 : 1)
    }
  )
})

describe('Joust reveal choreography', () => {
  it('uses a temporary face for a remote public draw and restores its hand back', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      remoteBackCount: number
      remoteBacks: Sprite[]
      activeDepartureSlots: Set<GameCardSlot>
      deckViews: Map<PlayerId, { drawOrigin: Sprite }>
      drawOrigins: WeakMap<GameCardSlot | Sprite, Sprite>
      createSlot(card: OpeningCard): Promise<GameCardSlot>
      animateDeckDeparture(
        slot: GameCardSlot,
        duration: number,
        delay: number,
        profile: string
      ): Promise<void>
      syncTurnHud(): void
      wait(duration: number): Promise<void>
      presentEvent(event: OpeningMatchEvent): Promise<void>
    }
    const remote = internal.session.remoteParticipantId
    const deck = new Sprite(Texture.WHITE)
    value.addChild(deck)
    vi.spyOn(internal.deckViews, 'get').mockReturnValue({ drawOrigin: deck })
    const slot = Object.assign(mulliganSlot('public-draw'), {
      card: { renderedHeight: 900 }
    })
    vi.spyOn(internal, 'createSlot').mockResolvedValue(slot)
    vi.spyOn(internal, 'syncTurnHud').mockImplementation(() => {})
    vi.spyOn(internal, 'wait').mockResolvedValue()
    let finish!: () => void
    const animate = vi.spyOn(internal, 'animateDeckDeparture').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const count = internal.remoteBackCount
    const pending = internal.presentEvent({
      type: 'card-drawn',
      participantId: remote,
      publicReveal: true,
      origin: 'deck',
      card: { instanceId: 'public-draw', cardId: asCardId('classic_wisp') }
    })
    for (let i = 0; i < 4; i++) await Promise.resolve()
    const back = internal.remoteBacks.at(-1)!
    expect(animate).toHaveBeenCalledWith(slot, 0, 0, 'public-reveal')
    expect(internal.drawOrigins.get(slot)).toBe(deck)
    expect(internal.remoteBackCount).toBe(count + 1)
    expect(back.visible).toBe(false)
    finish()
    await pending
    expect(back.visible).toBe(true)
    expect(slot.destroyed).toBe(true)
    expect(internal.activeDepartureSlots.size).toBe(0)
  })

  it.each(['dispose', 'asset failure'] as const)(
    'releases prepared cards after %s',
    async (mode) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        activeDepartureSlots: Set<GameCardSlot>
        createSlot(card: OpeningCard): Promise<GameCardSlot>
        presentEffectResolved(event: OpeningMatchEvent): Promise<void>
      }
      const first = mulliganSlot('prepared')
      const late = mulliganSlot('late')
      let resolveLate!: (slot: GameCardSlot) => void
      let rejectLate!: (error: Error) => void
      vi.spyOn(internal, 'createSlot')
        .mockResolvedValueOnce(first)
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolveLate = resolve
              rejectLate = reject
            })
        )
      const local = internal.session.localParticipantId
      const remote = internal.session.remoteParticipantId
      const pending = internal.presentEffectResolved({
        type: 'effect-resolved',
        revision: 1,
        sourceInstanceId: 'jouster',
        sourceCardId: asCardId('the_grand_tournament_gadgetzan_jouster'),
        controllerId: local,
        action: 'joust',
        actionPath: 'test',
        cardReveal: {
          id: 'cancelled-reveal',
          comparison: { winnerId: null },
          cards: [local, remote].map((participantId, index) => ({
            participantId,
            origin: 'deck',
            card: { instanceId: `card-${index}`, cardId: asCardId('classic_wisp') }
          }))
        }
      })
      await Promise.resolve()
      if (mode === 'dispose') value.dispose()
      else rejectLate(new Error('Artwork unavailable'))
      await pending
      expect(first.destroyed).toBe(true)
      expect(internal.activeDepartureSlots.size).toBe(0)
      if (mode === 'dispose') {
        resolveLate(late)
        await Promise.resolve()
        expect(late.destroyed).toBe(true)
      } else late.destroy({ children: true })
    }
  )

  it('keeps the two peaks separated even at the pulse maximum', () => {
    const corners: DrawCorners = [
      { x: 0, y: 0 },
      { x: 620, y: 0 },
      { x: 620, y: 900 },
      { x: 0, y: 900 }
    ]
    const progress =
      CARD_DRAW_LAYOUT.localReveal.reveal.at(-1)!.at /
      CARD_DRAW_LAYOUT.localReveal.duration
    const poses = [CARD_REVEAL_LAYOUT.remote, CARD_REVEAL_LAYOUT.local].map(
      (placement, index) =>
        createLocalDrawFlight(
          corners,
          corners,
          620,
          900,
          index ? 'local-reveal' : 'remote-reveal',
          placement.position
        )(progress)
    )
    expect(poses.every((pose) => pose.front)).toBe(true)
    const center = (pose: (typeof poses)[number]) =>
      pose.corners.reduce((sum, p) => sum + p.y / 4, 0)
    const half =
      (900 * CARD_REVEAL_LAYOUT.local.scale!.y * CARD_REVEAL_LAYOUT.pulseScale) / 2
    expect(center(poses[0]) + half).toBeLessThan(center(poses[1]) - half)
  })

  it.each(['local', 'remote', 'interrupt', null] as const)(
    'waits for both faces, holds, and cleans up (winner=%s)',
    async (winner) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        animationScope: AnimationScope
        activeDepartureSlots: Set<GameCardSlot>
        drawAnimations: Set<CardDrawAnimation>
        deckViews: Map<PlayerId, { drawOrigin: Sprite }>
        createSlot(card: OpeningCard): Promise<GameCardSlot>
        presentEffectResolved(event: OpeningMatchEvent): Promise<void>
      }
      const local = internal.session.localParticipantId
      const remote = internal.session.remoteParticipantId
      const deck = new Sprite(Texture.WHITE)
      value.addChild(deck)
      vi.spyOn(internal.deckViews, 'get').mockReturnValue({ drawOrigin: deck })
      const cards = [local, remote].map((id, index) => ({
        participantId: id,
        origin: 'deck' as const,
        card: { instanceId: `reveal-${index}`, cardId: asCardId('classic_wisp') }
      }))
      const makeSlot = (id: string): GameCardSlot => {
        const slot = mulliganSlot(id)
        const face = new Sprite(Texture.WHITE)
        face.width = 620
        face.height = 900
        face.position.set(-310, -900)
        slot.addChild(face)
        Object.assign(face, {
          createAppearanceSnapshot: () =>
            RenderTexture.create({ width: 620, height: 900 })
        })
        return Object.assign(slot, { card: face }) as unknown as GameCardSlot
      }
      const slots = cards.map((entry) => makeSlot(entry.card.instanceId))
      let release!: (slot: GameCardSlot) => void
      vi.spyOn(internal, 'createSlot')
        .mockResolvedValueOnce(slots[0])
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve
            })
        )
      const timeline = vi.spyOn(internal.animationScope, 'timeline')
      const update = vi.spyOn(CardDrawAnimation.prototype, 'update')
      let finished = false
      const pending = internal
        .presentEffectResolved({
          type: 'effect-resolved',
          revision: 1,
          sourceInstanceId: 'jouster',
          sourceCardId: asCardId('the_grand_tournament_gadgetzan_jouster'),
          controllerId: remote,
          action: 'joust',
          actionPath: 'test',
          cardReveal: {
            id: 'joust-1',
            cards,
            comparison: {
              winnerId: winner === 'local' ? local : winner ? remote : null
            }
          }
        })
        .then(() => {
          finished = true
        })
      await Promise.resolve()
      expect(update).not.toHaveBeenCalled()
      release(slots[1])
      for (let i = 0; i < 8; i++) await Promise.resolve()
      const flight = timeline.mock.results.at(-1)!.value as gsap.core.Timeline
      flight.pause()
      expect(internal.drawAnimations.size).toBe(2)
      expect(flight.duration()).toBeCloseTo(1 + (winner ? 0.24 : 0) + 0.5)
      flight.time(winner ? 1.12 : 1)
      if (winner)
        expect(
          update.mock.calls.some((call) => Math.abs((call[1] ?? 1) - 1.1) < 0.001)
        ).toBe(true)
      expect(finished).toBe(false)
      if (winner === 'interrupt') value.dispose()
      else flight.progress(1)
      await pending
      expect(slots.every((slot) => slot.destroyed)).toBe(true)
      expect(internal.drawAnimations.size).toBe(0)
      expect(internal.activeDepartureSlots.size).toBe(0)
    }
  )
})

describe('match interaction frame ordering', () => {
  it.each(['remove', 'reconcile'] as const)(
    'releases a dying selected attacker on %s and keeps pointer frames running',
    async (operation) => {
      const value = board()
      const internal = value as unknown as {
        options: { cursor?: unknown }
        session: GameBoardSession
        selectedCombatView: MinionView | null
        pendingBoardPointer: { globalX: number; globalY: number; target: null }
        insertLocalMinionView(position: number, view: MinionView): void
        removeMinionView(view: MinionView): void
        syncMinionRowAttackability(
          views: readonly MinionView[],
          state: OpeningMatchState,
          ownerId: PlayerId
        ): void
        selectAttacker(view: MinionView): void
        updateShadows(deltaMS: number): void
      }
      const cursor = {
        setTargeting: vi.fn(),
        setTargetingVisualScale: vi.fn(),
        setContextVariant: vi.fn(),
        setOverrideVariant: vi.fn()
      }
      internal.options.cursor = cursor
      const view = await MinionView.create(
        {
          label: 'selected-dying-highmane',
          attack: 6,
          health: 2,
          maxHealth: 5,
          legendary: false,
          taunt: false,
          enraged: false,
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: true,
          poisonous: false,
          aura: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
          lifesteal: false,
          elusive: false,
          immune: false
        },
        new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
        Texture.WHITE
      )
      view.instanceId = 'dying-highmane'
      view.ownerId = internal.session.localParticipantId
      internal.insertLocalMinionView(0, view)
      view.setCanAttack(true)
      view.setTargetable(true)
      view.setSelected(true)
      internal.selectedCombatView = view
      cursor.setTargeting(true)

      // The engine has already removed Highmane, while its view is still visible.
      if (operation === 'remove') internal.removeMinionView(view)
      else {
        internal.syncMinionRowAttackability(
          [view],
          internal.session.match.getState(),
          internal.session.localParticipantId
        )
        expect(view.isCanAttack()).toBe(false)
        expect(view.isTargetable()).toBe(false)
        internal.selectAttacker(view)
      }
      expect(internal.selectedCombatView).toBeNull()
      expect(cursor.setTargeting).toHaveBeenLastCalledWith(false)
      if (operation === 'remove') expect(view.destroyed).toBe(true)

      vi.spyOn(internal, 'updateShadows').mockImplementation(() => undefined)
      for (const globalX of [100, 300]) {
        internal.pendingBoardPointer = { globalX, globalY: 100, target: null }
        expect(() => value.updateFrame(16)).not.toThrow()
      }
      expect(cursor.setTargetingVisualScale).toHaveBeenCalledTimes(2)
    }
  )

  it('prepares only a stationary hover and lets pickup and scene warmup bypass its dwell', () => {
    const value = board()
    const internal = value as unknown as {
      hand: GameHandView
      updateLocalBoardPreview(point: { x: number; y: number }): void
    }
    vi.spyOn(internal, 'updateLocalBoardPreview').mockImplementation(() => undefined)
    const transforms = layoutHand(3)
    const entries = transforms.map((rest, index) => {
      const card = Object.assign(new Container(), {
        plan: { width: 620 },
        renderedHeight: 900,
        createAppearanceSnapshot: vi.fn(() =>
          RenderTexture.create({ width: 620, height: 900 })
        ),
        flushAppearanceSnapshot: vi.fn()
      })
      card.addChild(new Sprite(Texture.WHITE))
      const slot = Object.assign(mulliganSlot(`prepared-card-${index}`), {
        card,
        playableOutlineTexture: Texture.WHITE,
        suppressPlayableOutline: vi.fn(),
        isPlayableOutlineEnabled: () => true,
        getPlayableOutlinePalette: () => 'blue' as const,
        getPlayableOutlineTuning: () => undefined,
        getPlayableOutlinePreset: () => 'card' as const
      })
      slot.addChild(card)
      slot.position.set(rest.x, rest.y)
      internal.hand.layer.addChild(slot)
      const entry = {
        card: { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') },
        slot,
        restTransform: rest,
        displaced: false
      }
      internal.hand.append(entry)
      return entry
    })
    const drag = internal.hand.drag
    for (const index of [0, 1, 0, 2, 1]) {
      drag.prepare(entries[index]!.slot)
      drag.update(HAND_PREPARATION_DWELL_MS / 2)
    }
    for (const entry of entries)
      expect(entry.slot.card.createAppearanceSnapshot).not.toHaveBeenCalled()

    // A duplicate request for the same candidate must not restart its dwell.
    drag.prepare(entries[1]!.slot)
    drag.update(HAND_PREPARATION_DWELL_MS / 2 - 1)
    expect(entries[1]!.slot.card.createAppearanceSnapshot).not.toHaveBeenCalled()
    // A slow sweep can remain over one card longer than the dwell. Each move
    // postpones preparation even though that candidate has not changed.
    for (let move = 0; move < 3; move++) {
      drag.deferPreparation()
      drag.update(HAND_PREPARATION_DWELL_MS - 1)
      expect(entries[1]!.slot.card.createAppearanceSnapshot).not.toHaveBeenCalled()
    }
    drag.update(1)
    drag.update(HAND_PREPARATION_DWELL_MS)
    expect(entries[1]!.slot.card.createAppearanceSnapshot).toHaveBeenCalledOnce()

    drag.prepare(entries[0]!.slot)
    drag.update(HAND_PREPARATION_DWELL_MS - 1)
    drag.prepare(null)
    drag.update(HAND_PREPARATION_DWELL_MS)
    expect(entries[0]!.slot.card.createAppearanceSnapshot).not.toHaveBeenCalled()

    const picked = entries[2]!
    drag.prepare(picked.slot)
    drag.begin(2, picked.restTransform, 17)
    expect(picked.slot.card.createAppearanceSnapshot).not.toHaveBeenCalled()
    drag.update(1)
    expect(picked.slot.card.createAppearanceSnapshot).toHaveBeenCalledOnce()
    expect(picked.slot.card.visible).toBe(false)
    drag.releaseForTargeting(picked)

    drag.prepare(entries[0]!.slot, true)
    drag.update(1)
    expect(entries[0]!.slot.card.createAppearanceSnapshot).toHaveBeenCalledOnce()
  })

  it('rebuilds changed held-card bounds without losing tilt or shadow ownership', () => {
    const value = board()
    const { options } = value as unknown as { options: GameBoardViewOptions }
    const pool = new HandCardPerspectivePool(options.renderer)
    const slot = mulliganSlot('changed-appearance')
    const card = Object.assign(new Container(), {
      plan: { width: 620 },
      renderedHeight: 900,
      appearanceRevision: 0,
      createAppearanceSnapshot: (
        _renderer: unknown,
        frame: { width: number; height: number }
      ) => RenderTexture.create({ width: frame.width, height: frame.height }),
      flushAppearanceSnapshot: vi.fn()
    })
    const artwork = new Sprite(Texture.WHITE)
    artwork.width = 620
    artwork.height = 900
    card.addChild(artwork)
    slot.addChild(card)
    try {
      const held = pool.acquire(card as unknown as CardView)
      held.setTarget({ x: 0.4, y: -0.25 })
      held.update()
      const oldMesh = slot.children.find(
        (child) => child instanceof PerspectiveMesh
      ) as PerspectiveMesh
      const geometry = vi.spyOn(oldMesh.geometry, 'destroy')
      artwork.width = 700
      card.appearanceRevision += 1
      held.update()
      pool.flush()
      const mesh = slot.children.find(
        (child) => child instanceof PerspectiveMesh
      ) as PerspectiveMesh
      expect(mesh).not.toBe(oldMesh)
      expect(geometry).toHaveBeenCalledExactlyOnceWith(true)
      expect(card.visible).toBe(false)
      expect(getShadowCaster(slot)?.visual).toBe(mesh)
      expect(held.captureCorners().topLeft).not.toEqual({ x: 0, y: 0 })
      pool.release(held)
      expect(card.visible).toBe(true)
      expect(getShadowCaster(slot)?.visual).toBe(card)
    } finally {
      pool.dispose()
      slot.destroy({ children: true })
    }
  })

  it('bounds prepared drag resources and keeps the last held card ready', () => {
    const value = board()
    const { options } = value as unknown as { options: GameBoardViewOptions }
    const pool = new HandCardPerspectivePool(options.renderer)
    const parent = new Container()
    const textures: RenderTexture[] = []
    const cards = [0, 1, 2].map(() => {
      const card = Object.assign(new Container(), {
        plan: { width: 620 },
        renderedHeight: 900,
        createAppearanceSnapshot: () => {
          const texture = RenderTexture.create({ width: 620, height: 900 })
          textures.push(texture)
          return texture
        },
        flushAppearanceSnapshot: vi.fn()
      })
      card.addChild(new Sprite(Texture.WHITE))
      parent.addChild(card)
      return card as unknown as CardView
    })
    try {
      pool.prepare(cards[0]!)
      const held = pool.acquire(cards[0]!)
      pool.release(held)
      pool.prepare(cards[1]!)
      pool.prepare(cards[2]!)
      expect(textures.map((texture) => texture.destroyed)).toEqual([false, true, false])
      expect(pool.acquire(cards[0]!)).toBe(held)
      pool.release(held)
      cards[0]!.destroy({ children: true })
      expect(textures[0]!.destroyed).toBe(true)
    } finally {
      pool.dispose()
      parent.destroy({ children: true })
    }
    expect(textures.every((texture) => texture.destroyed)).toBe(true)
  })

  it('processes gesture evidence immediately and board visuals once before shadows', () => {
    const value = board()
    const internal = value as unknown as {
      hand: GameHandView
      updateTargetGesture(event: FederatedPointerEvent): void
      updateHeroPowerHover(point: { x: number; y: number } | null): void
      flushBoardPointerVisuals(): void
    }
    const order: string[] = []
    const gesture = vi
      .spyOn(internal, 'updateTargetGesture')
      .mockImplementation(() => undefined)
    const hover = vi
      .spyOn(internal, 'updateHeroPowerHover')
      .mockImplementation(() => order.push('pointer'))
    vi.spyOn(internal.hand.drag, 'update').mockImplementation(() => order.push('drag'))
    vi.spyOn(value, 'updateShadows').mockImplementation(() => order.push('shadow'))
    expect(value.listenerCount('pointermove')).toBe(0)
    expect(value.listenerCount('globalpointermove')).toBe(1)
    for (const x of [800, 900])
      value.emit('globalpointermove', {
        pointerId: 1,
        globalX: x,
        globalY: 600,
        target: value
      } as unknown as FederatedPointerEvent)
    expect(gesture).toHaveBeenCalledTimes(2)
    expect(hover).not.toHaveBeenCalled()
    value.updateFrame(16)
    expect(order).toEqual(['drag', 'pointer', 'shadow'])
    expect(hover).toHaveBeenCalledExactlyOnceWith({ x: 900, y: 600 })
    value.updateFrame(16)
    expect(hover).toHaveBeenCalledOnce()
  })

  it('caches CSS bounds and converts logical renderer points independently of DPI', () => {
    const value = board()
    const internal = value as unknown as {
      options: GameBoardViewOptions
      toRendererPoint(x: number, y: number): { x: number; y: number }
      toCursorTargetPoint(x: number, y: number): { x: number; y: number }
      invalidateCanvasBounds(): void
    }
    const rect = vi
      .spyOn(internal.options.renderer.canvas, 'getBoundingClientRect')
      .mockReturnValue({ left: 20, top: 10, width: 960, height: 540 } as DOMRect)
    Object.assign(internal.options.renderer, {
      width: 3840,
      height: 2160,
      resolution: 2
    })
    expect(internal.toRendererPoint(500, 280)).toEqual({ x: 960, y: 540 })
    expect(internal.toCursorTargetPoint(960, 540)).toEqual({ x: 500, y: 280 })
    expect(rect).toHaveBeenCalledOnce()
    internal.invalidateCanvasBounds()
    internal.toRendererPoint(500, 280)
    expect(rect).toHaveBeenCalledTimes(2)
  })

  it('flushes the actual outside-release coordinates before resolving a carried card', () => {
    const value = board()
    const internal = value as unknown as {
      hand: GameHandView
      handleWindowPointerUp(event: PointerEvent): void
      releaseTargetGesture(): boolean
      requiresSeparatePlacementClick(): boolean
      resolveCardDrop(point: { x: number; y: number }): void
      flushBoardPointerVisuals(): void
    }
    const slot = mulliganSlot('released-card')
    internal.hand.layer.addChild(slot)
    internal.hand.append({
      card: { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') },
      slot,
      restTransform: layoutHand(1)[0],
      displaced: false
    })
    internal.hand.layer.scale.set(2)
    let latest = { x: 400, y: 900 }
    vi.spyOn(internal.hand.drag, 'index', 'get').mockReturnValue(0)
    vi.spyOn(internal.hand.drag, 'returning', 'get').mockReturnValue(false)
    vi.spyOn(internal.hand.drag, 'ownsPointer').mockImplementation((id) => id === 7)
    vi.spyOn(internal.hand.drag, 'movedBeyondThreshold', 'get').mockReturnValue(true)
    vi.spyOn(internal.hand.drag, 'pointer', 'get').mockImplementation(() => latest)
    const flush = vi
      .spyOn(internal.hand.drag, 'flushPointer')
      .mockImplementation((point) => {
        latest = { ...point }
      })
    vi.spyOn(internal, 'releaseTargetGesture').mockReturnValue(false)
    vi.spyOn(internal, 'requiresSeparatePlacementClick').mockReturnValue(false)
    vi.spyOn(internal, 'flushBoardPointerVisuals').mockImplementation(() => undefined)
    const drop = vi
      .spyOn(internal, 'resolveCardDrop')
      .mockImplementation(() => undefined)
    internal.handleWindowPointerUp({
      button: 0,
      pointerId: 7,
      clientX: 1400,
      clientY: 650
    } as PointerEvent)
    expect(flush).toHaveBeenCalledWith(expect.objectContaining({ x: 700, y: 325 }), 7)
    expect(drop).toHaveBeenCalledWith({ x: 700, y: 325 })
  })

  it.each(['down', 'up', 'board-up'] as const)(
    'ignores another pointer %s while carrying a card',
    (kind) => {
      const value = board()
      const internal = value as unknown as {
        hand: GameHandView
        handleWindowPointerDown(event: PointerEvent): void
        handleWindowPointerUp(event: PointerEvent): void
        handleBoardPointerUp(event: FederatedPointerEvent): void
        resolveCardDrop(point: { x: number; y: number }): void
        requiresSeparatePlacementClick(): boolean
        updateLocalBoardPreview(point: { x: number; y: number }): void
        flushBoardPointerVisuals(): void
      }
      const slot = Object.assign(mulliganSlot('owned-drag'), {
        suppressPlayableOutline: vi.fn()
      })
      const rest = layoutHand(1)[0]!
      slot.position.set(rest.x, rest.y)
      internal.hand.layer.addChild(slot)
      internal.hand.append({
        card: { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') },
        slot,
        restTransform: rest,
        displaced: false
      })
      vi.spyOn(internal, 'updateLocalBoardPreview').mockImplementation(() => undefined)
      vi.spyOn(internal, 'flushBoardPointerVisuals').mockImplementation(() => undefined)
      vi.spyOn(internal, 'requiresSeparatePlacementClick').mockReturnValue(false)
      const drop = vi
        .spyOn(internal, 'resolveCardDrop')
        .mockImplementation(() => undefined)
      internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 7)
      const carriedPoint = { x: rest.x, y: 600 }
      internal.hand.drag.flushPointer(carriedPoint, 7)
      const flush = vi.spyOn(internal.hand.drag, 'flushPointer')
      const event = {
        button: 0,
        pointerId: 8,
        clientX: 1100,
        clientY: 700,
        globalX: 1100,
        globalY: 700,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      }
      const handle = (pointerId: number) => {
        const sample = { ...event, pointerId }
        if (kind === 'down')
          internal.handleWindowPointerDown(sample as unknown as PointerEvent)
        else if (kind === 'up')
          internal.handleWindowPointerUp(sample as unknown as PointerEvent)
        else internal.handleBoardPointerUp(sample as unknown as FederatedPointerEvent)
      }
      expect(internal.hand.drag.ownsPointer(7)).toBe(true)
      expect(internal.hand.drag.movedBeyondThreshold).toBe(true)
      handle(8)
      expect(flush).not.toHaveBeenCalled()
      expect(drop).not.toHaveBeenCalled()
      expect(internal.hand.drag.pointer).toEqual(carriedPoint)
      expect(internal.hand.drag.index).toBe(0)
      handle(7)
      expect(flush).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ x: 1100, y: 700 }),
        7
      )
      if (kind === 'board-up') expect(drop).not.toHaveBeenCalled()
      else expect(drop).toHaveBeenCalledExactlyOnceWith({ x: 1100, y: 700 })
    }
  )

  it('resolves insertion once without cloning match state for an unchanged pointer sample', () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      hand: GameHandView
      updateLocalBoardPreview(point: { x: number; y: number }): void
      resolveLocalBoardPreview(point: { x: number; y: number }): number | null
    }
    const owner = internal.session.localParticipantId
    const slot = mulliganSlot('preview-card')
    internal.hand.append({
      card: { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') },
      slot,
      restTransform: layoutHand(1)[0],
      displaced: false
    })
    const input: PlayCardInput = {
      participantId: owner,
      cardInstanceId: slot.instanceId,
      cardId: asCardId('classic_wisp'),
      currentCost: 0,
      requiresPosition: true,
      legalPositions: [0],
      targetSelectors: [],
      legalTargetOptions: [],
      choiceCount: 0,
      legalChoices: [],
      choiceOptions: [],
      choiceTiming: 'before-play',
      skipTargetedBattlecry: false,
      effectPreview: null
    }
    const legality = internal.session.match.getLegality!(owner)
    vi.spyOn(internal.session.match, 'getPlayInput').mockReturnValue(input)
    vi.spyOn(internal.session.match, 'getLegality').mockReturnValue({
      ...legality,
      playableCardInstanceIds: [slot.instanceId]
    })
    vi.spyOn(internal.hand.drag, 'index', 'get').mockReturnValue(0)
    const state = vi.spyOn(internal.session.match, 'getState')
    const resolve = vi.spyOn(internal, 'resolveLocalBoardPreview')
    const outline = vi
      .spyOn(internal.hand.drag, 'setDropAllowed')
      .mockImplementation(() => undefined)
    internal.updateLocalBoardPreview({ x: 985, y: 610 })
    expect(resolve).toHaveBeenCalledOnce()
    expect(state).not.toHaveBeenCalled()
    expect(outline).toHaveBeenCalledWith(true)
  })
})

describe('Golden Monkey hand presentation', () => {
  it('flips every existing slot in parallel and keeps transformed hand order', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      hand: GameHandView
      activePresentationState: OpeningMatchState | null
      createCardPresentation(
        card: OpeningCard
      ): Promise<{ card: unknown; outlineTexture: Texture }>
      presentGoldenMonkeyHandReplacement(replacement: {
        sourceInstanceId: string
        targetInstanceIds: ReadonlySet<string>
      }): Promise<void>
    }
    const initialState = internal.session.getState()
    const localId = internal.session.localParticipantId
    const localPlayer = initialState.players.find(
      (player) => player.participantId === localId
    )!
    const transformedIds = localPlayer.hand.map((card) => card.instanceId)
    const transformedState = {
      ...initialState,
      players: initialState.players.map((player) =>
        player.participantId === localId
          ? {
              ...player,
              hand: player.hand.map((card) => ({
                ...card,
                cardId: asCardId('classic_alakir_the_windlord')
              }))
            }
          : player
      )
    } as unknown as OpeningMatchState
    internal.activePresentationState = transformedState

    const entries = localPlayer.hand.map((card) => {
      const slot = mulliganSlot(card.instanceId)
      internal.hand.append({
        card: { ...card },
        slot,
        restTransform: undefined,
        displaced: false
      })
      internal.hand.layer.addChild(slot)
      return { card, slot }
    })
    const createCardPresentation = vi
      .spyOn(internal, 'createCardPresentation')
      .mockImplementation(async () => ({
        card: Object.assign(new Container(), { enableTextureCache: vi.fn() }),
        outlineTexture: Texture.WHITE
      }))
    vi.spyOn(internal.hand, 'configureSlot').mockImplementation(() => undefined)

    await internal.presentGoldenMonkeyHandReplacement({
      sourceInstanceId: 'golden-monkey',
      targetInstanceIds: new Set(transformedIds)
    })

    expect(createCardPresentation).toHaveBeenCalledTimes(entries.length)
    expect(internal.hand.entries.map((entry) => entry.card.cardId)).toEqual(
      entries.map(() => asCardId('classic_alakir_the_windlord'))
    )
    expect(internal.hand.entries.map((entry) => entry.slot)).toEqual(
      entries.map(({ slot }) => slot)
    )
    for (const { slot } of entries) {
      expect(slot.prepareCardReplacement).toHaveBeenCalledTimes(1)
      expect(slot.flipToCardReplacement).toHaveBeenCalledWith(
        RESOLUTION_TIMING.handReplacementFlip
      )
    }
  })
})

describe('remote card choices', () => {
  it('hides the board inspection toggle while the remote Discover is active', async () => {
    const value = board()
    const internal = value as unknown as {
      cardSelectionOverlay: CardSelectionOverlay
    }
    const overlay = internal.cardSelectionOverlay
    await overlay.showRemoteDiscover(
      [0, 1, 2].map((index) => ({
        instanceId: `remote-choice-${index}`,
        cardId: asCardId('basic_fireball'),
        zone: 'revealed' as const,
        revealed: true
      }))
    )

    expect(overlay.getChildByLabel('game.card-selection.toggle')?.visible).toBe(false)
    expect(overlay.getChildByLabel('game.card-selection.toggle-outline')?.visible).toBe(
      false
    )

    overlay.clear()
    expect(overlay.getChildByLabel('game.card-selection.toggle')?.visible).toBe(true)
    expect(overlay.getChildByLabel('game.card-selection.toggle-outline')?.visible).toBe(
      true
    )
  })

  it('shows remote Discover backs non-modally near the top edge without dimming', async () => {
    const value = board()
    const internal = value as unknown as {
      cardSelectionOverlay: CardSelectionOverlay
    }
    const overlay = internal.cardSelectionOverlay
    await overlay.showRemoteDiscover(
      [0, 1, 2].map((index) => ({
        instanceId: `remote-choice-${index}`,
        cardId: asCardId('basic_fireball'),
        zone: 'revealed' as const,
        revealed: true
      }))
    )

    const { remoteDiscover } = GAME_BOARD_LAYOUT.cardSelection
    const darkOverlay = overlay.getChildByLabel(
      'game.card-selection.dark-overlay'
    ) as Graphics
    expect(darkOverlay.alpha).toBe(0)
    expect(darkOverlay.eventMode).toBe('none')

    const cardsLayer = overlay.getChildByLabel('game.card-selection.cards')!
    const backs = ['remote-choice-0', 'remote-choice-1', 'remote-choice-2'].map(
      (instanceId) =>
        cardsLayer.getChildByLabel(
          `game.card-selection.remote-discover:${instanceId}`
        ) as Sprite
    )
    for (const [index, back] of backs.entries()) {
      expect(back.x).toBe(remoteDiscover.centerX + (index - 1) * remoteDiscover.gap)
      expect(back.y).toBe(remoteDiscover.baselineY)
      expect(back.scale.x).toBe(remoteDiscover.scale)
      expect(back.scale.y).toBe(remoteDiscover.scale)
      expect(back.alpha).toBe(1)
      expect(back.eventMode).toBe('none')
      expect(getShadowCaster(back)?.restingHeight).toBe(remoteDiscover.shadowHeight)
    }

    overlay.clear()
    expect(darkOverlay.alpha).toBe(1)
    expect(darkOverlay.eventMode).toBe('static')
  })
})

describe('skipped match opening', () => {
  it('settles the board and both opening hands without an intro animation', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      openingLayer: Container
      remoteHandLayer: Container
      remoteBacks: Sprite[]
      heroViews: Map<PlayerId, HeroView>
      hand: GameHandView
      prepareStartedMatch(): Promise<void>
      wait(duration: number): Promise<void>
      syncTurnHud(state: OpeningMatchState): void
      handleTurnStarted(participantId: PlayerId): void
    }
    const scenario = createMatchScenario()
    internal.session = new GameBoardSession({
      setup: { ...scenario.setup, skipMulligan: true },
      decks: scenario.decks
    })
    const state = internal.session.getState()
    expect(state.phase).toBe('turns')

    for (const player of state.players) {
      const hero = Object.assign(new Container(), {
        setBaseScale: vi.fn(),
        setHealthVisible: vi.fn()
      }) as unknown as HeroView
      internal.heroViews.set(player.participantId, hero)
    }
    const remote = state.players.find(
      (player) => player.participantId === internal.session.remoteParticipantId
    )!
    internal.remoteHandLayer.visible = false
    for (let index = 0; index < remote.hand.length; index++) {
      const back = new Sprite(Texture.WHITE)
      back.alpha = 0
      internal.remoteBacks.push(back)
      internal.remoteHandLayer.addChild(back)
    }
    const slot = mulliganSlot('opening-local')
    slot.alpha = 0
    internal.hand.append({
      card: {
        instanceId: slot.instanceId,
        cardId: asCardId('basic_acidic_swamp_ooze')
      },
      slot,
      restTransform: undefined,
      displaced: false
    })
    vi.spyOn(internal.hand, 'configureSlot').mockImplementation(() => undefined)

    await internal.prepareStartedMatch()
    expect(internal.openingLayer.visible).toBe(false)
    expect(internal.remoteHandLayer.visible).toBe(true)
    expect(internal.remoteBacks).toHaveLength(remote.hand.length)
    expect(internal.remoteBacks.every((back) => back.alpha === 1)).toBe(true)
    expect(slot.parent).toBe(internal.hand.layer)
    expect(slot.alpha).toBe(1)
    expect(internal.hand.entries[0].restTransform).toBeDefined()
    expect(internal.hand.active).toBe(true)
    for (const [participantId, hero] of internal.heroViews) {
      const placement =
        participantId === internal.session.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.local
          : GAME_BOARD_LAYOUT.heroes.remote
      expect(hero.position).toMatchObject(placement.position)
      expect(hero.scale.x).toBe(placement.scale?.x ?? 1)
      expect(hero.setBaseScale).toHaveBeenCalledWith(placement.scale?.x ?? 1)
      expect(hero.setHealthVisible).toHaveBeenCalledWith(true)
    }

    const wait = vi.spyOn(internal, 'wait')
    const syncTurnHud = vi
      .spyOn(internal, 'syncTurnHud')
      .mockImplementation(() => undefined)
    const handleTurnStarted = vi
      .spyOn(internal, 'handleTurnStarted')
      .mockImplementation(() => undefined)
    await value.playOpeningReveal()
    expect(wait).not.toHaveBeenCalled()
    expect(syncTurnHud).toHaveBeenCalledWith(state)
    expect(handleTurnStarted).toHaveBeenCalledWith(state.activePlayerId)
  })
})

describe('character indicator tracking', () => {
  function setup() {
    const value = board()
    const internal = value as unknown as {
      combat: GameCombatPresentation
      boardPositions: BoardPositionController
      heroViews: Map<PlayerId, HeroView>
      session: GameBoardSession
      createHeroes(state: OpeningMatchState): void
    }
    internal.createHeroes(internal.session.getState())
    const render = (): void => {
      internal.combat.indicatorLayer.onRender?.(undefined as never)
    }
    const minion = (id: string): MinionView =>
      Object.assign(new Container(), {
        instanceId: id,
        setBaseScale: vi.fn(),
        isSelected: () => false
      }) as unknown as MinionView
    return { value, ...internal, render, minion }
  }

  it.each(['local', 'remote'] as const)(
    'follows simultaneous damage and healing throughout a %s summon row shift',
    async (side) => {
      const { combat, boardPositions, render, minion } = setup()
      const first = minion('first')
      const second = minion('second')
      boardPositions.insert(side, 0, first)
      boardPositions.insert(side, 1, second)
      const initial = boardPositions.layout(side)
      for (const view of [first, second])
        for (const tween of gsap.getTweensOf(view)) tween.progress(1)
      await initial
      const heal = combat.showHealIndicator(first, 2)!
      const damage = combat.showDamageIndicator(second, 3)!
      const startingX = heal.x
      boardPositions.reserve(side, 'summon', 2)
      const shifting = boardPositions.layout(side)
      const shifts = [first, second].flatMap((view) => gsap.getTweensOf(view))
      for (const progress of [0.25, 0.5, 1]) {
        for (const tween of shifts) tween.progress(progress)
        render()
        expect(heal.x).toBeCloseTo(first.x)
        expect(heal.y).toBeCloseTo(first.y - 15)
        expect(damage.x).toBeCloseTo(second.x)
        expect(damage.y).toBeCloseTo(second.y - 15)
      }
      await shifting
      expect(heal.x).not.toBe(startingX)
      const summoned = minion('summon')
      const landing = boardPositions.entrancePosition(side, 'summon')
      summoned.position.set(landing.x, landing.y)
      boardPositions.insert(side, 2, summoned)
      boardPositions.finishEntrance(side, 'summon')
      render()
      expect(heal.x).toBeCloseTo(first.x)
      expect(damage.x).toBeCloseTo(second.x)
    }
  )

  it('follows heroes through transformed combat parents and reparenting', () => {
    const { combat, heroViews, render } = setup()
    const [attacker, defender] = [...heroViews.values()]
    const originalParent = attacker.parent!
    const damage = combat.showDamageIndicator(attacker, 2)!
    const heal = combat.showHealIndicator(defender, 2)!
    combat.layer.position.set(100, -40)
    combat.layer.scale.set(0.8)
    combat.layer.rotation = 0.1
    combat.indicatorLayer.position.set(-50, 25)
    combat.indicatorLayer.scale.set(1.2)
    combat.layer.reparentChild(attacker)
    for (const returning of [false, true]) {
      if (returning) originalParent.reparentChild(attacker)
      attacker.x += 80
      defender.y += 30
      render()
      for (const [view, indicator] of [
        [attacker, damage],
        [defender, heal]
      ] as const) {
        const expected = combat.indicatorLayer.toLocal(view.getGlobalPosition())
        expect(indicator.x).toBeCloseTo(expected.x)
        expect(indicator.y).toBeCloseTo(expected.y - 5)
      }
    }
  })

  it.each(['detach', 'destroy', 'ancestor-detach'] as const)(
    'finishes at the last position after source %s without following replacements',
    (removal) => {
      const { combat, minion, render } = setup()
      const parent = new Container()
      combat.indicatorLayer.parent!.addChild(parent)
      const source = minion('source')
      parent.addChild(source)
      source.position.set(500, 600)
      const indicator = combat.showHealIndicator(source, 2)!
      const timeline = gsap.getTweensOf(indicator)[0]!.parent!
      timeline.progress(0.3)
      source.x += 50
      render()
      const last = indicator.position.clone()
      if (removal === 'destroy') source.destroy()
      else if (removal === 'detach') source.removeFromParent()
      else parent.removeFromParent()
      render()
      expect(combat.indicatorLayer.onRender).toBeTypeOf('function')
      const replacement = minion('source')
      combat.indicatorLayer.parent!.addChild(replacement)
      replacement.position.set(1000, 200)
      if (!source.destroyed) source.position.set(900, 100)
      render()
      expect(indicator.position).toMatchObject({ x: last.x, y: last.y })
      expect(indicator.destroyed).toBe(false)
      timeline.progress(1)
      expect(indicator.destroyed).toBe(true)
      if (!source.destroyed) source.destroy()
      parent.destroy({ children: true })
    }
  )

  it.each(['complete', 'interrupt', 'destroy', 'dispose'] as const)(
    'releases tracking and animations on %s, preserving pause/resume',
    (ending) => {
      const { value, combat, heroViews, render } = setup()
      const source = [...heroViews.values()][0]!
      const indicator = combat.showDamageIndicator(source, 2)!
      const scale = indicator.scale
      const timeline = gsap.getTweensOf(indicator)[0]!.parent!
      timeline.progress(0.3)
      value.pauseAnimations()
      expect(timeline.paused()).toBe(true)
      render()
      expect(indicator.destroyed).toBe(false)
      value.resumeAnimations()
      expect(timeline.paused()).toBe(false)
      if (ending === 'complete') timeline.progress(1)
      else if (ending === 'interrupt') timeline.kill()
      else if (ending === 'destroy') indicator.destroy({ children: true })
      else value.dispose()
      expect(indicator.destroyed).toBe(true)
      if (ending === 'dispose') expect(combat.indicatorLayer.onRender).toBeNull()
      else expect(combat.indicatorLayer.onRender).toBeTypeOf('function')
      expect(gsap.getTweensOf([indicator, scale])).toHaveLength(0)
      if (ending !== 'dispose') {
        const pause = vi.spyOn(timeline, 'pause')
        value.pauseAnimations()
        expect(pause).not.toHaveBeenCalled()
      }
    }
  )

  it('does not skip another render callback when the last source disappears', () => {
    const { combat, heroViews } = setup()
    const root = combat.indicatorLayer.parent!
    root.enableRenderGroup()
    const source = [...heroViews.values()][0]!
    combat.showHealIndicator(source, 2)
    const other = new Container()
    root.addChild(other)
    const rendered = vi.fn()
    other.onRender = rendered
    source.removeFromParent()
    root.renderGroup!.runOnRender(undefined as never)
    expect(rendered).toHaveBeenCalledOnce()
  })
})

describe('AI decision overlap', () => {
  it.each(['fast', 'slow', 'stale', 'exit', 'choice', 'failure', 'baseline'])(
    'preserves execution barriers for a %s response',
    async (mode) => {
      vi.stubEnv('VITE_AI_OVERLAP', mode === 'baseline' ? '0' : '1')
      let release!: () => void
      const animation = new Promise<void>((resolve) => {
        release = resolve
      })
      let reply!: (value: typeof decision | null) => void
      const response = new Promise<typeof decision | null>((resolve) => {
        reply = resolve
      })
      const decision = { command: { type: 'end-turn' }, expectedRevision: 0 }
      let state = {
        phase: 'turns',
        activePlayerId: 'ai',
        revision: 0,
        pendingDiscover: undefined as object | undefined
      }
      const order: string[] = []
      const controller = {
        chooseTurnAction: vi
          .fn()
          .mockImplementationOnce(async () => decision)
          .mockImplementation(() => {
            order.push('request')
            expect(state.revision).toBe(1)
            expect(order).toContain('record')
            return response
          }),
        recordExecution: vi.fn(() => {
          order.push('record')
        }),
        recordTiming: vi.fn(),
        isCurrent: vi.fn(() => {
          if (mode === 'stale' && state.revision === 1) {
            harness.turnLayer.visible = false
            return false
          }
          return true
        }),
        isAbandoned: false,
        hasLegalActions: () => false
      }
      const harness = {
        destroyed: false,
        aiTurnRunning: false,
        aiController: controller,
        remoteParticipantId: 'ai',
        turnLayer: { visible: true },
        match: { getState: () => state },
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined
        },
        showOpponentLeft: () => undefined,
        wait: async () => undefined,
        waitForResolutionIdle: async () => undefined,
        findPlayer: () => ({ hand: [] }),
        dispatchCommand: vi.fn(() => {
          state = {
            ...state,
            revision: state.revision + 1,
            phase: state.revision ? 'ended' : 'turns',
            pendingDiscover: mode === 'choice' ? { participantId: 'ai' } : undefined
          }
          return { accepted: true, state, events: [] }
        }),
        syncTurnHud: () => undefined,
        syncTurnControls: () => undefined,
        syncSecrets: () => undefined,
        presentResolutionEvents: () => undefined,
        enqueuePresentation: vi.fn(async () => {
          order.push('animation')
          if (state.revision === 1) await animation
        })
      }
      const run = (
        GameBoardView.prototype as unknown as { scheduleAiTurn(): Promise<void> }
      ).scheduleAiTurn.call(harness)
      await vi.waitFor(() =>
        expect(harness.enqueuePresentation).toHaveBeenCalledTimes(1)
      )
      expect(controller.chooseTurnAction).toHaveBeenCalledTimes(
        mode === 'choice' || mode === 'baseline' ? 1 : 2
      )
      if (mode === 'fast') reply(decision)
      if (mode === 'exit') harness.destroyed = true
      if (mode === 'failure') {
        controller.isAbandoned = true
        reply(null)
      }
      await Promise.resolve()
      expect(harness.dispatchCommand).toHaveBeenCalledTimes(1)
      release()
      if (mode === 'slow' || mode === 'choice' || mode === 'baseline') {
        await vi.waitFor(() =>
          expect(controller.chooseTurnAction).toHaveBeenCalledTimes(2)
        )
        expect(harness.dispatchCommand).toHaveBeenCalledTimes(1)
      }
      reply(decision)
      await run
      expect(harness.dispatchCommand).toHaveBeenCalledTimes(
        ['fast', 'slow', 'choice', 'baseline'].includes(mode) ? 2 : 1
      )
      expect(controller.chooseTurnAction).toHaveBeenCalledTimes(2)
      vi.unstubAllEnvs()
    }
  )

  it('starts the first AI request before turn-start presentation finishes', async () => {
    vi.stubEnv('VITE_AI_OVERLAP', '1')
    let releaseIdle!: () => void
    const idle = new Promise<void>((resolve) => {
      releaseIdle = resolve
    })
    const decision = { command: { type: 'end-turn' }, expectedRevision: 0 }
    let state = {
      phase: 'turns',
      activePlayerId: 'ai',
      revision: 0
    }
    const controller = {
      chooseTurnAction: vi.fn().mockResolvedValue(decision),
      recordExecution: vi.fn(),
      recordTiming: vi.fn(),
      isCurrent: () => true,
      isAbandoned: false,
      hasLegalActions: () => false
    }
    const harness = {
      destroyed: false,
      aiTurnRunning: false,
      aiController: controller,
      remoteParticipantId: 'ai',
      turnLayer: { visible: true },
      match: {
        getState: () => state
      },
      wait: async () => undefined,
      waitForResolutionIdle: () => idle,
      findPlayer: () => ({ hand: [] }),
      dispatchCommand: vi.fn(() => {
        state = {
          phase: 'turns',
          activePlayerId: 'human-player',
          revision: 1
        }
        return { accepted: true, state, events: [] }
      }),
      syncTurnHud: () => undefined,
      syncTurnControls: () => undefined,
      syncSecrets: () => undefined,
      presentResolutionEvents: () => undefined,
      enqueuePresentation: vi.fn(async () => undefined)
    }
    const run = (
      GameBoardView.prototype as unknown as { scheduleAiTurn(): Promise<void> }
    ).scheduleAiTurn.call(harness)
    await vi.waitFor(() => expect(controller.chooseTurnAction).toHaveBeenCalledTimes(1))
    expect(harness.dispatchCommand).not.toHaveBeenCalled()
    releaseIdle()
    await run
    expect(harness.dispatchCommand).toHaveBeenCalledTimes(1)
    vi.unstubAllEnvs()
  })
})

describe('post-combat choices', () => {
  it.each(['choice', 'match ended', 'disposed'])(
    'waits for combat return and reconciliation before showing Adapt (%s)',
    async (ending) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        presentResolutionEvents(events: readonly OpeningMatchEvent[]): Promise<void>
        presentEvent(event: OpeningMatchEvent): Promise<void>
        reconcileWeaponViews(): Promise<void>
        reconcileEffectMovement(): Promise<void>
        syncLocalHandCards(): void
        syncBoardMinionPresentation(): void
        syncBoardHeroPresentation(): void
        syncBoardAttackability(): void
        matchResultShown: boolean
      }
      let returnHome!: () => void
      const returning = new Promise<void>((resolve) => {
        returnHome = resolve
      })
      const order: string[] = []
      const present = vi
        .spyOn(internal, 'presentEvent')
        .mockImplementation(async (event) => {
          if (event.type === 'character-combat-resolved') {
            await returning
            order.push('returned')
          }
          if (event.type === 'card-choice-started') order.push('choice')
        })
      vi.spyOn(internal, 'reconcileWeaponViews').mockResolvedValue()
      vi.spyOn(internal, 'reconcileEffectMovement').mockImplementation(async () => {
        order.push('reconciled')
      })
      for (const method of [
        'syncLocalHandCards',
        'syncBoardMinionPresentation',
        'syncBoardHeroPresentation',
        'syncBoardAttackability'
      ] as const)
        vi.spyOn(internal, method).mockImplementation(() => {})
      if (ending === 'match ended') {
        const state = internal.session.getState()
        vi.spyOn(internal.session.match, 'getState').mockReturnValue({
          ...state,
          phase: 'ended'
        })
      }
      const events = [
        { type: 'combat-started', combatId: 'adapt-combat' },
        {
          type: 'card-choice-started',
          participantId: internal.session.localParticipantId,
          sourceCardInstanceId: 'fledgling',
          sourceCardId: asCardId('journey_to_ungoro_vicious_fledgling'),
          options: []
        },
        { type: 'character-combat-resolved', combatId: 'adapt-combat' }
      ] as OpeningMatchEvent[]
      const playing = internal.presentResolutionEvents(events)
      await Promise.resolve()
      expect(
        present.mock.calls.some(([event]) => event.type === 'card-choice-started')
      ).toBe(false)
      if (ending === 'disposed') value.dispose()
      returnHome()
      await playing
      if (ending === 'choice')
        expect(order).toEqual(['returned', 'reconciled', 'choice'])
      else expect(order).not.toContain('choice')
    }
  )
})

describe('random spell playback', () => {
  function playback() {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      hand: GameHandView
      presentAcceptedMinionPlay(
        entry: HandEntry,
        result: Extract<ReturnType<GameBoardSession['dispatch']>, { accepted: true }>
      ): Promise<void>
      randomSpellRevision: number | null
      randomSpellState: OpeningMatchState | null
      presentationState(): OpeningMatchState
      dispatchCommand(command: unknown): ReturnType<GameBoardSession['dispatch']>
      enqueuePresentation(
        state: OpeningMatchState,
        job: () => Promise<void>
      ): Promise<void>
      presentResolutionEvents(events: readonly OpeningMatchEvent[]): Promise<void>
      presentEffectResolved(event: OpeningMatchEvent): Promise<void>
      reconcileRandomSpellState(state: OpeningMatchState): Promise<void>
      reconcileWeaponViews(state: OpeningMatchState): Promise<void>
      reconcileEffectMovement(state: OpeningMatchState): Promise<void>
      syncBoardMinionPresentation(state: OpeningMatchState): void
      syncBoardHeroPresentation(state: OpeningMatchState): void
      syncBoardAttackability(state: OpeningMatchState): void
      syncTurnHud(state: OpeningMatchState): void
      syncTurnControls(state: OpeningMatchState): void
      waitForResolutionIdle(): Promise<void>
      remoteCardPlayPreview: RemoteCardPlayPreview
      secretRevealView: SecretRevealView
      secretZoneView: SecretZoneView
      syncSecrets(state: OpeningMatchState): void
    }
    const state = internal.session.getState()
    const owner = internal.session.localParticipantId
    const before = { ...state, revision: state.revision + 1 }
    const middle = { ...before, turnNumber: 10 }
    const after = { ...before, turnNumber: 20 }
    const boundary = (
      type: 'random-spell-started' | 'random-spell-completed',
      castId: string,
      snapshot: OpeningMatchState
    ): OpeningMatchEvent => ({
      type,
      castId,
      state: snapshot,
      participantId: owner,
      cardId: asCardId('basic_hellfire')
    })
    const effect: OpeningMatchEvent = {
      type: 'effect-resolved',
      revision: before.revision,
      sourceInstanceId: 'first',
      sourceCardId: asCardId('basic_hellfire'),
      controllerId: owner,
      action: 'damage',
      actionPath: 'cast.damage',
      data: {}
    }
    const events: OpeningMatchEvent[] = [
      boundary('random-spell-started', 'first', before),
      effect,
      boundary('random-spell-completed', 'first', middle),
      boundary('random-spell-started', 'second', middle),
      { ...effect, sourceInstanceId: 'second' },
      boundary('random-spell-completed', 'second', after)
    ]
    for (const method of [
      'reconcileWeaponViews',
      'reconcileEffectMovement',
      'reconcileRandomSpellState'
    ] as const)
      vi.spyOn(internal, method).mockResolvedValue()
    for (const method of [
      'syncBoardMinionPresentation',
      'syncBoardHeroPresentation',
      'syncBoardAttackability',
      'syncTurnHud',
      'syncTurnControls'
    ] as const)
      vi.spyOn(internal, method).mockImplementation(() => undefined)
    return { value, internal, state, before, middle, after, events, owner }
  }

  async function flush() {
    for (let tick = 0; tick < 30; tick++) await Promise.resolve()
  }

  it.each(['local', 'remote'] as const)(
    'gates two %s Secrets and changes each badge only after its banner',
    async (side) => {
      const { internal, state, before, middle, after, events, owner } = playback()
      const participantId =
        side === 'local'
          ? owner
          : state.players.find((player) => player.participantId !== owner)!
              .participantId
      const cardId = asCardId('classic_counterspell')
      const withSecrets = (
        snapshot: OpeningMatchState,
        ids: string[]
      ): OpeningMatchState => {
        const update = (
          player: OpeningMatchState['players'][number]
        ): OpeningMatchState['players'][number] =>
          player.participantId === participantId
            ? {
                ...player,
                secrets: ids.map((instanceId) => ({
                  instanceId,
                  cardId,
                  controllerId: participantId,
                  ownerId: participantId,
                  revealed: false,
                  creationOrdinal: 1,
                  playOrder: 1
                }))
              }
            : player
        return {
          ...snapshot,
          players: [update(snapshot.players[0]), update(snapshot.players[1])]
        }
      }
      const initial = withSecrets(before, ['first', 'second'])
      const oneLeft = withSecrets(middle, ['second'])
      const noneLeft = withSecrets(after, [])
      const boundary = (
        type: 'secret-resolution-started' | 'secret-resolution-completed',
        secretId: string,
        snapshot: OpeningMatchState
      ): OpeningMatchEvent => ({
        type,
        secretId,
        cardId,
        participantId,
        state: snapshot
      })
      const secretEvents = [
        boundary('secret-resolution-started', 'first', initial),
        events[1],
        boundary('secret-resolution-completed', 'first', oneLeft),
        boundary('secret-resolution-started', 'second', oneLeft),
        events[4],
        boundary('secret-resolution-completed', 'second', noneLeft)
      ]
      vi.spyOn(internal.session, 'dispatch').mockReturnValue({
        accepted: true,
        state: noneLeft,
        events: secretEvents
      })
      const sync = vi.spyOn(internal, 'syncSecrets').mockImplementation(() => undefined)
      vi.spyOn(internal.secretZoneView, 'revealOrigin').mockReturnValue({
        x: 1027,
        y: 100
      })
      const reveals: Array<{ consume: () => void; finish: () => void }> = []
      const reveal = vi
        .spyOn(internal.secretRevealView, 'present')
        .mockImplementation(
          (_id, _origin, consume) =>
            new Promise((finish) => reveals.push({ consume, finish }))
        )
      const effects = vi.spyOn(internal, 'presentEffectResolved').mockResolvedValue()
      internal.dispatchCommand({ type: 'play-card' })
      expect(internal.dispatchCommand({ type: 'end-turn' }).accepted).toBe(false)
      const job = internal.enqueuePresentation(noneLeft, () =>
        internal.presentResolutionEvents(secretEvents)
      )
      await flush()
      expect(reveals).toHaveLength(1)
      expect(effects).not.toHaveBeenCalled()
      expect(
        internal
          .presentationState()
          .players.find((player) => player.participantId === participantId)!.secrets
      ).toHaveLength(2)
      expect(reveal.mock.calls[0][1]).toEqual({ x: 1027, y: 100 })
      reveals[0].consume()
      expect(
        sync.mock.lastCall![0].players.find(
          (player) => player.participantId === participantId
        )!.secrets
      ).toHaveLength(1)
      expect(effects).not.toHaveBeenCalled()
      reveals[0].finish()
      await flush()
      expect(effects).toHaveBeenCalledTimes(1)
      expect(reveals).toHaveLength(2)
      reveals[1].consume()
      expect(
        sync.mock.lastCall![0].players.find(
          (player) => player.participantId === participantId
        )!.secrets
      ).toHaveLength(0)
      reveals[1].finish()
      await job
      expect(effects).toHaveBeenCalledTimes(2)
      expect(internal.randomSpellRevision).toBeNull()
    }
  )

  it('continues Secret effects when artwork preparation fails', async () => {
    const { internal, before, after, events, owner } = playback()
    const boundary = {
      secretId: 'secret',
      participantId: owner,
      cardId: asCardId('classic_counterspell')
    }
    const secretEvents: OpeningMatchEvent[] = [
      { ...boundary, type: 'secret-resolution-started', state: before },
      events[1],
      { ...boundary, type: 'secret-resolution-completed', state: after }
    ]
    vi.spyOn(internal.session, 'dispatch').mockReturnValue({
      accepted: true,
      state: after,
      events: secretEvents
    })
    vi.spyOn(internal.secretRevealView, 'present').mockRejectedValue(
      new Error('artwork unavailable')
    )
    vi.spyOn(internal, 'syncSecrets').mockImplementation(() => undefined)
    const effect = vi.spyOn(internal, 'presentEffectResolved').mockResolvedValue()
    internal.dispatchCommand({ type: 'play-card' })
    await internal.enqueuePresentation(after, () =>
      internal.presentResolutionEvents(secretEvents)
    )
    expect(effect).toHaveBeenCalledOnce()
    expect(internal.randomSpellRevision).toBeNull()
  })

  it('waits for each reveal and effect, uses intermediate states, and locks actions immediately', async () => {
    const { internal, state, middle, after, events } = playback()
    const dispatch = vi
      .spyOn(internal.session, 'dispatch')
      .mockReturnValue({ accepted: true, state: after, events })
    internal.dispatchCommand({ type: 'play-card' })
    expect(internal.randomSpellRevision).toBe(after.revision)
    expect(internal.presentationState()).toEqual(state)
    expect(internal.dispatchCommand({ type: 'end-turn' }).accepted).toBe(false)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const reveals: Array<() => void> = []
    const effects: Array<() => void> = []
    const preview = vi
      .spyOn(internal.remoteCardPlayPreview, 'present')
      .mockImplementation(() => new Promise((resolve) => reveals.push(resolve)))
    const seen: OpeningMatchState[] = []
    vi.spyOn(internal, 'presentEffectResolved').mockImplementation(() => {
      seen.push(internal.presentationState())
      return new Promise((resolve) => effects.push(resolve))
    })
    let idle = false
    const waiting = internal.waitForResolutionIdle().then(() => {
      idle = true
    })
    const job = internal.enqueuePresentation(after, () =>
      internal.presentResolutionEvents(events)
    )
    await flush()
    expect(reveals).toHaveLength(1)
    expect(effects).toHaveLength(0)
    expect(idle).toBe(false)
    expect(preview.mock.calls[0][2]).toEqual({ side: 'local', concealSecret: false })
    reveals[0]()
    await flush()
    expect(seen).toEqual([middle])
    expect(reveals).toHaveLength(1)
    effects[0]()
    await flush()
    expect(reveals).toHaveLength(2)
    expect(seen).toHaveLength(1)
    reveals[1]()
    await flush()
    expect(seen).toEqual([middle, after])
    effects[1]()
    await job
    await waiting
    expect(internal.randomSpellRevision).toBeNull()
    expect(internal.randomSpellState).toBeNull()
    expect(idle).toBe(true)
  })

  it('continues after preview failure and releases the barrier after a failed presentation', async () => {
    const { internal, after, events } = playback()
    vi.spyOn(internal.session, 'dispatch').mockReturnValue({
      accepted: true,
      state: after,
      events
    })
    internal.dispatchCommand({ type: 'play-card' })
    vi.spyOn(internal.remoteCardPlayPreview, 'present').mockRejectedValue(
      new Error('artwork')
    )
    const effect = vi.spyOn(internal, 'presentEffectResolved').mockResolvedValue()
    await internal.enqueuePresentation(after, () =>
      internal.presentResolutionEvents(events)
    )
    expect(effect).toHaveBeenCalledTimes(2)
    expect(internal.randomSpellRevision).toBeNull()
    internal.dispatchCommand({ type: 'play-card' })
    await expect(
      internal.enqueuePresentation(after, async () => {
        throw new Error('entrance')
      })
    ).rejects.toThrow('entrance')
    expect(internal.randomSpellRevision).toBeNull()
  })

  it('stops a local minion sequence on scene exit and releases AI waiters', async () => {
    const { value, internal, after, events } = playback()
    const result = { accepted: true as const, state: after, events }
    vi.spyOn(internal.session, 'dispatch').mockReturnValue(result)
    internal.dispatchCommand({ type: 'play-card' })
    const card = new Container()
    vi.spyOn(
      internal.remoteCardPlayPreview as unknown as {
        createCard(): Promise<Container>
      },
      'createCard'
    ).mockResolvedValue(card)
    vi.spyOn(internal.hand, 'applyLayout').mockResolvedValue()
    const effect = vi.spyOn(internal, 'presentEffectResolved').mockResolvedValue()
    const entry: HandEntry = {
      card: {
        instanceId: 'yogg',
        cardId: asCardId('whispers_of_the_old_gods_yogg_saron_hopes_end')
      },
      slot: mulliganSlot('yogg'),
      displaced: false,
      restTransform: undefined
    }
    const idle = internal.waitForResolutionIdle()
    const job = internal.enqueuePresentation(after, () =>
      internal.presentAcceptedMinionPlay(entry, result)
    )
    await flush()
    expect(internal.remoteCardPlayPreview.children).toHaveLength(1)
    value.dispose()
    await job
    await idle
    expect(effect).not.toHaveBeenCalled()
    expect(card.destroyed).toBe(true)
    expect(internal.randomSpellState).toBeNull()
  })

  it('bounds nested effects by the next boundary, not the outer spell final state', () => {
    const { before, middle, after, events } = playback()
    const nested = [
      events[0],
      events[1],
      events[3],
      events[4],
      events[5],
      events[1],
      events[2]
    ]
    expect(randomSpellPresentationStates(nested, after)).toEqual([
      before,
      middle,
      middle,
      after,
      after,
      middle,
      middle
    ])
    expect(randomSpellPresentationStates([events[1]], after)).toBeNull()
  })

  it('keeps Secrets nested inside random spells bounded by their own snapshots', () => {
    const { before, middle, after, events, owner } = playback()
    const secret = {
      secretId: 'nested-secret',
      participantId: owner,
      cardId: asCardId('classic_counterspell')
    }
    const nested: OpeningMatchEvent[] = [
      events[0],
      events[1],
      { ...secret, type: 'secret-resolution-started', state: before },
      events[1],
      { ...secret, type: 'secret-resolution-completed', state: middle },
      events[4],
      events[5]
    ]
    expect(randomSpellPresentationStates(nested, after)).toEqual([
      before,
      before,
      before,
      middle,
      middle,
      after,
      after
    ])
  })
})

describe('board lifecycle preservation', () => {
  it('opens a fresh gap for a queued hand entrance and waits for a token summon gap', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      boardPositions: BoardPositionController
      animationScope: AnimationScope
      resolver: { loadArtwork(): Promise<Texture> }
      cardPlayAnimation: {
        createMinionAura(): Container
        detachMinionAura(): void
        emitMinionParticles(): Container
        alignMinionArtwork(): void
      }
      localMinionViews: readonly MinionView[]
      selectedCombatView: MinionView | null
      combatInProgress: boolean
      deselectAttacker(animate: boolean): void
      presentMinionPlayed(
        event: Extract<OpeningMatchEvent, { type: 'dev-minion-summoned' }>,
        slot?: GameCardSlot,
        removedFromHand?: boolean
      ): Promise<MinionPreviewPresentation | null>
    }
    vi.spyOn(internal.resolver, 'loadArtwork').mockResolvedValue(Texture.WHITE)
    vi.spyOn(internal.cardPlayAnimation, 'createMinionAura').mockImplementation(
      () => new Container()
    )
    vi.spyOn(internal.cardPlayAnimation, 'detachMinionAura').mockImplementation(
      () => undefined
    )
    vi.spyOn(internal.cardPlayAnimation, 'emitMinionParticles').mockImplementation(
      () => new Container()
    )
    vi.spyOn(internal.cardPlayAnimation, 'alignMinionArtwork').mockImplementation(
      () => undefined
    )
    const animations: gsap.core.Animation[] = []
    const makeTimeline = internal.animationScope.timeline.bind(internal.animationScope)
    const makeTween = internal.animationScope.to.bind(internal.animationScope)
    vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
      const result = makeTimeline(vars)
      animations.push(result)
      return result
    })
    vi.spyOn(internal.animationScope, 'to').mockImplementation((target, vars) => {
      const result = makeTween(target, vars)
      animations.push(result)
      return result
    })
    const finish = async (job: Promise<unknown>): Promise<void> => {
      let done = false
      void job.then(() => {
        done = true
      })
      for (let pass = 0; pass < 60 && !done; pass++) {
        for (const animation of animations)
          if (animation.progress() < 1) animation.progress(1)
        await Promise.resolve()
      }
      expect(done).toBe(true)
      await job
    }
    const event = (cardId: string, position: number) => {
      const result = internal.session.dispatch({
        type: 'dev-summon-minion',
        participantId: internal.session.localParticipantId,
        cardId: asCardId(cardId)
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) throw new Error(result.message)
      const events: readonly OpeningMatchEvent[] = result.events
      const summoned = events.find(
        (
          candidate
        ): candidate is Extract<OpeningMatchEvent, { type: 'dev-minion-summoned' }> =>
          candidate.type === 'dev-minion-summoned'
      )!
      expect(summoned).toBeDefined()
      return { ...summoned, position }
    }
    for (const player of internal.session.getState().players)
      expect(
        internal.session.dispatch({
          type: 'confirm-mulligan',
          participantId: player.participantId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    await finish(
      internal.presentMinionPlayed(event('naxxramas_undertaker', 0), undefined, false)
    )
    await finish(
      internal.presentMinionPlayed(event('classic_leper_gnome', 0), undefined, false)
    )
    const alleycat = event('mean_streets_of_gadgetzan_alleycat', 1)
    const slot = Object.assign(mulliganSlot(alleycat.minion.instanceId), {
      card: new Container(),
      beginMinionPlayTransition: vi.fn()
    })
    // Simulate the preceding action closing the earlier hover gap before the
    // accepted card's entrance gets its turn in the presentation queue.
    internal.boardPositions.preview('local', 'drag', 1)
    internal.boardPositions.preview('local', 'drag', null)
    const arriving = internal.presentMinionPlayed(alleycat, slot, false)
    // Committing Undertaker's queued attack must leave its row slide running
    // while Alleycat is using that slide to make room for its entrance.
    internal.selectedCombatView = internal.localMinionViews[1]
    internal.combatInProgress = true
    internal.deselectAttacker(false)
    await finish(arriving)
    const [leper, cat, undertaker] = internal.localMinionViews
    const step = GAME_BOARD_LAYOUT.boardMinions.local.maxStep
    expect(cat.x - leper.x).toBeCloseTo(step)
    expect(undertaker.x - cat.x).toBeCloseTo(step)
    const summon = internal.presentMinionPlayed(
      event('mean_streets_of_gadgetzan_tabbycat', 2),
      undefined,
      false
    )
    await Promise.resolve()
    expect(internal.localMinionViews).toHaveLength(3)
    await finish(summon)
    const row = internal.localMinionViews
    for (let index = 1; index < row.length; index++)
      expect(row[index].x - row[index - 1].x).toBeCloseTo(step)
  })

  it.each(['leper-gnome', 'haunted-creeper', 'fiery-bat'])(
    'preserves Alleycat space after %s cleanup and opens space for Tabbycat',
    async (deathrattle) => {
      const value = board()
      const internal = value as unknown as {
        boardPositions: BoardPositionController
        animationScope: AnimationScope
      }
      const positions = internal.boardPositions
      const tweens: gsap.core.Tween[] = []
      const makeTween = internal.animationScope.to.bind(internal.animationScope)
      vi.spyOn(internal.animationScope, 'to').mockImplementation((target, vars) => {
        const tween = makeTween(target, vars)
        tweens.push(tween)
        return tween
      })
      const minion = (instanceId: string): MinionView =>
        Object.assign(new Container(), {
          instanceId,
          setBaseScale: vi.fn(),
          isSelected: () => false
        }) as unknown as MinionView
      const advance = (): void => {
        for (const tween of tweens) if (tween.progress() < 1) tween.progress(1)
      }
      const undertaker = minion('undertaker')
      const first = minion(deathrattle)
      positions.insert('local', 0, first)
      positions.insert('local', 1, undertaker)
      const initial = positions.layout('local')
      advance()
      await initial

      // The next gesture happens while the preceding play still owns queued effects.
      positions.preview('local', 'alleycat', 1)
      positions.preview('local', deathrattle, null)
      positions.finishEntrance('local', deathrattle)
      advance()
      const config = GAME_BOARD_LAYOUT.boardMinions.local
      const expected = layoutBoardRow(3, config)
      expect(first.x).toBe(expected[0].x)
      expect(undertaker.x).toBe(expected[2].x)

      positions.reserve('local', 'alleycat', 1)
      const ready = positions.layout('local')
      // Older cleanup cannot cancel an active entrance with the same numeric index.
      positions.finishEntrance('local', deathrattle)
      await ready
      const alleycat = minion('alleycat')
      const landing = positions.entrancePosition('local', 'alleycat')
      alleycat.position.set(landing.x, landing.y)
      positions.insert('local', 1, alleycat)
      positions.finishEntrance('local', 'alleycat')
      expect(alleycat.x - first.x).toBe(config.maxStep)
      expect(undertaker.x - alleycat.x).toBe(config.maxStep)

      positions.reserve('local', 'tabbycat', 2)
      let spaceReady = false
      const space = positions.layout('local').then(() => {
        spaceReady = true
      })
      await Promise.resolve()
      expect(spaceReady).toBe(false)
      // Repeated cleanup/layout requests must await the existing movement, not
      // interrupt it and report an early completion to the incoming summon.
      const repeated = positions.layout('local')
      advance()
      await Promise.all([space, repeated])
      const tabbycat = minion('tabbycat')
      const tabbyLanding = positions.entrancePosition('local', 'tabbycat')
      tabbycat.position.set(tabbyLanding.x, tabbyLanding.y)
      positions.insert('local', 2, tabbycat)
      positions.finishEntrance('local', 'tabbycat')
      expect(tabbycat.x - alleycat.x).toBe(config.maxStep)
      expect(undertaker.x - tabbycat.x).toBe(config.maxStep)
    }
  )

  it('defers placement previews during travel and releases cancelled entrances', async () => {
    const value = board()
    const internal = value as unknown as {
      boardPositions: BoardPositionController
      animationScope: AnimationScope
    }
    const positions = internal.boardPositions
    const attacker = Object.assign(new Container(), {
      instanceId: 'attacker',
      setBaseScale: vi.fn(),
      isSelected: () => false
    }) as unknown as MinionView
    positions.insert('local', 0, attacker)
    const center = GAME_BOARD_LAYOUT.boardMinions.local.centerX
    attacker.position.set(center, GAME_BOARD_LAYOUT.boardMinions.local.baselineY)
    positions.beginMotion(attacker)
    positions.preview('local', 'next-card', 0)
    expect(positions.restingPosition(attacker)?.x).toBe(center)
    positions.endMotion(attacker)
    expect(positions.restingPosition(attacker)?.x).toBeGreaterThan(center)
    positions.reserve('local', 'next-card', 0)
    positions.finishEntrance('local', 'next-card')
    expect(positions.restingPosition(attacker)?.x).toBe(center)
    positions.reserve('local', 'replacement', 0)
    const waiting = positions.layout('local')
    // Disposal resolves movement waiters without leaving a reservation or tween.
    value.dispose()
    await waiting
    expect(positions.views('local')).toHaveLength(0)
  })

  function trackingBoard() {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      cardSelectionOverlay: CardSelectionOverlay
      createSlot(card: OpeningCard): Promise<GameCardSlot>
      handleWindowBlur(): void
      handleWindowPointerDown(event: PointerEvent): void
      toRendererPoint(x: number, y: number): { x: number; y: number }
      restorePendingChoice(): Promise<void>
      presentResolutionEvents(events: readonly OpeningMatchEvent[]): Promise<void>
      syncTurnHud(): void
      syncTurnControls(): void
      createHeroes(state: OpeningMatchState): void
    }
    const session = internal.session
    const owner = session.localParticipantId
    for (const player of session.getState().players)
      session.dispatch({
        type: 'confirm-mulligan',
        participantId: player.participantId,
        replaceInstanceIds: []
      })
    if (session.getState().activePlayerId !== owner)
      session.dispatch({ type: 'end-turn', participantId: session.remoteParticipantId })
    session.dispatch({
      type: 'dev-set-mana',
      participantId: owner,
      available: 10,
      maximum: 10
    })
    session.dispatch({
      type: 'dev-add-card',
      participantId: owner,
      cardId: asCardId('basic_tracking')
    })
    const card = session
      .getState()
      .players.find((player) => player.participantId === owner)!
      .hand.find((card) => card.cardId === 'basic_tracking')!
    expect(
      session.dispatch({
        type: 'play-card',
        participantId: owner,
        cardInstanceId: card.instanceId
      }).accepted
    ).toBe(true)
    expect(session.getState().pendingDiscover?.candidates).toHaveLength(3)
    vi.spyOn(internal, 'createSlot').mockImplementation(async (card) =>
      mulliganSlot(card.instanceId)
    )
    vi.spyOn(internal, 'syncTurnHud').mockImplementation(() => undefined)
    vi.spyOn(internal, 'syncTurnControls').mockImplementation(() => undefined)
    // Exercise command dispatch without rendering the hand animation.
    vi.spyOn(internal, 'presentResolutionEvents').mockImplementation(async () => {
      const pending = session.getState().pendingDiscover
      if (pending) await internal.cardSelectionOverlay.show(pending.candidates)
      else internal.cardSelectionOverlay.clear()
    })
    return { value, internal, session, owner }
  }

  it.each(['blur', 'right-click'] as const)(
    'keeps Tracking selectable after %s, including artwork loading',
    async (action) => {
      const { internal, session, owner } = trackingBoard()
      const overlay = internal.cardSelectionOverlay
      const pending = session.getState().pendingDiscover!
      const releases: Array<() => void> = []
      vi.mocked(internal.createSlot).mockImplementation(
        (card) =>
          new Promise((resolve) =>
            releases.push(() => resolve(mulliganSlot(card.instanceId)))
          )
      )
      const interrupt = () => {
        if (action === 'blur') internal.handleWindowBlur()
        else {
          vi.spyOn(internal, 'toRendererPoint').mockReturnValue({ x: 0, y: 0 })
          internal.handleWindowPointerDown({
            button: 2,
            clientX: 0,
            clientY: 0
          } as PointerEvent)
        }
      }
      const showing = overlay.show(pending.candidates)
      interrupt()
      releases.forEach((release) => release())
      await showing
      interrupt()
      expect(overlay.visible).toBe(true)
      expect(session.getState().pendingDiscover).toEqual(pending)
      expect(
        session.dispatch({ type: 'end-turn', participantId: owner }).accepted
      ).toBe(false)
      const cards = overlay.getChildByLabel('game.card-selection.cards')!
      expect(cards.children).toHaveLength(3)
      cards.children[0].emit('pointertap', { button: 0 } as FederatedPointerEvent)
      expect(session.getState().pendingDiscover).toBeUndefined()
      expect(
        session
          .getState()
          .players.find((player) => player.participantId === owner)!
          .hand.some((card) => card.instanceId === pending.candidates[0].instanceId)
      ).toBe(true)
      expect(
        session.dispatch({ type: 'end-turn', participantId: owner }).accepted
      ).toBe(true)
      await Promise.resolve()
    }
  )

  it('restores Tracking after a rejected selection and allows retry', async () => {
    const { internal, session } = trackingBoard()
    const overlay = internal.cardSelectionOverlay
    await internal.restorePendingChoice()
    const restore = vi.spyOn(internal, 'restorePendingChoice')
    vi.spyOn(session, 'dispatch').mockReturnValueOnce({
      accepted: false,
      state: session.getState(),
      events: [],
      code: 'invalid-command',
      message: 'Rejected for regression test'
    })
    overlay
      .getChildByLabel('game.card-selection.cards')!
      .children[0].emit('pointertap', { button: 0 } as FederatedPointerEvent)
    await restore.mock.results[0].value
    expect(overlay.visible).toBe(true)
    overlay
      .getChildByLabel('game.card-selection.cards')!
      .children[1].emit('pointertap', { button: 0 } as FederatedPointerEvent)
    expect(session.getState().pendingDiscover).toBeUndefined()
    await Promise.resolve()
  })

  it('preserves mandatory card options on blur and restores them after rejection', async () => {
    const { internal, session, owner } = trackingBoard()
    const state = {
      ...session.getState(),
      pendingDiscover: undefined,
      pendingCardChoice: {
        participantId: owner,
        sourceCardInstanceId: 'mandatory-choice',
        sourceCardId: asCardId('basic_fireball'),
        options: [0, 1].map((choice) => ({
          choice,
          label: `Option ${choice}`,
          presentationCardId: asCardId('basic_fireball')
        }))
      }
    }
    vi.spyOn(session.match, 'getState').mockReturnValue(state)
    await internal.restorePendingChoice()
    internal.handleWindowBlur()
    const overlay = internal.cardSelectionOverlay
    expect(overlay.visible).toBe(true)
    const restore = vi.spyOn(internal, 'restorePendingChoice')
    const dispatch = vi.spyOn(session, 'dispatch').mockReturnValue({
      accepted: false,
      state,
      events: [],
      code: 'invalid-command',
      message: 'Rejected for regression test'
    })
    overlay
      .getChildByLabel('game.card-selection.cards')!
      .children[0].emit('pointertap', { button: 0 } as FederatedPointerEvent)
    await restore.mock.results[0].value
    overlay
      .getChildByLabel('game.card-selection.cards')!
      .children[1].emit('pointertap', { button: 0 } as FederatedPointerEvent)
    await restore.mock.results[1].value
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'choose-card-option', choice: 1 })
    )
    vi.mocked(session.match.getState).mockReturnValue({
      ...state,
      pendingCardChoice: undefined
    })
    await internal.restorePendingChoice()
    expect(overlay.visible).toBe(false)
  })

  it('cancels a temporary card choice on blur and returns its card', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      cardPlay: GameCardTargeting
      hand: GameHandView
      cardSelectionOverlay: CardSelectionOverlay
      createSlot(card: OpeningCard): Promise<GameCardSlot>
      handleWindowBlur(): void
    }
    const slot = Object.assign(mulliganSlot('temporary-choice'), {
      suppressPlayableOutline: vi.fn()
    })
    const card = { instanceId: slot.instanceId, cardId: asCardId('basic_fireball') }
    internal.hand.append({ card, slot, displaced: false, restTransform: undefined })
    internal.hand.layer.addChild(slot)
    vi.spyOn(internal, 'createSlot').mockImplementation(async (card) =>
      mulliganSlot(card.instanceId)
    )
    internal.cardPlay.beginCardTargeting(
      { card, slot, displaced: false, restTransform: undefined },
      {
        participantId: internal.session.localParticipantId,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        currentCost: 4,
        requiresPosition: false,
        legalPositions: [],
        targetSelectors: [],
        legalTargetOptions: [],
        choiceCount: 1,
        legalChoices: [0],
        choiceOptions: [
          { choice: 0, label: 'Temporary option', presentationCardId: card.cardId }
        ],
        choiceTiming: 'before-play',
        skipTargetedBattlecry: false,
        effectPreview: null
      }
    )
    expect(internal.cardSelectionOverlay.visible).toBe(true)
    expect(slot.visible).toBe(false)
    internal.handleWindowBlur()
    await Promise.resolve()
    expect(internal.cardSelectionOverlay.visible).toBe(false)
    expect(internal.cardPlay.current).toBeNull()
    expect(slot.visible).toBe(true)
  })

  it.each(['concede', 'dispose'] as const)(
    'clears mandatory choices on %s while artwork loads',
    async (action) => {
      const { value, internal } = trackingBoard()
      internal.createHeroes(internal.session.getState())
      const releases: Array<() => void> = []
      const slots: GameCardSlot[] = []
      vi.mocked(internal.createSlot).mockImplementation(
        (card) =>
          new Promise((resolve) =>
            releases.push(() => {
              const slot = mulliganSlot(card.instanceId)
              slots.push(slot)
              resolve(slot)
            })
          )
      )
      const showing = internal.restorePendingChoice()
      if (action === 'concede') value.concede()
      else value.dispose()
      releases.forEach((release) => release())
      await showing
      expect(internal.cardSelectionOverlay.visible).toBe(false)
      expect(slots.every((slot) => slot.destroyed)).toBe(true)
    }
  )

  it.each(['local', 'remote'] as const)(
    'returns a %s attacker to its slot after an interrupted row shift',
    async (side) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        combat: GameCombatPresentation
        animationScope: AnimationScope
        localMinionViews: MinionView[]
        remoteMinionViews: MinionView[]
        insertLocalMinionView(position: number, view: MinionView): void
        insertRemoteMinionView(position: number, view: MinionView): void
        removeMinionView(view: MinionView): void
        applyLocalBoardLayout(): void
        applyRemoteBoardLayout(): void
      }
      const owner =
        side === 'local'
          ? internal.session.localParticipantId
          : internal.session.remoteParticipantId
      const opponent =
        side === 'local'
          ? internal.session.remoteParticipantId
          : internal.session.localParticipantId
      const insert =
        side === 'local'
          ? internal.insertLocalMinionView.bind(internal)
          : internal.insertRemoteMinionView.bind(internal)
      const layout =
        side === 'local'
          ? internal.applyLocalBoardLayout.bind(internal)
          : internal.applyRemoteBoardLayout.bind(internal)
      const config = GAME_BOARD_LAYOUT.boardMinions[side]
      const views: MinionView[] = []
      for (let index = 0; index < 6; index++) {
        const view = await MinionView.create(
          {
            label: `regression-${index}`,
            attack: 2,
            health: 3,
            maxHealth: 3,
            legendary: false,
            taunt: false,
            enraged: false,
            divineShield: false,
            frozen: false,
            stealth: false,
            deathrattle: false,
            poisonous: false,
            aura: false,
            trigger: false,
            inspire: false,
            windfury: false,
            spellDamage: false,
            lifesteal: false,
            elusive: false,
            immune: false
          },
          new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
          Texture.WHITE
        )
        view.instanceId = `regression-${index}`
        view.ownerId = index === 4 ? opponent : owner
        views.push(view)
        if (index < 4) {
          insert(index, view)
          const position = layoutBoardRow(4, config)[index]
          view.position.set(position.x, position.y)
        } else if (index === 4) {
          if (side === 'local') internal.insertRemoteMinionView(0, view)
          else internal.insertLocalMinionView(0, view)
        }
      }
      const attacker = views[1]
      const parent = attacker.parent!
      const timelines: gsap.core.Timeline[] = []
      const tweens: gsap.core.Tween[] = []
      const makeTimeline = internal.animationScope.timeline.bind(
        internal.animationScope
      )
      const makeTween = internal.animationScope.to.bind(internal.animationScope)
      vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
        const animation = makeTimeline(vars)
        timelines.push(animation)
        return animation
      })
      vi.spyOn(internal.animationScope, 'to').mockImplementation((target, vars) => {
        const animation = makeTween(target, vars)
        tweens.push(animation)
        return animation
      })
      const finish = async (job: Promise<void>): Promise<void> => {
        let done = false
        void job.then(() => {
          done = true
        })
        for (let pass = 0; pass < 40 && !done; pass++) {
          for (const animation of timelines) animation.progress(1)
          await Promise.resolve()
        }
        expect(done).toBe(true)
        await job
      }
      // Boar dies; commit Crocolisk's attack only 25 ms into the resulting slide.
      internal.removeMinionView(views[3])
      layout()
      for (const tween of tweens) tween.time(0.025)
      const interruptedX = attacker.x
      const attackerRef = {
        participantId: owner,
        character: { kind: 'minion' as const, instanceId: attacker.instanceId! },
        attack: 2,
        healthBefore: 3,
        armorBefore: 0
      }
      const defenderRef = {
        participantId: opponent,
        character: { kind: 'minion' as const, instanceId: views[4].instanceId! },
        attack: 1,
        healthBefore: 3,
        armorBefore: 0
      }
      await finish(
        internal.combat.presentCombatStarted({
          type: 'combat-started',
          combatId: 'row-shift',
          attacker: attackerRef,
          defender: defenderRef
        })
      )
      const contact = { x: attacker.x, y: attacker.y }
      layout()
      for (const tween of tweens) if (tween.progress() < 1) tween.progress(1)
      expect({ x: attacker.x, y: attacker.y }).toEqual(contact)
      await finish(internal.combat.returnLatestAttacker()!)
      const resting = layoutBoardRow(3, config)[1]
      expect(attacker.parent).toBe(parent)
      expect(attacker.x).toBeCloseTo(resting.x)
      expect(attacker.x).not.toBeCloseTo(interruptedX)
      expect(attacker.x - views[0].x).toBeCloseTo(config.maxStep)

      // A later summon changes the slot again; cleanup must not replay the return.
      insert(3, views[5])
      layout()
      for (const tween of tweens) if (tween.progress() < 1) tween.progress(1)
      const afterSummon = attacker.x
      await finish(
        internal.combat.presentCombatResolved({
          type: 'character-combat-resolved',
          combatId: 'row-shift',
          weapon: null,
          attacker: {
            ...attackerRef,
            damageDealt: 2,
            attemptedDamage: 1,
            healthAfter: 2,
            armorAfter: 0,
            destroyed: false
          },
          defender: {
            ...defenderRef,
            damageDealt: 1,
            attemptedDamage: 2,
            healthAfter: 1,
            armorAfter: 0,
            destroyed: false
          }
        })
      )
      expect(attacker.x).toBeCloseTo(afterSummon)
    }
  )

  it('removes a lethal combat attacker before presenting its Deathrattle', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      combat: GameCombatPresentation
      animationScope: AnimationScope
      findMinionView(ownerId: PlayerId, instanceId: string): MinionView | undefined
      insertLocalMinionView(position: number, view: MinionView): void
      insertRemoteMinionView(position: number, view: MinionView): void
    }
    const owner = internal.session.localParticipantId
    const opponent = internal.session.remoteParticipantId
    const createView = async (instanceId: string, ownerId: PlayerId) => {
      const view = await MinionView.create(
        {
          label: `deathrattle-regression.${instanceId}`,
          attack: 2,
          health: 1,
          maxHealth: 1,
          legendary: false,
          taunt: false,
          enraged: false,
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: false,
          poisonous: false,
          aura: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
          lifesteal: false,
          elusive: false,
          immune: false
        },
        new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
        Texture.WHITE
      )
      view.instanceId = instanceId
      view.ownerId = ownerId
      if (ownerId === owner) internal.insertLocalMinionView(0, view)
      else internal.insertRemoteMinionView(0, view)
      return view
    }
    const attacker = await createView('deathrattle-attacker', owner)
    const defender = await createView('deathrattle-defender', opponent)
    const animations: gsap.core.Timeline[] = []
    const makeTimeline = internal.animationScope.timeline.bind(internal.animationScope)
    vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
      const animation = makeTimeline(vars)
      animations.push(animation)
      return animation
    })
    const finish = async (job: Promise<void>): Promise<void> => {
      let done = false
      void job.then(() => {
        done = true
      })
      for (let pass = 0; pass < 60 && !done; pass++) {
        for (const animation of animations) animation.progress(1)
        await Promise.resolve()
      }
      expect(done).toBe(true)
      await job
    }
    const attackerRef = {
      participantId: owner,
      character: { kind: 'minion' as const, instanceId: attacker.instanceId! },
      attack: 2,
      healthBefore: 1,
      armorBefore: 0
    }
    const defenderRef = {
      participantId: opponent,
      character: { kind: 'minion' as const, instanceId: defender.instanceId! },
      attack: 1,
      healthBefore: 3,
      armorBefore: 0
    }

    await finish(
      internal.combat.presentCombatStarted({
        type: 'combat-started',
        combatId: 'deathrattle-order',
        attacker: attackerRef,
        defender: defenderRef
      })
    )
    await finish(
      internal.combat.presentDeathBatchStarted({
        type: 'death-batch-started',
        batchId: 'deathrattle-order-batch',
        deaths: [
          {
            instanceId: attacker.instanceId!,
            participantId: owner,
            kind: 'minion',
            cardId: asCardId('one_night_in_karazhan_kindly_grandmother'),
            position: 0,
            hasDeathrattle: true
          }
        ]
      })
    )

    expect(attacker.destroyed).toBe(true)
    expect(internal.findMinionView(owner, attacker.instanceId!)).toBeUndefined()

    const ghostJob = internal.combat.presentDeathrattleGhost(attacker.instanceId!)
    expect(
      internal.combat.layer.getChildByLabel(`game.deathrattle.${attacker.instanceId}`)
    ).toBeDefined()
    expect(attacker.destroyed).toBe(true)
    await finish(ghostJob)

    await finish(
      internal.combat.presentCombatResolved({
        type: 'character-combat-resolved',
        combatId: 'deathrattle-order',
        weapon: null,
        attacker: {
          ...attackerRef,
          damageDealt: 1,
          attemptedDamage: 1,
          healthAfter: 0,
          armorAfter: 0,
          destroyed: true
        },
        defender: {
          ...defenderRef,
          damageDealt: 2,
          attemptedDamage: 2,
          healthAfter: 1,
          armorAfter: 0,
          destroyed: false
        }
      })
    )
    expect(defender.destroyed).toBe(false)
  })

  it('wiggles a dying minion after its lethal combat return', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      combat: GameCombatPresentation
      animationScope: AnimationScope
      boardPositions: BoardPositionController
      insertLocalMinionView(position: number, view: MinionView): void
      insertRemoteMinionView(position: number, view: MinionView): void
    }
    const owner = internal.session.localParticipantId
    const opponent = internal.session.remoteParticipantId
    const createView = async (instanceId: string, ownerId: PlayerId) => {
      const view = await MinionView.create(
        {
          label: `death-wiggle.${instanceId}`,
          attack: 2,
          health: 1,
          maxHealth: 1,
          legendary: false,
          taunt: false,
          enraged: false,
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: false,
          poisonous: false,
          aura: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
          lifesteal: false,
          elusive: false,
          immune: false
        },
        new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
        Texture.WHITE
      )
      view.instanceId = instanceId
      view.ownerId = ownerId
      if (ownerId === owner) internal.insertLocalMinionView(0, view)
      else internal.insertRemoteMinionView(0, view)
      return view
    }
    const attacker = await createView('wiggle-attacker', owner)
    const defender = await createView('wiggle-defender', opponent)
    const resting = internal.boardPositions.restingPosition(attacker)!
    attacker.position.set(resting.x, resting.y)
    const home = { x: resting.x, y: resting.y, parent: attacker.parent }
    const animations: gsap.core.Timeline[] = []
    const makeTimeline = internal.animationScope.timeline.bind(internal.animationScope)
    vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
      const animation = makeTimeline(vars)
      animations.push(animation)
      return animation
    })
    const finish = async (job: Promise<void>): Promise<void> => {
      let done = false
      void job.then(() => {
        done = true
      })
      for (let pass = 0; pass < 60 && !done; pass++) {
        for (const animation of animations)
          if (animation.progress() < 1) animation.progress(1)
        await Promise.resolve()
      }
      expect(done).toBe(true)
      await job
    }
    const attackerRef = {
      participantId: owner,
      character: { kind: 'minion' as const, instanceId: attacker.instanceId! },
      attack: 2,
      healthBefore: 1,
      armorBefore: 0
    }
    const defenderRef = {
      participantId: opponent,
      character: { kind: 'minion' as const, instanceId: defender.instanceId! },
      attack: 1,
      healthBefore: 1,
      armorBefore: 0
    }

    await finish(
      internal.combat.presentCombatStarted({
        type: 'combat-started',
        combatId: 'death-wiggle',
        attacker: attackerRef,
        defender: defenderRef
      })
    )
    internal.combat.beginLatestImpact()
    const damage = internal.combat.showDamageIndicator(attacker, 1)!
    const damageTimeline = animations.at(-1)!
    animations.splice(animations.indexOf(damageTimeline), 1)
    await finish(internal.combat.returnLatestAttacker()!)
    expect(attacker.parent).toBe(home.parent)
    expect(attacker.x).toBeCloseTo(home.x)
    expect(attacker.y).toBeCloseTo(home.y)
    expect(damage.destroyed).toBe(false)

    const resolution = internal.combat.presentCombatResolved({
      type: 'minion-combat-resolved',
      combatId: 'death-wiggle',
      attacker: {
        participantId: owner,
        instanceId: attacker.instanceId!,
        attack: 2,
        damageDealt: 1,
        attemptedDamage: 1,
        healthBefore: 1,
        healthAfter: 0,
        destroyed: true
      },
      defender: {
        participantId: opponent,
        instanceId: defender.instanceId!,
        attack: 1,
        damageDealt: 1,
        attemptedDamage: 1,
        healthBefore: 1,
        healthAfter: 0,
        destroyed: true
      }
    })

    const deathTimeline = animations.find((animation) =>
      animation
        .getChildren(false, true, false)
        .some((child) => (child as gsap.core.Tween).vars.rotation !== undefined)
    )!
    const deathTweens = deathTimeline.getChildren(
      false,
      true,
      false
    ) as gsap.core.Tween[]
    const wiggles = deathTweens.filter((tween) => tween.vars.rotation !== undefined)
    const collapse = deathTweens.find((tween) => tween.vars.alpha === 0)!
    deathTimeline.progress(0.2)
    expect(wiggles).toHaveLength(4)
    expect(collapse.startTime()).toBeGreaterThan(
      wiggles.at(-1)!.startTime() + wiggles.at(-1)!.duration() - 0.001
    )
    expect(attacker.x).toBeCloseTo(home.x)
    expect(attacker.y).toBeCloseTo(home.y)
    expect(attacker.alpha).toBe(1)
    expect(Math.abs(attacker.rotation)).toBeGreaterThan(0.01)
    await finish(resolution)
    expect(attacker.destroyed).toBe(true)
  })

  it('wiggles a minion before a regular death-batch collapse', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      combat: GameCombatPresentation
      animationScope: AnimationScope
      insertLocalMinionView(position: number, view: MinionView): void
    }
    const owner = internal.session.localParticipantId
    const view = await MinionView.create(
      {
        label: 'death-wiggle.regular',
        attack: 2,
        health: 0,
        maxHealth: 1,
        legendary: false,
        taunt: false,
        enraged: false,
        divineShield: false,
        frozen: false,
        stealth: false,
        deathrattle: false,
        poisonous: false,
        aura: false,
        trigger: false,
        inspire: false,
        windfury: false,
        spellDamage: false,
        lifesteal: false,
        elusive: false,
        immune: false
      },
      new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
      Texture.WHITE
    )
    view.instanceId = 'wiggle-regular'
    view.ownerId = owner
    internal.insertLocalMinionView(0, view)
    const animations: gsap.core.Timeline[] = []
    const makeTimeline = internal.animationScope.timeline.bind(internal.animationScope)
    vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
      const animation = makeTimeline(vars)
      animations.push(animation)
      return animation
    })

    const job = internal.combat.presentDeathBatchStarted({
      type: 'death-batch-started',
      batchId: 'death-wiggle-regular',
      deaths: [
        {
          instanceId: view.instanceId!,
          participantId: owner,
          kind: 'minion',
          cardId: asCardId('basic_bloodfen_raptor'),
          position: 0,
          hasDeathrattle: false
        }
      ]
    })
    const deathTimeline = animations[0]!
    const deathTweens = deathTimeline.getChildren(
      false,
      true,
      false
    ) as gsap.core.Tween[]
    const wiggles = deathTweens.filter((tween) => tween.vars.rotation !== undefined)
    const collapse = deathTweens.find((tween) => tween.vars.alpha === 0)!
    expect(wiggles).toHaveLength(4)
    expect(collapse.startTime()).toBeGreaterThan(
      wiggles.at(-1)!.startTime() + wiggles.at(-1)!.duration() - 0.001
    )
    deathTimeline.progress(0.2)
    expect(Math.abs(view.rotation)).toBeGreaterThan(0.01)
    expect(view.alpha).toBe(1)
    deathTimeline.progress(1)
    await job
    expect(view.destroyed).toBe(true)
  })

  it.each([
    [0, false],
    [0, true],
    [1, false],
    [1, true]
  ] as const)(
    'plays Keeper choice %s with one target click (before preview ready: %s)',
    async (choice, clickBeforeReady) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        hand: GameHandView
        cardPlay: GameCardTargeting
        cardSelectionOverlay: CardSelectionOverlay
        presentMinionPlayed(): Promise<MinionPreviewPresentation | null>
        presentAcceptedMinionPlay(): Promise<void>
      }
      const session = internal.session
      const owner = session.localParticipantId
      const opponent = session.remoteParticipantId
      for (const player of session.getState().players)
        expect(
          session.dispatch({
            type: 'confirm-mulligan',
            participantId: player.participantId,
            replaceInstanceIds: []
          }).accepted
        ).toBe(true)
      if (session.getState().activePlayerId !== owner)
        expect(
          session.dispatch({ type: 'end-turn', participantId: opponent }).accepted
        ).toBe(true)
      expect(
        session.dispatch({
          type: 'dev-set-mana',
          participantId: owner,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        session.dispatch({
          type: 'dev-add-card',
          participantId: owner,
          cardId: asCardId('classic_keeper_of_the_grove')
        }).accepted
      ).toBe(true)
      expect(
        session.dispatch({
          type: 'dev-summon-minion',
          participantId: opponent,
          cardId: asCardId('basic_chillwind_yeti')
        }).accepted
      ).toBe(true)
      const state = session.getState()
      const card = state.players
        .find((player) => player.participantId === owner)!
        .hand.find((candidate) => candidate.cardId === 'classic_keeper_of_the_grove')!
      const enemy = state.players.find((player) => player.participantId === opponent)!
        .board[0]!
      const slot = Object.assign(mulliganSlot(card.instanceId), {
        suppressPlayableOutline: vi.fn()
      })
      const entry: HandEntry = {
        card,
        slot,
        restTransform: layoutHand(1)[0]!,
        displaced: false
      }
      internal.hand.append(entry)
      internal.hand.layer.addChild(slot)
      vi.spyOn(internal.cardSelectionOverlay, 'showChoices').mockResolvedValue()
      vi.spyOn(internal, 'presentAcceptedMinionPlay').mockResolvedValue()
      let finish!: (presentation: MinionPreviewPresentation) => void
      const present = vi.spyOn(internal, 'presentMinionPlayed').mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      const input = session.match.getPlayInput!(owner, card.instanceId)!
      internal.cardPlay.beginCardTargeting(entry, input, 0)
      expect(present).not.toHaveBeenCalled()
      internal.cardPlay.chooseCardPlayOption(choice)
      await Promise.resolve() // Targeted entrances use the same presentation queue.
      expect(present).toHaveBeenCalledTimes(1)
      expect(slot.visible).toBe(true)
      const preview = internal.cardPlay.minionTargetPreview()!
      const target = Object.assign(new Container(), {
        ownerId: opponent,
        instanceId: enemy.instanceId
      }) as unknown as MinionView
      const view = Object.assign(new Container(), {
        setTargetable: vi.fn(),
        setTargetingOutline: vi.fn()
      }) as unknown as MinionView
      try {
        if (clickBeforeReady) {
          internal.cardPlay.commitCardTarget(target)
          expect(session.getState().revision).toBe(state.revision)
        }
        finish({ view, slot, resting: { x: 960, y: 600, scale: 1 } })
        await preview.presentationPromise
        await Promise.resolve()
        if (!clickBeforeReady) internal.cardPlay.commitCardTarget(target)
        const after = session.getState()
        const local = after.players.find((player) => player.participantId === owner)!
        const affected = after.players.find(
          (player) => player.participantId === opponent
        )!.board[0]!
        expect(
          local.hand.some((candidate) => candidate.instanceId === card.instanceId)
        ).toBe(false)
        expect(local.board.some((minion) => minion.cardId === card.cardId)).toBe(true)
        expect(affected.health).toBe(enemy.health - (choice === 0 ? 2 : 0))
        if (choice === 1) expect(affected.silenced).toBe(true)
        expect(internal.cardPlay.current).toBeNull()
      } finally {
        target.destroy()
        view.destroy()
      }
    }
  )

  it('accepts two legal attacks immediately while presenting their impacts in order', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      combat: GameCombatPresentation
      animationScope: AnimationScope
      localMinionViews: MinionView[]
      localMinionLayer: Container
      heroViews: Map<PlayerId, HeroView>
      createHeroes(state: OpeningMatchState): void
      selectAttacker(view: MinionView): void
      attackCharacter(view: HeroView): Promise<void>
    }
    const session = internal.session
    for (const player of session.getState().players)
      expect(
        session.dispatch({
          type: 'confirm-mulligan',
          participantId: player.participantId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    if (session.getState().activePlayerId !== session.localParticipantId) {
      expect(
        session.dispatch({
          type: 'end-turn',
          participantId: session.remoteParticipantId
        }).accepted
      ).toBe(true)
    }
    for (let index = 0; index < 2; index++)
      expect(
        session.dispatch({
          type: 'dev-summon-minion',
          participantId: session.localParticipantId,
          cardId: asCardId('basic_wolfrider')
        }).accepted
      ).toBe(true)
    for (const player of session.getState().players)
      expect(
        session.dispatch({
          type: 'dev-clear-zone',
          participantId: player.participantId,
          zone: 'hand'
        }).accepted
      ).toBe(true)
    const state = session.getState()
    internal.createHeroes(state)
    const local = state.players.find(
      (player) => player.participantId === session.localParticipantId
    )!
    for (const minion of local.board) {
      const view = await MinionView.create(
        {
          label: `queued-attacker.${minion.instanceId}`,
          attack: minion.attack,
          health: minion.health,
          maxHealth: minion.maxHealth,
          legendary: false,
          taunt: false,
          enraged: false,
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: false,
          poisonous: false,
          aura: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
          lifesteal: false,
          elusive: false,
          immune: false
        },
        new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
        Texture.WHITE
      )
      view.ownerId = session.localParticipantId
      view.instanceId = minion.instanceId
      view.cardId = minion.cardId
      view.setCanAttack(true)
      internal.localMinionViews.push(view)
      internal.localMinionLayer.addChild(view)
    }
    const target = internal.heroViews.get(session.remoteParticipantId)!
    const start = vi.spyOn(internal.combat, 'presentCombatStarted')
    const timelines: gsap.core.Timeline[] = []
    const timeline = internal.animationScope.timeline.bind(internal.animationScope)
    vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
      const result = timeline(vars)
      timelines.push(result)
      return result
    })
    const dispatch = vi.spyOn(session, 'dispatch')
    internal.selectAttacker(internal.localMinionViews[0]!)
    const first = internal.attackCharacter(target)
    internal.selectAttacker(internal.localMinionViews[1]!)
    const second = internal.attackCharacter(target)
    expect(
      dispatch.mock.results.filter(
        (result) => result.type === 'return' && result.value.accepted
      )
    ).toHaveLength(2)
    const remote = session
      .getState()
      .players.find((player) => player.participantId === session.remoteParticipantId)!
    expect(remote.hero.health).toBe(
      state.players.find(
        (player) => player.participantId === session.remoteParticipantId
      )!.hero.health - local.board.reduce((total, minion) => total + minion.attack, 0)
    )
    let complete = false
    const both = Promise.all([first, second]).then(() => {
      complete = true
    })
    for (let pass = 0; pass < 150 && !complete; pass++) {
      await Promise.resolve()
      for (const animation of timelines) animation.progress(1)
    }
    expect(complete).toBe(true)
    await both
    expect(start.mock.calls.map(([event]) => event.attacker.character)).toEqual(
      local.board.map((minion) => ({ kind: 'minion', instanceId: minion.instanceId }))
    )
    for (const view of internal.localMinionViews)
      expect(view.parent).toBe(internal.localMinionLayer)
  })

  it('defers the weapon HUD sync for a local hero attack', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      heroViews: Map<PlayerId, HeroView>
      createHeroes(state: OpeningMatchState): void
      attackCharacter(target: HeroView): Promise<void>
      dispatchCommand(command: unknown): ReturnType<GameBoardSession['dispatch']>
      syncTurnHud(
        state: OpeningMatchState,
        options?: { readonly skipWeaponSync?: boolean }
      ): void
      syncTurnControls(state: OpeningMatchState): void
      updateCombatPreview(target: HeroView): void
      enqueuePresentation(
        state: OpeningMatchState,
        present: () => Promise<void>
      ): Promise<void>
    }
    for (const player of internal.session.getState().players) {
      const result = internal.session.dispatch({
        type: 'confirm-mulligan',
        participantId: player.participantId,
        replaceInstanceIds: []
      })
      expect(result.accepted).toBe(true)
    }
    const state = internal.session.getState()
    internal.createHeroes(state)
    const attacker = internal.heroViews.get(internal.session.localParticipantId)!
    const target = internal.heroViews.get(internal.session.remoteParticipantId)!
    Object.assign(value, { selectedCombatView: attacker })

    const result = { accepted: true as const, state, events: [] as OpeningMatchEvent[] }
    vi.spyOn(internal, 'dispatchCommand').mockReturnValue(result)
    vi.spyOn(internal, 'updateCombatPreview').mockImplementation(() => undefined)
    const syncTurnHud = vi
      .spyOn(internal, 'syncTurnHud')
      .mockImplementation(() => undefined)
    vi.spyOn(internal, 'syncTurnControls').mockImplementation(() => undefined)
    vi.spyOn(internal, 'enqueuePresentation').mockResolvedValue(undefined)

    await internal.attackCharacter(target)

    expect(syncTurnHud).toHaveBeenNthCalledWith(1, state, {
      skipWeaponSync: true
    })
  })

  it.each(['clear', 'dispose'])(
    'discards choice artwork arriving after overlay %s',
    async (action) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        cardSelectionOverlay: CardSelectionOverlay
        createSlot(card: OpeningCard): Promise<GameCardSlot>
      }
      const releases: Array<(slot: GameCardSlot) => void> = []
      vi.spyOn(internal, 'createSlot').mockImplementation(
        () => new Promise((resolve) => releases.push(resolve))
      )
      const source = asCardId('basic_fireball')
      const showing = internal.cardSelectionOverlay.showChoices(
        internal.session.localParticipantId,
        'pending-choice',
        source,
        [
          { choice: 0, label: 'First', presentationCardId: source },
          { choice: 1, label: 'Second', presentationCardId: source }
        ]
      )
      if (action === 'clear') internal.cardSelectionOverlay.clear()
      else internal.cardSelectionOverlay.dispose()
      const slots = releases.map((resolve, index) => {
        const slot = mulliganSlot(`choice-${index}`)
        resolve(slot)
        return slot
      })
      await showing
      for (const slot of slots) expect(slot.destroyed).toBe(true)
      expect(internal.cardSelectionOverlay.visible).toBe(false)
    }
  )

  it.each(['cancel', 'dispose'])(
    'discards a minion preview that finishes after %s',
    async (action) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        hand: GameHandView
        cardPlay: GameCardTargeting
        presentMinionPlayed(): Promise<MinionPreviewPresentation | null>
        commitPendingCardPlay(): void
      }
      const slot = Object.assign(mulliganSlot('pending-minion'), {
        suppressPlayableOutline: vi.fn()
      })
      const entry: HandEntry = {
        card: { instanceId: slot.instanceId, cardId: asCardId('basic_elven_archer') },
        slot,
        restTransform: layoutHand(1)[0]!,
        displaced: false
      }
      internal.hand.append(entry)
      internal.hand.layer.addChild(slot)
      let finish!: (presentation: MinionPreviewPresentation) => void
      vi.spyOn(internal, 'presentMinionPlayed').mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      const submit = vi
        .spyOn(internal, 'commitPendingCardPlay')
        .mockImplementation(() => undefined)
      internal.cardPlay.beginCardTargeting(
        entry,
        {
          participantId: internal.session.localParticipantId,
          cardInstanceId: slot.instanceId,
          cardId: entry.card.cardId,
          currentCost: 1,
          requiresPosition: true,
          legalPositions: [0],
          targetSelectors: [{}],
          legalTargetOptions: [
            [{ kind: 'hero', participantId: internal.session.remoteParticipantId }]
          ],
          choiceCount: 0,
          legalChoices: [],
          choiceOptions: [],
          choiceTiming: 'before-play',
          skipTargetedBattlecry: false,
          effectPreview: null
        },
        0
      )
      const preview = internal.cardPlay.minionTargetPreview()!
      await Promise.resolve() // Start the queued preview before testing late artwork.
      if (action === 'cancel') {
        internal.cardPlay.cancelCardTargeting()
        await preview.reversePromise
      } else value.dispose()
      const view = await MinionView.create(
        {
          label: 'late-minion-preview',
          attack: 1,
          health: 1,
          maxHealth: 1,
          legendary: false,
          taunt: false,
          enraged: false,
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: false,
          poisonous: false,
          aura: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
          lifesteal: false,
          elusive: false,
          immune: false
        },
        new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
        Texture.WHITE
      )
      finish({ view, slot, resting: { x: 960, y: 600, scale: 1 } })
      await preview.presentationPromise
      await Promise.resolve()
      expect(view.destroyed).toBe(true)
      expect(internal.cardPlay.current).toBeNull()
      expect(submit).not.toHaveBeenCalled()
    }
  )

  it('collects a spell target without dispatching and restores its hidden card on blur', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      hand: GameHandView
      heroViews: Map<PlayerId, HeroView>
      cardPlay: GameCardTargeting
      createHeroes(state: OpeningMatchState): void
      commitPendingCardPlay(): void
      handleWindowBlur(): void
    }
    internal.createHeroes(internal.session.getState())
    const owner = internal.session.localParticipantId
    const target = internal.heroViews.get(internal.session.remoteParticipantId)!
    const slot = Object.assign(mulliganSlot('pending-spell'), {
      suppressPlayableOutline: vi.fn()
    })
    const rest = layoutHand(1)[0]!
    const entry: HandEntry = {
      card: { instanceId: slot.instanceId, cardId: asCardId('basic_fireball') },
      slot,
      restTransform: rest,
      displaced: false
    }
    internal.hand.append(entry)
    internal.hand.layer.addChild(slot)
    const input: PlayCardInput = {
      participantId: owner,
      cardInstanceId: slot.instanceId,
      cardId: entry.card.cardId,
      currentCost: 4,
      requiresPosition: false,
      legalPositions: [],
      targetSelectors: [{}],
      legalTargetOptions: [
        [{ kind: 'hero', participantId: internal.session.remoteParticipantId }]
      ],
      choiceCount: 0,
      legalChoices: [],
      choiceOptions: [],
      choiceTiming: 'before-play',
      skipTargetedBattlecry: false,
      effectPreview: null
    }
    const dispatch = vi.spyOn(internal.session, 'dispatch')
    const submit = vi
      .spyOn(internal, 'commitPendingCardPlay')
      .mockImplementation(() => undefined)
    internal.cardPlay.beginCardTargeting(entry, input)
    expect(slot.visible).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    internal.cardPlay.commitCardTarget(target)
    expect(internal.cardPlay.current?.targets).toEqual(input.legalTargetOptions[0])
    expect(submit).toHaveBeenCalledOnce()
    internal.handleWindowBlur()
    expect(internal.cardPlay.current).toBeNull()
    expect(slot.visible).toBe(true)
    gsap.getTweensOf(slot)[0]!.parent!.progress(1)
    await Promise.resolve()
    expect(internal.hand.drag.returning).toBe(false)
    expect(slot.position.x).toBe(rest.x)
    expect(slot.position.y).toBe(rest.y)
  })

  it('owns captured deathrattle ghosts through completion and scene exit', async () => {
    const value = board()
    const { combat } = value as unknown as { combat: GameCombatPresentation }
    combat.captureDeathMarker('captured-death', {
      texture: Texture.WHITE,
      globalPosition: { x: 500, y: 400 },
      worldScale: 0.7
    })
    const first = combat.presentDeathrattleGhost('captured-death')
    const ghost = combat.layer.getChildByLabel('game.deathrattle.captured-death')!
    expect({ x: ghost.x, y: ghost.y, scale: ghost.scale.x }).toEqual({
      x: 500,
      y: 400,
      scale: 0.7
    })
    expect(ghost.eventMode).toBe('none')
    const timeline = gsap.getTweensOf(ghost)[0]!.parent!
    value.pauseAnimations()
    expect(timeline.paused()).toBe(true)
    value.resumeAnimations()
    timeline.progress(1)
    await first
    expect(ghost.destroyed).toBe(true)
    const second = combat.presentDeathrattleGhost('captured-death')
    const interrupted = combat.layer.getChildByLabel('game.deathrattle.captured-death')!
    value.dispose()
    await second
    expect(interrupted.destroyed).toBe(true)
    expect(combat.layer.destroyed).toBe(true)
  })

  it.each([false, true])(
    'restores a combat attacker using queued stats and immunity (persistent: %s)',
    async (persistentImmune) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        animationScope: AnimationScope
        createHeroes(state: OpeningMatchState): void
        heroViews: Map<PlayerId, HeroView>
        combat: GameCombatPresentation
        enqueuePresentation(
          state: OpeningMatchState,
          present: () => Promise<void>
        ): Promise<void>
      }
      for (const player of internal.session.getState().players) {
        const result = internal.session.dispatch({
          type: 'confirm-mulligan',
          participantId: player.participantId,
          replaceInstanceIds: []
        })
        expect(result.accepted).toBe(true)
      }
      const state = internal.session.getState()
      internal.createHeroes(state)
      const [first, second] = state.players
      const attacker = internal.heroViews.get(first.participantId)!
      const defender = internal.heroViews.get(second.participantId)!
      const origin = {
        x: attacker.x,
        y: attacker.y,
        zIndex: attacker.zIndex,
        parent: attacker.parent,
        index: attacker.parent!.getChildIndex(attacker)
      }
      const beforeAttacker = {
        participantId: first.participantId,
        character: { kind: 'hero' } as const,
        attack: 3,
        healthBefore: 30,
        armorBefore: 0,
        immune: true
      }
      const beforeDefender = {
        participantId: second.participantId,
        character: { kind: 'hero' } as const,
        attack: 2,
        healthBefore: 30,
        armorBefore: 0
      }
      if (persistentImmune) {
        expect(
          internal.session.dispatch({
            type: 'dev-summon-minion',
            participantId: first.participantId,
            cardId: 'goblins_vs_gnomes_malganis'
          }).accepted
        ).toBe(true)
      }
      const captured = internal.session.dispatch({
        type: 'dev-set-hero',
        participantId: first.participantId,
        health: 27
      })
      expect(captured.accepted).toBe(true)
      const setStats = vi.spyOn(attacker, 'setStats')
      const timelines: gsap.core.Timeline[] = []
      const timeline = internal.animationScope.timeline.bind(internal.animationScope)
      vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
        const result = timeline(vars)
        timelines.push(result)
        return result
      })
      let completed = false
      const job = internal.enqueuePresentation(
        internal.session.getState(),
        async () => {
          await internal.combat.presentCombatStarted({
            type: 'combat-started',
            combatId: 'baseline-combat',
            attacker: beforeAttacker,
            defender: beforeDefender
          })
          expect(attacker.parent).toBe(internal.combat.layer)
          expect(attacker.zIndex).toBe(100)
          expect(attacker.getChildByLabel('hero.immune')!.visible).toBe(true)
          // An intervening HUD refresh uses the final state, where Longbow expired.
          attacker.setImmune(false)
          expect(attacker.getChildByLabel('hero.immune')!.visible).toBe(true)
          expect(defender.parent).toBe(origin.parent)
          await internal.combat.presentCombatResolved({
            type: 'character-combat-resolved',
            combatId: 'baseline-combat',
            weapon: null,
            attacker: {
              ...beforeAttacker,
              damageDealt: 3,
              attemptedDamage: 2,
              healthAfter: 28,
              armorAfter: 0,
              destroyed: false
            },
            defender: {
              ...beforeDefender,
              damageDealt: 2,
              attemptedDamage: 3,
              healthAfter: 27,
              armorAfter: 0,
              destroyed: false
            }
          })
          expect(attacker.getChildByLabel('hero.immune')!.visible).toBe(
            persistentImmune
          )
          completed = true
        }
      )
      // A newer authoritative command must not replace the running job's snapshot.
      const newer = internal.session.dispatch({
        type: 'dev-set-hero',
        participantId: first.participantId,
        health: 15
      })
      expect(newer.accepted).toBe(true)
      for (let pass = 0; pass < 30 && !completed; pass++) {
        await Promise.resolve()
        for (const animation of timelines) animation.progress(1)
      }
      expect(completed).toBe(true)
      await job
      expect(setStats).toHaveBeenLastCalledWith(0, 27, 0, 30)
      expect(attacker.parent).toBe(origin.parent)
      expect(attacker.parent!.getChildIndex(attacker)).toBe(origin.index)
      expect({ x: attacker.x, y: attacker.y, zIndex: attacker.zIndex }).toEqual({
        x: origin.x,
        y: origin.y,
        zIndex: origin.zIndex
      })
      expect(internal.combat.layer.children).not.toContain(attacker)
      const exiting = internal.combat.presentCombatStarted({
        type: 'combat-started',
        combatId: 'exit-combat',
        attacker: beforeAttacker,
        defender: beforeDefender
      })
      expect(attacker.parent).toBe(internal.combat.layer)
      const timelinesAtExit = timelines.length
      value.dispose()
      await exiting
      expect(timelines).toHaveLength(timelinesAtExit)
      expect(attacker.destroyed).toBe(true)
      expect(defender.destroyed).toBe(true)
    }
  )

  it('updates a hero immediately for a set-health effect event', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      createHeroes(state: OpeningMatchState): void
      heroViews: Map<PlayerId, HeroView>
      wait(duration: number): Promise<void>
      enqueuePresentation(
        state: OpeningMatchState,
        present: () => Promise<void>
      ): Promise<void>
      presentEffectResolved(
        event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
      ): Promise<void>
    }
    for (const player of internal.session.getState().players) {
      const result = internal.session.dispatch({
        type: 'confirm-mulligan',
        participantId: player.participantId,
        replaceInstanceIds: []
      })
      expect(result.accepted).toBe(true)
    }
    const ownerId = internal.session.localParticipantId
    const changed = internal.session.dispatch({
      type: 'dev-set-hero',
      participantId: ownerId,
      health: 10
    })
    expect(changed.accepted).toBe(true)
    if (!changed.accepted) return

    internal.createHeroes(changed.state)
    const hero = internal.heroViews.get(ownerId)!
    const setStats = vi.spyOn(hero, 'setStats')
    vi.spyOn(internal, 'wait').mockResolvedValue()
    const event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }> = {
      type: 'effect-resolved',
      revision: changed.state.revision,
      sourceInstanceId: 'alexstrasza-instance',
      sourceCardId: asCardId('classic_alexstrasza'),
      controllerId: ownerId,
      action: 'set-health',
      actionPath: 'play-card.battlecry[0]',
      data: {
        target: `${ownerId}:hero`,
        health: 15,
        healthBefore: 10,
        healthAfter: 15,
        maximumHealthAfter: 30
      }
    }

    await internal.enqueuePresentation(changed.state, () =>
      internal.presentEffectResolved(event)
    )

    expect(setStats).toHaveBeenCalledWith(0, 15, 0, 30)
  })

  it('removes Divine Shield from a surviving minion on a character damage summary', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      activePresentationState: OpeningMatchState | null
      insertRemoteMinionView(position: number, view: MinionView): void
      presentCharacterStateChange(
        event: Extract<OpeningMatchEvent, { type: 'character-damaged' }>
      ): void
    }
    const session = internal.session
    for (const player of session.getState().players) {
      const result = session.dispatch({
        type: 'confirm-mulligan',
        participantId: player.participantId,
        replaceInstanceIds: []
      })
      expect(result.accepted).toBe(true)
    }

    const summoned = session.dispatch({
      type: 'dev-summon-minion',
      participantId: session.remoteParticipantId,
      cardId: asCardId('classic_argent_squire')
    })
    expect(summoned.accepted).toBe(true)
    if (!summoned.accepted) return
    const before = summoned.state.players.find(
      (player) => player.participantId === session.remoteParticipantId
    )!.board[0]!
    const view = await MinionView.create(
      {
        label: `damage-summary.${before.instanceId}`,
        attack: before.attack,
        health: before.health,
        maxHealth: before.maxHealth,
        legendary: false,
        taunt: false,
        enraged: false,
        divineShield: true,
        frozen: false,
        stealth: false,
        deathrattle: false,
        poisonous: false,
        aura: false,
        trigger: false,
        inspire: false,
        windfury: false,
        spellDamage: false,
        lifesteal: false,
        elusive: false,
        immune: false
      },
      new Proxy({} as MinionViewTextures, { get: () => Texture.WHITE }),
      Texture.WHITE
    )
    view.instanceId = before.instanceId
    view.ownerId = session.remoteParticipantId
    view.cardId = before.cardId
    internal.insertRemoteMinionView(0, view)
    const shield = view.getChildByLabel('minion.divine-shield') as Sprite
    expect(shield.visible).toBe(true)

    expect(
      session.dispatch({
        type: 'dev-set-mana',
        participantId: session.localParticipantId,
        available: 2,
        maximum: 2
      }).accepted
    ).toBe(true)
    const result = session.dispatch({
      type: 'use-hero-power',
      participantId: session.localParticipantId,
      target: {
        kind: 'minion',
        participantId: session.remoteParticipantId,
        instanceId: before.instanceId
      }
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const damaged = result.events.find(
      (event): event is Extract<OpeningMatchEvent, { type: 'character-damaged' }> =>
        event.type === 'character-damaged' &&
        event.character.kind === 'minion' &&
        event.character.instanceId === before.instanceId
    )
    expect(damaged).toBeDefined()
    if (!damaged) return

    internal.activePresentationState = result.state
    internal.presentCharacterStateChange(damaged)
    expect(shield.visible).toBe(false)
  })

  it('does not route deck-originated discards through the hand animation', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      presentEffectResolved(
        event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
      ): Promise<void>
      presentHandDiscard(
        event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
      ): Promise<void>
    }
    const handDiscard = vi.spyOn(internal, 'presentHandDiscard').mockResolvedValue()
    const event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }> = {
      type: 'effect-resolved',
      revision: 1,
      sourceInstanceId: 'fel-reaver-instance',
      sourceCardId: asCardId('goblins_vs_gnomes_fel_reaver'),
      controllerId: internal.session.remoteParticipantId,
      action: 'discard',
      actionPath: 'trigger.on-card-played[0].discard[0]',
      data: {
        target: `${internal.session.remoteParticipantId}:deck:1`,
        cardId: null,
        fromZone: 'deck',
        participantId: internal.session.remoteParticipantId
      }
    }

    await internal.presentEffectResolved(event)

    expect(handDiscard).not.toHaveBeenCalled()
  })

  it('keeps hand hover blocked by reflow and targeting and clears listeners on exit', () => {
    const value = board()
    const internal = value as unknown as {
      hand: GameHandView
      heroPowerTargeting: boolean
    }
    const hand = internal.hand
    const slot = mulliganSlot('hover-card')
    const rest = layoutHand(1)[0]!
    slot.position.set(rest.x, rest.y)
    hand.layer.addChild(slot)
    hand.append({
      card: { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') },
      slot,
      restTransform: rest,
      displaced: false
    })
    hand.activate()
    hand.activate()
    const deferPreparation = vi.spyOn(hand.drag, 'deferPreparation')
    expect(hand.layer.listenerCount('pointermove')).toBe(1)
    expect(hand.layer.listenerCount('globalpointermove')).toBe(1)
    const move = (offsetX = 0) =>
      hand.layer.emit('pointermove', {
        getLocalPosition: () => ({ x: rest.x + offsetX, y: rest.y - 40 })
      } as unknown as FederatedPointerEvent)
    hand.setReflowing(true)
    move()
    expect(hand.hoveredSlot).toBeNull()
    hand.setReflowing(false)
    internal.heroPowerTargeting = true
    move()
    expect(hand.hoveredSlot).toBeNull()
    internal.heroPowerTargeting = false
    move()
    expect(hand.hoveredSlot).toBe(slot)
    expect(slot.zIndex).toBe(1000)
    move(1)
    expect(hand.hoveredSlot).toBe(slot)
    expect(deferPreparation).toHaveBeenCalledTimes(2)
    hand.layer.emit('pointerleave', {} as FederatedPointerEvent)
    expect(hand.hoveredSlot).toBeNull()
    value.dispose()
    expect(hand.layer.listenerCount('pointermove')).toBe(0)
    expect(hand.layer.listenerCount('globalpointermove')).toBe(0)
    expect(slot.destroyed).toBe(true)
  })

  it.each(['draw', 'generated', 'discover'] as const)(
    'keeps hover responsive while a %s card arrives',
    async (source) => {
      const value = board()
      const internal = value as unknown as {
        hand: GameHandView
        cardSelectionOverlay: CardSelectionOverlay
        createSlot(card: OpeningCard): Promise<GameCardSlot>
        prepareSlotAtDeck(): void
        prepareSlotAtGeneratedOrigin(): void
        addLocalCard(card: OpeningCard): Promise<void>
        spawnLocalCard(
          card: OpeningCard,
          origin: { x: number; y: number }
        ): Promise<void>
      }
      const hand = internal.hand
      const existing = ['first', 'second'].map((id, index) => {
        const slot = mulliganSlot(id)
        const rest = layoutHand(2)[index]!
        slot.position.set(rest.x, rest.y)
        slot.scale.set(rest.scale)
        hand.layer.addChild(slot)
        hand.append({
          card: { instanceId: id, cardId: asCardId('classic_wisp') },
          slot,
          restTransform: rest,
          displaced: false
        })
        return slot
      })
      hand.activate()
      const move = (index: number) => {
        const rest = hand.entries[index]!.restTransform!
        hand.layer.emit('pointermove', {
          getLocalPosition: () => ({ x: rest.x, y: rest.y - 40 })
        } as unknown as FederatedPointerEvent)
      }
      move(0)
      const enlargedScale = existing[0]!.scale.x
      const incoming = mulliganSlot('incoming')
      const card = { instanceId: 'incoming', cardId: asCardId('classic_wisp') }
      vi.spyOn(internal, 'createSlot').mockResolvedValue(incoming)
      vi.spyOn(internal, 'prepareSlotAtDeck').mockImplementation(() => {})
      vi.spyOn(internal, 'prepareSlotAtGeneratedOrigin').mockImplementation(() => {})
      vi.spyOn(hand, 'configureSlot').mockImplementation(() => {})
      if (source === 'discover') {
        vi.spyOn(internal.cardSelectionOverlay, 'takeSelected').mockReturnValue({
          card,
          slot: incoming,
          globalPosition: { x: 0, y: 0 }
        })
      }
      let land!: () => void
      const travel = new Promise<void>((resolve) => {
        land = resolve
      })
      vi.spyOn(hand, 'animateSlotToHand').mockReturnValue(travel)
      let finished = false
      const arrival = (
        source === 'generated'
          ? internal.spawnLocalCard(card, { x: 0, y: 0 })
          : internal.addLocalCard(card)
      ).then(() => {
        finished = true
      })
      await Promise.resolve()
      expect(hand.isReflowing).toBe(false)
      expect(hand.hoveredSlot).toBe(existing[0])
      for (const tween of gsap.getTweensOf([existing[0], existing[0]!.scale]))
        tween.progress(1)
      expect(existing[0]!.scale.x).toBe(enlargedScale)
      move(1)
      expect(hand.hoveredSlot).toBe(existing[1])
      for (const tween of gsap.getTweensOf([existing[1], existing[1]!.scale]))
        tween.progress(1)
      expect(existing[1]!.scale.x).toBe(enlargedScale)
      hand.layer.emit('pointerleave', {} as FederatedPointerEvent)
      expect(hand.hoveredSlot).toBeNull()
      move(2)
      expect(hand.hoveredSlot).toBeNull()
      expect(finished).toBe(false)
      // Finishing a draw must not release an unrelated interaction barrier.
      hand.setReflowing(true)
      land()
      await arrival
      expect(hand.isReflowing).toBe(true)
      move(2)
      expect(hand.hoveredSlot).toBeNull()
      hand.setReflowing(false)
      move(2)
      expect(hand.hoveredSlot).toBe(incoming)
    }
  )

  it('reuses held card resources on return and releases them on exit', async () => {
    const value = board()
    const internal = value as unknown as {
      hand: GameHandView
      updateLocalBoardPreview(point: { x: number; y: number }): void
    }
    const card = Object.assign(new Container(), {
      plan: { width: 620 },
      renderedHeight: 900,
      createAppearanceSnapshot: vi.fn(() =>
        RenderTexture.create({ width: 620, height: 900 })
      ),
      flushAppearanceSnapshot: vi.fn()
    })
    card.addChild(new Sprite(Texture.WHITE))
    const slot = Object.assign(mulliganSlot('held-card'), {
      card,
      playableOutlineTexture: Texture.WHITE,
      suppressPlayableOutline: vi.fn(),
      isPlayableOutlineEnabled: () => true,
      getPlayableOutlinePalette: () => 'blue',
      getPlayableOutlineTuning: () => undefined,
      getPlayableOutlinePreset: () => 'card'
    })
    slot.addChild(card)
    const rest = layoutHand(1)[0]!
    slot.position.set(rest.x, rest.y)
    internal.hand.layer.addChild(slot)
    internal.hand.append({
      card: { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') },
      slot,
      restTransform: rest,
      displaced: true
    })
    internal.hand.drag.activate()
    const preview = vi
      .spyOn(internal, 'updateLocalBoardPreview')
      .mockImplementation(() => undefined)
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 1)
    expect(card.createAppearanceSnapshot).not.toHaveBeenCalled()
    expect(card.visible).toBe(true)
    internal.hand.drag.update(16)
    preview.mockClear()
    expect(card.visible).toBe(false)
    expect(slot.children).toHaveLength(3)
    const firstSnapshot = card.createAppearanceSnapshot.mock.results[0]!.value
    const firstMeshes = slot.children.filter(
      (child): child is PerspectiveMesh => child instanceof PerspectiveMesh
    )
    const destroyGeometry = firstMeshes.map((mesh) =>
      vi.spyOn(mesh.geometry, 'destroy')
    )
    expect(internal.hand.layer.listenerCount('globalpointermove')).toBe(1)
    internal.hand.layer.emit('globalpointermove', {
      pointerId: 1,
      getLocalPosition: () => ({ x: rest.x + 11, y: rest.y })
    } as unknown as FederatedPointerEvent)
    expect(internal.hand.drag.movedBeyondThreshold).toBe(true)
    expect(internal.hand.drag.pointer).toEqual({ x: rest.x + 11, y: rest.y })
    for (const x of [rest.x + 30, rest.x])
      internal.hand.layer.emit('globalpointermove', {
        pointerId: 1,
        getLocalPosition: () => ({ x, y: rest.y })
      } as unknown as FederatedPointerEvent)
    expect(internal.hand.drag.movedBeyondThreshold).toBe(true)
    expect(preview).not.toHaveBeenCalled()
    internal.hand.drag.update(16)
    expect(preview).toHaveBeenCalledExactlyOnceWith({ x: rest.x, y: rest.y })
    internal.hand.drag.flushPointer({ x: rest.x + 50, y: rest.y - 40 }, 1)
    expect(preview).toHaveBeenLastCalledWith({ x: rest.x + 50, y: rest.y - 40 })
    internal.hand.drag.end()
    gsap.getTweensOf(slot)[0]!.parent!.progress(1)
    await Promise.resolve()
    expect(internal.hand.drag.index).toBeNull()
    expect(firstSnapshot.destroyed).toBe(false)
    expect(card.visible).toBe(true)
    expect(slot.children).toEqual([card])
    expect(slot.suppressPlayableOutline).toHaveBeenLastCalledWith(false)
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 2)
    internal.hand.drag.update(16)
    expect(card.createAppearanceSnapshot).toHaveBeenCalledOnce()
    expect(slot.children.filter((child) => child instanceof PerspectiveMesh)).toEqual(
      firstMeshes
    )
    internal.hand.drag.acceptCard(() => {
      expect(card.visible).toBe(false)
      expect(slot.children).toHaveLength(3)
    })
    expect(card.visible).toBe(true)
    expect(slot.children).toEqual([card])
    expect(internal.hand.drag.index).toBeNull()
    expect(internal.hand.drag.returning).toBe(true)
    expect(internal.hand.isReflowing).toBe(true)
    internal.hand.drag.presentationSettled()
    const entry = internal.hand.entries[0]!
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 3)
    internal.hand.drag.update(16)
    internal.hand.drag.releaseForTargeting(entry)
    expect(slot.children).toEqual([card])
    expect(slot.suppressPlayableOutline).toHaveBeenLastCalledWith(true)
    expect(internal.hand.drag.index).toBeNull()
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 4)
    internal.hand.drag.update(16)
    internal.hand.drag.hideForPendingPlay(entry)
    expect(slot.visible).toBe(false)
    expect(slot.children).toEqual([card])
    expect(internal.hand.drag.index).toBeNull()
    slot.visible = true
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 5)
    internal.hand.drag.update(16)
    value.dispose()
    for (const result of card.createAppearanceSnapshot.mock.results)
      expect(result.value.destroyed).toBe(true)
    for (const destroy of destroyGeometry)
      expect(destroy).toHaveBeenCalledExactlyOnceWith(true)
    expect(slot.destroyed).toBe(true)
  })

  it('gates mulligan selection until the deal finishes and restores it after rejection', async () => {
    const value = board()
    const internal = value as unknown as {
      createSlot(card: OpeningCard): Promise<GameCardSlot>
      createInitialLocalCards(cards: readonly OpeningCard[]): Promise<void>
      mulligan: GameMulliganView
      session: GameBoardSession
      confirmMulligan(): Promise<void>
      hand: GameHandView
    }
    const slot = mulliganSlot('missing-card')
    vi.spyOn(internal, 'createSlot').mockResolvedValue(slot)
    internal.mulligan.createLayer()
    internal.mulligan.createControls()
    const confirmButton = internal.mulligan.layer.children.find(
      (child) => child instanceof Button
    )!
    const dispatch = vi.spyOn(internal.session, 'dispatch')
    await internal.createInitialLocalCards([
      { instanceId: slot.instanceId, cardId: asCardId('classic_wisp') }
    ])
    const tap = (button = 0) =>
      slot.emit('pointertap', { button } as FederatedPointerEvent)
    tap()
    expect(slot.setSelected).not.toHaveBeenCalled()
    internal.mulligan.setInputEnabled(true)
    tap(2)
    expect(slot.setSelected).not.toHaveBeenCalled()
    tap()
    expect(slot.setSelected).toHaveBeenLastCalledWith(true)
    expect(slot.setPlayableOutlineEnabled).toHaveBeenLastCalledWith(false)
    await internal.confirmMulligan()
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ replaceInstanceIds: ['missing-card'] })
    )
    expect(confirmButton.visible).toBe(true)
    expect(slot.setMulliganInteractionEnabled).toHaveBeenLastCalledWith(true)
    expect(slot.setSelected).toHaveBeenLastCalledWith(true)
    tap()
    expect(slot.setSelected).toHaveBeenLastCalledWith(false)
    expect(slot.setPlayableOutlineEnabled).toHaveBeenLastCalledWith(true)
    confirmButton.emit('pointerdown', { button: 0 } as FederatedPointerEvent)
    expect(gsap.getTweensOf(confirmButton.sprite.scale).length).toBeGreaterThan(0)
    value.dispose()
    expect(gsap.getTweensOf(confirmButton.sprite.scale)).toHaveLength(0)
    expect(slot.destroyed).toBe(true)
    expect(slot.disposePlayableOutline).toHaveBeenCalledOnce()
  })

  it.each([3, 4])(
    'keeps %i opening cards in hand order when artwork finishes in reverse',
    async (count) => {
      const value = board()
      const internal = value as unknown as {
        mulligan: GameMulliganView
        createSlot(card: OpeningCard): Promise<GameCardSlot>
        createInitialLocalCards(cards: readonly OpeningCard[]): Promise<void>
        prepareSlotAtDeck(): void
        animateDeckDeparture(
          slot: GameCardSlot,
          duration: number,
          delay: number,
          profile: string
        ): Promise<void>
        drawOrigins: WeakMap<Container, Sprite>
        hand: GameHandView
      }
      const slots = Array.from({ length: count }, (_, index) =>
        mulliganSlot(`opening-${index}`)
      )
      const cards = slots.map((slot) => ({
        instanceId: slot.instanceId,
        cardId: asCardId('classic_wisp')
      }))
      const releases: Array<(slot: GameCardSlot) => void> = []
      vi.spyOn(internal, 'createSlot').mockImplementation(
        () => new Promise((resolve) => releases.push(resolve))
      )
      const creating = internal.createInitialLocalCards(cards)
      for (let index = count - 1; index >= 0; index--) {
        releases[index]!(slots[index]!)
        await Promise.resolve()
      }
      await creating
      expect(internal.hand.entries.map((entry) => entry.slot)).toEqual(slots)
      expect(internal.mulligan.initialCardCount).toBe(count)
      vi.spyOn(internal, 'prepareSlotAtDeck').mockImplementation(() => undefined)
      const depart = vi.spyOn(internal, 'animateDeckDeparture').mockResolvedValue()
      const deck = new Sprite(Texture.WHITE)
      for (const slot of slots) internal.drawOrigins.set(slot, deck)
      await internal.mulligan.dealInitialCards(0, Math.min(3, count))
      if (count === 4)
        await internal.mulligan.dealInitialCards(
          3,
          4,
          OPENING_TIMING.playerTwoFourthCard
        )
      expect(depart.mock.calls.map(([slot]) => slot)).toEqual(slots)
      expect(depart.mock.calls.map(([, , delay]) => delay)).toEqual(
        count === 4 ? [0, 0.5, 1, 0] : [0, 0.5, 1]
      )
      const layout = GAME_BOARD_LAYOUT.mulligan.cards
      expect(slots.map((slot) => slot.x)).toEqual(
        slots.map((_, index) => layout.centerX + (index - (count - 1) / 2) * layout.gap)
      )
      for (const slot of slots) {
        expect(slot.parent).toBe(internal.mulligan.layer)
        expect(slot.y).toBe(layout.baselineY)
        expect(slot.scale.x).toBe(layout.scale)
      }
      deck.destroy()
    }
  )

  it('keeps mulligan animations in the board scope and ignores a departed card after disposal', async () => {
    const value = board()
    const internal = value as unknown as {
      mulligan: GameMulliganView
      drawOrigins: WeakMap<Container, Sprite>
      travelLayer: Container
      animateDeckDeparture(): Promise<void>
    }
    internal.mulligan.createLayer()
    internal.mulligan.createControls()
    const slot = mulliganSlot('replacement')
    internal.travelLayer.addChild(slot)
    const movement = internal.mulligan.animateSlot(slot, 0, 3, OPENING_TIMING.cardDeal)
    const timeline = gsap.getTweensOf(slot)[0]!.parent!
    value.pauseAnimations()
    expect(timeline.paused()).toBe(true)
    value.resumeAnimations()
    expect(timeline.paused()).toBe(false)
    timeline.progress(1)
    await movement
    expect(slot.parent).toBe(internal.mulligan.layer)
    internal.mulligan.enableSelection()
    expect(internal.mulligan.beginConfirmation([slot])).toEqual([])
    expect(internal.mulligan.beginConfirmation([slot])).toBeNull()
    internal.mulligan.showConfirmed(true)
    const waiting = internal.mulligan.layer.getChildByLabel(
      'game.mulligan.opponent-still-choosing'
    )!
    expect(waiting.visible).toBe(true)
    let release!: () => void
    vi.spyOn(internal, 'animateDeckDeparture').mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const deck = new Sprite(Texture.WHITE)
    internal.drawOrigins.set(slot, deck)
    const pending = internal.mulligan.animateSlot(slot, 0, 3, OPENING_TIMING.cardDeal)
    value.dispose()
    release()
    await pending
    expect(slot.destroyed).toBe(true)
    expect(waiting.destroyed).toBe(true)
    expect(internal.mulligan.layer.destroyed).toBe(true)
    deck.destroy()
  })

  it('keeps queued presentation snapshots separate from immediately accepted commands', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      enqueuePresentation(
        state: OpeningMatchState,
        present: () => Promise<void>
      ): Promise<void>
      presentationState(): OpeningMatchState
    }
    const firstState = internal.session.getState()
    let release!: () => void
    const order: number[] = []
    const first = internal.enqueuePresentation(firstState, async () => {
      order.push(internal.presentationState().revision)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      expect(internal.presentationState()).toEqual(firstState)
    })
    await Promise.resolve()
    const result = internal.session.dispatch({
      type: 'dev-set-mana',
      participantId: internal.session.localParticipantId,
      available: 5,
      maximum: 5
    })
    expect(result.accepted).toBe(true)
    expect(internal.session.getState().revision).toBeGreaterThan(firstState.revision)
    const second = internal.enqueuePresentation(result.state, async () => {
      order.push(internal.presentationState().revision)
    })
    expect(order).toEqual([firstState.revision])
    release()
    await Promise.all([first, second])
    expect(order).toEqual([firstState.revision, result.state.revision])
    expect(internal.presentationState()).toEqual(internal.session.getState())
  })

  it('clears targeting and choice presentation on focus loss and scene exit', () => {
    const value = board()
    const internal = value as unknown as {
      heroPowerTargeting: boolean
      targetGestures: TargetGestureController<{ kind: 'hero-power' }>
      cardPlay: GameCardTargeting
      handleWindowBlur(): void
    }
    internal.heroPowerTargeting = true
    internal.targetGestures.begin({ kind: 'hero-power' }, 7, { x: 10, y: 10 })
    const choice = new Sprite(Texture.WHITE)
    internal.cardPlay.cardChoiceLayer.addChild(choice)
    internal.handleWindowBlur()
    expect(internal.heroPowerTargeting).toBe(false)
    expect(internal.targetGestures.current).toBeNull()
    expect(choice.destroyed).toBe(true)
    value.dispose()
    expect(value.destroyed).toBe(true)
    const replacement = board()
    expect(replacement.destroyed).toBe(false)
  })

  it('owns a banner through pause, resume, replacement, completion, and disposal', async () => {
    const value = board()
    const internal = value as unknown as {
      hud: { presentYourTurnFlag(texture: Texture): void }
      turnLayer: Container
    }
    internal.hud.presentYourTurnFlag(Texture.WHITE)
    const first = internal.turnLayer.children.find(
      (child) => child.label === 'game.your-turn-flag'
    ) as Sprite
    expect(first).toBeDefined()
    expect(first.eventMode).toBe('none')
    const tween = gsap.getTweensOf(first)[0]!
    expect(tween).toBeDefined()
    value.pauseAnimations()
    expect(tween.parent!.paused()).toBe(true)
    value.resumeAnimations()
    expect(tween.parent!.paused()).toBe(false)
    const oldTimelinePause = vi.spyOn(tween.parent!, 'pause')
    internal.hud.presentYourTurnFlag(Texture.WHITE)
    expect(first.destroyed).toBe(true)
    value.pauseAnimations()
    expect(oldTimelinePause).not.toHaveBeenCalled()
    value.resumeAnimations()
    const second = internal.turnLayer.children.find(
      (child) => child.label === 'game.your-turn-flag'
    ) as Sprite
    expect(second).not.toBe(first)
    gsap.getTweensOf(second)[0]!.parent!.progress(1)
    await Promise.resolve()
    expect(second.destroyed).toBe(true)
    internal.hud.presentYourTurnFlag(Texture.WHITE)
    const third = internal.turnLayer.children.find(
      (child) => child.label === 'game.your-turn-flag'
    ) as Sprite
    value.dispose()
    expect(third.destroyed).toBe(true)
  })
})

describe('PresentationQueue', () => {
  it('runs presentation work in submission order without delaying submission', async () => {
    const queue = new PresentationQueue()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push('first')
            resolve()
          }
        })
    )
    const second = queue.enqueue(async () => {
      order.push('second')
    })

    await Promise.resolve()
    expect(queue.busy).toBe(true)
    expect(order).toEqual([])

    releaseFirst?.()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
    expect(queue.busy).toBe(false)
  })

  it('continues after a failed presentation', async () => {
    const queue = new PresentationQueue()
    const failed = queue.enqueue(async () => {
      throw new Error('presentation failed')
    })
    const next = queue.enqueue(async () => 'presented')

    await expect(failed).rejects.toThrow('presentation failed')
    await expect(next).resolves.toBe('presented')
  })
})

describe('shared board card hover preview', () => {
  it.each(['drag', 'card', 'hero-power', 'combat'] as const)(
    'dismisses previews while %s is active',
    async (mode) => {
      const value = board()
      const internal = value as unknown as {
        hand: GameHandView
        cardPlay: { current: unknown }
        heroPowerTargeting: boolean
        selectedCombatView: Container | null
        boardCardPreview: Container | null
        hoveredBoardCardView: Container | null
        showBoardCardPreview(view: Container): Promise<void>
        isBoardCardPreviewEnabled(): boolean
      }
      expect(internal.isBoardCardPreviewEnabled()).toBe(true)
      const source = new Container()
      const preview = new Container()
      internal.boardCardPreview = preview
      internal.hoveredBoardCardView = source
      if (mode === 'drag')
        vi.spyOn(internal.hand.drag, 'index', 'get').mockReturnValue(0)
      if (mode === 'card')
        vi.spyOn(internal.cardPlay, 'current', 'get').mockReturnValue({})
      if (mode === 'hero-power') internal.heroPowerTargeting = true
      if (mode === 'combat') internal.selectedCombatView = source
      expect(internal.isBoardCardPreviewEnabled()).toBe(false)
      await internal.showBoardCardPreview(source)
      expect(preview.destroyed).toBe(true)
      expect(internal.boardCardPreview).toBeNull()
      expect(internal.hoveredBoardCardView).toBeNull()
      vi.restoreAllMocks()
      internal.heroPowerTargeting = false
      internal.selectedCombatView = null
      source.destroy()
    }
  )
})

describe('hero power hover during mulligan', () => {
  it('does not arm a hero-power preview while the match is in mulligan', () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      heroPowerViews: Map<
        PlayerId,
        {
          toLocal(point: { readonly x: number; readonly y: number }): {
            readonly x: number
            readonly y: number
          }
          containsCanvasPoint(x: number, y: number): boolean
          setHoverAura(enabled: boolean): void
          dispose(): void
        }
      >
      updateHeroPowerHover(point: { readonly x: number; readonly y: number }): void
      hoveredHeroPowerParticipantId: PlayerId | null
      hoverPreview: { currentKey(): string | null }
    }
    const participantId = internal.session.localParticipantId
    internal.heroPowerViews.set(participantId, {
      toLocal: () => ({ x: 0, y: 0 }),
      containsCanvasPoint: () => true,
      setHoverAura: vi.fn(),
      dispose: vi.fn()
    })

    internal.updateHeroPowerHover({ x: 0, y: 0 })

    expect(internal.hoveredHeroPowerParticipantId).toBeNull()
    expect(internal.hoverPreview.currentKey()).toBeNull()
  })
})

describe('board preview asynchronous cancellation', () => {
  it.each(['leave', 'remove', 'switch'] as const)(
    'cancels pending artwork on %s',
    async (action) => {
      const value = board()
      const internal = value as unknown as {
        resolver: { loadArtwork(): Promise<unknown> }
        boardCardPreviewForView(view: Container): unknown
        showBoardCardPreview(view: Container): Promise<void>
        hideBoardCardPreview(view?: Container): void
        removeWeaponView(owner: PlayerId, view: Container): void
        weaponViews: Map<PlayerId, Container>
        boardCardPreview: Container | null
        hoveredBoardCardView: Container | null
      }
      const source = new Container()
      const other = new Container()
      value.addChild(source, other)
      vi.spyOn(internal, 'boardCardPreviewForView').mockReturnValue({
        key: 'weapon-1',
        model: { card: { id: asCardId('basic_fiery_war_axe') } }
      })
      let resolveArtwork!: () => void
      vi.spyOn(internal.resolver, 'loadArtwork').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveArtwork = resolve
          })
      )
      const pending = internal.showBoardCardPreview(source)
      const finishFirst = resolveArtwork
      if (action === 'leave') internal.hideBoardCardPreview(source)
      if (action === 'remove') {
        const owner = 'local' as PlayerId
        internal.weaponViews.set(owner, source)
        internal.removeWeaponView(owner, source)
      }
      let next: Promise<void> | undefined
      if (action === 'switch') next = internal.showBoardCardPreview(other)
      finishFirst()
      await pending
      expect(internal.boardCardPreview).toBeNull()
      expect(internal.hoveredBoardCardView).toBe(action === 'switch' ? other : null)
      if (next) {
        internal.hideBoardCardPreview(other)
        resolveArtwork()
        await next
      }
    }
  )
})

describe('Secret reveal choreography', () => {
  it('separates banner/count/card stages and resolves only after the fast fade', async () => {
    const view = new SecretRevealView(Texture.WHITE)
    const internal = view as unknown as {
      resolver: CardAssetResolver
      animations: AnimationScope
      screen: Sprite
    }
    const card = new Container() as CardView
    vi.spyOn(internal.resolver, 'loadArtwork').mockResolvedValue(undefined)
    const create = vi.spyOn(CardView, 'create').mockResolvedValue(card)
    const timeline = gsap.timeline({ paused: true })
    vi.spyOn(internal.animations, 'timeline').mockReturnValue(timeline)
    const consume = vi.fn()
    let finished = false
    const job = view
      .present('classic_counterspell', { x: 1027, y: 100 }, consume, true, 'remote')
      .then(() => {
        finished = true
      })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(create.mock.calls[0][2]).toMatchObject({
      premium: true,
      premiumSide: 'remote'
    })
    expect(card.visible).toBe(false)
    expect(card.position).toMatchObject({ x: 1027, y: 100 })
    timeline.totalTime(0.35, false)
    expect(internal.screen.scale.x).toBe(1)
    expect(internal.screen.alpha).toBe(1)
    timeline.totalTime(0.79, false)
    expect(consume).not.toHaveBeenCalled()
    expect(card.visible).toBe(false)
    timeline.totalTime(0.81, false)
    expect(consume).toHaveBeenCalledOnce()
    expect(internal.screen.visible).toBe(false)
    expect(card.visible).toBe(true)
    timeline.totalTime(1.45, false)
    expect(card.position).toMatchObject(SECRET_LAYOUT.revealCard.position)
    expect(card.scale.x).toBeCloseTo(0.6)
    expect(card.alpha).toBe(1)
    expect(finished).toBe(false)
    timeline.totalTime(1.6, false)
    await job
    expect(finished).toBe(true)
    expect(card.destroyed).toBe(true)
    expect(view.visible).toBe(false)
    timeline.kill()
    view.destroy({ children: true })
  })

  it('settles on disposal even while artwork is pending', async () => {
    const view = new SecretRevealView(Texture.WHITE)
    const internal = view as unknown as { resolver: CardAssetResolver }
    let release!: () => void
    vi.spyOn(internal.resolver, 'loadArtwork').mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(undefined)
      })
    )
    const create = vi.spyOn(CardView, 'create')
    const consume = vi.fn()
    const job = view.present('classic_counterspell', { x: 985, y: 100 }, consume)
    view.destroy({ children: true })
    await job
    release()
    await Promise.resolve()
    expect(create).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('grouped summon presentation', () => {
  function boomEvents() {
    const scenario = createMatchScenario({
      cardId: 'goblins_vs_gnomes_dr_boom',
      seed: 240
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    })
    const card = scenario.match
      .getState()
      .players.find((player) => player.participantId === participantId)!
      .hand.find((card) => card.cardId === 'goblins_vs_gnomes_dr_boom')!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 0
    })
    if (!result.accepted) throw new Error(result.message)
    return result.events
  }

  it('groups a real Boom Battlecry across its summon bookkeeping', () => {
    const events = boomEvents()
    const start = events.findIndex(
      (event) => event.type === 'minion-summoned' && !!event.summonGroupId
    )
    const batch = summonPresentationBatch(events, start)!
    expect(batch.summons).toHaveLength(2)
    expect(batch.bookkeeping.some((event) => event.type === 'effect-resolved')).toBe(
      true
    )
    expect(batch.end).toBeGreaterThan(start)
  })

  it('stops at gameplay consequences and distinct action executions', () => {
    const summons = boomEvents()
      .filter((event) => event.type === 'minion-summoned')
      .filter((event) => !!event.summonGroupId)
    const first = summons[0]!
    const second = summons[1]!
    const barrier: OpeningMatchEvent = {
      type: 'death-batch-completed',
      batchId: 'death'
    }
    expect(summonPresentationBatch([first, barrier, second], 0)!.summons).toHaveLength(
      1
    )
    expect(
      summonPresentationBatch(
        [first, { ...second, summonGroupId: 'another-action' }],
        0
      )!.summons
    ).toHaveLength(1)
    expect(
      summonPresentationBatch([{ ...first, summonGroupId: undefined }, second], 0)
    ).toBeNull()
  })

  it.each(['local', 'remote'] as const)(
    'waits for all artwork and starts the %s entrances together',
    async (side) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        animationScope: AnimationScope
        boardPositions: BoardPositionController
        createSummonedMinionView(event: unknown): Promise<MinionView>
        presentMinionSummonBatch(events: readonly OpeningMatchEvent[]): Promise<void>
        wireMinionView(view: MinionView): void
        syncBoardAttackability(): void
      }
      vi.spyOn(internal, 'wireMinionView').mockImplementation(() => undefined)
      vi.spyOn(internal, 'syncBoardAttackability').mockImplementation(() => undefined)
      const fakeView = () =>
        Object.assign(new Container(), {
          setBaseScale: vi.fn(),
          presentTauntPop: vi.fn(),
          isSelected: () => false
        }) as unknown as MinionView
      const firstView = fakeView()
      const secondView = fakeView()
      let resolveSecond!: (view: MinionView) => void
      vi.spyOn(internal, 'createSummonedMinionView')
        .mockResolvedValueOnce(firstView)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveSecond = resolve
          })
        )
      const participantId =
        side === 'local'
          ? internal.session.localParticipantId
          : internal.session.remoteParticipantId
      const events = boomEvents()
        .filter((event) => event.type === 'minion-summoned')
        .filter((event) => !!event.summonGroupId)
        .map((event) => ({ ...event, participantId, position: 0 }))
      const layout = vi.spyOn(internal.boardPositions, 'layout')
      const timelines: gsap.core.Timeline[] = []
      const makeTimeline = internal.animationScope.timeline.bind(
        internal.animationScope
      )
      vi.spyOn(internal.animationScope, 'timeline').mockImplementation((vars) => {
        const timeline = makeTimeline(vars).pause()
        timelines.push(timeline)
        return timeline
      })
      const job = internal.presentMinionSummonBatch(events)
      for (let i = 0; i < 8; i++) await Promise.resolve()
      expect(firstView.parent).toBeNull()
      expect(timelines).toHaveLength(0)
      resolveSecond(secondView)
      for (let i = 0; i < 15; i++) await Promise.resolve()
      expect(internal.boardPositions.views(side)).toEqual([secondView, firstView])
      expect(layout).toHaveBeenCalledTimes(1)
      expect(timelines).toHaveLength(1)
      const timeline = timelines[0]!
      const starts = timeline.getChildren().map((child) => child.startTime())
      expect(starts).toEqual([0, 0])
      expect(firstView.alpha).toBe(0)
      expect(secondView.alpha).toBe(0)
      timeline.progress(0.5)
      expect(firstView.alpha).toBeGreaterThan(0)
      expect(firstView.alpha).toBe(secondView.alpha)
      timeline.progress(1)
      await job
    }
  )
  it.each(['failure', 'disposal'] as const)(
    'cleans prepared summon views on %s',
    async (mode) => {
      const value = board()
      const internal = value as unknown as {
        session: GameBoardSession
        createSummonedMinionView(event: unknown): Promise<MinionView>
        presentMinionSummonBatch(events: readonly OpeningMatchEvent[]): Promise<void>
      }
      const firstView = new Container() as unknown as MinionView
      const secondView = new Container() as unknown as MinionView
      let resolveSecond!: (view: MinionView) => void
      let rejectSecond!: (error: Error) => void
      vi.spyOn(internal, 'createSummonedMinionView')
        .mockResolvedValueOnce(firstView)
        .mockReturnValueOnce(
          new Promise((resolve, reject) => {
            resolveSecond = resolve
            rejectSecond = reject
          })
        )
      const events = boomEvents()
        .filter((event) => event.type === 'minion-summoned')
        .filter((event) => !!event.summonGroupId)
        .map((event) => ({
          ...event,
          participantId: internal.session.localParticipantId
        }))
      const job = internal.presentMinionSummonBatch(events)
      if (mode === 'failure') {
        const rejected = expect(job).rejects.toThrow('artwork failed')
        rejectSecond(new Error('artwork failed'))
        await rejected
        secondView.destroy()
      } else {
        value.dispose()
        resolveSecond(secondView)
        await job
        expect(secondView.destroyed).toBe(true)
      }
      expect(firstView.destroyed).toBe(true)
    }
  )

  it('does not recreate or duplicate views already materialized by reconciliation', async () => {
    const value = board()
    const internal = value as unknown as {
      session: GameBoardSession
      boardPositions: BoardPositionController
      createSummonedMinionView(event: unknown): Promise<MinionView>
      presentMinionSummoned(event: unknown): Promise<void>
      presentMinionSummonBatch(events: readonly OpeningMatchEvent[]): Promise<void>
    }
    const events = boomEvents()
      .filter((event) => event.type === 'minion-summoned')
      .filter((event) => !!event.summonGroupId)
      .map((event) => ({
        ...event,
        participantId: internal.session.localParticipantId
      }))
    const views = events.map(
      (event) =>
        Object.assign(new Container(), {
          instanceId: event.minion.instanceId,
          ownerId: event.participantId,
          isSelected: () => false,
          setBaseScale: vi.fn()
        }) as unknown as MinionView
    )
    views.forEach((view, index) => internal.boardPositions.insert('local', index, view))
    const create = vi.spyOn(internal, 'createSummonedMinionView')
    vi.spyOn(internal, 'presentMinionSummoned').mockResolvedValue()
    await internal.presentMinionSummonBatch(events)
    expect(create).not.toHaveBeenCalled()
    expect(internal.boardPositions.views('local')).toEqual(views)
  })
})
