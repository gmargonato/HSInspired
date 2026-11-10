import {
  inspectExpertPublicThreat,
  EXPERT_PUBLIC_THREAT_MAX_DISPATCHES
} from './expert-public-threat'
import { describe, expect, it } from 'vitest'
import type {
  OpeningMatchCheckpoint,
  TurnMatchCommand
} from '../../../game-rules/match'
import { canonicalCommandKey, enumerateLegalCommands } from '../../../game-rules/match'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import {
  searchTactics,
  inspectTacticalLine,
  revealsTacticalInformation
} from '../../../game-rules/match/ai/tactical-search'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import { asPlayerId } from '../../../game-rules/match/match-types'
import { GameBoardSession } from '../game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { aiActions } from './ai-context'
import recorded from './expert-tactical-recorded-states.json'
import { runExpertAiWorkerDecision } from './expert-ai.worker'
import { evaluateExpertAiWorld } from './expert-ai-world-runner'
import { chooseExpertConsensus, type ExpertEvaluatedWorld } from './expert-ai-consensus'
import {
  findExpertVisibleDefense,
  EXPERT_VISIBLE_SURVIVAL_MAX_DISPATCHES
} from './expert-visible-survival'

type Match = Parameters<typeof enumerateLegalCommands>[0]

describe('Bounded public lethal defense', () => {
  function scenario(options: Partial<Parameters<typeof createAiFixture>[0]> = {}) {
    const fixture = createAiFixture({
      seed: 99,
      aiHeroId: 'malfurion',
      opponentHeroId: 'rexxar',
      turnNumber: 16,
      aiMana: 6,
      aiMaximumMana: 8,
      aiHealth: 7,
      aiArmor: 2,
      aiHeroPowerUsesThisTurn: 1,
      aiHeroPowerId: 'druid-dire-shapeshift',
      aiHand: ['basic_swipe', 'basic_wild_growth'],
      aiBoard: [{ cardId: 'classic_keeper_of_the_grove', ready: true }],
      opponentBoard: [
        { cardId: 'naxxramas_spectral_spider' },
        { cardId: 'whispers_of_the_old_gods_princess_huhuran', health: 1 },
        { cardId: 'basic_huffer', health: 2 },
        { cardId: 'classic_leokk' },
        { cardId: 'basic_misha' }
      ],
      aiDeck: ['basic_wild_growth'],
      opponentDeck: ['basic_tracking'],
      ...options
    })
    return new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
  }

  function review(session: GameBoardSession, stop = () => false) {
    return findExpertVisibleDefense(
      session.match.getCheckpoint(),
      session.remoteParticipantId,
      enumerateLegalCommands(session.match as Match, session.remoteParticipantId),
      undefined,
      stop,
      () => 0
    )
  }

  it('finds a deterministic spell-plus-trade defense without changing the live match', () => {
    const session = scenario(),
      before = session.match.getCheckpoint()
    const result = review(session)
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(result.stats.selectedReply).toBe('lethal')
    expect(result.stats.dispatches).toBeLessThanOrEqual(
      EXPERT_VISIBLE_SURVIVAL_MAX_DISPATCHES
    )
    expect(result.defense?.commands).toHaveLength(2)
    for (const command of result.defense!.commands)
      expect(session.dispatch(command).accepted).toBe(true)
    const self = session
      .getState()
      .players.find((p) => p.participantId === session.remoteParticipantId)!
    const enemy = session
      .getState()
      .players.find((p) => p.participantId === session.localParticipantId)!
    expect(self.hero.health + self.hero.armor).toBe(9)
    expect(enemy.board.map((m) => [m.cardId, m.attack, m.health])).toEqual([
      ['classic_leokk', 2, 3]
    ])
  })

  it('keeps a safe pass and refuses an exhausted check', () => {
    const safe = review(scenario({ opponentBoard: [] }))
    expect(safe.defense).toBeUndefined()
    expect(safe.stats.selectedReply).toBe('clear')
    const stopped = review(scenario(), () => true)
    expect(stopped.defense).toBeUndefined()
    expect(stopped.stats.exhausted).toBe(true)
    expect(stopped.stats.dispatches).toBe(0)
  })

  it.each(['classic_alexstrasza', 'one_night_in_karazhan_cat_trick'])(
    'never certifies concealed-condition Chillmaw defense from hidden %s',
    (hidden) => {
      const result = review(
        scenario({
          aiHealth: 6,
          aiArmor: 0,
          aiMana: 2,
          aiHand: ['basic_goldshire_footman', 'basic_goldshire_footman'],
          aiBoard: [],
          opponentBoard: [
            { cardId: 'the_grand_tournament_chillmaw', health: 1 },
            { cardId: 'basic_boulderfist_ogre' }
          ],
          opponentHand: [hidden],
          opponentDeck: [],
          opponentMaximumMana: 0
        })
      )
      expect(result.defense).toBeUndefined()
      expect(result.stats.supported).toBe(false)
      expect(result.stats.dispatches).toBe(0)
    }
  )

  it('does not turn a sampled random removal into a certified defense', () => {
    const result = review(
      scenario({
        aiHeroId: 'jaina',
        aiHeroPowerId: 'mage-fireblast',
        aiHealth: 2,
        aiArmor: 0,
        aiMana: 2,
        aiHand: ['goblins_vs_gnomes_flamecannon'],
        aiBoard: [],
        opponentBoard: [{ cardId: 'basic_bloodfen_raptor' }]
      })
    )
    expect(result.defense).toBeUndefined()
    expect(result.stats.selectedReply).toBe('lethal')
  })

  it('does not inspect an unknown generated card in its own deck', () => {
    const session = scenario({
      aiHealth: 6,
      aiArmor: 0,
      aiMana: 1,
      aiHand: ['basic_goldshire_footman'],
      aiBoard: [],
      opponentBoard: [{ cardId: 'basic_boulderfist_ogre' }],
      opponentHeroId: 'garrosh',
      opponentDeck: [],
      opponentMaximumMana: 0
    })
    const actor = session.remoteParticipantId
    const before = session.match.getCheckpoint()
    const variants = [
      'classic_wisp',
      'mean_streets_of_gadgetzan_patches_the_pirate',
      'the_grand_tournament_ambush'
    ].map((cardId) => ({
      ...before,
      state: {
        ...before.state,
        players: before.state.players.map((player) =>
          player.participantId !== actor
            ? player
            : {
                ...player,
                deck: player.deck.map((card) => ({
                  ...card,
                  cardId: cardId as typeof card.cardId,
                  startedInDeck: false,
                  knownTo: []
                }))
              }
        ) as unknown as typeof before.state.players
      }
    }))
    expect(createFairHypothesisCheckpoint(variants[0]!, actor, 19)).toEqual(
      createFairHypothesisCheckpoint(variants[1]!, actor, 19)
    )
    const commands = enumerateLegalCommands(session.match as Match, actor)
    const results = variants.map((checkpoint) =>
      findExpertVisibleDefense(
        checkpoint,
        actor,
        commands,
        undefined,
        () => false,
        () => 0
      )
    )
    for (const result of results.slice(1)) expect(result).toEqual(results[0])
    expect(results[0]!.defense?.commands).toHaveLength(1)
  })

  it('abstains when a known future draw can trigger an effect', () => {
    const session = scenario()
    const actor = session.remoteParticipantId
    const checkpoint = session.match.getCheckpoint()
    const knownDraw = {
      ...checkpoint,
      state: {
        ...checkpoint.state,
        players: checkpoint.state.players.map((player) =>
          player.participantId !== actor
            ? player
            : {
                ...player,
                deck: player.deck.map((card) => ({
                  ...card,
                  cardId: 'the_grand_tournament_ambush' as typeof card.cardId,
                  startedInDeck: false,
                  knownTo: [actor]
                }))
              }
        ) as unknown as typeof checkpoint.state.players
      }
    }
    const result = findExpertVisibleDefense(
      knownDraw,
      actor,
      enumerateLegalCommands(session.match as Match, actor),
      undefined,
      () => false,
      () => 0
    )
    expect(result.stats.supported).toBe(false)
    expect(result.stats.dispatches).toBe(0)
    expect(result.defense).toBeUndefined()
  })
})

