import { reviewChanceAttackOrder, hasChanceWeaponSetup } from './expert-chance-order'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  OpeningMatchCheckpoint,
  TurnMatchCommand
} from '../../../game-rules/match'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import { asPlayerId } from '../../../game-rules/match/match-types'
import { GameBoardSession } from '../game-board-session'
import { createExpertAttackOrderInspector } from './expert-action-ordering'
import recorded from './expert-tactical-recorded-states.json'
import { reviewCommittedActionOrder } from './expert-committed-order'
import {
  reviewCompletedAttackOrder,
  identicalSupportedContinuation
} from './expert-completed-attack-order'

function fixture(options: Partial<AiFixtureOptions> = {}) {
  const f = createAiFixture({
    seed: 613,
    aiHeroId: 'thrall',
    opponentHeroId: 'jaina',
    aiMana: 2,
    aiHeroPowerAvailable: false,
    aiHand: ['basic_flametongue_totem'],
    aiBoard: [{ cardId: 'basic_chillwind_yeti', ready: true }],
    ...options
  })
  return new GameBoardSession({
    setup: f.setup,
    decks: f.decks,
    checkpoint: f.checkpoint
  })
}
function face(session: GameBoardSession) {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  ).find((c) => c.type === 'attack-character' && c.defender.kind === 'hero')!
}
function inspect(session: GameBoardSession, command: TurnMatchCommand) {
  return createExpertAttackOrderInspector(
    session.match.getCheckpoint(),
    session.remoteParticipantId
  )(command)
}

afterEach(() => vi.restoreAllMocks())

describe('Bounded cached attack-order review', () => {
  it.each(['auraBeforeAttack', 'summonBeforeTrade'] as const)(
    'detects recorded $0 without live mutation or concealed-card decisions',
    (key) => {
      vi.spyOn(performance, 'now').mockReturnValue(0)
      const entry = recorded[key]
      const checkpoint = entry.checkpoint as unknown as OpeningMatchCheckpoint
      const session = new GameBoardSession({
        setup: checkpoint.setup,
        decks: checkpoint.decks,
        checkpoint
      })
      const before = session.match.getCheckpoint()
      expect(
        createExpertAttackOrderInspector(
          checkpoint,
          asPlayerId(entry.actorId)
        )(entry.historicalCommand as TurnMatchCommand)
      ).toBe(true)
      expect(session.match.getCheckpoint()).toEqual(before)
    }
  )

  it('keeps a ready guaranteed attack lethal instead of requiring development', () => {
    const session = fixture({ opponentHealth: 4 })
    expect(inspect(session, face(session))).toBe(false)
  })

  it('abstains from concealed Secrets and triggered/random payoffs', () => {
    for (const options of [
      { opponentSecrets: [{ cardId: 'classic_ice_block', revealed: false }] },
      {
        aiBoard: [
          { cardId: 'basic_chillwind_yeti', ready: true },
          { cardId: 'classic_knife_juggler', ready: false }
        ]
      }
    ]) {
      const session = fixture(options)
      expect(inspect(session, face(session))).toBe(false)
    }
  })

  it('does not demand an aura before an attack that must first free board space', () => {
    const session = fixture({
      aiBoard: Array.from({ length: 7 }, () => ({
        cardId: 'classic_wisp',
        ready: true
      })),
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    const trade = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    ).find((c) => c.type === 'attack-character' && c.defender.kind === 'minion')!
    expect(inspect(session, trade)).toBe(false)
  })

  it('does not prefer summon-first when the board cap removes the additional summon', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const session = fixture({
      aiMana: 3,
      aiHeroId: 'rexxar',
      aiHand: ['classic_unleash_the_hounds'],
      aiBoard: Array.from({ length: 6 }, () => ({
        cardId: 'classic_wisp',
        ready: true
      })),
      opponentBoard: [{ cardId: 'classic_wisp' }, { cardId: 'basic_chillwind_yeti' }]
    })
    const target = session
      .getState()
      .players.find((p) => p.participantId === session.localParticipantId)!.board[0]!
    const trade = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    ).find(
      (c) =>
        c.type === 'attack-character' &&
        c.defender.kind === 'minion' &&
        c.defender.instanceId === target.instanceId
    )!
    const legal = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    )
    expect(trade).toBeDefined()
    expect(legal.some((command) => command.type === 'play-card')).toBe(true)
    const review = createExpertAttackOrderInspector(
      session.match.getCheckpoint(),
      session.remoteParticipantId
    )
    expect(review(trade)).toBe(false)
    expect(review.stats.dispatches).toBe(4)
    expect(review.stats.abstentions).toBe(0)
  })

  it('abstains after its own wall budget instead of forcing an unchecked order', () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 101))
    const session = fixture()
    expect(inspect(session, face(session))).toBe(false)
  })
})

