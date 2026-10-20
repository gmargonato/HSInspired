import { reviewChanceAttackOrder, hasChanceWeaponSetup } from './expert-chance-order'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { reviewRedundantHealingPrefix } from './expert-redundant-healing'
import { reviewRedundantSpellPrefix } from './expert-redundant-spell'
import * as redundantSpellReview from './expert-redundant-spell'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { asCardId, CARD_CATALOG } from '../../../game-rules/content'
import healingRecorded from './expert-redundant-healing-recorded.json'
import { ExpertAiDecisionApi } from './expert-ai-decision-api'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import type {
  AiDecisionRequest,
  AiDecisionResponse
} from '../../../desktop/contracts/ipc/ai'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'
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

describe('Selected redundant healing prefix', () => {
  // These cases prove semantics independently of shared-host scheduling.
  // Dedicated timing/controller evidence exercises the real production deadline.
  beforeEach(() => vi.spyOn(performance, 'now').mockReturnValue(0))

  function healing(
    options: Partial<AiFixtureOptions> = {},
    cards = ['league_of_explorers_reno_jackson', 'classic_loot_hoarder']
  ) {
    const session = fixture({
      aiHeroId: 'anduin',
      opponentHeroId: 'jaina',
      aiHealth: 13,
      aiMana: 10,
      aiMaximumMana: 10,
      aiHeroPowerAvailable: true,
      aiHand: cards,
      aiBoard: [],
      aiDeck: ['basic_bloodfen_raptor'],
      opponentDeck: ['basic_bloodfen_raptor'],
      ...options
    })
    const actor = session.remoteParticipantId
    const original = session.match.getCheckpoint()
    const commands = session.match.analyze((fork) => {
      const line: TurnMatchCommand[] = []
      const power = enumerateLegalCommands(fork, actor).find(
        (command) =>
          command.type === 'use-hero-power' &&
          command.target?.kind === 'hero' &&
          command.target.participantId === actor
      )!
      line.push(power)
      expect(fork.dispatch(power).accepted).toBe(true)
      for (const id of cards) {
        const card = fork
          .getState()
          .players.find((player) => player.participantId === actor)!
          .hand.find((card) => card.cardId === id)!
        const command = enumerateLegalCommands(fork, actor)
          .filter(
            (command) =>
              command.type === 'play-card' && command.cardInstanceId === card.instanceId
          )
          .at(-1)!
        if (!command) break
        line.push(command)
        expect(fork.dispatch(command).accepted).toBe(true)
        if (fork.getState().phase === 'ended') break
      }
      return line
    })
    const intents = commands.map((command) =>
      aiActionIntent(command, session.localParticipantId)
    )
    return { session, actor, original, commands, intents }
  }

  it('retains the exact card sequence and two mana without mutating history, fatigue or RNG', () => {
    const f = healing({ aiFatigueDamage: 5 })
    const review = reviewRedundantHealingPrefix(
      f.original,
      f.actor,
      f.intents,
      () => false
    )
    expect(review.commands).toEqual(f.commands.slice(1))
    expect(review.stats).toMatchObject({
      dispatches: 5,
      manaSaved: 2,
      abstained: false
    })
    expect(f.session.match.getCheckpoint()).toEqual(f.original)
    for (const command of review.commands!)
      expect(f.session.dispatch(command).accepted).toBe(true)
    const after = f.session.getState()
    const self = after.players.find((player) => player.participantId === f.actor)!
    expect(self.hero.health).toBe(30)
    expect(self.mana.available).toBe(2)
    expect(self.heroPower.available).toBe(true)
    expect(self.fatigueDamage).toBe(5)
    expect(after.history!.heroPowersUsedByPlayer).toEqual(
      f.original.state.history!.heroPowersUsedByPlayer
    )
    expect(f.session.match.getCheckpoint().rngState).toEqual(f.original.rngState)
  })

  it('uses effect outcomes rather than a full-heal card identity', () => {
    const f = healing({ aiHealth: 25 }, [
      'mean_streets_of_gadgetzan_greater_healing_potion'
    ])
    expect(
      reviewRedundantHealingPrefix(f.original, f.actor, f.intents, () => false).commands
    ).toEqual(f.commands.slice(1))
  })

  it.each<[string, Partial<AiFixtureOptions>, string[]?]>([
    [
      'known original-deck power history payoff',
      { aiDeck: ['the_grand_tournament_frost_giant'] }
    ],
    [
      'held power history payoff',
      {
        aiHand: [
          'league_of_explorers_reno_jackson',
          'classic_loot_hoarder',
          'the_grand_tournament_frost_giant'
        ]
      }
    ],
    ['healing trigger', { aiBoard: [{ cardId: 'classic_lightwarden' }] }],
    [
      'Inspire trigger',
      { aiBoard: [{ cardId: 'the_grand_tournament_spawn_of_shadows' }] }
    ],
    [
      'active quest',
      { aiQuest: { cardId: 'journey_to_ungoro_awaken_the_makers', progress: 1 } }
    ],
    ['concealed secret', { opponentSecrets: [{ cardId: 'classic_counterspell' }] }],
    [
      'Reno disabled by duplicates',
      { aiDeck: ['basic_bloodfen_raptor', 'basic_bloodfen_raptor'] }
    ],
    ['insufficient later healing', { aiHealth: 13 }, ['classic_earthen_ring_farseer']],
    [
      'information-revealing suffix',
      {},
      ['league_of_explorers_reno_jackson', 'basic_novice_engineer']
    ],
    ['random suffix', {}, ['league_of_explorers_reno_jackson', 'classic_mad_bomber']],
    [
      'survival before self-damage',
      { aiHealth: 2 },
      ['classic_flame_imp', 'league_of_explorers_reno_jackson']
    ]
  ])('abstains for %s', (_name, options, cards) => {
    const f = healing(options, cards)
    expect(
      reviewRedundantHealingPrefix(f.original, f.actor, f.intents, () => false).commands
    ).toBeNull()
    expect(f.session.match.getCheckpoint()).toEqual(f.original)
  })

  it('abstains on a stopped budget and preserves an unconsumed future use counter', () => {
    const f = healing()
    expect(
      reviewRedundantHealingPrefix(f.original, f.actor, f.intents, () => true)
    ).toMatchObject({ commands: null, stats: { dispatches: 0, abstained: true } })
    let checks = 0
    expect(
      reviewRedundantHealingPrefix(f.original, f.actor, f.intents, () => ++checks >= 10)
    ).toMatchObject({ commands: null, stats: { dispatches: 5, abstained: true } })
    const changed = structuredClone(f.original)
    Object.assign(changed.state.history!, { heroPowersUsedByPlayer: { [f.actor]: 3 } })
    const before = structuredClone(changed)
    expect(
      reviewRedundantHealingPrefix(changed, f.actor, f.intents, () => false).commands
    ).toEqual(f.commands.slice(1))
    expect(changed).toEqual(before)
  })

  it('keeps the own 25ms limit even when the caller stop callback stays false', () => {
    const f = healing()
    vi.spyOn(performance, 'now').mockReset().mockReturnValueOnce(0).mockReturnValue(25)
    expect(
      reviewRedundantHealingPrefix(f.original, f.actor, f.intents, () => false)
    ).toMatchObject({ commands: null, stats: { dispatches: 0, abstained: true } })
  })

  it('rejects non-roundtrippable, stale, unsupported and illegal typed intents', () => {
    const f = healing()
    const [power, card, suffix] = f.intents
    for (const intents of [
      [{ ...power!, option: 0 }, card!, suffix!],
      [power!, { ...card!, source: 'missing-card' }, suffix!],
      [power!, { ...card!, targets: [suffix!.source!] }, suffix!],
      [power!, { ...card!, position: 99 }, suffix!]
    ]) {
      expect(
        reviewRedundantHealingPrefix(f.original, f.actor, intents, () => false).commands
      ).toBeNull()
      expect(f.session.match.getCheckpoint()).toEqual(f.original)
    }
  })

  it('does not inspect an unknown-origin own deck card to rule out history payoffs', () => {
    const f = healing()
    for (const cardId of [
      'basic_bloodfen_raptor',
      'the_grand_tournament_frost_giant'
    ]) {
      const unknown = structuredClone(f.original)
      const self = unknown.state.players.find(
        (player) => player.participantId === f.actor
      )!
      Object.assign(self.deck[0]!, { cardId, startedInDeck: false, knownTo: [] })
      const before = structuredClone(unknown)
      expect(
        reviewRedundantHealingPrefix(unknown, f.actor, f.intents, () => false).commands
      ).toBeNull()
      expect(unknown).toEqual(before)
    }
  })

  it.each(['action', 'plan'] as const)(
    'changes the selected %s decision and executes the shortened continuation',
    async (phase) => {
      const f = healing()
      const actions = () =>
        aiActions(
          f.session,
          enumerateLegalCommands(
            {
              getState: f.session.match.getState,
              getPlayInput: f.session.match.getPlayInput!,
              getLegality: f.session.match.getLegality!
            },
            f.actor
          )
        )
      let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
      let workerCalls = 0
      const worker = {
        addEventListener(type: string, listener: unknown) {
          if (type === 'message') receive = listener as typeof receive
        },
        postMessage(message: ExpertAiWorkerRequest) {
          if (message.type !== 'decide') return
          workerCalls++
          const selected = actions().find(
            (action) => JSON.stringify(action.command) === JSON.stringify(f.commands[0])
          )!
          const response: AiDecisionResponse = {
            ...message.request,
            modelId: 'hardware-local-v2',
            reason: 'Selected heal then full heal.',
            durationMs: 0,
            finishReason: 'fixture',
            choice:
              phase === 'plan'
                ? {
                    plan: {
                      objective: 'Selected healing line',
                      winCheck: '',
                      lossRisk: '',
                      candidates: [
                        {
                          sequence: ['Heal', 'Reno', 'Loot Hoarder', 'End turn'],
                          budget: '',
                          endPosition: '',
                          opponentReply: ''
                        }
                      ],
                      preferred: 0,
                      firstActionId: selected.id,
                      checks: []
                    }
                  }
                : {
                    actionId: selected.id,
                    intent: f.intents[0]!,
                    expectedResult: '',
                    planUpdate: null
                  },
            usage: {
              decisionPriority: phase === 'plan' ? 'tactical-safety' : 'strategy',
              plannedActionIntents: [
                ...f.intents,
                aiActionIntent(
                  { type: 'end-turn', participantId: f.actor },
                  f.session.localParticipantId
                )
              ].map((intent) => ({ ...intent, targets: [...intent.targets] }))
            }
          }
          receive?.({
            data: { type: 'decision', requestId: message.request.requestId, response }
          } as MessageEvent<ExpertAiWorkerResponse>)
        },
        terminate() {}
      } as unknown as Worker
      const api = new ExpertAiDecisionApi(
        f.session,
        () => worker,
        () => 0
      )
      const request = (
        phase: 'action' | 'plan',
        suffix: string
      ): AiDecisionRequest => ({
        matchId: 'redundant-healing',
        requestId: 'healing-' + suffix,
        expectedRevision: f.session.getState().revision,
        phase,
        allowInspection: false,
        messages: [],
        actionIds: actions().map((action) => action.id)
      })
      try {
        const first = await api.decide(request(phase, 'first'))
        expect(first.usage?.actionOutcomeReason).toBe('redundant-healing-prefix')
        expect(first.usage?.decisionPriority).toBe(
          phase === 'plan' ? 'tactical-safety' : 'tactical-preference'
        )
        const firstId =
          'plan' in first.choice
            ? first.choice.plan.firstActionId
            : 'actionId' in first.choice
              ? first.choice.actionId
              : null
        expect(actions().find((action) => action.id === firstId)?.command).toEqual(
          f.commands[1]
        )
        if (phase === 'plan') {
          const cached = await api.decide(request('action', 'cached'))
          expect('actionId' in cached.choice && cached.choice.actionId).toBe(firstId)
        }
        expect(f.session.dispatch(f.commands[1]!).accepted).toBe(true)
        const next = await api.decide(request('action', 'next'))
        const nextId = 'actionId' in next.choice ? next.choice.actionId : null
        expect(actions().find((action) => action.id === nextId)?.command).toEqual(
          f.commands[2]
        )
        expect(f.session.dispatch(f.commands[2]!).accepted).toBe(true)
        expect(
          f.session
            .getState()
            .players.find((player) => player.participantId === f.actor)?.mana.available
        ).toBe(2)
        const end = await api.decide(request('action', 'end'))
        const endId = 'actionId' in end.choice ? end.choice.actionId : null
        const pass = actions().find((action) => action.id === endId)!
        expect(pass.command.type).toBe('end-turn')
        expect(f.session.dispatch(pass.command).accepted).toBe(true)
        const final = f.session
          .getState()
          .players.find((player) => player.participantId === f.actor)!
        expect(final.hero.health).toBe(30)
        expect(final.mana.available).toBe(2)
        expect(final.heroPower.available).toBe(true)
        expect(workerCalls).toBe(1)
      } finally {
        api.dispose()
      }
    }
  )

  it('keeps a legal healing continuation in real fixed-work search', async () => {
    vi.restoreAllMocks()
    const f = healing()
    const actions = aiActions(
      f.session,
      enumerateLegalCommands(
        {
          getState: f.session.match.getState,
          getPlayInput: f.session.match.getPlayInput!,
          getLegality: f.session.match.getLegality!
        },
        f.actor
      )
    )
    const api = new LocalAiDecisionApi(f.session, undefined, {
      profile: 'expert',
      workBudget: 64
    })
    const result = await api.decide({
      matchId: 'healing-local',
      requestId: 'healing-local',
      expectedRevision: f.session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    const selected = actions.find(
      (action) => 'actionId' in result.choice && action.id === result.choice.actionId
    )!
    expect(selected.command.type).toBe('play-card')
    expect(f.session.dispatch(selected.command).accepted).toBe(true)
  }, 30_000)

  it('shortens the historical real fixed-work choice only in the Expert controller', async () => {
    vi.restoreAllMocks()
    // This controller regression needs the historical search to emit its redundant
    // heal prefix. Pin only Future Past to the catalog present when recorded:
    // new cards legitimately change seeded hidden-card hypotheses and the line.
    // The unmocked expanded-catalog case below checks current search behavior.
    const historicalFuturePast = new Set([
      'future_past_animated_broomstick',
      'future_past_armor_vendor',
      'future_past_critter_caretaker',
      'future_past_depth_charge',
      'future_past_dragonscale_armaments',
      'future_past_knight_of_anointment',
      'future_past_miracle_salesman',
      'future_past_peasant',
      'future_past_order_in_the_court',
      'future_past_sing_along_buddy',
      'future_past_nozdormu_the_timeless',
      'future_past_snake_oil'
    ])
    const historicalCatalog = CARD_CATALOG.all.filter(
      (card) => !card.id.startsWith('future_past_') || historicalFuturePast.has(card.id)
    )
    vi.spyOn(CARD_CATALOG, 'all', 'get').mockReturnValue(historicalCatalog)
    const checkpoint = healingRecorded.checkpoint as unknown as OpeningMatchCheckpoint
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
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
    const request: AiDecisionRequest = {
      matchId: 'historical-heal',
      requestId: 'historical-heal-1',
      expectedRevision: checkpoint.state.revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    }
    const before = session.match.getCheckpoint()
    const baselineApi = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      workBudget: 256
    })
    const baseline = await baselineApi.decide(request)
    const baselineAction = actions.find(
      (action) =>
        'actionId' in baseline.choice && action.id === baseline.choice.actionId
    )!
    expect(baselineAction.command.type).toBe('use-hero-power')
    const line = baselineApi
      .getLastTrace()!
      .candidates.find(
        (entry) => entry.actionId === baselineAction.id
      )!.sequenceIntents!
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        receive?.(
          new MessageEvent<ExpertAiWorkerResponse>('message', {
            data: {
              type: 'decision',
              requestId: message.request.requestId,
              response: {
                ...baseline,
                usage: {
                  ...baseline.usage,
                  plannedActionIntents: line.map((intent) => ({
                    ...intent,
                    targets: [...intent.targets]
                  }))
                }
              }
            }
          })
        )
      },
      terminate() {}
    } as unknown as Worker
    // This case proves the semantic controller rewrite of a real search result.
    // Separate cold/warm and live-controller evidence enforces the wall deadline.
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const candidateApi = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => 0
    )
    const candidate = await candidateApi.decide(request)
    candidateApi.dispose()
    const selected = actions.find(
      (action) =>
        'actionId' in candidate.choice && action.id === candidate.choice.actionId
    )!
    expect(candidate.usage?.redundantHealingReview).toMatchObject({
      fromActionId: baselineAction.id,
      toActionId: selected.id,
      manaSaved: 2
    })
    expect(selected.command.type).toBe('play-card')
    expect(session.match.getCheckpoint()).toEqual(before)
    const shortened = line.slice(1)
    for (const intent of shortened) {
      if (intent.type === 'end-turn') break
      const command = enumerateLegalCommands(
        {
          getState: session.match.getState,
          getPlayInput: session.match.getPlayInput!,
          getLegality: session.match.getLegality!
        },
        actor
      ).find(
        (command) =>
          JSON.stringify(aiActionIntent(command, session.localParticipantId)) ===
          JSON.stringify(intent)
      )!
      expect(command).toBeDefined()
      expect(session.dispatch(command).accepted).toBe(true)
    }
    const self = session
      .getState()
      .players.find((player) => player.participantId === actor)!
    expect(self.hero.health).toBe(30)
    expect(self.mana.available).toBe(2)
    expect(self.heroPower.available).toBe(true)
    expect(self.board.map((minion) => minion.cardId).sort()).toEqual([
      'classic_loot_hoarder',
      'league_of_explorers_reno_jackson'
    ])
  }, 60_000)

  it('keeps the expanded-catalog historical line legal without redundant healing', async () => {
    vi.restoreAllMocks()
    const checkpoint = healingRecorded.checkpoint as unknown as OpeningMatchCheckpoint
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
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
    const request: AiDecisionRequest = {
      matchId: 'historical-heal',
      requestId: 'historical-heal-1',
      expectedRevision: checkpoint.state.revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    }
    const before = session.match.getCheckpoint()
    const baselineApi = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      workBudget: 256
    })
    const baseline = await baselineApi.decide(request)
    const baselineAction = actions.find(
      (action) =>
        'actionId' in baseline.choice && action.id === baseline.choice.actionId
    )!
    expect(baselineAction.command.type).toBe('play-card')
    expect(session.match.getCheckpoint()).toEqual(before)
    const line = baselineApi
      .getLastTrace()!
      .candidates.find(
        (entry) => entry.actionId === baselineAction.id
      )!.sequenceIntents!
    expect(line.some((intent) => intent.type === 'use-hero-power')).toBe(false)
    for (const intent of line) {
      if (intent.type === 'end-turn') break
      const command = enumerateLegalCommands(
        {
          getState: session.match.getState,
          getPlayInput: session.match.getPlayInput!,
          getLegality: session.match.getLegality!
        },
        actor
      ).find(
        (command) =>
          JSON.stringify(aiActionIntent(command, session.localParticipantId)) ===
          JSON.stringify(intent)
      )!
      expect(command).toBeDefined()
      expect(session.dispatch(command).accepted).toBe(true)
    }
    const self = session
      .getState()
      .players.find((player) => player.participantId === actor)!
    expect(self.hero.health).toBe(30)
    expect(self.mana.available).toBe(2)
    expect(self.heroPower.available).toBe(true)
    expect(self.board.map((minion) => minion.cardId).sort()).toEqual([
      'classic_loot_hoarder',
      'league_of_explorers_reno_jackson'
    ])
  }, 60_000)
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

