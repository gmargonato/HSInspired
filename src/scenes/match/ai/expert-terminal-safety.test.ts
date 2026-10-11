import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject
} from '../../../desktop/contracts/ipc/ai'
import {
  enumerateLegalCommands,
  type OpeningMatchAnalysis,
  type OpeningMatchCheckpoint,
  type PlayerId,
  type TurnMatchCommand
} from '../../../game-rules/match'
import * as opening from '../../../game-rules/match/opening-match'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import type { TacticalOutcome } from '../../../game-rules/match/ai/tactical-search'
import { canonicalCommandKey } from '../../../game-rules/match/ai/legal-commands'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { GameBoardSession } from '../game-board-session'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import * as terminalOutcomes from './expert-action-outcome'

import { ExpertAiDecisionApi } from './expert-ai-decision-api'
import { selectExpertTimeoutFallbackAction } from './expert-ai-timeout-fallback'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'
import recorded from './expert-tactical-recorded-states.json'

// Namespace import keeps API-only regression cases executable on the baseline,
// where the new proof helpers do not exist yet.
const {
  createExpertTerminalInspector,
  inspectExpertTerminalAction,
  EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES
} = terminalOutcomes

function sessionFor(options: Partial<Parameters<typeof createAiFixture>[0]> = {}) {
  const fixture = createAiFixture({
    seed: 611046,
    aiHeroId: 'malfurion',
    opponentHeroId: 'thrall',
    aiHealth: 8,
    aiArmor: 1,
    aiAttack: 1,
    aiMana: 0,
    aiHeroPowerAvailable: false,
    aiDeck: ['basic_chillwind_yeti'],
    opponentDeck: ['basic_chillwind_yeti'],
    opponentBoard: [
      { cardId: 'whispers_of_the_old_gods_flamewreathed_faceless' },
      { cardId: 'basic_flametongue_totem' }
    ],
    ...options
  })
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
}

function legalActions(session: GameBoardSession) {
  return aiActions(
    session,
    enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    )
  )
}

type Action = ReturnType<typeof legalActions>[number]
function fatalAttack(session: GameBoardSession): Action {
  const target = session
    .getState()
    .players.find((p) => p.participantId === session.localParticipantId)!.board[0]!
  return legalActions(session).find(
    (action) =>
      action.command.type === 'attack-character' &&
      action.command.attacker.kind === 'hero' &&
      action.command.defender.kind === 'minion' &&
      action.command.defender.instanceId === target.instanceId
  )!
}

function harness(
  session: GameBoardSession,
  choose: (call: number) => Action = () => fatalAttack(session),
  options: {
    verified?: boolean
    progress?: boolean
    line?: () => readonly Action[]
    now?: () => number
  } = {}
) {
  let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
  let calls = 0
  const worker = {
    addEventListener(type: string, listener: unknown) {
      if (type === 'message') receive = listener as typeof receive
    },
    postMessage(message: ExpertAiWorkerRequest) {
      if (message.type !== 'decide') return
      const selected = choose(calls++)
      const intent = aiActionIntent(selected.command, session.localParticipantId)
      const response: AiDecisionResponse = {
        matchId: message.request.matchId,
        requestId: message.request.requestId,
        expectedRevision: message.request.expectedRevision,
        modelId: 'hardware-local-v2',
        reason: 'Fixture candidate.',
        durationMs: 0,
        finishReason: 'fixture',
        choice:
          message.request.phase === 'plan'
            ? {
                plan: {
                  objective: 'Fixture candidate.',
                  winCheck: 'Fixture.',
                  lossRisk: 'Fixture.',
                  candidates: [
                    {
                      sequence: [selected.description],
                      budget: 'Fixture.',
                      endPosition: 'Fixture.',
                      opponentReply: 'Fixture.'
                    }
                  ],
                  preferred: 0,
                  firstActionId: selected.id,
                  checks: []
                }
              }
            : {
                actionId: selected.id,
                intent,
                expectedResult: 'Fixture.',
                planUpdate: null
              },
        usage: {
          ...(options.verified ? { decisionPriority: 'verified-win' } : {}),
          candidateConsensus: [{ candidateId: selected.id }],
          plannedActionIntents: (options.line?.() ?? [selected]).map((action) =>
            aiActionIntent(action.command, session.localParticipantId)
          )
        } as unknown as JsonObject
      }
      receive?.({
        data: options.progress
          ? {
              type: 'progress',
              requestId: message.request.requestId,
              response,
              recommendationValue: -0.2,
              worldIndex: 0,
              iterations: 1
            }
          : { type: 'decision', requestId: message.request.requestId, response }
      } as MessageEvent<ExpertAiWorkerResponse>)
    },
    terminate() {}
  } as unknown as Worker
  const api = new ExpertAiDecisionApi(session, () => worker, options.now)
  const request = (phase: 'action' | 'plan' = 'action'): AiDecisionRequest => ({
    matchId: 'terminal-safety',
    requestId: `terminal-safety:${calls}:${phase}`,
    phase,
    expectedRevision: session.getState().revision,
    actionIds: legalActions(session).map((action) => action.id),
    allowInspection: false,
    messages: []
  })
  return {
    api,
    request,
    calls: () => calls,
    fail() {
      receive?.({
        data: {
          type: 'failure',
          requestId: `terminal-safety:0:action`,
          error: 'Fixture stop.'
        }
      } as MessageEvent<ExpertAiWorkerResponse>)
    }
  }
}