it('shares one dispatch budget across many distinct attacks and memoizes repeat reviews', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const session = fixture({
    aiBoard: Array.from({ length: 5 }, () => ({ cardId: 'classic_wisp', ready: true })),
    opponentBoard: [
      { cardId: 'basic_boulderfist_ogre' },
      { cardId: 'basic_chillwind_yeti' }
    ]
  })
  const review = createExpertAttackOrderInspector(
    session.match.getCheckpoint(),
    session.remoteParticipantId
  )
  const attacks = enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  ).filter((c) => c.type === 'attack-character')
  expect(attacks.length).toBeGreaterThan(8)
  for (const command of attacks) review(command)
  expect(review.stats.dispatches).toBeLessThanOrEqual(32)
  expect(review.stats.abstentions).toBeGreaterThan(0)
  const used = review.stats.dispatches
  review(attacks[0]!)
  expect(review.stats.dispatches).toBe(used)
  expect(review.stats.cacheHits).toBeGreaterThan(0)
})

it('does not normalize away a changed original minion when aura changes combat survival', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const session = fixture({
    aiMana: 3,
    aiHand: ['classic_murloc_warleader'],
    aiBoard: [{ cardId: 'basic_murloc_raider', ready: true }],
    opponentBoard: [{ cardId: 'classic_wisp', health: 2, maxHealth: 2, attack: 1 }]
  })
  const trade = enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  ).find(
    (command) =>
      command.type === 'attack-character' && command.defender.kind === 'minion'
  )!
  // The aura saves the original Raider. It must not be erased as an extra summon.
  expect(inspect(session, trade)).toBe(false)
})

describe('Committed weapon-refresh order', () => {
  function pair(options: Partial<AiFixtureOptions> = {}) {
    const session = fixture({
      aiHeroId: 'valeera',
      aiHeroPowerAvailable: true,
      aiHand: [],
      aiBoard: [],
      aiWeapon: { cardId: 'basic_wicked_knife', durability: 1 },
      opponentBoard: [{ cardId: 'whispers_of_the_old_gods_ravaging_ghoul', health: 3 }],
      ...options
    })
    const commands = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    )
    const refresh = commands.find((command) => command.type === 'use-hero-power')!
    const attack = commands.find(
      (command) =>
        command.type === 'attack-character' && command.defender.kind === 'minion'
    )!
    return { session, refresh, attack }
  }

  it('preserves the old dagger attack and a fresh charge without changing the checkpoint', () => {
    const { session, refresh, attack } = pair()
    const checkpoint = session.match.getCheckpoint()
    const before = structuredClone(checkpoint)
    const result = reviewCommittedActionOrder(
      checkpoint,
      session.remoteParticipantId,
      refresh,
      attack,
      () => false,
      () => 0
    )
    expect(result.improves).toBe(true)
    expect(result.stats.dispatches).toBe(4)
    expect(checkpoint).toEqual(before)
  })

  it.each([
    { opponentSecrets: [{ cardId: 'classic_ice_block', revealed: false }] },
    { aiHealth: 1 },
    { opponentBoard: [{ cardId: 'classic_loot_hoarder', health: 1 }] }
  ])(
    'abstains when a secret, death or new information changes the comparison',
    (options) => {
      const { session, refresh, attack } = pair(options)
      expect(
        reviewCommittedActionOrder(
          session.match.getCheckpoint(),
          session.remoteParticipantId,
          refresh,
          attack,
          () => false,
          () => 0
        ).improves
      ).toBe(false)
    }
  )

  it('abstains with no work budget rather than exceeding it', () => {
    const { session, refresh, attack } = pair()
    const result = reviewCommittedActionOrder(
      session.match.getCheckpoint(),
      session.remoteParticipantId,
      refresh,
      attack,
      () => true,
      () => 0
    )
    expect(result.improves).toBe(false)
    expect(result.stats.dispatches).toBe(0)
  })

  it('does not delay a refreshed weapon deathrattle just to retain durability', () => {
    const session = fixture({
      aiHeroId: 'uther',
      aiMana: 4,
      aiHeroPowerAvailable: false,
      aiBoard: [],
      aiHand: ['naxxramas_deaths_bite'],
      aiWeapon: { cardId: 'classic_truesilver_champion', durability: 1 },
      opponentBoard: [{ cardId: 'basic_chillwind_yeti', health: 2 }]
    })
    const refresh = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    ).find((command) => command.type === 'play-card')!
    expect(
      reviewCommittedActionOrder(
        session.match.getCheckpoint(),
        session.remoteParticipantId,
        refresh,
        face(session),
        () => false,
        () => 0
      ).improves
    ).toBe(false)
  })
})