function recordedSession(seed = 0x71ac71c) {
  const checkpoint = createFairHypothesisCheckpoint(
    recorded.compoundLethal.checkpoint as unknown as OpeningMatchCheckpoint,
    asPlayerId(recorded.compoundLethal.actorId),
    seed
  )
  return new GameBoardSession({
    setup: checkpoint.setup,
    decks: checkpoint.decks,
    checkpoint
  })
}

describe('Expert recorded compound lethal', () => {
  it('keeps weapon replacement and Overload damage within the existing six-ply beam', () => {
    const session = recordedSession()
    const before = session.match.getCheckpoint()
    const actor = session.remoteParticipantId
    const result = session.match.analyze((fork) => searchTactics(fork, actor))
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(result.nodes).toBeLessThanOrEqual(2_000)
    expect(result.win?.proven).toBe(true)
    expect(result.win?.commands).toHaveLength(6)
    const hand = before.state.players.find((p) => p.participantId === actor)!.hand
    const hammerId = hand.find((c) => c.cardId === 'classic_doomhammer')!.instanceId
    const line = result.win!.commands
    const weaponIndex = line.findIndex(
      (c) => c.type === 'play-card' && c.cardInstanceId === hammerId
    )
    expect(weaponIndex).toBeGreaterThan(0)
    expect(
      line
        .slice(0, weaponIndex)
        .some((c) => c.type === 'attack-character' && c.attacker.kind === 'hero')
    ).toBe(true)
    for (const command of line) {
      expect(
        enumerateLegalCommands(
          {
            getState: session.match.getState,
            getPlayInput: session.match.getPlayInput!,
            getLegality: session.match.getLegality!
          },
          actor
        ).map(canonicalCommandKey)
      ).toContain(canonicalCommandKey(command))
      expect(session.dispatch(command).accepted).toBe(true)
    }
    expect(session.getState().phase).toBe('ended')
    expect(session.getState().winnerId).toBe(actor)
  })

  it.each([48, 256])(
    'returns a proven line with accurate exhaustion at deterministic work cap %i',
    async (budget) => {
      const session = recordedSession()
      const actor = session.remoteParticipantId
      const actions = aiActions(
        session,
        enumerateLegalCommands(
          {
            getState: session.match.getState,
            getPlayInput: session.match.getPlayInput!,
            getLegality: session.match.getLegality!
          },
          actor
        )
      )
      const api = new LocalAiDecisionApi(session, undefined, {
        profile: 'expert',
        workBudget: budget,
        fairHypothesis: true
      })
      const response = await api.decide({
        matchId: 'recorded-c1',
        requestId: 'recorded-c1:53',
        phase: 'action',
        expectedRevision: session.getState().revision,
        actionIds: actions.map((a) => a.id),
        allowInspection: false,
        messages: []
      })
      expect(api.getLastTrace()?.decisionPriority).toBe('verified-win')
      expect(api.getLastTrace()?.tacticalNodes).toBeLessThanOrEqual(budget)
      expect(api.getLastTrace()?.tacticalExhausted).toBe(budget === 48)
      expect('actionId' in response.choice).toBe(true)
      for (const label of api.getLastTrace()!.chosenSequence!) {
        const command = JSON.parse(label) as TurnMatchCommand
        expect(
          enumerateLegalCommands(session.match as Match, actor).map(canonicalCommandKey)
        ).toContain(canonicalCommandKey(command))
        expect(session.dispatch(command).accepted).toBe(true)
      }
      expect(session.getState().winnerId).toBe(actor)
    },
    15_000
  )

  it('does not turn a pressure estimate into proof through a hidden Secret', () => {
    const fixture = createAiFixture({
      seed: 611,
      aiHeroId: 'thrall',
      opponentHeroId: 'jaina',
      aiMana: 0,
      aiHeroPowerAvailable: false,
      aiBoard: [{ cardId: 'basic_boulderfist_ogre', ready: true }],
      opponentHealth: 1,
      opponentSecrets: [{ cardId: 'classic_ice_block', revealed: false }]
    })
    const fair = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      23
    )
    const session = new GameBoardSession({
      setup: fair.setup,
      decks: fair.decks,
      checkpoint: fair
    })
    const before = session.match.getCheckpoint()
    const result = session.match.analyze((fork) =>
      searchTactics(fork, session.remoteParticipantId)
    )
    expect(result.win).toBeNull()
    expect(session.match.getCheckpoint()).toEqual(before)
  })

  it.each([
    { label: 'frozen', minion: { frozen: true } },
    {
      label: 'cannot attack heroes',
      minion: { keywords: ['cannot-attack-heroes'] as const }
    },
    { label: 'fresh Rush', minion: { ready: false, keywords: ['rush'] as const } }
  ])('does not certify unavailable face damage: $label', ({ minion }) => {
    const fixture = createAiFixture({
      seed: 612,
      aiHeroId: 'thrall',
      opponentHeroId: 'jaina',
      aiMana: 0,
      aiHeroPowerAvailable: false,
      aiBoard: [{ cardId: 'basic_boulderfist_ogre', ...minion }],
      opponentHealth: 1
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    expect(
      session.match.analyze((fork) => searchTactics(fork, session.remoteParticipantId))
        .win
    ).toBeNull()
  })
})

it('preserves positional frontier width and reports pruned states as incomplete', () => {
  // A small public graph isolates breadth selection; real-engine cases above
  // establish that the ranking hint can only become a win through dispatch.
  const actor = asPlayerId('width-self')
  const commands = Array.from({ length: 20 }, (_, index) => ({
    type: 'play-card' as const,
    participantId: actor,
    cardInstanceId: String(index)
  }))
  function node(
    selected = -1
  ): import('../../../game-rules/match').OpeningMatchAnalysis {
    let current = selected
    const state = () => ({
      phase: 'turns',
      activePlayerId: actor,
      turnNumber: 1,
      players: [
        { participantId: actor, hero: { health: 30, armor: 0 }, board: [], hand: [] },
        {
          participantId: 'width-enemy',
          hero: { health: 30 - current, armor: 0 },
          board: [],
          hand: []
        }
      ]
    })
    return {
      getState: state,
      getAiObservation: () => ({ selected: current }),
      getRandomState: () => 1,
      getLegality: () => ({
        playableCardInstanceIds: [],
        legalAttackTargets: {},
        legalHeroPower: false,
        canEndTurn: true
      }),
      getPlayInput: () => null,
      dispatch(command: { type: string; cardInstanceId?: string }) {
        if (command.type === 'play-card') current = Number(command.cardInstanceId)
        return { accepted: true, state: state(), events: [] }
      },
      analyze: (callback: (fork: unknown) => unknown) => callback(node(current))
    } as unknown as import('../../../game-rules/match').OpeningMatchAnalysis
  }
  const result = searchTactics(node(), actor, {
    commands,
    maxDepth: 2,
    width: 12,
    maxNodes: 100,
    evaluate: (fork) => fork.getState().players[1]!.hero.health
  })
  const expanded = result.lines
    .filter((line) => line.commands.length === 2)
    .map((line) => (line.commands[0] as { cardInstanceId: string }).cardInstanceId)
  expect(new Set(expanded).size).toBe(12)
  expect(expanded).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '11'
  ])
  expect(result.nodes).toBe(32)
  expect(result.complete).toBe(false)
})

