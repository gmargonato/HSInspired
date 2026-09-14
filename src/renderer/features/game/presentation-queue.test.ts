import { PresentationQueue } from './presentation-queue'
import { randomSpellPresentationStates } from './random-spell-presentation'
import type { RemoteCardPlayPreview } from './remote-card-play-preview'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Container,
  Sprite,
  Texture,
  DOMAdapter,
  RenderTexture,
  type FederatedPointerEvent
} from 'pixi.js'
import { GameMulliganView } from './game-mulligan-view'
import type { GameHandView } from './game-hand-view'
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
import type { HeroView } from '../../rendering/heroes/hero-view'
import type { GameCardSlot } from './game-card-slot'
import { TargetGestureController } from './target-gesture'
import { asCardId } from '../../../game/content/cards'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { OPENING_TIMING } from './game-presentation-timing'
import { DEFAULT_HAND_LAYOUT, layoutHand } from './hand-layout'
import { attachShadow } from '../../rendering/shadows/shadow-caster'
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
      canvas: { parentElement: null },
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
  for (const value of boards.splice(0)) if (!value.destroyed) value.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
            divineShield: false,
            frozen: false,
            stealth: false,
            deathrattle: false,
            poisonous: false,
            trigger: false,
            inspire: false,
            windfury: false,
            spellDamage: false,
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
        suppressPlayableOutline: vi.fn(),
        enableBakedPlayableOutline: vi.fn()
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
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: false,
          poisonous: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
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
        suppressPlayableOutline: vi.fn(),
        enableBakedPlayableOutline: vi.fn()
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
          divineShield: false,
          frozen: false,
          stealth: false,
          deathrattle: false,
          poisonous: false,
          trigger: false,
          inspire: false,
          windfury: false,
          spellDamage: false,
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
    expect(hand.layer.listenerCount('pointermove')).toBe(1)
    expect(hand.layer.listenerCount('globalpointermove')).toBe(1)
    const move = () =>
      hand.layer.emit('pointermove', {
        getLocalPosition: () => ({ x: rest.x, y: rest.y - 40 })
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

  it('releases a held card snapshot and ticker when returning to the hand or exiting', async () => {
    const value = board()
    const internal = value as unknown as {
      hand: GameHandView
    }
    const card = Object.assign(new Container(), {
      plan: { width: 620 },
      renderedHeight: 900,
      createAppearanceSnapshot: () => RenderTexture.create({ width: 620, height: 900 })
    })
    card.addChild(new Sprite(Texture.WHITE))
    const slot = Object.assign(mulliganSlot('held-card'), {
      card,
      playableOutlineTexture: Texture.WHITE,
      suppressPlayableOutline: vi.fn(),
      isPlayableOutlineEnabled: () => true,
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
    const addTicker = vi.spyOn(gsap.ticker, 'add')
    internal.hand.drag.activate()
    const removeTicker = vi.spyOn(gsap.ticker, 'remove')
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 1)
    expect(card.visible).toBe(false)
    expect(slot.children).toHaveLength(3)
    const firstTick = addTicker.mock.lastCall![0]
    expect(internal.hand.layer.listenerCount('globalpointermove')).toBe(1)
    internal.hand.layer.emit('globalpointermove', {
      pointerId: 1,
      getLocalPosition: () => ({ x: rest.x + 11, y: rest.y })
    } as unknown as FederatedPointerEvent)
    expect(internal.hand.drag.movedBeyondThreshold).toBe(true)
    expect(internal.hand.drag.pointer).toEqual({ x: rest.x + 11, y: rest.y })
    internal.hand.drag.end()
    gsap.getTweensOf(slot)[0]!.parent!.progress(1)
    await Promise.resolve()
    expect(internal.hand.drag.index).toBeNull()
    expect(removeTicker).toHaveBeenCalledWith(firstTick)
    expect(card.visible).toBe(true)
    expect(slot.children).toEqual([card])
    expect(slot.suppressPlayableOutline).toHaveBeenLastCalledWith(false)
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 2)
    const secondTick = addTicker.mock.lastCall![0]
    internal.hand.drag.acceptCard(() => {
      expect(removeTicker).toHaveBeenCalledWith(secondTick)
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
    internal.hand.drag.releaseForTargeting(entry)
    expect(slot.children).toEqual([card])
    expect(slot.suppressPlayableOutline).toHaveBeenLastCalledWith(true)
    expect(internal.hand.drag.index).toBeNull()
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 4)
    internal.hand.drag.hideForPendingPlay(entry)
    expect(slot.visible).toBe(false)
    expect(slot.children).toEqual([card])
    expect(internal.hand.drag.index).toBeNull()
    slot.visible = true
    internal.hand.drag.begin(0, { x: rest.x, y: rest.y }, 5)
    const finalTick = addTicker.mock.lastCall![0]
    value.dispose()
    expect(removeTicker).toHaveBeenCalledWith(finalTick)
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
        count === 4 ? [0, 0.35, 0.7, 0] : [0, 0.35, 0.7]
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