describe('Committed attack-setup order', () => {
  it.each([0, 1, 2, 9, 20])(
    'uses a selected buff before attacking through %s armor',
    (armor) => {
      const session = fixture({
        aiHeroId: 'valeera',
        aiMana: 1,
        aiBoard: [],
        aiHand: ['basic_deadly_poison'],
        aiWeapon: { cardId: 'basic_wicked_knife', durability: 2 },
        opponentHealth: 12,
        opponentArmor: armor
      })
      const commands = enumerateLegalCommands(
        {
          getState: session.match.getState,
          getPlayInput: session.match.getPlayInput!,
          getLegality: session.match.getLegality!
        },
        session.remoteParticipantId
      )
      const buff = commands.find((command) => command.type === 'play-card')!
      const snapshot = session.match.getCheckpoint()
      const result = reviewCommittedActionOrder(
        snapshot,
        session.remoteParticipantId,
        face(session),
        buff,
        () => false,
        () => 0
      )
      expect(result.improves).toBe(true)
      expect(result.reason).toBe('committed-attack-setup-order')
      expect(result.stats.dispatches).toBe(4)
      expect(session.match.getCheckpoint()).toEqual(snapshot)
    }
  )

  it('does not normalize different friendly healing from a Lifesteal weapon', () => {
    const session = fixture({
      aiHeroId: 'valeera',
      aiMana: 1,
      aiHealth: 10,
      aiBoard: [],
      aiHand: ['basic_deadly_poison'],
      aiWeapon: {
        cardId: 'knights_of_the_frozen_throne_grave_vengeance',
        durability: 2
      },
      opponentHealth: 30
    })
    const commands = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    )
    // Increased friendly healing is a separate outcome, beyond this proof's
    // single permitted difference in opponent face damage.
    const buff = commands.find((command) => command.type === 'play-card')!
    const result = reviewCommittedActionOrder(
      session.match.getCheckpoint(),
      session.remoteParticipantId,
      face(session),
      buff,
      () => false,
      () => 0
    )
    expect(result.improves).toBe(false)
    expect(result.stats.dispatches).toBe(4)
  })
})