function chosenAction(session: GameBoardSession, response: AiDecisionResponse) {
  const id =
    'plan' in response.choice
      ? response.choice.plan.firstActionId
      : 'actionId' in response.choice
        ? response.choice.actionId
        : undefined
  return legalActions(session).find((action) => action.id === id)!
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Expert immediate terminal safety', () => {
  it('proves the one-command loss and leaves the live match and RNG unchanged', () => {
    const session = sessionFor()
    const before = session.match.getCheckpoint()
    const inspect = createExpertTerminalInspector(before, session.remoteParticipantId)
    expect(inspect(fatalAttack(session).command)).toBe('loss')
    const harmless = legalActions(session).find(
      (action) =>
        action.command.type === 'attack-character' &&
        action.command.defender.kind === 'minion' &&
        canonicalCommandKey(action.command) !==
          canonicalCommandKey(fatalAttack(session).command)
    )!
    expect(inspect(harmless.command)).toBe('ongoing')
    expect(
      inspect({ type: 'end-turn', participantId: session.remoteParticipantId })
    ).not.toBe('loss')
    expect(session.match.getCheckpoint()).toEqual(before)
  })

  it.each([false, true])(
    'guards a fresh worker action, verified-win claim=%s',
    async (verified) => {
      const session = sessionFor()
      const h = harness(session, undefined, { verified })
      try {
        const response = await h.api.decide(h.request())
        expect(chosenAction(session, response).id).not.toBe(fatalAttack(session).id)
        expect(response.usage?.actionOutcomeReason).toBe('immediate-terminal-loss')
        expect(response.usage?.decisionPriority).not.toBe('verified-win')
      } finally {
        h.api.dispose()
      }
    }
  )

  it('guards a plan before its selected action is committed from the cache', async () => {
    const session = sessionFor()
    const h = harness(session, undefined, { verified: true })
    try {
      const plan = await h.api.decide(h.request('plan'))
      const response = await h.api.decide(h.request())
      expect(chosenAction(session, plan).id).not.toBe(fatalAttack(session).id)
      expect(chosenAction(session, response).id).toBe(chosenAction(session, plan).id)
      expect(response.finishReason).toBe('expert-plan-commit-cache')
      expect(h.calls()).toBe(1)
    } finally {
      h.api.dispose()
    }
  })

  it('rechecks a cached plan even if it carries bogus verified-win metadata', async () => {
    const session = sessionFor()
    const h = harness(session)
    try {
      await h.api.decide(h.request('plan'))
      // Inject a stale producer's unsafe plan after the fresh-result guard.
      const cache = (
        h.api as unknown as {
          planCommit: { response: AiDecisionResponse }
        }
      ).planCommit
      if (!('plan' in cache.response.choice)) throw new Error('Expected plan cache.')
      Object.assign(cache.response.choice.plan, {
        firstActionId: fatalAttack(session).id
      })
      Object.assign(cache.response.usage!, { decisionPriority: 'verified-win' })
      const response = await h.api.decide(h.request())
      expect(h.calls()).toBe(2)
      expect(response.finishReason).not.toBe('expert-plan-commit-cache')
      expect(response.usage?.continuationRejection).toBe('immediate-terminal-loss')
      expect(chosenAction(session, response).id).not.toBe(fatalAttack(session).id)
    } finally {
      h.api.dispose()
    }
  })

  it.each([false, true])(
    'rejects a lethal cached continuation, verified-win claim=%s',
    async (verified) => {
      const session = sessionFor({ aiHand: ['basic_chillwind_yeti'], aiMana: 4 })
      const play = legalActions(session).find(
        (action) => action.command.type === 'play-card'
      )!
      const fatal = fatalAttack(session)
      const h = harness(session, (call) => (call === 0 ? play : fatalAttack(session)), {
        verified,
        line: () => [play, fatal]
      })
      try {
        const first = await h.api.decide(h.request())
        expect(chosenAction(session, first).id).toBe(play.id)
        expect(session.match.dispatch(play.command).accepted).toBe(true)
        const response = await h.api.decide(h.request())
        expect(h.calls()).toBe(2)
        expect(response.usage?.continuationRejection).toBe('immediate-terminal-loss')
        expect(chosenAction(session, response).id).not.toBe(fatalAttack(session).id)
      } finally {
        h.api.dispose()
      }
    }
  )

  it.each(['timeout', 'failure'] as const)(
    'guards best progress after worker %s',
    async (cause) => {
      vi.useFakeTimers()
      const session = sessionFor()
      const h = harness(session, undefined, { progress: true, verified: true })
      try {
        const pending = h.api.decide(h.request())
        if (cause === 'timeout') await vi.runAllTimersAsync()
        else h.fail()
        const response = await pending
        expect(response.finishReason).toBe(
          cause === 'timeout'
            ? 'expert-best-so-far-timeout'
            : 'expert-best-so-far-worker-failure'
        )
        expect(chosenAction(session, response).id).not.toBe(fatalAttack(session).id)
        expect(response.usage?.actionOutcomeReason).toBe('immediate-terminal-loss')
      } finally {
        h.api.dispose()
      }
    }
  )

  it('does not return a fatal continuation after the turn budget expires', async () => {
    const session = sessionFor({ aiHand: ['basic_chillwind_yeti'], aiMana: 4 })
    const play = legalActions(session).find(
      (action) => action.command.type === 'play-card'
    )!
    const fatal = fatalAttack(session)
    let now = 0
    const h = harness(session, () => play, {
      verified: true,
      line: () => [play, fatal],
      now: () => now
    })
    try {
      await h.api.decide(h.request())
      expect(session.match.dispatch(play.command).accepted).toBe(true)
      now = 90_000
      await expect(h.api.decide(h.request())).rejects.toMatchObject({
        details: { failureKind: 'timeout' }
      })
      expect(h.calls()).toBe(1)
    } finally {
      h.api.dispose()
    }
  })

  it('guards timeout policy scoring that prefers a fatal hero trade', () => {
    const session = sessionFor({ aiAttack: 9 })
    const actions = legalActions(session)
    const chosen = selectExpertTimeoutFallbackAction(
      session,
      actions.map((action) => action.command)
    )!
    expect(canonicalCommandKey(chosen.command)).not.toBe(
      canonicalCommandKey(fatalAttack(session).command)
    )
    expect(session.match.preview(chosen.command).state.winnerId).not.toBe(
      session.localParticipantId
    )
  })

  it('preserves a selected loss if no other legal requested action is available', async () => {
    const session = sessionFor()
    const fatal = fatalAttack(session)
    const h = harness(session)
    try {
      const response = await h.api.decide({ ...h.request(), actionIds: [fatal.id] })
      expect(chosenAction(session, response).id).toBe(fatal.id)
      expect(
        selectExpertTimeoutFallbackAction(session, [fatal.command])?.command
      ).toEqual(fatal.command)
    } finally {
      h.api.dispose()
    }
  })

  it('preserves a verified immediate engine win', async () => {
    const session = sessionFor({ opponentHealth: 1, opponentBoard: [] })
    const h = harness(session)
    try {
      const response = await h.api.decide(h.request())
      expect(h.calls()).toBe(0)
      expect(response.usage?.decisionPriority).toBe('verified-win')
      const result = session.match.dispatch(chosenAction(session, response).command)
      expect(result.state.phase).toBe('ended')
      expect(result.state.winnerId).toBe(session.remoteParticipantId)
    } finally {
      h.api.dispose()
    }
  })

  it.each([
    { health: 2, opponentHealth: 2, outcome: 'draw' },
    { health: 3, opponentHealth: 2, outcome: 'win' },
    { health: 2, opponentHealth: 3, outcome: 'loss' }
  ] as const)(
    'uses resolved deathrattles for $outcome rather than health arithmetic',
    ({ health, opponentHealth, outcome }) => {
      const session = sessionFor({
        aiHealth: health,
        aiArmor: 0,
        opponentHealth,
        opponentBoard: [{ cardId: 'classic_abomination', attack: 0, health: 1 }]
      })
      const command = fatalAttack(session).command
      expect(
        createExpertTerminalInspector(
          session.match.getCheckpoint(),
          session.remoteParticipantId
        )(command)
      ).toBe(outcome)
    }
  )

  it('preserves immunity applied by an on-attack weapon effect', () => {
    const session = sessionFor({
      aiHealth: 1,
      aiArmor: 0,
      aiAttack: 0,
      aiWeapon: { cardId: 'classic_gladiators_longbow' }
    })
    expect(
      createExpertTerminalInspector(
        session.match.getCheckpoint(),
        session.remoteParticipantId
      )(fatalAttack(session).command)
    ).toBe('ongoing')
  })

  it('preserves lifesteal resolved by the engine during an otherwise fatal attack', () => {
    const source = sessionFor({ aiAttack: 10 })
    const checkpoint = structuredClone(source.match.getCheckpoint())
    const player = checkpoint.state.players.find(
      (p) => p.participantId === source.remoteParticipantId
    )!
    Object.assign(player.hero, { baseKeywords: ['lifesteal'], keywords: ['lifesteal'] })
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    expect(
      createExpertTerminalInspector(
        checkpoint,
        session.remoteParticipantId
      )(fatalAttack(session).command)
    ).toBe('ongoing')
  })

  it('keeps concealed secrets, draws and random effects unknown', () => {
    const secret = sessionFor({ opponentSecrets: [{ cardId: 'classic_ice_barrier' }] })
    expect(
      createExpertTerminalInspector(
        secret.match.getCheckpoint(),
        secret.remoteParticipantId
      )(fatalAttack(secret).command)
    ).toBe('unknown')
    for (const cardId of ['basic_arcane_intellect', 'basic_arcane_missiles']) {
      const session = sessionFor({ aiHeroId: 'jaina', aiMana: 10, aiHand: [cardId] })
      const play = legalActions(session).find(
        (action) => action.command.type === 'play-card'
      )!
      expect(
        createExpertTerminalInspector(
          session.match.getCheckpoint(),
          session.remoteParticipantId
        )(play.command)
      ).toBe('unknown')
    }
  })

  it('does not veto a worker action whose immediate outcome is unknown', async () => {
    const session = sessionFor({ opponentSecrets: [{ cardId: 'classic_ice_barrier' }] })
    const h = harness(session, undefined, { verified: true })
    try {
      const response = await h.api.decide(h.request())
      expect(chosenAction(session, response).id).toBe(fatalAttack(session).id)
      expect(response.usage?.actionOutcomeReason).toBeUndefined()
    } finally {
      h.api.dispose()
    }
  })

  it.each(['draw', 'lifesteal', 'unknown'] as const)(
    'preserves %s at the fresh plan and action-cache boundaries',
    async (control) => {
      let session =
        control === 'draw'
          ? sessionFor({
              aiHealth: 2,
              aiArmor: 0,
              opponentHealth: 2,
              opponentBoard: [{ cardId: 'classic_abomination', attack: 0, health: 1 }]
            })
          : control === 'unknown'
            ? sessionFor({ opponentSecrets: [{ cardId: 'classic_ice_barrier' }] })
            : sessionFor({ aiAttack: 10 })
      if (control === 'lifesteal') {
        const checkpoint = structuredClone(session.match.getCheckpoint())
        const self = checkpoint.state.players.find(
          (p) => p.participantId === session.remoteParticipantId
        )!
        Object.assign(self.hero, {
          baseKeywords: ['lifesteal'],
          keywords: ['lifesteal']
        })
        session = new GameBoardSession({
          setup: checkpoint.setup,
          decks: checkpoint.decks,
          checkpoint
        })
      }
      const selected = fatalAttack(session)
      const h = harness(session, () => selected, { verified: true })
      try {
        const plan = await h.api.decide(h.request('plan'))
        const response = await h.api.decide(h.request())
        expect(chosenAction(session, plan).id).toBe(selected.id)
        expect(chosenAction(session, response).id).toBe(selected.id)
        expect(response.finishReason).toBe('expert-plan-commit-cache')
        expect(h.calls()).toBe(1)
      } finally {
        h.api.dispose()
      }
    }
  )

  it('returns unknown for rejected commands and missing proof hooks', () => {
    const session = sessionFor()
    const match = opening.createOpeningMatchFromCheckpoint(
      createFairHypothesisCheckpoint(
        session.match.getCheckpoint(),
        session.remoteParticipantId,
        123
      )
    )
    match.analyze((fork) => {
      const command = fatalAttack(session).command
      const withoutHooks: OpeningMatchAnalysis = {
        ...fork,
        analyze: (operation) =>
          fork.analyze((child) => operation({ ...child, getRandomState: undefined }))
      }
      expect(
        inspectExpertTerminalAction(withoutHooks, session.remoteParticipantId, command)
      ).toBe('unknown')
      expect(
        inspectExpertTerminalAction(fork, session.remoteParticipantId, {
          ...command,
          participantId: session.localParticipantId
        })
      ).toBe('unknown')
    })
  })

  it('caps additional engine dispatches, memoizes probes, and gives each new selection a budget', () => {
    const session = sessionFor({
      aiHeroId: 'jaina',
      aiMana: 10,
      aiHand: Array.from({ length: 4 }, () => 'basic_fireball'),
      opponentBoard: Array.from({ length: 7 }, () => ({
        cardId: 'basic_chillwind_yeti'
      }))
    })
    const original = opening.createOpeningMatchFromCheckpoint
    let dispatches = 0
    const wrap = (fork: OpeningMatchAnalysis): OpeningMatchAnalysis => ({
      ...fork,
      dispatch(command) {
        dispatches++
        return fork.dispatch(command)
      },
      analyze: (operation) => fork.analyze((child) => operation(wrap(child)))
    })
    vi.spyOn(opening, 'createOpeningMatchFromCheckpoint').mockImplementation(
      (checkpoint) => {
        const match = original(checkpoint)
        return {
          ...match,
          analyze: (operation) => match.analyze((fork) => operation(wrap(fork)))
        }
      }
    )
    const checkpoint = session.match.getCheckpoint()
    const cache = new Map<string, TacticalOutcome>()
    const inspect = createExpertTerminalInspector(
      checkpoint,
      session.remoteParticipantId,
      undefined,
      cache
    )
    const actions = legalActions(session)
    expect(actions.length).toBeGreaterThan(EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES)
    actions.forEach((action) => inspect(action.command))
    expect(dispatches).toBe(EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES)
    inspect(actions[0]!.command)
    expect(dispatches).toBe(EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES)
    const next = createExpertTerminalInspector(
      checkpoint,
      session.remoteParticipantId,
      1,
      cache
    )
    next(actions.at(-1)!.command)
    expect(dispatches).toBe(EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES + 1)
    expect(inspect.stats.workAbstentions).toBeGreaterThan(0)
    expect(inspect.stats.cacheHits).toBe(1)
  })

  it('still checks the selected action after the deadline and abstains on new alternatives', () => {
    const session = sessionFor()
    const inspect = createExpertTerminalInspector(
      session.match.getCheckpoint(),
      session.remoteParticipantId,
      undefined,
      undefined,
      () => true
    )
    expect(inspect(fatalAttack(session).command)).toBe('loss')
    expect(
      inspect({ type: 'end-turn', participantId: session.remoteParticipantId })
    ).toBe('unknown')
    expect(inspect.stats).toMatchObject({ probes: 1, timeAbstentions: 1 })
  })

  it.each(['auraBeforeAttack', 'summonBeforeTrade'] as const)(
    'revalidates recorded %s through both plan and continuation caches',
    async (name) => {
      const fixture = recorded[name]
      for (const cacheKind of ['plan', 'continuation'] as const) {
        const actorId = fixture.actorId as PlayerId
        const checkpoint = createFairHypothesisCheckpoint(
          fixture.checkpoint as unknown as OpeningMatchCheckpoint,
          actorId,
          0x71ac71c
        )
        const session = new GameBoardSession({
          setup: checkpoint.setup,
          decks: checkpoint.decks,
          checkpoint
        })
        const historical = legalActions(session).find(
          (action) =>
            canonicalCommandKey(action.command) ===
            canonicalCommandKey(fixture.historicalCommand as TurnMatchCommand)
        )!
        const pass = legalActions(session).find(
          (action) => action.command.type === 'end-turn'
        )!
        let emptyAtReplan = false
        const h = harness(session, (call) => {
          if (cacheKind === 'plan' && call === 0) return historical
          const caches = h.api as unknown as {
            planCommit: unknown
            continuation: unknown
          }
          emptyAtReplan = caches.planCommit === null && caches.continuation === null
          return pass
        })
        try {
          if (cacheKind === 'plan') await h.api.decide(h.request('plan'))
          else {
            const intent = aiActionIntent(
              historical.command,
              session.localParticipantId
            )
            Object.assign(h.api, {
              continuation: {
                turn: checkpoint.state.turnNumber,
                expectedRevision: checkpoint.state.revision - 1,
                nextIndex: 1,
                actions: [intent, intent]
              }
            })
          }
          const response = await h.api.decide(h.request())
          expect(h.calls()).toBe(cacheKind === 'plan' ? 2 : 1)
          expect(emptyAtReplan).toBe(true)
          expect(response.usage?.continuationRejection).toBe('attack-before-setup')
          expect(chosenAction(session, response).command.type).toBe('end-turn')
        } finally {
          h.api.dispose()
        }
      }
    }
  )

  it('restores the exact J1 root 46 failure and rejects its fatal action from a worker', async () => {
    const checkpoint = recorded.jadeSelfLoss
      .checkpoint as unknown as OpeningMatchCheckpoint
    const actorId = recorded.jadeSelfLoss.actorId as PlayerId
    const command = recorded.jadeSelfLoss.historicalCommand as TurnMatchCommand
    const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
    const session = new GameBoardSession({
      setup: fair.setup,
      decks: fair.decks,
      checkpoint: fair
    })
    expect(session.remoteParticipantId).toBe(actorId)
    expect(
      opening.createOpeningMatchFromCheckpoint(fair).preview(command).state.winnerId
    ).toBe(session.localParticipantId)
    const fatal = legalActions(session).find(
      (action) => canonicalCommandKey(action.command) === canonicalCommandKey(command)
    )!
    const h = harness(session, () => fatal, { verified: true })
    try {
      const response = await h.api.decide(h.request())
      expect(chosenAction(session, response).id).not.toBe(fatal.id)
      expect(response.usage?.actionOutcomeReason).toBe('immediate-terminal-loss')
      expect(session.getState().revision).toBe(47)
    } finally {
      h.api.dispose()
    }
  })
})
