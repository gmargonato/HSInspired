import { describe, expect, it } from 'vitest'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import {
  enumerateLegalCommands,
  type OpeningMatchCheckpoint,
  type TurnMatchCommand
} from '../../../game-rules/match'
import { GameBoardSession } from '../game-board-session'
import {
  createExpertExpiringAttackInspector,
  EXPERT_EXPIRING_ATTACK_MAX_DISPATCHES
} from './expert-expiring-hero-attack'

type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T
type FixtureOptions = Parameters<typeof createAiFixture>[0]

function position(
  options: Partial<FixtureOptions> = {},
  edit?: (checkpoint: Mutable<OpeningMatchCheckpoint>, actor: string) => void
) {
  const fixture = createAiFixture({
    seed: 4004,
    aiHeroId: 'malfurion',
    opponentHeroId: 'thrall',
    aiMana: 2,
    aiHand: [],
    opponentHand: [],
    aiDeck: ['basic_chillwind_yeti'],
    opponentDeck: ['basic_chillwind_yeti'],
    opponentBoard: [{ cardId: 'basic_flametongue_totem' }],
    ...options
  })
  const initial = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
  expect(
    initial.dispatch({ type: 'use-hero-power', participantId: fixture.aiParticipantId })
      .accepted
  ).toBe(true)
  const checkpoint = structuredClone(
    initial.match.getCheckpoint()
  ) as Mutable<OpeningMatchCheckpoint>
  edit?.(checkpoint, fixture.aiParticipantId)
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: checkpoint as unknown as OpeningMatchCheckpoint
  })
}

function attacks(session: GameBoardSession) {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  ).filter(
    (command) => command.type === 'attack-character' && command.attacker.kind === 'hero'
  )
}

function inspect(session: GameBoardSession, stop = () => false, now = () => 0) {
  return createExpertExpiringAttackInspector(
    session.match.getCheckpoint(),
    session.remoteParticipantId,
    stop,
    now
  )
}