describe('Completed committed attack order', () => {
  function completed(options: Partial<AiFixtureOptions> = {}, stop = () => false) {
    const session = fixture({
      aiHeroId: 'valeera',
      aiMana: 1,
      aiHand: ['classic_southsea_deckhand'],
      aiBoard: [],
      aiWeapon: { cardId: 'basic_wicked_knife', durability: 1 },
      opponentHealth: 12,
      opponentArmor: 9,
      ...options
    })
    const commands = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    )
    const attack = commands.find(
      (command) =>
        command.type === 'attack-character' &&
        command.attacker.kind === 'hero' &&
        command.defender.kind === 'hero'
    )!
    const play = commands.find((command) => command.type === 'play-card')!
    const before = session.match.getCheckpoint()
    const result = reviewCompletedAttackOrder(
      before,
      session.remoteParticipantId,
      [attack, play],
      stop,
      () => 0
    )
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(result.stats.dispatches).toBeLessThanOrEqual(9)
    return result
  }
  it('recovers one newly enabled attack without changing card commitments', () => {
    const result = completed()
    expect(result.commands?.map((command) => command.type)).toEqual([
      'play-card',
      'attack-character',
      'attack-character'
    ])
    expect(result.stats.dispatches).toBe(5)
  })
  it('keeps restored-weapon and other remaining choices in search', () => {
    expect(completed({ aiMana: 3, aiHeroPowerAvailable: true }).commands).toBeNull()
  })
  it('does not add an attack if ordinary Charge remains available after weapon loss', () => {
    expect(completed({ aiHand: ['basic_stonetusk_boar'] }).commands).toBeNull()
  })
  it('abstains from a secret and an unknown trigger', () => {
    expect(
      completed({ opponentSecrets: [{ cardId: 'classic_ice_block', revealed: false }] })
        .commands
    ).toBeNull()
    expect(
      completed({ aiBoard: [{ cardId: 'classic_knife_juggler' }] }).commands
    ).toBeNull()
  })
  it('abstains from weapon deathrattles and pending end-turn payoffs', () => {
    expect(
      completed({ aiWeapon: { cardId: 'naxxramas_deaths_bite', durability: 1 } })
        .commands
    ).toBeNull()
    expect(
      completed({ aiBoard: [{ cardId: 'classic_baron_geddon', ready: false }] })
        .commands
    ).toBeNull()
  })
  it('leaves unreviewed exhausted-budget lines unchanged', () => {
    const result = completed({}, () => true)
    expect(result.commands).toBeNull()
    expect(result.stats.dispatches).toBe(0)
    expect(result.stats.abstained).toBe(true)
  })
  it('extends only the same repeatedly supported prefix, within the cache limit', () => {
    const end: TurnMatchCommand = { type: 'end-turn', participantId: asPlayerId('ai') }
    const attack: TurnMatchCommand = {
      type: 'attack-character',
      participantId: asPlayerId('ai'),
      attacker: { kind: 'hero' },
      defender: { kind: 'hero' }
    }
    const play: TurnMatchCommand = {
      type: 'use-hero-power',
      participantId: asPlayerId('ai')
    }
    const line = { visits: 3, valueSum: 0.3, commands: [attack] }
    const full = { ...line, commands: [attack, play, end] }
    expect(identicalSupportedContinuation(line, [line, full])).toBe(full)
    for (const other of [
      { ...full, visits: 2, valueSum: 0.2 },
      { ...full, valueSum: 0.4 },
      { ...full, commands: [play, attack, end] },
      { ...full, commands: [attack, ...Array(6).fill(play)] }
    ])
      expect(identicalSupportedContinuation(line, [line, other])).toBe(line)
    const once = { ...line, visits: 1 }
    expect(identicalSupportedContinuation(once, [{ ...full, visits: 1 }])).toBe(once)
  })
})