it.each([
  {
    label: 'Taunt',
    options: {
      aiBoard: [{ cardId: 'basic_boulderfist_ogre', ready: true }],
      opponentHealth: 1,
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          health: 20,
          maxHealth: 20,
          keywords: ['taunt'] as const
        }
      ]
    }
  },
  {
    label: 'one remaining Windfury weapon charge',
    options: {
      aiBoard: [],
      opponentHealth: 3,
      aiWeapon: { cardId: 'classic_doomhammer', durability: 1 }
    }
  }
])('does not certify face potential blocked by $label', ({ options }) => {
  const fixture = createAiFixture({
    seed: 614,
    aiHeroId: 'thrall',
    opponentHeroId: 'jaina',
    aiMana: 0,
    aiHeroPowerAvailable: false,
    ...options
  })
  const session = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
  expect(
    session.match.analyze((fork) => searchTactics(fork, session.remoteParticipantId))
      .win
  ).toBeNull()
})

it('does not certify a positive pressure overestimate after a Windfury weapon breaks', () => {
  const fixture = createAiFixture({
    seed: 615,
    aiHeroId: 'thrall',
    opponentHeroId: 'jaina',
    aiMana: 0,
    aiHeroPowerAvailable: false,
    aiAttack: 1,
    aiWeapon: { cardId: 'classic_doomhammer', durability: 1 },
    aiHand: ['classic_wisp'],
    opponentHealth: 4
  })
  const session = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
  const play = enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  ).find((command) => command.type === 'play-card')!
  const before = session.match.getCheckpoint()
  const result = session.match.analyze((fork) =>
    searchTactics(fork, session.remoteParticipantId, {
      commands: [play],
      maxNodes: 100
    })
  )
  expect(result.win).toBeNull()
  expect(result.nodes).toBeGreaterThan(1)
  expect(session.match.getCheckpoint()).toEqual(before)
})

it('counts face completion against the same node, depth and cancellation limits', () => {
  const session = recordedSession()
  const actor = session.remoteParticipantId
  const hero = {
    type: 'attack-character' as const,
    participantId: actor,
    attacker: { kind: 'hero' as const },
    defender: { kind: 'hero' as const }
  }
  expect(session.dispatch(hero).accepted).toBe(true)
  const hammer = session
    .getState()
    .players.find((p) => p.participantId === actor)!
    .hand.find((c) => c.cardId === 'classic_doomhammer')!
  expect(
    session.dispatch({
      type: 'play-card',
      participantId: actor,
      cardInstanceId: hammer.instanceId
    }).accepted
  ).toBe(true)
  const first = enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    actor
  ).find((c) => c.type === 'attack-character' && c.attacker.kind === 'minion')!
  const before = session.match.getCheckpoint()
  const capped = session.match.analyze((fork) =>
    searchTactics(fork, actor, { commands: [first], maxNodes: 3 })
  )
  expect(capped.win).toBeNull()
  expect(capped.nodes).toBe(3)
  expect(capped.lines).toHaveLength(1)
  expect(capped.exhausted).toBe(true)
  expect(capped.complete).toBe(false)
  const shallow = session.match.analyze((fork) =>
    searchTactics(fork, actor, { commands: [first], maxDepth: 3, maxNodes: 100 })
  )
  expect(shallow.win).toBeNull()
  expect(shallow.lines.every((line) => line.commands.length <= 3)).toBe(true)
  let checks = 0
  const cancelled = session.match.analyze((fork) =>
    searchTactics(fork, actor, { commands: [first], shouldStop: () => ++checks >= 6 })
  )
  expect(cancelled.win).toBeNull()
  expect(cancelled.exhausted).toBe(true)
  expect(cancelled.complete).toBe(false)
  expect(session.match.getCheckpoint()).toEqual(before)
})

it('prioritizes a direct engine win over an earlier higher-prior setup completion', () => {
  const fixture = createAiFixture({
    seed: 616,
    aiHeroId: 'guldan',
    opponentHeroId: 'uther',
    aiMana: 8,
    aiHealth: 22,
    aiHand: ['basic_chillwind_yeti'],
    aiBoard: [{ cardId: 'basic_chillwind_yeti', ready: true }],
    opponentHealth: 4
  })
  const session = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
  const actor = session.remoteParticipantId
  const result = session.match.analyze((fork) =>
    searchTactics(fork, actor, {
      prior: (command) => (command.type === 'play-card' ? 100 : 0)
    })
  )
  expect(result.win?.proven).toBe(true)
  expect(result.win?.commands).toHaveLength(1)
  for (const command of result.win!.commands)
    expect(session.dispatch(command).accepted).toBe(true)
  expect(session.getState().winnerId).toBe(actor)
})

function provisionalGraph(uncertainty: 'none' | 'random' | 'reveal' = 'none') {
  const actor = asPlayerId('proof-self')
  const first = {
    type: 'play-card' as const,
    participantId: actor,
    cardInstanceId: 'first'
  }
  function node(
    selected = 0
  ): import('../../../game-rules/match').OpeningMatchAnalysis {
    let current = selected
    const state = () => ({
      phase: current === 3 ? 'ended' : 'turns',
      winnerId: current === 3 ? actor : null,
      activePlayerId: actor,
      turnNumber: 1,
      players: [
        {
          participantId: actor,
          hero: { health: 30, armor: 0, attack: current === 2 ? 1 : 0 },
          board: [],
          hand: []
        },
        {
          participantId: 'proof-enemy',
          hero: { health: current === 3 ? 0 : 1, armor: 0 },
          board: [],
          hand: []
        }
      ]
    })
    return {
      getState: state,
      getAiObservation: () => ({ current }),
      getRandomState: () => (uncertainty === 'random' && current >= 2 ? 2 : 1),
      getLegality: () => ({
        playableCardInstanceIds:
          current === 1
            ? ['long-setup', ...(uncertainty === 'none' ? ['direct-win'] : [])]
            : [],
        legalAttackTargets:
          current === 2 ? { [`${actor}:hero`]: [{ kind: 'hero' }] } : {},
        legalHeroPower: false,
        canEndTurn: false
      }),
      getPlayInput: () => ({
        choiceCount: 0,
        legalTargetOptions: [],
        requiresPosition: false
      }),
      dispatch(command: { type: string; cardInstanceId?: string }) {
        current =
          command.type === 'attack-character' || command.cardInstanceId === 'direct-win'
            ? 3
            : command.cardInstanceId === 'first'
              ? 1
              : 2
        return {
          accepted: true,
          state: state(),
          events:
            uncertainty === 'reveal' && current === 2 ? [{ type: 'card-drawn' }] : []
        }
      },
      analyze: (callback: (fork: unknown) => unknown) => callback(node(current))
    } as unknown as import('../../../game-rules/match').OpeningMatchAnalysis
  }
  return {
    actor,
    first,
    node,
    options: {
      commands: [first],
      prior: (command: { type: string; cardInstanceId?: string }) =>
        command.cardInstanceId === 'long-setup' ? 100 : 0
    }
  }
}

it('finishes the current breadth layer before choosing a longer completion', () => {
  const graph = provisionalGraph()
  const result = searchTactics(graph.node(), graph.actor, graph.options)
  expect(result.win?.commands).toEqual([
    graph.first,
    { type: 'play-card', participantId: graph.actor, cardInstanceId: 'direct-win' }
  ])
  expect(result.win?.proven).toBe(true)
  expect(result.nodes).toBe(4)
})

