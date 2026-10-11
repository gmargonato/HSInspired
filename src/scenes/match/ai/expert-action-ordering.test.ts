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