describe('Expert free expiring hero attack preference', () => {
  it.each(['hidden pending modifiers', 'revealed hand modifiers'] as const)(
    'is invariant to %s that are absent from the fair observation',
    (kind) => {
      const original = position({ opponentHand: ['basic_chillwind_yeti'] }, (cp) => {
        if (kind === 'revealed hand modifiers')
          cp.state.players.find(
            (player) => player.participantId !== cp.state.activePlayerId
          )!.hand[0]!.knownTo = [cp.state.activePlayerId!]
      })
      const checkpoint = structuredClone(
        original.match.getCheckpoint()
      ) as Mutable<OpeningMatchCheckpoint>
      const hidden = checkpoint.state.players.find(
        (player) => player.participantId !== checkpoint.state.activePlayerId
      )!
      if (kind === 'hidden pending modifiers')
        hidden.pendingCostModifiers = [
          {
            id: 'private-discount',
            sourceInstanceId: 'private-source',
            amount: -1,
            filter: { type: 'Minion' },
            duration: 'this-turn',
            expiresOnTurn: checkpoint.state.turnNumber
          }
        ]
      else {
        hidden.hand[0]!.enchantments = [
          {
            id: 'private-hand-enchantment',
            sourceInstanceId: 'private-source',
            sourceCardId: null,
            attackDelta: 1,
            duration: 'this-turn',
            expiresOnTurn: checkpoint.state.turnNumber
          }
        ]
        hidden.hand[0]!.costAdjustments = [
          {
            id: 'private-hand-cost',
            sourceInstanceId: 'private-source',
            amount: -1,
            duration: 'this-turn',
            expiresOnTurn: checkpoint.state.turnNumber
          }
        ]
      }
      const changed = new GameBoardSession({
        setup: original.match.getCheckpoint().setup,
        decks: original.match.getCheckpoint().decks,
        checkpoint: checkpoint as unknown as OpeningMatchCheckpoint
      })
      expect(changed.getAiObservation()).toEqual(original.getAiObservation())
      const first = inspect(original)
      const second = inspect(changed)
      const commands = attacks(original)
      expect(commands).toEqual(attacks(changed))
      expect(commands.map(first)).toEqual(commands.map(second))
      expect(first.stats).toEqual(second.stats)
      expect(first.stats.dispatches).toBeGreaterThan(0)
      expect(commands.some(first)).toBe(true)
    }
  )

  it('proves nonlethal damage without altering the live match, and expiry resets capacity', () => {
    const session = position({
      aiBoard: [{ cardId: 'mean_streets_of_gadgetzan_aya_blackpaw' }]
    })
    const before = session.match.getCheckpoint()
    const command = attacks(session).find(
      (command) =>
        command.type === 'attack-character' && command.defender.kind === 'minion'
    )!
    const review = inspect(session)
    expect(review(command)).toBe(true)
    expect(review(command)).toBe(true)
    expect(review.stats).toMatchObject({ dispatches: 1, cacheHits: 1 })
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(session.dispatch(command).accepted).toBe(true)
    const own = () =>
      session
        .getState()
        .players.find((player) => player.participantId === session.remoteParticipantId)!
    expect(own().hero.attacksUsedThisTurn).toBe(1)
    expect(
      session.dispatch({ type: 'end-turn', participantId: session.remoteParticipantId })
        .accepted
    ).toBe(true)
    expect(own().hero.attack).toBe(0)
    expect(own().hero.attacksUsedThisTurn).toBe(0)
    expect(own().hero.enchantments).toEqual([])
    expect(
      session.dispatch({ type: 'end-turn', participantId: session.localParticipantId })
        .accepted
    ).toBe(true)
    expect(
      session.dispatch({
        type: 'use-hero-power',
        participantId: session.remoteParticipantId
      }).accepted
    ).toBe(true)
    expect(attacks(session).length).toBeGreaterThan(0)
  })

  it('admits safe face damage as well and preserves a low-health hero and its armor', () => {
    const session = position({ aiHealth: 1 })
    const before = session.getAiObservation()
    const face = attacks(session).find(
      (command) =>
        command.type === 'attack-character' && command.defender.kind === 'hero'
    )!
    expect(inspect(session)(face)).toBe(true)
    expect(session.dispatch(face).accepted).toBe(true)
    expect(
      session.getAiObservation().players.find((player) => player.role === 'self')!.hero
        .health
    ).toBe(1)
    expect(
      session.getAiObservation().players.find((player) => player.role === 'self')!.hero
        .armor
    ).toBe(before.players.find((player) => player.role === 'self')!.hero.armor)
  })

  const controls: {
    name: string
    options?: Partial<FixtureOptions>
    edit?: Parameters<typeof position>[1]
    target?: 'hero' | 'minion'
    probes?: number
  }[] = [
    {
      name: 'weapon durability',
      options: { aiWeapon: { cardId: 'basic_wicked_knife', attack: 1, durability: 2 } }
    },
    { name: 'permanent hero attack', options: { aiAttack: 1 } },
    {
      name: 'retaliation',
      probes: 1,
      options: { opponentBoard: [{ cardId: 'basic_chillwind_yeti' }] }
    },
    {
      name: 'lethal retaliation at low health',
      probes: 1,
      options: { aiHealth: 1, opponentBoard: [{ cardId: 'basic_chillwind_yeti' }] }
    },
    {
      name: 'Divine Shield',
      probes: 1,
      options: {
        opponentBoard: [
          {
            cardId: 'basic_flametongue_totem',
            divineShield: true,
            keywords: ['divine-shield']
          }
        ]
      }
    },
    {
      name: 'enrage',
      options: {
        opponentBoard: [{ cardId: 'classic_amani_berserker', attack: 0, baseAttack: 0 }]
      }
    },
    {
      name: 'damage trigger',
      options: {
        opponentBoard: [{ cardId: 'classic_acolyte_of_pain', attack: 0, baseAttack: 0 }]
      }
    },
    {
      name: 'attack trigger',
      options: {
        opponentBoard: [
          { cardId: 'the_grand_tournament_cutpurse', attack: 0, baseAttack: 0 }
        ]
      }
    },
    {
      name: 'future healing payoff',
      options: {
        opponentBoard: [{ cardId: 'basic_northshire_cleric', attack: 0, baseAttack: 0 }]
      }
    },
    {
      name: 'Secret',
      options: { opponentSecrets: [{ cardId: 'classic_ice_barrier' }] }
    },
    {
      name: 'deathrattle target kill',
      probes: 1,
      options: {
        opponentBoard: [
          { cardId: 'classic_leper_gnome', attack: 0, baseAttack: 0, health: 1 }
        ]
      }
    },
    {
      name: 'future own board clear',
      options: { opponentBoard: [{ cardId: 'classic_doomsayer' }] }
    },
    {
      name: 'end-turn healing',
      options: { opponentBoard: [{ cardId: 'basic_healing_totem' }] }
    },
    {
      name: 'terminal opponent fatigue',
      options: { opponentDeck: [], opponentHealth: 1 },
      target: 'hero'
    },
    {
      name: 'quest',
      options: { aiQuest: { cardId: 'journey_to_ungoro_jungle_giants', progress: 0 } }
    },
    {
      name: 'extra hero attacks',
      edit: (cp, actor) => {
        cp.state.players.find(
          (p) => p.participantId === actor
        )!.hero.maxAttacksPerTurn = 2
      }
    },
    {
      name: 'later expiry',
      edit: (cp, actor) => {
        cp.state.players.find(
          (p) => p.participantId === actor
        )!.hero.enchantments![0]!.expiresOnTurn = cp.state.turnNumber + 2
      }
    },
    {
      name: 'hero power temporal modifier',
      edit: (cp, actor) => {
        cp.state.players.find(
          (p) => p.participantId === actor
        )!.heroPower.enchantments = [
          {
            id: 'future-power',
            sourceInstanceId: `${actor}:hero`,
            sourceCardId: null,
            costDelta: -1,
            duration: 'this-turn',
            expiresOnTurn: cp.state.turnNumber
          }
        ]
      }
    },
    {
      name: 'hand temporal modifier',
      options: { aiHand: ['basic_chillwind_yeti'] },
      edit: (cp, actor) => {
        cp.state.players.find(
          (p) => p.participantId === actor
        )!.hand[0]!.costAdjustments = [
          {
            id: 'future-hand',
            sourceInstanceId: `${actor}:hero`,
            amount: -1,
            duration: 'this-turn',
            expiresOnTurn: cp.state.turnNumber
          }
        ]
      }
    },
    {
      name: 'scheduled boundary effect',
      edit: (cp, actor) => {
        cp.state.scheduledEffects = [
          {
            id: 'boundary',
            sourceInstanceId: `${actor}:hero`,
            sourceCardId: null,
            controllerId: cp.state.activePlayerId!,
            trigger: 'end-of-turn',
            executeOnTurn: cp.state.turnNumber,
            actions: [{ action: 'restore', player: 'self', amount: 2 }]
          }
        ]
      }
    }
  ]

  it.each(controls)(
    'abstains for $name while the attack is legal',
    ({ options, edit, target = 'minion', probes = 0 }) => {
      const session = position(options, edit)
      const command = attacks(session).find(
        (command) =>
          command.type === 'attack-character' && command.defender.kind === target
      )
      expect(command).toBeDefined()
      const before = session.match.getCheckpoint()
      const review = inspect(session)
      expect(review(command!)).toBe(false)
      expect(review.stats.dispatches).toBe(probes)
      expect(review.stats.abstentions).toBe(0)
      expect(session.match.getCheckpoint()).toEqual(before)
    }
  )

  it.each(['frozen', 'stealth', 'spent'] as const)(
    'does not invent availability for %s hero capacity',
    (kind) => {
      const session = position({}, (cp, actor) => {
        const hero = cp.state.players.find((p) => p.participantId === actor)!.hero
        if (kind === 'frozen') hero.frozenUntilTurn = cp.state.turnNumber + 1
        if (kind === 'stealth') hero.keywords = ['stealth']
        if (kind === 'spent') {
          hero.attacksUsedThisTurn = 1
          hero.lastAttackedOnTurn = cp.state.turnNumber
        }
      })
      const command: TurnMatchCommand = {
        type: 'attack-character',
        participantId: session.remoteParticipantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      }
      expect(inspect(session)(command)).toBe(false)
    }
  )

  it('shares eight dispatches across targets, including rejected probes', () => {
    const session = position()
    const review = inspect(session)
    for (let index = 0; index < 20; index++)
      review({
        type: 'attack-character',
        participantId: session.remoteParticipantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'minion', instanceId: `missing-${index}` }
      })
    expect(review.stats.dispatches).toBe(EXPERT_EXPIRING_ATTACK_MAX_DISPATCHES)
    expect(review.stats.abstentions).toBe(12)
    expect(review(attacks(session)[0]!)).toBe(false)
    expect(review.stats.dispatches).toBe(EXPERT_EXPIRING_ATTACK_MAX_DISPATCHES)
  })

  it('abstains before any probe when deadline is spent or clock is unavailable', () => {
    const session = position()
    for (const review of [
      inspect(session, () => true),
      inspect(
        session,
        () => false,
        () => Number.NaN
      )
    ]) {
      expect(review(attacks(session)[0]!)).toBe(false)
      expect(review.stats.dispatches).toBe(0)
      expect(review.stats.abstentions).toBe(1)
    }
  })

  it('does not reset the time allowance for each candidate', () => {
    const session = position()
    let now = 0
    const review = inspect(
      session,
      () => false,
      () => now
    )
    expect(review(attacks(session)[0]!)).toBe(true)
    now = 25
    expect(review(attacks(session)[1]!)).toBe(false)
    expect(review.stats.dispatches).toBe(1)
  })
})