describe('All-outcome random setup opportunity', () => {
  function chance(options: Partial<AiFixtureOptions> = {}) {
    const session = fixture({
      aiHeroId: 'valeera',
      aiMana: 1,
      aiHand: ['classic_preparation', 'goblins_vs_gnomes_tinkers_sharpsword_oil'],
      aiBoard: [
        { cardId: 'classic_violet_teacher' },
        { cardId: 'classic_southsea_deckhand' },
        { cardId: 'classic_si_7_agent' }
      ],
      aiWeapon: { cardId: 'basic_wicked_knife', durability: 2 },
      opponentHealth: 12,
      opponentArmor: 12,
      ...options
    })
    const own = session
      .getState()
      .players.find((p) => p.participantId === session.remoteParticipantId)!
    const prep = own.hand.find((c) => c.cardId === 'classic_preparation')!
    expect(
      session.dispatch({
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: prep.instanceId
      }).accepted
    ).toBe(true)
    const cp = session.match.getCheckpoint()
    const attack: TurnMatchCommand = {
      type: 'attack-character',
      participantId: session.remoteParticipantId,
      attacker: { kind: 'hero' },
      defender: { kind: 'hero' }
    }
    const oil: TurnMatchCommand = {
      type: 'play-card',
      participantId: session.remoteParticipantId,
      cardInstanceId: own.hand.find(
        (c) => c.cardId === 'goblins_vs_gnomes_tinkers_sharpsword_oil'
      )!.instanceId
    }
    return { session, cp, commands: [attack, oil] }
  }
  it('covers every target including the new on-cast summon, with one shared deterministic prefix', () => {
    const { session, cp, commands } = chance()
    const before = structuredClone(cp)
    const proof = reviewChanceAttackOrder(
      cp,
      session.remoteParticipantId,
      commands,
      () => false,
      () => 0
    )
    expect(proof.improves).toBe(true)
    expect(proof.stats).toMatchObject({
      outcomes: 5,
      targets: 5,
      dispatches: 16,
      abstained: false
    })
    expect(cp).toEqual(before)
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(hasChanceWeaponSetup('goblins_vs_gnomes_tinkers_sharpsword_oil')).toBe(true)
    expect(hasChanceWeaponSetup('basic_deadly_poison')).toBe(false)
  })
  it.each([0, 1, 20])(
    'accounts for the exact damage delta across %s armor',
    (armor) => {
      const { session, cp, commands } = chance({ opponentArmor: armor })
      expect(
        reviewChanceAttackOrder(
          cp,
          session.remoteParticipantId,
          commands,
          () => false,
          () => 0
        ).improves
      ).toBe(true)
    }
  )
  it('cannot approve a partial outcome set or an exhausted work allowance', () => {
    const { session, cp, commands } = chance()
    for (const work of [0, 1, 6, 15]) {
      const proof = reviewChanceAttackOrder(
        cp,
        session.remoteParticipantId,
        commands,
        () => false,
        () => 0,
        work
      )
      expect(proof.improves).toBe(false)
      expect(proof.stats.dispatches).toBeLessThanOrEqual(work)
      expect(proof.stats.abstained).toBe(true)
    }
    expect(
      reviewChanceAttackOrder(
        cp,
        session.remoteParticipantId,
        commands,
        () => true,
        () => 0
      ).improves
    ).toBe(false)
  })
  it('abstains for a secret, lethal boundary, broken weapon and unequal own healing', () => {
    for (const options of [
      { opponentSecrets: [{ cardId: 'classic_ice_block', revealed: false }] },
      { opponentHealth: 3, opponentArmor: 0 },
      { aiWeapon: { cardId: 'basic_wicked_knife', durability: 1 } },
      {
        aiHealth: 10,
        aiWeapon: {
          cardId: 'knights_of_the_frozen_throne_grave_vengeance',
          durability: 2
        }
      }
    ] satisfies Partial<AiFixtureOptions>[]) {
      const { session, cp, commands } = chance(options)
      expect(
        reviewChanceAttackOrder(
          cp,
          session.remoteParticipantId,
          commands,
          () => false,
          () => 0
        ).improves
      ).toBe(false)
    }
  })
  it('rejects an additional trigger-owned random selection instead of sampling it', () => {
    const { session, cp, commands } = chance({
      aiBoard: [
        { cardId: 'classic_violet_teacher' },
        { cardId: 'classic_knife_juggler' }
      ],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    expect(
      reviewChanceAttackOrder(
        cp,
        session.remoteParticipantId,
        commands,
        () => false,
        () => 0
      ).improves
    ).toBe(false)
  })
})

describe('committed singleton minion setup ordering', () => {
  function singleton(options: Partial<AiFixtureOptions> = {}) {
    const session = fixture({
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiMana: 6,
      aiHeroPowerAvailable: true,
      aiHand: ['basic_the_coin', 'goblins_vs_gnomes_tinkers_sharpsword_oil'],
      aiBoard: [{ cardId: 'classic_si_7_agent', ready: true, health: 1 }],
      opponentHealth: 12,
      opponentArmor: 5,
      ...options
    })
    const actor = session.remoteParticipantId,
      own = session.getState().players.find((p) => p.participantId === actor)!
    expect(
      session.dispatch({
        type: 'play-card',
        participantId: actor,
        cardInstanceId: own.hand.find((c) => c.cardId === 'basic_the_coin')!.instanceId
      }).accepted
    ).toBe(true)
    const attack: TurnMatchCommand = {
      type: 'attack-character',
      participantId: actor,
      attacker: { kind: 'minion', instanceId: own.board[0]!.instanceId },
      defender: { kind: 'hero' }
    }
    const power: TurnMatchCommand = { type: 'use-hero-power', participantId: actor }
    const oil: TurnMatchCommand = {
      type: 'play-card',
      participantId: actor,
      cardInstanceId: own.hand.find(
        (c) => c.cardId === 'goblins_vs_gnomes_tinkers_sharpsword_oil'
      )!.instanceId
    }
    const hero: TurnMatchCommand = {
      type: 'attack-character',
      participantId: actor,
      attacker: { kind: 'hero' },
      defender: { kind: 'hero' }
    }
    const cp = session.match.getCheckpoint()
    return { session, actor, cp, commands: [attack, power, oil], suffix: [hero] }
  }
  it('proves both complete lines including the future hero attack, without mutating source state', () => {
    const { session, actor, cp, commands, suffix } = singleton(),
      before = structuredClone(cp)
    const proof = reviewChanceAttackOrder(
      cp,
      actor,
      commands,
      () => false,
      () => 0,
      8,
      suffix
    )
    expect(proof.improves).toBe(true)
    expect(proof.stats).toMatchObject({
      dispatches: 8,
      outcomes: 1,
      targets: 1,
      abstained: false
    })
    expect(proof.transition?.revision).toBe(cp.state.revision + 1)
    expect(
      proof.transition?.events.filter((e) => e.type === 'effect-resolved')
    ).toHaveLength(2)
    expect(cp).toEqual(before)
    expect(session.match.getCheckpoint()).toEqual(before)
  })
  it.each([0, 1, 7])('cannot certify an incomplete %s-dispatch proof', (work) => {
    const { actor, cp, commands, suffix } = singleton()
    const proof = reviewChanceAttackOrder(
      cp,
      actor,
      commands,
      () => false,
      () => 0,
      work,
      suffix
    )
    expect(proof.improves).toBe(false)
    expect(proof.transition).toBeUndefined()
    expect(proof.stats.dispatches).toBeLessThanOrEqual(work)
  })
  it.each([
    {
      aiBoard: [
        { cardId: 'classic_si_7_agent', ready: true },
        { cardId: 'basic_chillwind_yeti' }
      ]
    },
    { aiBoard: [{ cardId: 'classic_violet_teacher', ready: true }] },
    {
      aiBoard: [{ cardId: 'classic_gadgetzan_auctioneer', ready: true }],
      aiDeck: ['basic_chillwind_yeti', 'basic_chillwind_yeti']
    },
    { aiBoard: [{ cardId: 'classic_archmage_antonidas', ready: true }] },
    { opponentSecrets: [{ cardId: 'classic_ice_block', revealed: false }] },
    { opponentHealth: 4, opponentArmor: 0 }
  ] satisfies Partial<AiFixtureOptions>[])(
    'abstains when the complete singleton proof fails: %j',
    (options) => {
      const { actor, cp, commands, suffix } = singleton(options)
      const proof = reviewChanceAttackOrder(
        cp,
        actor,
        commands,
        () => false,
        () => 0,
        8,
        suffix
      )
      expect(proof.improves).toBe(false)
      expect(proof.transition).toBeUndefined()
    }
  )
})