describe('complete-turn redundant damage spell review', () => {
  // Semantic proofs use a frozen clock. Real-clock acceptance is measured separately.
  beforeEach(() => vi.spyOn(performance, 'now').mockReturnValue(0))

  function damageTurn(options: Partial<AiFixtureOptions> = {}) {
    const f = createAiFixture({
      seed: 611040,
      aiHeroId: 'valeera',
      opponentHeroId: 'jaina',
      aiMana: 10,
      aiMaximumMana: 10,
      aiHand: ['basic_backstab', 'basic_vanish'],
      aiDeck: ['classic_wisp', 'classic_wisp'],
      opponentDeck: ['classic_wisp'],
      opponentBoard: [{ cardId: 'basic_core_hound' }],
      ...options
    })
    const actor = f.aiParticipantId
    const own = f.checkpoint.state.players.find((p) => p.participantId === actor)!
    const enemy = f.checkpoint.state.players.find((p) => p.participantId !== actor)!
    const play = (id: string, position?: number): TurnMatchCommand => ({
      type: 'play-card',
      participantId: actor,
      cardInstanceId: own.hand.find((c) => c.cardId === id)!.instanceId,
      ...(position === undefined ? {} : { position })
    })
    const damage: TurnMatchCommand = {
      ...play(
        options.aiHand?.[0] === 'basic_fireball' ? 'basic_fireball' : 'basic_backstab'
      ),
      targets: [
        {
          kind: 'minion',
          participantId: enemy.participantId,
          instanceId: enemy.board[0]!.instanceId
        }
      ]
    } as TurnMatchCommand
    const end: TurnMatchCommand = { type: 'end-turn', participantId: actor }
    const commands = [damage, play('basic_vanish'), end]
    const intents = (line = commands) =>
      line.map((command) => aiActionIntent(command, enemy.participantId))
    const review = (line = commands, checkpoint = f.checkpoint, stop = () => false) =>
      reviewRedundantSpellPrefix(checkpoint, actor, intents(line), stop)
    const replay = (line: readonly TurnMatchCommand[], checkpoint = f.checkpoint) => {
      const match = createOpeningMatchFromCheckpoint({
        ...checkpoint,
        setup: { ...checkpoint.setup, recordEffectTrace: false }
      })
      for (const command of line) expect(match.dispatch(command).accepted).toBe(true)
      return match.getCheckpoint()
    }
    return {
      ...f,
      actor,
      own,
      enemy,
      play,
      damage,
      end,
      commands,
      intents,
      review,
      replay
    }
  }

  it.each(['basic_backstab', 'basic_fireball'])(
    'retains %s only with the exact complete endpoint delta, including mana and history',
    (spell) => {
      const f = damageTurn({
        aiHand: [spell, 'basic_vanish'],
        opponentBoard: [{ cardId: 'basic_core_hound', health: 8, maxHealth: 8 }]
      })
      const before = structuredClone(f.checkpoint)
      const review = f.review()
      expect(review.commands).toEqual(f.commands.slice(1))
      expect(review.stats.cardsSaved).toBe(1)
      expect(review.stats.dispatches).toBe(5)
      expect(f.checkpoint).toEqual(before)
      const selected = f.replay(f.commands)
      const shortened = f.replay(review.commands!)
      const selectedOwn = selected.state.players.find(
        (p) => p.participantId === f.actor
      )!
      const shortenedOwn = shortened.state.players.find(
        (p) => p.participantId === f.actor
      )!
      const prefix = f.own.hand[0]!
      expect(shortened.state.activePlayerId).toBe(f.enemy.participantId)
      expect(shortenedOwn.hand).toHaveLength(selectedOwn.hand.length + 1)
      expect(
        shortenedOwn.hand.find((card) => card.instanceId === prefix.instanceId)?.cardId
      ).toBe(spell)
      expect(shortenedOwn.mana.available - selectedOwn.mana.available).toBe(
        prefix.baseCost
      )
      // Normalize only the individually verified prefix bookkeeping. Every other
      // checkpoint field, including fatigue, RNG, entity ordinals and turn state, must match.
      const expected = {
        ...shortened,
        state: {
          ...shortened.state,
          revision: shortened.state.revision + 1,
          turnStartedAtRevision: shortened.state.turnStartedAtRevision! + 1,
          history: {
            ...shortened.state.history!,
            cardsPlayedThisGame: [
              prefix.cardId,
              ...shortened.state.history!.cardsPlayedThisGame
            ],
            spellsCastThisGameByPlayer: {
              ...shortened.state.history!.spellsCastThisGameByPlayer,
              [f.actor]:
                (shortened.state.history!.spellsCastThisGameByPlayer[f.actor] ?? 0) + 1
            }
          },
          players: shortened.state.players.map((player) =>
            player.participantId !== f.actor
              ? player
              : {
                  ...player,
                  hand: player.hand.filter(
                    (card) => card.instanceId !== prefix.instanceId
                  ),
                  discardedCards: [
                    selectedOwn.discardedCards![0]!,
                    ...(player.discardedCards ?? [])
                  ],
                  mana: {
                    ...player.mana,
                    available: player.mana.available - prefix.baseCost!
                  }
                }
          )
        }
      }
      expect(selected).toEqual(expected)
    }
  )

  it('replays a complete six-action line with hero power, attack and preserved Combo', () => {
    const f = damageTurn({
      aiHand: [
        'basic_backstab',
        'basic_vanish',
        'whispers_of_the_old_gods_bladed_cultist'
      ]
    })
    const line: TurnMatchCommand[] = [
      f.damage,
      f.play('basic_vanish'),
      { type: 'use-hero-power', participantId: f.actor },
      f.play('whispers_of_the_old_gods_bladed_cultist', 0),
      {
        type: 'attack-character',
        participantId: f.actor,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      },
      f.end
    ]
    const result = f.review(line)
    expect(result.commands).toEqual(line.slice(1))
    expect(result.stats.dispatches).toBe(11)
    const after = f.replay(result.commands!)
    const own = after.state.players.find((p) => p.participantId === f.actor)!
    expect(own.board[0]).toMatchObject({ attack: 2, health: 3 })
  })

  it('only tolerates the matched ordinary final opponent draw burn', () => {
    const f = damageTurn({ opponentHand: Array(9).fill('classic_wisp') })
    const review = f.review()
    expect(review.commands).toEqual(f.commands.slice(1))
    expect(review.stats.ordinaryBoundaryBurn).toBe(true)
    const selected = f
      .replay(f.commands)
      .state.players.find((p) => p.participantId !== f.actor)!
    const shortened = f
      .replay(review.commands!)
      .state.players.find((p) => p.participantId !== f.actor)!
    expect(shortened).toEqual(selected)
    expect(shortened.deck).toHaveLength(0)
    expect(shortened.hand).toHaveLength(10)
  })

  it('preserves a cheap spell that prevents a valuable friendly minion from overflowing', () => {
    const f = damageTurn({
      aiHand: ['basic_backstab', 'basic_vanish', ...Array(8).fill('classic_pyroblast')],
      aiBoard: [
        { cardId: 'classic_wisp', health: 1, maxHealth: 2 },
        { cardId: 'classic_ysera', health: 5 }
      ]
    })
    const original = f
      .replay(f.commands)
      .state.players.find((p) => p.participantId === f.actor)!
    const omitted = f
      .replay(f.commands.slice(1))
      .state.players.find((p) => p.participantId === f.actor)!
    const ysera = f.own.board[1]!.instanceId
    expect(original.hand.some((card) => card.instanceId === ysera)).toBe(true)
    expect(omitted.hand.some((card) => card.instanceId === ysera)).toBe(false)
    expect(omitted.discardedCards?.some((card) => card.instanceId === ysera)).toBe(true)
    expect(f.review().commands).toBeNull()
  })

  it('keeps capacity for the next mandatory draw after an otherwise identical turn', () => {
    const f = damageTurn({
      aiHand: ['basic_backstab', 'basic_vanish', ...Array(8).fill('classic_pyroblast')],
      aiBoard: [{ cardId: 'classic_wisp' }]
    })
    const original = f
      .replay(f.commands)
      .state.players.find((p) => p.participantId === f.actor)!
    const omitted = f
      .replay(f.commands.slice(1))
      .state.players.find((p) => p.participantId === f.actor)!
    expect(original.hand).toHaveLength(9)
    expect(omitted.hand).toHaveLength(10)
    const next: TurnMatchCommand = {
      type: 'end-turn',
      participantId: f.enemy.participantId
    }
    const originalNext = f
      .replay([...f.commands, next])
      .state.players.find((p) => p.participantId === f.actor)!
    const omittedNext = f
      .replay([...f.commands.slice(1), next])
      .state.players.find((p) => p.participantId === f.actor)!
    const drawn = f.own.deck[0]!.instanceId
    expect(originalNext.hand.some((card) => card.instanceId === drawn)).toBe(true)
    expect(omittedNext.discardedCards?.some((card) => card.instanceId === drawn)).toBe(
      true
    )
    expect(f.review().commands).toBeNull()
  })

  it('abstains for an unresolved own-next-start extra draw even with one free hand slot', () => {
    const f = damageTurn({
      aiHand: [
        'basic_backstab',
        'basic_vanish',
        'future_past_peasant',
        ...Array(7).fill('classic_pyroblast')
      ],
      aiBoard: [{ cardId: 'classic_wisp' }]
    })
    const line = [
      f.damage,
      f.play('basic_vanish'),
      f.play('future_past_peasant', 0),
      f.end
    ]
    const original = f
      .replay(line)
      .state.players.find((p) => p.participantId === f.actor)!
    const omitted = f
      .replay(line.slice(1))
      .state.players.find((p) => p.participantId === f.actor)!
    expect(original.hand).toHaveLength(8)
    expect(omitted.hand).toHaveLength(9)
    const next: TurnMatchCommand = {
      type: 'end-turn',
      participantId: f.enemy.participantId
    }
    const originalNext = f
      .replay([...line, next])
      .state.players.find((p) => p.participantId === f.actor)!
    const omittedNext = f
      .replay([...line.slice(1), next])
      .state.players.find((p) => p.participantId === f.actor)!
    const drawIds = new Set(f.own.deck.map((card) => card.instanceId))
    expect(
      originalNext.hand.filter((card) => drawIds.has(card.instanceId))
    ).toHaveLength(2)
    expect(
      omittedNext.hand.filter((card) => drawIds.has(card.instanceId))
    ).toHaveLength(1)
    expect(f.review(line).commands).toBeNull()
  })

  it('preserves a real Combo benefit despite erased prefix damage', () => {
    const combo = damageTurn({
      aiHand: [
        'basic_backstab',
        'basic_vanish',
        'basic_sap',
        'whispers_of_the_old_gods_bladed_cultist'
      ]
    })
    const sap: TurnMatchCommand = {
      ...combo.play('basic_sap'),
      targets: [
        {
          kind: 'minion',
          participantId: combo.enemy.participantId,
          instanceId: combo.enemy.board[0]!.instanceId
        }
      ]
    } as TurnMatchCommand
    const line = [
      combo.damage,
      combo.play('whispers_of_the_old_gods_bladed_cultist', 0),
      sap,
      combo.end
    ]
    const original = combo
      .replay(line)
      .state.players.find((p) => p.participantId === combo.actor)!
    const omitted = combo
      .replay(line.slice(1))
      .state.players.find((p) => p.participantId === combo.actor)!
    expect(original.board[0]!.attack).toBeGreaterThan(omitted.board[0]!.attack)
    expect(combo.review(line).commands).toBeNull()
  })

  it('abstains when the prefix activates a Deathrattle', () => {
    const death = damageTurn({ opponentBoard: [{ cardId: 'classic_loot_hoarder' }] })
    expect(death.review().commands).toBeNull()
  })

  it('abstains for persistent spell history, public hand-count and known on-draw consumers', () => {
    const history = damageTurn({ aiDeck: ['one_night_in_karazhan_arcane_giant'] })
    expect(history.review().commands).toBeNull()
    for (const [zone, id] of [
      ['hand', 'mean_streets_of_gadgetzan_leatherclad_hogleader'],
      ['deck', 'goblins_vs_gnomes_burrowing_mine']
    ] as const) {
      const f = damageTurn({ opponentHand: ['classic_wisp'] })
      const cp: OpeningMatchCheckpoint = {
        ...f.checkpoint,
        state: {
          ...f.checkpoint.state,
          players: f.checkpoint.state.players.map((player) =>
            player.participantId === f.actor
              ? player
              : {
                  ...player,
                  [zone]: player[zone].map((card, index) =>
                    index ? card : { ...card, cardId: asCardId(id), knownTo: [f.actor] }
                  )
                }
          ) as unknown as OpeningMatchCheckpoint['state']['players']
        }
      }
      expect(f.review(f.commands, cp).commands).toBeNull()
    }
  })

  it('does not consult hidden opponent hand or deck identities', () => {
    const f = damageTurn({ opponentHand: ['classic_wisp'] })
    const cp: OpeningMatchCheckpoint = {
      ...f.checkpoint,
      state: {
        ...f.checkpoint.state,
        players: f.checkpoint.state.players.map((player) =>
          player.participantId === f.actor
            ? player
            : {
                ...player,
                hand: player.hand.map((card) => ({
                  ...card,
                  cardId: asCardId('mean_streets_of_gadgetzan_leatherclad_hogleader'),
                  knownTo: []
                })),
                deck: player.deck.map((card) => ({
                  ...card,
                  cardId: asCardId('goblins_vs_gnomes_burrowing_mine'),
                  knownTo: []
                }))
              }
        ) as unknown as OpeningMatchCheckpoint['state']['players']
      }
    }
    expect(f.review(f.commands, cp).commands).toEqual(f.review().commands)
    expect(f.review().commands).not.toBeNull()
  })

  it('reuses a differently seeded request-fair checkpoint without mutating either input', () => {
    const f = damageTurn()
    const fair = createFairHypothesisCheckpoint(f.checkpoint, f.actor, 912341)
    const before = structuredClone(f.checkpoint)
    const fairBefore = structuredClone(fair)
    const result = reviewRedundantSpellPrefix(
      f.checkpoint,
      f.actor,
      f.intents(),
      () => false,
      fair
    )
    expect(result.commands).toEqual(f.review().commands)
    expect(result.commands).not.toBeNull()
    expect(f.checkpoint).toEqual(before)
    expect(fair).toEqual(fairBefore)
  })

  it('rejects a prepared snapshot from another revision, turn, phase or actor', () => {
    const f = damageTurn()
    const fair = createFairHypothesisCheckpoint(f.checkpoint, f.actor, 912342)
    for (const state of [
      { ...fair.state, revision: fair.state.revision + 1 },
      { ...fair.state, turnNumber: fair.state.turnNumber + 1 },
      { ...fair.state, phase: 'mulligan' as const },
      { ...fair.state, activePlayerId: f.enemy.participantId }
    ]) {
      const result = reviewRedundantSpellPrefix(
        f.checkpoint,
        f.actor,
        f.intents(),
        () => false,
        { ...fair, state }
      )
      expect(result.commands).toBeNull()
      expect(result.stats.dispatches).toBe(0)
    }
  })

  it('retains the raw known-card guard when a prepared snapshot is supplied', () => {
    const f = damageTurn({ aiDeck: ['one_night_in_karazhan_arcane_giant'] })
    const fair = createFairHypothesisCheckpoint(f.checkpoint, f.actor, 912343)
    const result = reviewRedundantSpellPrefix(
      f.checkpoint,
      f.actor,
      f.intents(),
      () => false,
      fair
    )
    expect(result.commands).toBeNull()
    expect(result.stats.dispatches).toBe(0)
  })

  function damageController(
    phase: 'action' | 'plan',
    witness: 'complete' | 'absent' | 'mismatched'
  ) {
    // Leave no useful action after the reset, so the normal pass guard retains
    // this explicit continuation rather than correctly reopening search.
    const f = damageTurn({ aiMana: 6, aiMaximumMana: 6, aiHeroPowerAvailable: false })
    const checkpoint = {
      ...f.checkpoint,
      setup: { ...f.checkpoint.setup, recordEffectTrace: false }
    }
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const actions = () =>
      aiActions(
        session,
        enumerateLegalCommands(
          {
            getState: session.match.getState,
            getPlayInput: session.match.getPlayInput!,
            getLegality: session.match.getLegality!
          },
          f.actor
        )
      )
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    let workerCalls = 0
    let sentCheckpoint: OpeningMatchCheckpoint | undefined
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        workerCalls++
        sentCheckpoint = message.checkpoint
        const selected = actions().find(
          (action) =>
            JSON.stringify(aiActionIntent(action.command, f.enemy.participantId)) ===
            JSON.stringify(f.intents()[0])
        )!
        const full = f.intents()
        const response: AiDecisionResponse = {
          ...message.request,
          modelId: 'hardware-local-v2',
          reason: 'Selected damage then reset.',
          durationMs: 0,
          finishReason: 'fixture',
          choice:
            phase === 'plan'
              ? {
                  plan: {
                    objective: 'Selected damage then reset',
                    winCheck: '',
                    lossRisk: '',
                    candidates: [
                      {
                        sequence: ['Damage', 'Reset'],
                        budget: '',
                        endPosition: '',
                        opponentReply: ''
                      }
                    ],
                    preferred: 0,
                    firstActionId: selected.id,
                    checks: []
                  }
                }
              : {
                  actionId: selected.id,
                  intent: full[0]!,
                  expectedResult: '',
                  planUpdate: null
                },
          usage: {
            decisionPriority: phase === 'plan' ? 'tactical-safety' : 'strategy',
            plannedActionIntents: full
              .slice(0, 2)
              .map((intent) => ({ ...intent, targets: [...intent.targets] })),
            ...(witness === 'absent'
              ? {}
              : {
                  resourceReviewIntents: (witness === 'complete'
                    ? full
                    : [full[0]!, full[2]!]
                  ).map((intent) => ({ ...intent, targets: [...intent.targets] }))
                })
          }
        }
        receive?.({
          data: { type: 'decision', requestId: message.request.requestId, response }
        } as MessageEvent<ExpertAiWorkerResponse>)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => 0
    )
    const request = (
      nextPhase: 'action' | 'plan',
      suffix: string
    ): AiDecisionRequest => ({
      matchId: 'redundant-spell-controller',
      requestId: `spell-${phase}-${witness}-${suffix}`,
      expectedRevision: session.getState().revision,
      phase: nextPhase,
      allowInspection: false,
      messages: [],
      actionIds: actions().map((action) => action.id)
    })
    const chosen = (response: AiDecisionResponse) => {
      const id =
        'plan' in response.choice
          ? response.choice.plan.firstActionId
          : 'actionId' in response.choice
            ? response.choice.actionId
            : null
      return actions().find((action) => action.id === id)!.command
    }
    return {
      f,
      session,
      api,
      request,
      chosen,
      workerCalls: () => workerCalls,
      sentCheckpoint: () => sentCheckpoint
    }
  }

  it.each(['action', 'plan'] as const)(
    'rewrites the selected %s through decide and executes the witnessed complete continuation',
    async (phase) => {
      // This is a semantic controller test; production timing is measured separately.
      const review = vi.spyOn(redundantSpellReview, 'reviewRedundantSpellPrefix')
      const c = damageController(phase, 'complete')
      const before = c.session.match.getCheckpoint()
      try {
        const first = await c.api.decide(c.request(phase, 'first'))
        expect(first.usage?.actionOutcomeReason).toBe('redundant-spell-prefix')
        expect(first.usage?.decisionPriority).toBe(
          phase === 'plan' ? 'tactical-safety' : 'tactical-preference'
        )
        expect(first.usage?.resourceReviewIntents).toBeNull()
        expect(c.chosen(first)).toEqual(c.f.commands[1])
        expect(c.session.match.getCheckpoint()).toEqual(before)
        expect(review).toHaveBeenCalledTimes(1)
        // The actual pending-request snapshot flows through decide; no private
        // guard invocation or independently constructed prepared root is used.
        expect(review.mock.calls[0]![4]).toBe(c.sentCheckpoint())
        expect(c.sentCheckpoint()).toBeDefined()
        if (phase === 'plan') {
          expect(
            'plan' in first.choice && first.choice.plan.candidates[0]!.sequence
          ).toEqual(c.f.commands.slice(1).map((command) => JSON.stringify(command)))
          const committed = await c.api.decide(c.request('action', 'committed'))
          expect(c.chosen(committed)).toEqual(c.f.commands[1])
        }
        expect(c.session.dispatch(c.chosen(first)).accepted).toBe(true)
        const end = await c.api.decide(c.request('action', 'end'))
        expect(c.chosen(end)).toEqual(c.f.end)
        expect(c.session.dispatch(c.chosen(end)).accepted).toBe(true)
        const final = c.session.match.getCheckpoint()
        expect(final).toEqual(c.f.replay(c.f.commands.slice(1)))
        expect(final.state.activePlayerId).toBe(c.f.enemy.participantId)
        expect(
          final.state.players
            .find((player) => player.participantId === c.f.actor)!
            .hand.some((card) => card.instanceId === c.f.own.hand[0]!.instanceId)
        ).toBe(true)
        expect(c.workerCalls()).toBe(1)
      } finally {
        c.api.dispose()
      }
    }
  )

  it.each(['absent', 'mismatched'] as const)(
    'retains the selected damage action when the complete witness is %s',
    async (witness) => {
      const c = damageController('action', witness)
      const before = c.session.match.getCheckpoint()
      try {
        const response = await c.api.decide(c.request('action', 'first'))
        expect(c.chosen(response)).toEqual(c.f.damage)
        expect(response.usage?.redundantSpellReview).toBeUndefined()
        expect(c.session.match.getCheckpoint()).toEqual(before)
        expect(c.workerCalls()).toBe(1)
      } finally {
        c.api.dispose()
      }
    }
  )

  it('requires explicit complete-turn provenance and stops before or during replay', () => {
    const f = damageTurn()
    expect(f.review(f.commands.slice(0, 2)).commands).toBeNull()
    expect(f.review(f.commands, f.checkpoint, () => true).stats).toMatchObject({
      dispatches: 0,
      abstained: true
    })
    let checks = 0
    const stopped = f.review(f.commands, f.checkpoint, () => ++checks >= 5)
    expect(stopped.commands).toBeNull()
    expect(stopped.stats.abstained).toBe(true)
    expect(stopped.stats.dispatches).toBeLessThan(5)
    let completeChecks = 0
    expect(
      f.review(f.commands, f.checkpoint, () => {
        completeChecks++
        return false
      }).commands
    ).not.toBeNull()
    let finalChecks = 0
    const late = f.review(
      f.commands,
      f.checkpoint,
      () => ++finalChecks >= completeChecks
    )
    expect(late.commands).toBeNull()
    expect(late.stats).toMatchObject({ dispatches: 5, abstained: true })
    vi.mocked(performance.now).mockReturnValueOnce(0).mockReturnValue(25)
    expect(f.review().stats).toMatchObject({ dispatches: 0, abstained: true })
  })
})
