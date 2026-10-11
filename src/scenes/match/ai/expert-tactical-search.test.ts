import { describe, expect, it } from 'vitest'
import type {
  OpeningMatchCheckpoint,
  TurnMatchCommand
} from '../../../game-rules/match'
import { canonicalCommandKey, enumerateLegalCommands } from '../../../game-rules/match'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { searchTactics } from '../../../game-rules/match/ai/tactical-search'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { asPlayerId } from '../../../game-rules/match/match-types'
import { GameBoardSession } from '../game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { aiActions } from './ai-context'
import recorded from './expert-tactical-recorded-states.json'

type Match = Parameters<typeof enumerateLegalCommands>[0]

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