it('retains the exact proven completion when the shared node cap stops shorter-win review', () => {
  const graph = provisionalGraph()
  const result = searchTactics(graph.node(), graph.actor, {
    ...graph.options,
    maxNodes: 3
  })
  expect(result.nodes).toBe(3)
  expect(result.exhausted).toBe(true)
  expect(result.complete).toBe(false)
  expect(result.win?.proven).toBe(true)
  expect(result.win?.commands.map((command) => command.type)).toEqual([
    'play-card',
    'play-card',
    'attack-character'
  ])
  const replay = graph.node()
  for (const command of result.win!.commands)
    expect(replay.dispatch(command).accepted).toBe(true)
  expect(replay.getState().winnerId).toBe(graph.actor)
})

it.each(['random', 'reveal'] as const)(
  'does not save a provisional proof across a %s boundary',
  (uncertainty) => {
    const graph = provisionalGraph(uncertainty)
    const result = searchTactics(graph.node(), graph.actor, graph.options)
    expect(result.win).toBeNull()
    expect(result.complete).toBe(false)
  }
)

it('extends public chance samples without promoting sampled wins to proofs', () => {
  const graph = provisionalGraph('random')
  const result = searchTactics(graph.node(), graph.actor, {
    ...graph.options,
    sampleChance: true,
    maxNodes: 32
  })
  expect(
    result.lines.some(
      (line) =>
        line.commands.length === 3 && line.sampledChance && line.outcome === 'win'
    )
  ).toBe(true)
  expect(result.win).toBeNull()
  expect(
    result.lines.filter((line) => line.sampledChance).every((line) => !line.proven)
  ).toBe(true)
  expect(result.nodes).toBeLessThanOrEqual(32)
})

it('does not extend a hidden draw when public chance sampling is enabled', () => {
  const graph = provisionalGraph('reveal')
  const result = searchTactics(graph.node(), graph.actor, {
    ...graph.options,
    sampleChance: true
  })
  expect(result.lines.some((line) => line.commands.length > 2)).toBe(false)
  expect(result.win).toBeNull()
})

it('samples Storm followed by a trade in the recorded Shaman position', () => {
  const session = new GameBoardSession(
    createAiFixture({
      seed: 20261109,
      aiHeroId: 'thrall',
      opponentHeroId: 'guldan',
      aiMana: 7,
      aiHand: ['journey_to_ungoro_tidal_surge', 'classic_lightning_storm'],
      aiBoard: [{ cardId: 'classic_harrison_jones', health: 1, ready: true }],
      opponentBoard: [
        { cardId: 'classic_infernal' },
        {
          cardId: 'whispers_of_the_old_gods_faceless_shambler',
          attack: 6,
          health: 6,
          maxHealth: 6
        }
      ]
    })
  )
  const actor = session.remoteParticipantId
  const before = session.match.getCheckpoint()
  const own = before.state.players.find((player) => player.participantId === actor)!
  const storm = own.hand.find((card) => card.cardId === 'classic_lightning_storm')!
  const surge = own.hand.find(
    (card) => card.cardId === 'journey_to_ungoro_tidal_surge'
  )!
  const result = session.match.analyze((root) =>
    searchTactics(root, actor, {
      sampleChance: true,
      maxNodes: 1024,
      maxDepth: 4,
      commands: enumerateLegalCommands(root, actor).filter(
        (command) =>
          command.type === 'play-card' &&
          command.cardInstanceId === surge.instanceId &&
          command.targets?.some(
            (target) => target.kind === 'minion' && target.participantId !== actor
          )
      )
    })
  )
  expect(
    result.lines.some(
      (line) =>
        line.sampledChance &&
        line.commands.some(
          (command, index) =>
            command.type === 'play-card' &&
            command.cardInstanceId === storm.instanceId &&
            line.commands[index + 1]?.type === 'attack-character'
        )
    )
  ).toBe(true)
  expect(result.win).toBeNull()
  expect(session.match.getCheckpoint()).toEqual(before)
})

describe('Expert recorded root attack-only wins', () => {
  it.each([
    { key: 'rootAttackOnly82', commands: 3, budget: 48 },
    { key: 'rootAttackOnly82', commands: 3, budget: 256 },
    { key: 'rootAttackOnly84', commands: 2, budget: 48 },
    { key: 'rootAttackOnly84', commands: 2, budget: 256 }
  ] as const)(
    'preserves hand and mana at $key with deterministic work cap $budget',
    async ({ key, commands, budget }) => {
      const data = recorded[key]
      const actor = asPlayerId(data.actorId)
      const checkpoint = createFairHypothesisCheckpoint(
        data.checkpoint as unknown as OpeningMatchCheckpoint,
        actor,
        0x73ac71c
      )
      const session = new GameBoardSession({
        setup: checkpoint.setup,
        decks: checkpoint.decks,
        checkpoint
      })
      const before = session.match.getCheckpoint()
      const ownBefore = before.state.players.find((p) => p.participantId === actor)!
      const actions = aiActions(
        session,
        enumerateLegalCommands(session.match as Match, actor)
      )
      const api = new LocalAiDecisionApi(session, undefined, {
        profile: 'expert',
        workBudget: budget,
        fairHypothesis: true
      })
      const response = await api.decide({
        matchId: 'recorded-root-attacks',
        requestId: `recorded-root-attacks:${data.ordinal}`,
        phase: 'plan',
        expectedRevision: session.getState().revision,
        actionIds: actions.map((action) => action.id),
        allowInspection: false,
        messages: []
      })
      expect('plan' in response.choice).toBe(true)
      expect(session.match.getCheckpoint()).toEqual(before)
      expect(api.getLastTrace()?.decisionPriority).toBe('verified-win')
      expect(api.getLastTrace()?.tacticalNodes).toBeLessThanOrEqual(budget)
      const sequence = api
        .getLastTrace()!
        .chosenSequence!.map((label) => JSON.parse(label) as TurnMatchCommand)
      expect(sequence).toHaveLength(commands)
      expect(sequence.every((command) => command.type === 'attack-character')).toBe(
        true
      )
      for (const command of sequence) {
        expect(
          enumerateLegalCommands(session.match as Match, actor).map(canonicalCommandKey)
        ).toContain(canonicalCommandKey(command))
        expect(session.dispatch(command).accepted).toBe(true)
        const own = session.getState().players.find((p) => p.participantId === actor)!
        expect(own.hand).toEqual(ownBefore.hand)
        expect(own.mana).toEqual(ownBefore.mana)
        expect(session.match.getCheckpoint().rngState).toEqual(before.rngState)
      }
      expect(session.getState().phase).toBe('ended')
      expect(session.getState().winnerId).toBe(actor)
    },
    15_000
  )
})

function attackOnlyRootSession(withImmediateSpell = false, withSetup = false) {
  const fixture = createAiFixture({
    seed: 617,
    aiHeroId: 'jaina',
    opponentHeroId: 'uther',
    aiMana: withImmediateSpell ? 4 : 0,
    aiHeroPowerAvailable: false,
    aiHand: withImmediateSpell ? ['basic_fireball'] : withSetup ? ['classic_wisp'] : [],
    aiBoard: [
      { cardId: 'basic_chillwind_yeti', ready: true },
      { cardId: 'basic_chillwind_yeti', ready: true }
    ],
    opponentHealth: 6
  })
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
}

it('does not begin a root attack-only proof with a face attack excluded by commands', () => {
  const session = attackOnlyRootSession()
  const actor = session.remoteParticipantId
  const allowed = enumerateLegalCommands(session.match as Match, actor).filter(
    (command) => command.type !== 'attack-character' || command.defender.kind !== 'hero'
  )
  expect(allowed).toHaveLength(1)
  expect(allowed[0]!.type).toBe('end-turn')
  const before = session.match.getCheckpoint()
  const result = session.match.analyze((fork) =>
    searchTactics(fork, actor, { commands: allowed, maxNodes: 100 })
  )
  expect(result.win).toBeNull()
  expect(result.nodes).toBeLessThanOrEqual(100)
  expect(
    result.lines.every((line) =>
      allowed.some(
        (command) =>
          canonicalCommandKey(command) === canonicalCommandKey(line.commands[0]!)
      )
    )
  ).toBe(true)
  expect(session.match.getCheckpoint()).toEqual(before)
})

