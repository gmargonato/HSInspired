import { describe, expect, it, vi } from 'vitest'
import {
  CARD_CATALOG,
  asCardId,
  type CardEffectBlock
} from '../../../game-rules/content/cards'
import { enumerateLegalCommands } from '../../../game-rules/match/ai/legal-commands'
import {
  revealsTacticalInformation,
  searchTactics,
  type TacticalLine
} from '../../../game-rules/match/ai/tactical-search'
import type {
  BoardMinion,
  OpeningMatchState,
  OpeningPlayerState
} from '../../../game-rules/match/opening-match-types'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import { GameBoardSession } from '../game-board-session'

const APPRENTICE = asCardId('classic_sorcerers_apprentice')
const ANTONIDAS = asCardId('classic_archmage_antonidas')
const REFLECTION = asCardId('journey_to_ungoro_molten_reflection')
type PublicContext = NonNullable<Parameters<typeof revealsTacticalInformation>[2]>

function build(
  options: Partial<AiFixtureOptions> = {},
  transformState: (state: OpeningMatchState) => OpeningMatchState = (state) => state
): GameBoardSession {
  const fixture = createAiFixture({
    seed: 720201,
    aiHeroId: 'jaina',
    opponentHeroId: 'garrosh',
    aiMana: 1,
    aiMaximumMana: 10,
    opponentMaximumMana: 10,
    opponentHealth: 20,
    turnNumber: 20,
    aiHand: [REFLECTION],
    aiBoard: [
      { cardId: APPRENTICE, ready: false },
      { cardId: APPRENTICE, ready: false },
      { cardId: APPRENTICE, ready: false },
      { cardId: ANTONIDAS, ready: false }
    ],
    aiDeck: ['basic_arcane_intellect'],
    opponentDeck: ['basic_chillwind_yeti'],
    ...options
  })
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: {
      ...fixture.checkpoint,
      state: transformState(fixture.checkpoint.state)
    }
  })
}

function proof(
  session: GameBoardSession,
  options: Parameters<typeof searchTactics>[2] = {}
) {
  return session.match.analyze((fork) =>
    searchTactics(fork, session.remoteParticipantId, { maxNodes: 150, ...options })
  )
}

function legalCommands(session: GameBoardSession) {
  return session.match.analyze((fork) =>
    enumerateLegalCommands(fork, session.remoteParticipantId)
  )
}

function executeWin(session: GameBoardSession, win: TacticalLine | null): void {
  expect(win?.proven).toBe(true)
  if (!win) throw new Error('Expected a proven lethal line')
  for (const command of win.commands) {
    expect(command.type).toBe('play-card')
    expect(session.dispatch(command).accepted).toBe(true)
  }
  expect(session.getState().winnerId).toBe(session.remoteParticipantId)
}

function castSetupSpell(session: GameBoardSession = build()) {
  const before = session.getState()
  const reducer = before.players.find(
    (player) => player.participantId === session.remoteParticipantId
  )!.board[0]!
  const command = legalCommands(session).find(
    (candidate) =>
      candidate.type === 'play-card' &&
      (!candidate.targets?.length ||
        candidate.targets.some(
          (target) =>
            target.kind === 'minion' && target.instanceId === reducer.instanceId
        ))
  )
  expect(command).toBeDefined()
  const result = session.dispatch(command)
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error('Fixture setup spell was rejected')
  return {
    events: result.events,
    context: { before, after: result.state, playerId: session.remoteParticipantId }
  }
}

function updatePlayers(
  state: OpeningMatchState,
  update: (player: OpeningPlayerState) => OpeningPlayerState
): OpeningMatchState {
  return {
    ...state,
    players: [update(state.players[0]), update(state.players[1])]
  }
}

function changeGenerator(
  state: OpeningMatchState,
  context: PublicContext,
  patch: Partial<BoardMinion>
): OpeningMatchState {
  return updatePlayers(state, (player) =>
    player.participantId === context.playerId
      ? {
          ...player,
          board: player.board.map((minion) =>
            minion.cardId === ANTONIDAS ? { ...minion, ...patch } : minion
          )
        }
      : player
  )
}

