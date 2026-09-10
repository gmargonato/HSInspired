import { PresentationQueue } from './presentation-queue'
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
import { layoutHand } from './hand-layout'
import type { HandEntry } from './game-hand-entry'
import type { PlayCardInput } from '../../../game/match'
import {
  MinionView,
  type MinionViewTextures
} from '../../rendering/minions/minion-view'
import type { MinionPreviewPresentation } from './game-card-targeting-types'
import type { CardSelectionOverlay } from './card-selection-overlay'

function mulliganSlot(instanceId: string): GameCardSlot {
  return Object.assign(new Container(), {
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

describe('board lifecycle preservation', () => {
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

  it('promotes and restores a combat attacker using the queued snapshot for final stats', async () => {
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
      armorBefore: 0
    }
    const beforeDefender = {
      participantId: second.participantId,
      character: { kind: 'hero' } as const,
      attack: 2,
      healthBefore: 30,
      armorBefore: 0
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
    const job = internal.enqueuePresentation(captured.state, async () => {
      await internal.combat.presentCombatStarted({
        type: 'combat-started',
        combatId: 'baseline-combat',
        attacker: beforeAttacker,
        defender: beforeDefender
      })
      expect(attacker.parent).toBe(internal.combat.layer)
      expect(attacker.zIndex).toBe(100)
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
      completed = true
    })
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
  })

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
      renderedHeight: 900
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