it('honors a non-default allowed first attacker ahead of a higher-prior legal setup', () => {
  const session = attackOnlyRootSession(false, true)
  const actor = session.remoteParticipantId
  const faceAttacks = enumerateLegalCommands(session.match as Match, actor).filter(
    (command) => command.type === 'attack-character' && command.defender.kind === 'hero'
  )
  expect(faceAttacks).toHaveLength(2)
  const allowedFirst = faceAttacks[1]!
  const setup = enumerateLegalCommands(session.match as Match, actor).find(
    (command) => command.type === 'play-card'
  )!
  expect(setup).toBeDefined()
  expect(canonicalCommandKey(allowedFirst)).not.toBe(
    canonicalCommandKey(faceAttacks[0]!)
  )
  const before = session.match.getCheckpoint()
  const result = session.match.analyze((fork) =>
    searchTactics(fork, actor, {
      commands: [setup, allowedFirst],
      maxNodes: 100,
      prior: (command) => (command.type === 'play-card' ? 100 : 0)
    })
  )
  expect(result.win?.proven).toBe(true)
  expect(result.win?.commands).toHaveLength(2)
  expect(canonicalCommandKey(result.win!.commands[0]!)).toBe(
    canonicalCommandKey(allowedFirst)
  )
  expect(session.match.getCheckpoint()).toEqual(before)
  for (const command of result.win!.commands) {
    expect(command.type).toBe('attack-character')
    expect(session.dispatch(command).accepted).toBe(true)
  }
  expect(session.getState().winnerId).toBe(actor)
})

it('keeps a later immediate spell win ahead of a provisional root attack-only proof', () => {
  const session = attackOnlyRootSession(true)
  const actor = session.remoteParticipantId
  const result = session.match.analyze((fork) =>
    searchTactics(fork, actor, {
      maxNodes: 100,
      prior: (command) => (command.type === 'attack-character' ? 100 : 0)
    })
  )
  expect(result.win?.proven).toBe(true)
  expect(result.win?.commands).toHaveLength(1)
  expect(result.win!.commands[0]!.type).toBe('play-card')
  expect(session.dispatch(result.win!.commands[0]!).accepted).toBe(true)
  expect(session.getState().winnerId).toBe(actor)
})

it('spends a one-node budget on the highest-prior immediate spell before root attack completion', () => {
  const session = attackOnlyRootSession(true)
  const actor = session.remoteParticipantId
  const opponent = session.getState().players.find((p) => p.participantId !== actor)!
  const immediate = enumerateLegalCommands(session.match as Match, actor).find(
    (command) =>
      command.type === 'play-card' &&
      command.targets?.some(
        (target) =>
          target.kind === 'hero' && target.participantId === opponent.participantId
      )
  )!
  expect(immediate).toBeDefined()
  const before = session.match.getCheckpoint()
  const result = session.match.analyze((fork) =>
    searchTactics(fork, actor, {
      maxNodes: 1,
      prior: (command) =>
        canonicalCommandKey(command) === canonicalCommandKey(immediate) ? 100 : 0
    })
  )
  expect(session.match.getCheckpoint()).toEqual(before)
  expect(result.nodes).toBe(1)
  expect(result.win?.proven).toBe(true)
  expect(result.win?.commands).toHaveLength(1)
  expect(canonicalCommandKey(result.win!.commands[0]!)).toBe(
    canonicalCommandKey(immediate)
  )
  expect(session.dispatch(result.win!.commands[0]!).accepted).toBe(true)
  expect(session.getState().winnerId).toBe(actor)
})