describe('Public fixed generation tactical continuation', () => {
  it('proves and executes reducer-copy lethal without changing the live checkpoint', () => {
    const session = build()
    const checkpoint = session.match.getCheckpoint()
    const result = proof(session)
    expect(session.match.getCheckpoint()).toEqual(checkpoint)
    expect(result.nodes).toBeLessThanOrEqual(150)
    expect(result.win?.commands).toHaveLength(5)
    executeWin(session, result.win)
  })

  it('does not certify copying the generator instead of the reducer', () => {
    const session = build()
    const generator = session
      .getState()
      .players.find((player) => player.participantId === session.remoteParticipantId)!
      .board.find((minion) => minion.cardId === ANTONIDAS)!
    const commands = legalCommands(session).filter(
      (command) =>
        command.type === 'play-card' &&
        command.targets?.some(
          (target) =>
            target.kind === 'minion' && target.instanceId === generator.instanceId
        )
    )
    expect(commands).toHaveLength(1)
    expect(proof(session, { commands }).win).toBeNull()
  })

  it('respects depth and node caps', () => {
    expect(proof(build(), { maxDepth: 4 }).win).toBeNull()
    const result = proof(build(), { maxNodes: 1 })
    expect(result.nodes).toBe(1)
    expect(result.exhausted).toBe(true)
    expect(result.win).toBeNull()
  })

  it('cannot summon the additional reducer onto a full board', () => {
    const aiBoard = [
      APPRENTICE,
      APPRENTICE,
      APPRENTICE,
      ANTONIDAS,
      'classic_wisp',
      'classic_wisp',
      'classic_wisp'
    ].map((cardId) => ({ cardId, ready: false }))
    expect(proof(build({ aiBoard })).win).toBeNull()
  })

  it('cannot spend unavailable mana on the setup spell', () => {
    expect(proof(build({ aiMana: 0 })).win).toBeNull()
  })

  it('requires both the generator and enough reducers', () => {
    for (const cards of [
      [APPRENTICE, APPRENTICE, APPRENTICE],
      [APPRENTICE, APPRENTICE, ANTONIDAS]
    ]) {
      const aiBoard = cards.map((cardId) => ({ cardId, ready: false }))
      expect(proof(build({ aiBoard })).win).toBeNull()
    }
  })

  it('executes spell lethal through Taunt without inventing attacks', () => {
    const session = build({ opponentBoard: [{ cardId: 'basic_senjin_shieldmasta' }] })
    executeWin(session, proof(session).win)
  })

  it('respects hand capacity when each played spell frees one generation slot', () => {
    const session = build({
      aiHand: [REFLECTION, ...Array.from({ length: 9 }, () => 'basic_boulderfist_ogre')]
    })
    executeWin(session, proof(session).win)
    expect(
      session
        .getState()
        .players.find((player) => player.participantId === session.remoteParticipantId)!
        .hand.length
    ).toBeLessThanOrEqual(10)
  })

  it.each(['classic_counterspell', 'classic_ice_block'])(
    'does not prove a line through concealed %s',
    (cardId) => {
      expect(proof(build({ opponentSecrets: [{ cardId }] })).win).toBeNull()
    }
  )

  it('does not claim damage lethal against an immune hero', () => {
    const session = build({}, (state) =>
      updatePlayers(state, (player) =>
        player.participantId === state.activePlayerId
          ? player
          : { ...player, hero: { ...player.hero, baseKeywords: ['immune'] } }
      )
    )
    expect(
      session
        .getState()
        .players.find((player) => player.participantId === session.localParticipantId)!
        .hero.immune
    ).toBe(true)
    const checkpoint = session.match.getCheckpoint()
    expect(proof(session).win).toBeNull()
    expect(session.match.getCheckpoint()).toEqual(checkpoint)
  })

  it('finds lethal even when passing would expose the hero to lethal damage', () => {
    const session = build({
      aiHealth: 1,
      opponentBoard: [{ cardId: 'basic_boulderfist_ogre', ready: true }]
    })
    executeWin(session, proof(session).win)
  })

  it('requires public context and exact top-level generation provenance', () => {
    const { events, context } = castSetupSpell()
    expect(events.some((event) => event.type === 'card-generated')).toBe(true)
    expect(revealsTacticalInformation(events)).toBe(true)
    expect(revealsTacticalInformation(events, false, context)).toBe(false)
    const nestedGeneration = events.map((event) =>
      event.type === 'effect-resolved' && event.action === 'add-to-hand'
        ? {
            ...event,
            actionPath: `trigger.on-cast.actions[0].then.actions[0].${context.playerId}`
          }
        : event
    )
    expect(revealsTacticalInformation(nestedGeneration, false, context)).toBe(true)
  })

  it.each(['grantedTriggers', 'attachedEffects', 'deathrattles'] as const)(
    'rejects pre-existing or newly added %s on the source',
    (key) => {
      const { events, context } = castSetupSpell()
      const source = context.before.players
        .find((player) => player.participantId === context.playerId)!
        .board.find((minion) => minion.cardId === ANTONIDAS)!
      const patches: Record<typeof key, Partial<BoardMinion>> = {
        grantedTriggers: {
          grantedTriggers: [
            {
              id: 'extra-trigger',
              trigger: 'on-cast',
              actions: [],
              sourceInstanceId: source.instanceId
            }
          ]
        },
        attachedEffects: {
          attachedEffects: [
            {
              id: 'extra-effect',
              sourceInstanceId: source.instanceId,
              sourceCardId: ANTONIDAS,
              controllerId: context.playerId,
              trigger: 'end-of-turn',
              actions: [],
              executeOnTurn: 20
            }
          ]
        },
        deathrattles: { deathrattles: [{ trigger: 'deathrattle', actions: [] }] }
      }
      for (const side of ['before', 'after'] as const) {
        const changed = {
          ...context,
          [side]: changeGenerator(context[side], context, patches[key])
        }
        expect(revealsTacticalInformation(events, false, changed), side).toBe(true)
      }
    }
  )

  it('rejects transformed or silenced generation sources', () => {
    const { events, context } = castSetupSpell()
    for (const patch of [
      { cardId: asCardId('basic_chillwind_yeti') },
      { silenced: true }
    ]) {
      const changed = {
        ...context,
        after: changeGenerator(context.after, context, patch)
      }
      expect(revealsTacticalInformation(events, false, changed)).toBe(true)
    }
  })

  it('rejects conditional, repeated, selected, dynamic, or mixed source effects', () => {
    const { events, context } = castSetupSpell()
    const definition = CARD_CATALOG.require(ANTONIDAS)
    const effect = definition.effects[0]!
    const action = effect.actions![0]!
    const variants: readonly [string, readonly CardEffectBlock[]][] = [
      ['condition', [{ ...effect, condition: { type: 'has-card-in-hand' } }]],
      ['repeat', [{ ...effect, repeat: { count: 2 } }]],
      ['source', [{ ...effect, actions: [{ ...action, source: { zone: 'deck' } }] }]],
      [
        'dynamic-count',
        [{ ...effect, actions: [{ ...action, count: { value: 'hand-size' } }] }]
      ],
      ['other-effect', [effect, { ...effect, condition: { type: 'has-card-in-hand' } }]]
    ]
    const original = CARD_CATALOG.require.bind(CARD_CATALOG)
    for (const [name, effects] of variants) {
      const spy = vi
        .spyOn(CARD_CATALOG, 'require')
        .mockImplementation((id) =>
          id === ANTONIDAS ? { ...definition, effects } : original(id)
        )
      try {
        expect(revealsTacticalInformation(events, false, context), name).toBe(true)
      } finally {
        spy.mockRestore()
      }
    }
  })

  it.each(['basic_arcane_intellect', 'goblins_vs_gnomes_unstable_portal'])(
    'keeps %s uncertain despite public fixed generation alongside it',
    (cardId) => {
      const { events, context } = castSetupSpell(build({ aiHand: [cardId] }))
      expect(revealsTacticalInformation(events, false, context)).toBe(true)
    }
  )
})