it.each([
  { budget: 22, retainsSetup: true },
  { budget: 100, retainsSetup: false }
])(
  'keeps the proven root line when optional attack preference reaches cap $budget',
  ({ budget, retainsSetup }) => {
    const data = recorded.rootAttackOnly82
    const actor = asPlayerId(data.actorId)
    const checkpoint = createFairHypothesisCheckpoint(
      data.checkpoint as unknown as OpeningMatchCheckpoint,
      actor,
      0x73ac71c
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const setup = data.historicalCommand as unknown as TurnMatchCommand
    const before = session.match.getCheckpoint()
    const ownBefore = before.state.players.find((p) => p.participantId === actor)!
    expect(
      enumerateLegalCommands(session.match as Match, actor).map(canonicalCommandKey)
    ).toContain(canonicalCommandKey(setup))
    const result = session.match.analyze((fork) =>
      searchTactics(fork, actor, {
        maxNodes: budget,
        prior: (command) =>
          canonicalCommandKey(command) === canonicalCommandKey(setup) ? 100 : 0
      })
    )
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(result.nodes).toBeLessThanOrEqual(budget)
    expect(result.win?.proven).toBe(true)
    if (retainsSetup) {
      expect(result.nodes).toBe(22)
      expect(result.exhausted).toBe(true)
      expect(result.complete).toBe(false)
      expect(result.win!.commands).toHaveLength(4)
      expect(canonicalCommandKey(result.win!.commands[0]!)).toBe(
        canonicalCommandKey(setup)
      )
    } else {
      expect(result.win!.commands).toHaveLength(3)
      expect(
        result.win!.commands.every((command) => command.type === 'attack-character')
      ).toBe(true)
    }
    for (const command of result.win!.commands) {
      expect(
        enumerateLegalCommands(session.match as Match, actor).map(canonicalCommandKey)
      ).toContain(canonicalCommandKey(command))
      expect(session.dispatch(command).accepted).toBe(true)
    }
    expect(session.getState().winnerId).toBe(actor)
    if (!retainsSetup) {
      const own = session.getState().players.find((p) => p.participantId === actor)!
      expect(own.hand).toEqual(ownBefore.hand)
      expect(own.mana).toEqual(ownBefore.mana)
    }
  }
)

describe('Public attack defense with dormant recycling', () => {
  function recycling(remaining = 2, hidden = 'basic_boulderfist_ogre') {
    const fixture = createAiFixture({
      seed: 99,
      aiHeroId: 'jaina',
      opponentHeroId: 'guldan',
      turnNumber: 16,
      aiMana: 6,
      aiMaximumMana: 8,
      aiHealth: 5,
      aiHand: [{ cardId: 'basic_sap', currentCost: 0 }],
      aiQuest: { cardId: 'journey_to_ungoro_open_the_waygate', progress: 3 },
      aiBoard: [],
      opponentBoard: [
        { cardId: 'journey_to_ungoro_flame_elemental' },
        { cardId: 'future_past_ancient_of_yore' },
        { cardId: 'future_past_puppetmaster_dorian', attack: 2, health: 3 },
        { cardId: 'future_past_ancient_of_yore', health: 3 }
      ],
      aiDeck: ['basic_fireball'],
      opponentDeck: [hidden],
      opponentHand: [hidden]
    })
    const actor = fixture.setup.participants.find(
      (p) => p.controllerKind === 'ai'
    )!.participantId
    const checkpoint = {
      ...fixture.checkpoint,
      state: {
        ...fixture.checkpoint.state,
        players: fixture.checkpoint.state.players.map((player) =>
          player.participantId === actor
            ? player
            : {
                ...player,
                board: player.board.map((m, index) =>
                  index === 1
                    ? { ...m, dormant: true, dormantTurnsRemaining: remaining }
                    : index === 3
                      ? {
                          ...m,
                          dormant: false,
                          deathrattles: [
                            {
                              trigger: 'deathrattle',
                              actions: [
                                {
                                  action: 'summon-fresh-copy',
                                  count: 2,
                                  dormantTurns: 2
                                }
                              ]
                            }
                          ]
                        }
                      : m
                )
              }
        )
      }
    } as unknown as OpeningMatchCheckpoint
    return { checkpoint, actor }
  }

  it.each(['basic_boulderfist_ogre', 'basic_fireball'])(
    'certifies free Sap without using concealed draw identity %s',
    (hidden) => {
      const { checkpoint, actor } = recycling(2, hidden)
      const before = JSON.stringify(checkpoint)
      const result = inspectExpertPublicThreat(
        checkpoint,
        actor,
        undefined,
        () => false,
        () => 0
      )
      expect(result.stats.supported).toBe(true)
      expect(result.reply).toBe('lethal')
      expect(
        result.defenses.some((line) => line.commands[0]?.type === 'play-card')
      ).toBe(true)
      expect(result.stats.dispatches).toBeLessThanOrEqual(
        EXPERT_PUBLIC_THREAT_MAX_DISPATCHES
      )
      expect(JSON.stringify(checkpoint)).toBe(before)
    }
  )

  it('does not certify Sap when the other Ancient wakes before attacking', () => {
    const { checkpoint, actor } = recycling(1)
    const result = inspectExpertPublicThreat(
      checkpoint,
      actor,
      undefined,
      () => false,
      () => 0
    )
    expect(result.reply).toBe('lethal')
    expect(result.defenses).toHaveLength(0)
  })

  it('keeps unsupported active deathrattle copies outside the safety boundary', () => {
    const { checkpoint, actor } = recycling()
    const changed = JSON.parse(JSON.stringify(checkpoint)) as OpeningMatchCheckpoint
    const enemy = changed.state.players.find((p) => p.participantId !== actor)!
    Object.assign(enemy.board[3]!.deathrattles![0]!.actions![0]!, { dormantTurns: 0 })
    const result = inspectExpertPublicThreat(
      changed,
      actor,
      undefined,
      () => false,
      () => 0
    )
    expect(result.stats.supported).toBe(false)
    expect(result.defenses).toHaveLength(0)
  })

  it('rejects restored unsupported printed effects from a silenced copy source', () => {
    const { checkpoint, actor } = recycling()
    const changed = JSON.parse(JSON.stringify(checkpoint)) as OpeningMatchCheckpoint
    const enemy = changed.state.players.find((p) => p.participantId !== actor)!
    Object.assign(enemy.board[3]!, { cardId: 'classic_knife_juggler', silenced: true })
    const result = inspectExpertPublicThreat(
      changed,
      actor,
      undefined,
      () => false,
      () => 0
    )
    expect(result.stats.supported).toBe(false)
    expect(result.defenses).toHaveLength(0)
  })

  it('finds a deterministic clear plus ping under the original shared budget', () => {
    const fixture = createAiFixture({
      seed: 99,
      aiHeroId: 'jaina',
      opponentHeroId: 'guldan',
      turnNumber: 18,
      aiMana: 9,
      aiMaximumMana: 10,
      aiHealth: 9,
      aiBoard: [],
      aiHand: ['basic_flamestrike', 'one_night_in_karazhan_firelands_portal'],
      opponentBoard: [
        { cardId: 'future_past_ancient_of_yore', health: 5 },
        { cardId: 'future_past_ancient_of_yore', health: 5 }
      ],
      aiDeck: ['basic_fireball'],
      opponentDeck: ['basic_fireball']
    })
    const actor = fixture.setup.participants.find(
      (p) => p.controllerKind === 'ai'
    )!.participantId
    const result = inspectExpertPublicThreat(
      fixture.checkpoint,
      actor,
      undefined,
      () => false,
      () => 0
    )
    expect(result.reply).toBe('lethal')
    expect(
      result.defenses.some(
        (line) =>
          line.commands.length === 3 &&
          line.commands.some((c) => c.type === 'use-hero-power') &&
          line.commands.some((c) => c.type === 'play-card')
      )
    ).toBe(true)
    expect(result.stats.dispatches).toBeLessThanOrEqual(
      EXPERT_PUBLIC_THREAT_MAX_DISPATCHES
    )
  })
})

it.each([
  ['classic_gorehowl', true],
  ['classic_truesilver_champion', false]
] as const)('keeps public weapon effect support narrow: %s', (cardId, supported) => {
  const fixture = createAiFixture({
    seed: 912,
    aiHeroId: 'malfurion',
    opponentHeroId: 'garrosh',
    aiMana: 0,
    aiHealth: 30,
    aiHeroPowerAvailable: false,
    aiHand: [],
    aiBoard: [],
    opponentBoard: [],
    opponentWeapon: { cardId },
    aiDeck: ['basic_murloc_raider'],
    opponentDeck: ['basic_murloc_raider']
  })
  const session = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
  const result = inspectExpertPublicThreat(
    session.match.getCheckpoint(),
    session.remoteParticipantId
  )
  expect(result.stats.supported).toBe(supported)
})

describe('Public certainty across concealed summon pools', () => {
  const base: AiFixtureOptions = {
    seed: 8801,
    aiHeroId: 'jaina',
    opponentHeroId: 'jaina',
    aiMana: 2,
    aiHeroPowerAvailable: false,
    aiHeroPowerUsesThisTurn: 1,
    opponentHeroPowerAvailable: false,
    opponentHeroPowerUsesThisTurn: 1,
    opponentHealth: 3,
    aiHealth: 6,
    aiBoard: [{ cardId: 'classic_questing_adventurer', ready: true }],
    aiHand: ['mean_streets_of_gadgetzan_dirty_rat'],
    opponentHand: ['goblins_vs_gnomes_flamecannon'],
    aiDeck: ['basic_chillwind_yeti'],
    opponentDeck: ['basic_chillwind_yeti']
  }
  function session(
    options: Partial<AiFixtureOptions> = {},
    sample?: number,
    knownHand = false
  ) {
    const f = createAiFixture({ ...base, ...options })
    const checkpoint =
      sample === undefined
        ? f.checkpoint
        : createFairHypothesisCheckpoint(f.checkpoint, f.aiParticipantId, sample)
    if (knownHand)
      for (const p of checkpoint.state.players)
        if (p.participantId !== f.aiParticipantId)
          for (const c of p.hand) Object.assign(c, { knownTo: [f.aiParticipantId] })
    return new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
  }
  function ratLine(s: GameBoardSession): TurnMatchCommand[] {
    const me = s
      .getState()
      .players.find((p) => p.participantId === s.remoteParticipantId)!
    return [
      {
        type: 'play-card',
        participantId: s.remoteParticipantId,
        cardInstanceId: me.hand[0]!.instanceId,
        position: 0
      },
      {
        type: 'attack-character',
        participantId: s.remoteParticipantId,
        attacker: { kind: 'minion', instanceId: me.board[0]!.instanceId },
        defender: { kind: 'hero' }
      }
    ]
  }
  function prove(s: GameBoardSession) {
    return s.match.analyze((fork) =>
      searchTactics(fork, s.remoteParticipantId, { maxNodes: 256 })
    )
  }
  function inspect(s: GameBoardSession, line: readonly TurnMatchCommand[]) {
    return s.match.analyze((fork) =>
      inspectTacticalLine(fork, s.remoteParticipantId, line)
    )
  }

  it('rejects a Dirty Rat no-op proof across identical public observations', () => {
    // Pin concealed identities: this checks public uncertainty, not catalog RNG.
    const lucky = session(),
      taunt = session({ opponentHand: ['basic_senjin_shieldmasta'] })
    expect(lucky.getAiObservation()).toEqual(taunt.getAiObservation())
    const before = lucky.match.getCheckpoint(),
      line = ratLine(lucky)
    const action = lucky.match.analyze((fork) => {
      const b = fork.getState(),
        rng = JSON.stringify(fork.getRandomState?.()),
        r = fork.dispatch(line[0]!)
      return {
        accepted: r.accepted,
        rngUnchanged: rng === JSON.stringify(fork.getRandomState?.()),
        uncertain: revealsTacticalInformation(r.events, false, {
          before: b,
          after: r.state,
          playerId: lucky.remoteParticipantId
        })
      }
    })
    expect(action.accepted).toBe(true)
    expect(action.rngUnchanged).toBe(true)
    expect(action.uncertain).toBe(true)
    expect(inspect(lucky, line).outcome).toBe('unknown')
    expect(prove(lucky).win).toBeNull()
    expect(lucky.match.getCheckpoint()).toEqual(before)
    const replay = taunt.match.analyze((fork) =>
      line.map((command) => fork.dispatch(command).accepted)
    )
    expect(replay).toEqual([true, false])
  })
  it.each([
    ['empty hand', [], false],
    ['publicly known spell', ['goblins_vs_gnomes_flamecannon'], true]
  ] as const)(
    'retains the deterministic win with %s',
    (_label, opponentHand, known) => {
      const s = session({ opponentHand }, undefined, known),
        line = ratLine(s)
      expect(inspect(s, line).outcome).toBe('win')
      expect(prove(s).win?.proven).toBe(true)
    }
  )
  it('rejects an independent Deathlord hidden-deck no-op proof', () => {
    const spec: Partial<AiFixtureOptions> = {
      aiMana: 0,
      aiHand: [],
      aiBoard: [
        { cardId: 'naxxramas_deathlord', health: 1, ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true }
      ],
      opponentHealth: 6,
      opponentBoard: [{ cardId: 'basic_senjin_shieldmasta', health: 1 }],
      opponentHand: [],
      opponentDeck: ['goblins_vs_gnomes_flamecannon']
    }
    const s = session(spec),
      me = s.getState().players.find((p) => p.participantId === s.remoteParticipantId)!,
      enemy = s
        .getState()
        .players.find((p) => p.participantId !== s.remoteParticipantId)!
    const line: TurnMatchCommand[] = [
      {
        type: 'attack-character',
        participantId: s.remoteParticipantId,
        attacker: { kind: 'minion', instanceId: me.board[0]!.instanceId },
        defender: { kind: 'minion', instanceId: enemy.board[0]!.instanceId }
      },
      {
        type: 'attack-character',
        participantId: s.remoteParticipantId,
        attacker: { kind: 'minion', instanceId: me.board[1]!.instanceId },
        defender: { kind: 'hero' }
      }
    ]
    expect(inspect(s, line).outcome).toBe('unknown')
    expect(prove(s).win).toBeNull()
    const taunt = session({ ...spec, opponentDeck: ['basic_senjin_shieldmasta'] })
    expect(taunt.getAiObservation()).toEqual(s.getAiObservation())
    expect(
      taunt.match.analyze((fork) =>
        line.map((command) => fork.dispatch(command).accepted)
      )
    ).toEqual([true, false])
  })
  it.each([
    ['Ancestors Call', { aiMana: 4, aiHand: ['goblins_vs_gnomes_ancestors_call'] }],
    [
      'Desert Camel',
      {
        aiMana: 3,
        aiHand: ['league_of_explorers_desert_camel'],
        opponentHand: [],
        opponentDeck: ['goblins_vs_gnomes_flamecannon']
      }
    ]
  ] as const)('rejects the %s concealed empty-pool variant', (_label, options) => {
    const s = session(options)
    expect(inspect(s, ratLine(s)).outcome).toBe('unknown')
    expect(prove(s).win).toBeNull()
  })
  it('retains Deathlord proof when the opponent deck is publicly empty', () => {
    const s = session({
      aiMana: 0,
      aiHand: [],
      aiBoard: [
        { cardId: 'naxxramas_deathlord', health: 1, ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true }
      ],
      opponentHealth: 6,
      opponentBoard: [{ cardId: 'basic_senjin_shieldmasta', health: 1 }],
      opponentHand: [],
      opponentDeck: []
    })
    expect(prove(s).win?.proven).toBe(true)
  })
  it('does not propagate the lucky world as a verified consensus win', async () => {
    const results: ExpertEvaluatedWorld[] = []
    let actionIds: string[] = []
    for (const seed of [13, 18]) {
      const s = session({}, seed),
        legal = aiActions(
          s,
          enumerateLegalCommands(s.match as Match, s.remoteParticipantId)
        )
      actionIds = legal.map((a) => a.id)
      const api = new LocalAiDecisionApi(s, undefined, {
        profile: 'expert',
        fairHypothesis: true,
        workBudget: 48
      })
      const response = await api.decide({
        matchId: 'certain',
        requestId: 'certain:8801',
        phase: 'action',
        expectedRevision: s.getState().revision,
        allowInspection: false,
        messages: [],
        actionIds
      })
      results.push({ response, trace: api.getLastTrace() })
    }
    expect(
      results.flatMap((r) => r.trace?.candidates ?? []).some((c) => c.provenWin)
    ).toBe(false)
    const consensus = chooseExpertConsensus(results, actionIds)
    expect([...consensus.scores.values()].some((c) => c.provenWin)).toBe(false)
  })
  it('chooses the public Wisp lethal instead of the lucky Dirty Rat line', async () => {
    const results: ExpertEvaluatedWorld[] = []
    let actionIds: string[] = []
    const actual = session({
      aiHand: ['mean_streets_of_gadgetzan_dirty_rat', 'classic_wisp'],
      opponentHand: ['goblins_vs_gnomes_annoy_o_tron']
    })
    for (const seed of [13, 18]) {
      const s = session(
          { aiHand: ['mean_streets_of_gadgetzan_dirty_rat', 'classic_wisp'] },
          seed
        ),
        legal = aiActions(
          s,
          enumerateLegalCommands(s.match as Match, s.remoteParticipantId)
        )
      actionIds = legal.map((a) => a.id)
      const api = new LocalAiDecisionApi(s, undefined, {
        profile: 'expert',
        fairHypothesis: true,
        workBudget: 48
      })
      const response = await api.decide({
        matchId: 'certain-choice',
        requestId: 'certain-choice:8801',
        phase: 'action',
        expectedRevision: s.getState().revision,
        allowInspection: false,
        messages: [],
        actionIds
      })
      results.push({ response, trace: api.getLastTrace() })
    }
    const consensus = chooseExpertConsensus(results, actionIds),
      selected = consensus.scores.get(consensus.actionId!)?.trace
    const me = actual
      .getState()
      .players.find((p) => p.participantId === actual.remoteParticipantId)!
    expect(selected?.sequenceIntents?.[0]?.source).toBe(
      me.hand.find((c) => c.cardId === 'classic_wisp')!.instanceId
    )
    const line: TurnMatchCommand[] = [
      {
        type: 'play-card',
        participantId: actual.remoteParticipantId,
        cardInstanceId: me.hand[1]!.instanceId,
        position: 0
      },
      {
        type: 'attack-character',
        participantId: actual.remoteParticipantId,
        attacker: { kind: 'minion', instanceId: me.board[0]!.instanceId },
        defender: { kind: 'hero' }
      }
    ]
    expect(inspect(actual, line).outcome).toBe('win')
  })
  it('keeps production worker aggregation on the public Wisp win', async () => {
    const s = session({
      aiHand: ['mean_streets_of_gadgetzan_dirty_rat', 'classic_wisp'],
      opponentHand: ['goblins_vs_gnomes_annoy_o_tron']
    })
    const legal = aiActions(
      s,
      enumerateLegalCommands(s.match as Match, s.remoteParticipantId)
    )
    const checkpoint = createFairHypothesisCheckpoint(
      s.match.getCheckpoint(),
      s.remoteParticipantId,
      8802
    )
    const response = await runExpertAiWorkerDecision(
      {
        type: 'decide',
        checkpoint,
        perspectivePlayerId: s.remoteParticipantId,
        seed: (13 - 0x9e3779b9) >>> 0,
        remainingSearchBudgetMs: 6000,
        request: {
          matchId: 'certain-worker',
          requestId: 'certain-worker:8801',
          phase: 'action',
          expectedRevision: s.getState().revision,
          allowInspection: false,
          messages: [],
          actionIds: legal.map((a) => a.id)
        }
      },
      {
        evaluateWorld: (request, index, budget) =>
          evaluateExpertAiWorld(request, index, budget, { workBudget: 48 })
      }
    )
    const me = s
      .getState()
      .players.find((p) => p.participantId === s.remoteParticipantId)!
    expect(response?.usage?.worldsEvaluated).toBe(2)
    expect(response?.usage?.decisionPriority).toBe('verified-win')
    if (!response || !('actionId' in response.choice))
      throw Error('Expected worker action')
    expect(response.choice.intent?.source).toBe(
      me.hand.find((c) => c.cardId === 'classic_wisp')!.instanceId
    )
  })
  it('persists bounded worker diagnostics with actual continuation support and ranking terms', async () => {
    const s = session({
      aiMana: 5,
      aiHealth: 30,
      aiHand: ['basic_the_coin', 'basic_boulderfist_ogre'],
      aiBoard: [],
      opponentHealth: 30,
      opponentHand: [],
      opponentBoard: []
    })
    const legal = aiActions(
      s,
      enumerateLegalCommands(s.match as Match, s.remoteParticipantId)
    )
    const response = await runExpertAiWorkerDecision(
      {
        type: 'decide',
        checkpoint: createFairHypothesisCheckpoint(
          s.match.getCheckpoint(),
          s.remoteParticipantId,
          8803
        ),
        perspectivePlayerId: s.remoteParticipantId,
        seed: 8803,
        remainingSearchBudgetMs: 6000,
        request: {
          matchId: 'diagnostics-worker',
          requestId: 'diagnostics-worker:8803',
          phase: 'action',
          expectedRevision: s.getState().revision,
          allowInspection: false,
          messages: [],
          actionIds: legal.map((a) => a.id)
        }
      },
      {
        evaluateWorld: (request, index, budget) =>
          evaluateExpertAiWorld(request, index, budget, { workBudget: 64 })
      }
    )
    if (!response || !('actionId' in response.choice))
      throw Error('Expected worker action')
    // Exercise the JSON boundary used by persisted AI usage records.
    const usage = JSON.parse(JSON.stringify(response.usage))
    expect(usage.selectedCandidateId).toBe(response.choice.actionId)
    expect(usage.policyRevision).toBe('expert-tactics-11')
    expect(usage.continuationPolicy.minimumSamples).toBe(4)
    expect(usage.continuationPolicy.exploratorySamples).toBe(2)
    let continuations = 0
    for (const world of usage.searchDiagnostics) {
      expect(world.comparisonVisits).toBeGreaterThan(0)
      expect(world.sampledChanceSeeds).toBeLessThanOrEqual(8)
      expect(world.candidateStatistics.length).toBeGreaterThan(0)
      expect(world.candidateStatistics.length).toBeLessThanOrEqual(8)
      expect(world.candidateStatistics[0].selectedInWorld).toBe(true)
      for (const candidate of world.candidateStatistics) {
        expect(candidate.visits).toBeGreaterThan(0)
        if (candidate.rankingComponents)
          expect(candidate.finalRecommendationValue).toBeCloseTo(
            Object.values(candidate.rankingComponents).reduce<number>(
              (sum, value) => sum + Number(value),
              0
            ),
            10
          )
        const estimate = candidate.continuationEstimate
        if (!estimate) continue
        continuations++
        expect(estimate.supportVisits).toBeGreaterThan(0)
        expect(estimate.comparisonVisits).toBe(world.comparisonVisits)
        expect(estimate.value).toBeGreaterThanOrEqual(estimate.rootValue)
        expect(estimate.supported).toBe(
          estimate.supportVisits >= estimate.requiredSamples
        )
      }
    }
    expect(continuations).toBeGreaterThan(0)
  })
  it('preserves pre-existing random-damage and secret safety', () => {
    for (const options of [
      {
        aiHand: ['basic_arcane_missiles'],
        opponentBoard: [{ cardId: 'basic_boulderfist_ogre' }]
      },
      { aiHand: ['basic_fireball'], opponentSecrets: [{ cardId: 'classic_ice_block' }] }
    ]) {
      const s = session({ aiBoard: [], opponentHealth: 1, aiMana: 4, ...options })
      expect(prove(s).win).toBeNull()
    }
  })

  it('known identity does not establish concealed hand attack', () => {
    const sessions = [3, 5].map((attack) => {
      const f = createAiFixture({
        seed: 8809,
        aiHeroId: 'jaina',
        opponentHeroId: 'malfurion',
        aiMana: 0,
        aiHand: [],
        opponentHand: ['basic_senjin_shieldmasta'],
        aiHeroPowerAvailable: false,
        aiHeroPowerUsesThisTurn: 1,
        opponentHealth: 6,
        aiBoard: [
          { cardId: 'classic_wisp', ready: true },
          { cardId: 'basic_boulderfist_ogre', ready: true }
        ],
        opponentBoard: [{ cardId: 'journey_to_ungoro_giant_anaconda', health: 1 }],
        aiDeck: ['basic_chillwind_yeti'],
        opponentDeck: ['basic_chillwind_yeti']
      })
      const card = f.checkpoint.state.players.find(
        (p) => p.participantId === f.localParticipantId
      )!.hand[0]!
      Object.assign(card, {
        knownTo: [f.aiParticipantId],
        attack,
        enchantments:
          attack === 5
            ? [
                {
                  id: 'known-stat-buff',
                  sourceInstanceId: 'known-stat-source',
                  sourceCardId: null,
                  attackDelta: 2,
                  duration: 'permanent'
                }
              ]
            : []
      })
      return new GameBoardSession({
        setup: f.setup,
        decks: f.decks,
        checkpoint: f.checkpoint
      })
    })
    expect(sessions[0].getAiObservation()).toEqual(sessions[1].getAiObservation())
    const s = sessions[0],
      me = s.getState().players.find((p) => p.participantId === s.remoteParticipantId)!,
      enemy = s
        .getState()
        .players.find((p) => p.participantId !== s.remoteParticipantId)!
    const line: TurnMatchCommand[] = [
      {
        type: 'attack-character',
        participantId: s.remoteParticipantId,
        attacker: { kind: 'minion', instanceId: me.board[0].instanceId },
        defender: { kind: 'minion', instanceId: enemy.board[0].instanceId }
      },
      {
        type: 'attack-character',
        participantId: s.remoteParticipantId,
        attacker: { kind: 'minion', instanceId: me.board[1].instanceId },
        defender: { kind: 'hero' }
      }
    ]
    const rows = sessions.map((s) => ({
      inspection: s.match.analyze((f) =>
        inspectTacticalLine(f, s.remoteParticipantId, line)
      ),
      proof: s.match.analyze((f) => searchTactics(f, s.remoteParticipantId)),
      replay: s.match.analyze((f) => line.map((c) => f.dispatch(c).accepted))
    }))
    expect(rows[0].inspection.outcome).toBe('unknown')
    expect(rows[0].proof.win).toBeNull()
    expect(rows[1].replay).toEqual([true, false])
  })
})
