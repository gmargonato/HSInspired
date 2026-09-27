import { describe, expect, it, vi } from 'vitest'
import type {
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject
} from '../../../shared/ipc/ai'
import { sameAiIntent, type AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import { createAiFixture } from '../../../game/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game/match'
import { asCardId } from '../../../game/content/cards'
import { createFairHypothesisCheckpoint } from '../../../game/match/ai/fair-hypothesis-checkpoint'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import {
  EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
  EXPERT_AI_SEARCH_BUDGET_MS,
  ExpertAiDecisionApi
} from './expert-ai-decision-api'
import { GameBoardSession } from './game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { chooseExpertConsensus } from './expert-ai-consensus'
import {
  expertAiBudgetForTurn,
  EXPERT_AI_TURN_BUDGET_MS
} from './expert-ai-worker-protocol'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'

describe('Expert hidden-world consensus', () => {
  it('ranks an empty Coin into face hero power below ordinary legal moves', () => {
    const candidate = (
      actionId: string,
      meanValue: number,
      recommendationTacticalPenalty = 0
    ) => ({
      actionId,
      type: 'play-card' as const,
      description: actionId,
      score: meanValue,
      scoreComponents: {
        positionDelta: meanValue,
        commandPreference: 0,
        continuationPreference: 0,
        threatDefense: 0,
        opponentBoardRemoval: 0,
        friendlyBoardLoss: 0,
        sequenceRefinement: 0
      },
      accepted: true as const,
      phase: 'turns' as const,
      winnerId: null,
      visits: 100,
      meanValue,
      recommendationTacticalPenalty
    })
    const results = [
      {
        response: { choice: { actionId: 'coin-face-power' } },
        trace: {
          chosenActionId: 'coin-face-power',
          candidates: [
            candidate('coin-face-power', 0.9, 3),
            candidate('hold-coin', 0.2)
          ],
          requestId: 'coin-face-power-regression',
          phase: 'action',
          durationMs: 1,
          evaluatedActions: 2,
          refinedActions: 2,
          continuations: 0,
          timedOut: false,
          baseScore: null,
          visibleThreat: null
        }
      }
    ] as unknown as Parameters<typeof chooseExpertConsensus>[0]

    expect(
      chooseExpertConsensus(results, ['coin-face-power', 'hold-coin']).actionId
    ).toBe('hold-coin')
  })

  it.each([
    {
      name: 'keeps a one-visit lucky rollout below a repeatedly supported root action',
      values: [
        { actionId: 'lucky', score: 0.95, meanValue: 0.95, visits: 1 },
        { actionId: 'supported', score: 0.7, meanValue: 0.7, visits: 100 }
      ]
    },
    {
      name: 'preserves the supported continuation value when combining worlds',
      values: [
        {
          actionId: 'lucky',
          score: 0.8,
          meanValue: 0.8,
          visits: 100,
          recommendationValue: 0.8
        },
        {
          actionId: 'supported',
          score: 0.4,
          meanValue: 0.4,
          visits: 100,
          recommendationValue: 0.9
        }
      ]
    }
  ])('$name', ({ values }) => {
    const candidates = values.map((candidate) => ({
      ...candidate,
      type: 'end-turn' as const,
      description: candidate.actionId,
      scoreComponents: {
        positionDelta: candidate.score,
        commandPreference: 0,
        continuationPreference: 0,
        threatDefense: 0,
        opponentBoardRemoval: 0,
        friendlyBoardLoss: 0,
        sequenceRefinement: 0
      },
      accepted: true as const,
      phase: 'turns' as const,
      winnerId: null
    }))
    const results = [
      {
        response: { choice: { actionId: 'lucky' } },
        trace: {
          chosenActionId: 'lucky',
          candidates,
          requestId: 'consensus-regression',
          phase: 'action',
          durationMs: 1,
          evaluatedActions: 2,
          refinedActions: 2,
          continuations: 0,
          timedOut: false,
          baseScore: null,
          visibleThreat: null
        }
      }
    ] as unknown as Parameters<typeof chooseExpertConsensus>[0]

    expect(chooseExpertConsensus(results, ['lucky', 'supported']).actionId).toBe(
      'supported'
    )
  })
})

describe('Expert AI worker boundary', () => {
  it('posts only a redacted checkpoint and reports the Expert model', async () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHand: ['classic_counterspell'],
      opponentSecrets: [{ cardId: 'classic_counterspell' }]
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const listeners = new Map<string, (event: unknown) => void>()
    const posted: ExpertAiWorkerRequest[] = []
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
        if (message.type === 'decide') {
          const response: ExpertAiWorkerResponse = {
            type: 'failure',
            requestId: message.request.requestId,
            error: 'fixture worker response'
          }
          listeners.get('message')?.({ data: response } as MessageEvent)
        }
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(session, () => worker)
    const request: AiDecisionRequest = {
      matchId: 'expert-boundary-match',
      requestId: 'expert-boundary-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [{ role: 'user', content: '{}' }],
      actionIds: ['a0']
    }

    try {
      await expect(api.settings()).resolves.toMatchObject({
        modelId: 'hardware-local-v2',
        provider: 'none'
      })
      await expect(api.decide(request)).rejects.toThrow('fixture worker response')

      const message = posted.find((entry) => entry.type === 'decide')!
      if (message.type !== 'decide') throw new Error('Expected a decide request.')
      expect(EXPERT_AI_TURN_BUDGET_MS).toBe(30_000)
      expect(EXPERT_AI_SEARCH_BUDGET_MS).toBe(24_500)
      expect(EXPERT_AI_DECISION_SEARCH_BUDGET_MS).toBe(23_000)
      expect(expertAiBudgetForTurn(10_000)).toMatchObject({
        turnBudgetMs: 10_000,
        searchBudgetMs: 4_500,
        decisionSearchBudgetMs: 3_000,
        planSearchLimitMs: 2_000,
        replanSearchLimitMs: 1_000
      })
      expect(message.remainingSearchBudgetMs).toBeLessThanOrEqual(23_000)
      const originalHidden = fixture.checkpoint.state.players.find(
        (player) => player.participantId === fixture.localParticipantId
      )!
      const workerHidden = message.checkpoint.state.players.find(
        (player) => player.participantId === fixture.localParticipantId
      )!
      expect(workerHidden.hand[0]?.instanceId).not.toBe(
        originalHidden.hand[0]?.instanceId
      )
      expect(workerHidden.hand[0]?.knownTo).toEqual([])
      expect(workerHidden.secrets?.[0]?.instanceId).toMatch(/^expert-hidden:/)
      expect(message.checkpoint.setup.seed).toBe(message.seed)
      expect(message.checkpoint.rngState).toBe(message.seed)
    } finally {
      api.dispose()
    }
  })

  it('shares the search allowance across replans and resets next turn', async () => {
    const fixture = createAiFixture({
      seed: 0x5eef,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    let now = 1_000
    const listeners = new Map<string, (event: unknown) => void>()
    const posted: ExpertAiWorkerRequest[] = []
    let decisions = 0
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
        if (message.type !== 'decide') return
        decisions++
        if (decisions === 1) now += EXPERT_AI_DECISION_SEARCH_BUDGET_MS
        const response: ExpertAiWorkerResponse = {
          type: 'failure',
          requestId: message.request.requestId,
          error: 'fixture worker response'
        }
        listeners.get('message')?.({ data: response } as MessageEvent)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => now
    )
    const makeRequest = (requestId: string): AiDecisionRequest => ({
      matchId: 'expert-shared-budget-match',
      requestId,
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: ['a0']
    })

    try {
      await expect(api.decide(makeRequest('expert-budget-first'))).rejects.toThrow(
        'fixture worker response'
      )
      await expect(api.decide(makeRequest('expert-budget-second'))).rejects.toThrow(
        'fixture worker response'
      )

      const decisionsPosted = posted.filter(
        (message): message is Extract<ExpertAiWorkerRequest, { type: 'decide' }> =>
          message.type === 'decide'
      )
      expect(decisionsPosted[0]?.remainingSearchBudgetMs).toBe(
        EXPERT_AI_DECISION_SEARCH_BUDGET_MS
      )
      expect(decisionsPosted[1]?.remainingSearchBudgetMs).toBe(1_500)

      const firstPlayerId = session.remoteParticipantId
      const secondPlayerId = session
        .getState()
        .players.find((player) => player.participantId !== firstPlayerId)!.participantId
      expect(
        session.match.dispatch({ type: 'end-turn', participantId: firstPlayerId })
          .accepted
      ).toBe(true)
      expect(
        session.match.dispatch({ type: 'end-turn', participantId: secondPlayerId })
          .accepted
      ).toBe(true)
      expect(session.getState().activePlayerId).toBe(firstPlayerId)

      await expect(api.decide(makeRequest('expert-budget-next-turn'))).rejects.toThrow(
        'fixture worker response'
      )
      const nextTurnDecision = posted.find(
        (message) =>
          message.type === 'decide' &&
          message.request.requestId === 'expert-budget-next-turn'
      )
      expect(nextTurnDecision?.type).toBe('decide')
      if (nextTurnDecision?.type !== 'decide')
        throw new Error('Expected the next-turn worker request.')
      expect(nextTurnDecision.remainingSearchBudgetMs).toBe(
        EXPERT_AI_DECISION_SEARCH_BUDGET_MS
      )

      now += 7_200
      await expect(
        api.decide(makeRequest('expert-budget-presentation-reserve'))
      ).rejects.toThrow('fixture worker response')
      const reserveDecision = posted.find(
        (message) =>
          message.type === 'decide' &&
          message.request.requestId === 'expert-budget-presentation-reserve'
      )
      expect(reserveDecision?.type).toBe('decide')
      if (reserveDecision?.type !== 'decide')
        throw new Error('Expected the presentation-reserve worker request.')
      expect(reserveDecision.remainingSearchBudgetMs).toBe(
        EXPERT_AI_SEARCH_BUDGET_MS - 7_200
      )
    } finally {
      api.dispose()
    }
  })

  it('scales only the worker deadline for serialized benchmark worlds', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef0,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const posted: ExpertAiWorkerRequest[] = []
    const listeners = new Map<string, (event: unknown) => void>()
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
      },
      terminate() {}
    } as unknown as Worker

    vi.useFakeTimers()
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => 1_000,
      session.remoteParticipantId,
      2
    )
    try {
      const pending = api.decide({
        matchId: 'serialized-benchmark-timeout-match',
        requestId: 'serialized-benchmark-timeout-request',
        expectedRevision: session.getState().revision,
        phase: 'action',
        allowInspection: false,
        messages: [],
        actionIds: ['a0']
      })
      const rejection = expect(pending).rejects.toThrow(
        'Expert AI exceeded its allocated turn search budget.'
      )

      await vi.advanceTimersByTimeAsync(EXPERT_AI_SEARCH_BUDGET_MS * 2 - 1)
      expect(posted.some((message) => message.type === 'cancel')).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await rejection
      expect(posted.some((message) => message.type === 'cancel')).toBe(true)
    } finally {
      api.dispose()
      vi.useRealTimers()
    }
  })

  it('reuses a still-legal plan action and carries its line forward', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef4,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: ['basic_the_coin', 'classic_faerie_dragon'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false,
      opponentBoard: [{ cardId: 'basic_voidwalker', ready: false }]
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const state = session.getState()
    const legal = enumerateLegalCommands(
      {
        getState: () => state,
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const player = session.findPlayer(state, session.remoteParticipantId)
    const coinInstanceId = player.hand.find(
      (card) => card.cardId === 'basic_the_coin'
    )?.instanceId
    const coinAction = actions.find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === coinInstanceId
    )
    const coin = player.hand.find((card) => card.cardId === 'basic_the_coin')!
    const faerie = player.hand.find((card) => card.cardId === 'classic_faerie_dragon')!
    if (!coinAction || coinAction.command.type !== 'play-card')
      throw new Error('Expected The Coin to be a legal action.')

    const coinIntent = aiActionIntent(coinAction.command, session.localParticipantId)
    const faerieIntent = aiActionIntent(
      {
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: faerie.instanceId,
        position: 0
      },
      session.localParticipantId
    )
    const endTurnIntent = aiActionIntent(
      { type: 'end-turn', participantId: session.remoteParticipantId },
      session.localParticipantId
    )
    const plannedIntents: readonly AiActionIntent[] = [
      coinIntent,
      faerieIntent,
      endTurnIntent
    ]
    const getCurrentActions = () => {
      const currentLegal = enumerateLegalCommands(
        {
          getState: () => session.getState(),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            session.match.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => session.match.getLegality!(participantId)
        },
        session.remoteParticipantId
      )
      return aiActions(session, currentLegal)
    }
    const listeners = new Map<string, (event: unknown) => void>()
    const posted: ExpertAiWorkerRequest[] = []
    let now = 1_000
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
        if (message.type !== 'decide') return
        if (message.request.phase === 'plan') now += 6_500
        const isPlan = message.request.phase === 'plan'
        const currentActions = getCurrentActions()
        const preferredAction = message.preferredContinuation
          ? currentActions.find((action) =>
              sameAiIntent(
                message.preferredContinuation!,
                aiActionIntent(action.command, session.localParticipantId)
              )
            )
          : undefined
        const selectedAction =
          preferredAction ??
          (isPlan || session.getState().revision === state.revision
            ? coinAction
            : currentActions.find(
                (action) =>
                  action.command.type === 'play-card' &&
                  action.command.cardInstanceId === faerie.instanceId
              ))
        if (!selectedAction) throw new Error('Expected a legal continued action.')
        const selectedIntent = aiActionIntent(
          selectedAction.command,
          session.localParticipantId
        )
        const continuation =
          selectedAction.command.type === 'play-card' &&
          selectedAction.command.cardInstanceId === coin.instanceId
            ? plannedIntents
            : [selectedIntent, endTurnIntent]
        const choice: AiDecisionResponse['choice'] = isPlan
          ? {
              plan: {
                objective: 'Use The Coin to develop a threat.',
                winCheck: 'Keep improving the board.',
                lossRisk: 'Respect the public Taunt.',
                candidates: [
                  {
                    sequence: ['The Coin', 'Faerie Dragon', 'End Turn'],
                    budget: 'Replan after each action.',
                    endPosition: 'Keep a developing board.',
                    opponentReply: 'Check the visible board.'
                  }
                ],
                preferred: 0,
                firstActionId: selectedAction.id,
                checks: []
              }
            }
          : {
              actionId: selectedAction.id,
              intent: selectedIntent,
              expectedResult: 'Continue the planned line.',
              planUpdate: null
            }
        const usage = {
          mode: 'expert-sampled-search',
          plannedActionIntents: continuation
        } as unknown as JsonObject
        const response: AiDecisionResponse = {
          matchId: message.request.matchId,
          requestId: message.request.requestId,
          expectedRevision: message.request.expectedRevision,
          modelId: 'hardware-local-v2',
          reason: 'Continue the planned line when still legal.',
          choice,
          durationMs: 0,
          finishReason: 'fixture',
          usage
        }
        const envelope: ExpertAiWorkerResponse = {
          type: 'decision',
          requestId: message.request.requestId,
          response
        }
        listeners.get('message')?.({ data: envelope } as MessageEvent)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => now
    )
    const makeRequest = (
      requestId: string,
      phase: 'plan' | 'action'
    ): AiDecisionRequest => ({
      matchId: 'expert-continuation-match',
      requestId,
      expectedRevision: session.getState().revision,
      phase,
      allowInspection: false,
      messages: [{ role: 'user', content: '{}' }],
      actionIds: getCurrentActions().map((action) => action.id)
    })

    try {
      await api.decide(makeRequest('expert-continuation-plan', 'plan'))
      const commit = await api.decide(
        makeRequest('expert-continuation-commit-coin', 'action')
      )
      expect(commit.finishReason).toBe('expert-plan-commit-cache')
      expect(commit.durationMs).toBe(0)
      expect('actionId' in commit.choice ? commit.choice.actionId : null).toBe(
        coinAction.id
      )
      const workerDecisions = posted.filter(
        (message): message is Extract<ExpertAiWorkerRequest, { type: 'decide' }> =>
          message.type === 'decide'
      )
      expect(workerDecisions).toHaveLength(1)
      expect(workerDecisions[0]?.request.phase).toBe('plan')

      const result = session.match.dispatch({
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: coin.instanceId
      })
      expect(result.accepted).toBe(true)

      const continuation = await api.decide(
        makeRequest('expert-continuation-fae', 'action')
      )
      expect(continuation.finishReason).toBe('expert-continuation')
      expect(
        'actionId' in continuation.choice ? continuation.choice.intent : null
      ).toEqual(faerieIntent)
      expect(posted.filter((message) => message.type === 'decide')).toHaveLength(1)
    } finally {
      api.dispose()
    }
  })

  it('continues the searched line before a worker request can fail', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef7,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: ['basic_the_coin', 'classic_faerie_dragon'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const currentActions = () => {
      const legal = enumerateLegalCommands(
        {
          getState: () => session.getState(),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            session.match.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => session.match.getLegality!(participantId)
        },
        session.remoteParticipantId
      )
      return aiActions(session, legal)
    }
    const player = session.findPlayer(session.getState(), session.remoteParticipantId)
    const coin = player.hand.find((card) => card.cardId === 'basic_the_coin')!
    const faerie = player.hand.find((card) => card.cardId === 'classic_faerie_dragon')!
    const coinAction = currentActions().find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === coin.instanceId
    )
    if (!coinAction) throw new Error('Expected The Coin to be legal.')
    const coinIntent = aiActionIntent(coinAction.command, session.localParticipantId)
    const faerieIntent = aiActionIntent(
      {
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: faerie.instanceId,
        position: 0
      },
      session.localParticipantId
    )
    const listeners = new Map<string, (event: unknown) => void>()
    const posted: ExpertAiWorkerRequest[] = []
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
        if (message.type !== 'decide') return
        if (message.request.phase === 'action')
          throw new Error('Fixture worker rejected the posted request.')
        const response: AiDecisionResponse = {
          matchId: message.request.matchId,
          requestId: message.request.requestId,
          expectedRevision: message.request.expectedRevision,
          modelId: 'hardware-local-v2',
          reason: 'Use The Coin, then develop Faerie Dragon.',
          choice: {
            plan: {
              objective: 'Develop a minion this turn.',
              winCheck: 'Keep a developing board.',
              lossRisk: 'Re-evaluate after each move.',
              candidates: [
                {
                  sequence: ['The Coin', 'Faerie Dragon'],
                  budget: 'Respect the current mana budget.',
                  endPosition: 'Develop a minion.',
                  opponentReply: 'Replan from the live state.'
                }
              ],
              preferred: 0,
              firstActionId: coinAction.id,
              checks: []
            }
          },
          durationMs: 0,
          finishReason: 'fixture-plan',
          usage: {
            plannedActionIntents: [coinIntent, faerieIntent]
          } as unknown as JsonObject
        }
        const envelope: ExpertAiWorkerResponse = {
          type: 'decision',
          requestId: message.request.requestId,
          response
        }
        listeners.get('message')?.({ data: envelope } as MessageEvent)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(session, () => worker)
    const makeRequest = (requestId: string, phase: 'plan' | 'action') =>
      ({
        matchId: 'expert-post-failure-match',
        requestId,
        expectedRevision: session.getState().revision,
        phase,
        allowInspection: false,
        messages: [],
        actionIds: currentActions().map((action) => action.id)
      }) satisfies AiDecisionRequest

    try {
      await api.decide(makeRequest('expert-post-failure-plan', 'plan'))
      const commit = await api.decide(
        makeRequest('expert-post-failure-commit', 'action')
      )
      expect(commit.finishReason).toBe('expert-plan-commit-cache')
      expect(session.match.dispatch(coinAction.command).accepted).toBe(true)

      const continued = await api.decide(
        makeRequest('expert-post-failure-faerie', 'action')
      )
      expect(continued.finishReason).toBe('expert-continuation')
      expect('actionId' in continued.choice ? continued.choice.intent : null).toEqual(
        faerieIntent
      )
      expect(posted.filter((message) => message.type === 'decide')).toHaveLength(1)
    } finally {
      api.dispose()
    }
  })

  it('discards the cached plan action when the match revision advances', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef5,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: ['basic_the_coin', 'classic_faerie_dragon'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const state = session.getState()
    const currentActions = () => {
      const legal = enumerateLegalCommands(
        {
          getState: () => session.getState(),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            session.match.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => session.match.getLegality!(participantId)
        },
        session.remoteParticipantId
      )
      return aiActions(session, legal)
    }
    const coinInstanceId = session
      .findPlayer(state, session.remoteParticipantId)
      .hand.find((card) => card.cardId === 'basic_the_coin')?.instanceId
    const coinAction = currentActions().find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === coinInstanceId
    )
    if (!coinAction) throw new Error('Expected The Coin to be legal.')

    const listeners = new Map<string, (event: unknown) => void>()
    const posted: ExpertAiWorkerRequest[] = []
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
        if (message.type !== 'decide') return
        const actions = currentActions()
        const selectedAction =
          message.request.phase === 'plan' ? coinAction : actions[0]
        if (!selectedAction) throw new Error('Expected a current legal action.')
        const intent = aiActionIntent(
          selectedAction.command,
          session.localParticipantId
        )
        const choice: AiDecisionResponse['choice'] =
          message.request.phase === 'plan'
            ? {
                plan: {
                  objective: 'Play the current best line.',
                  winCheck: 'Check the resulting public state.',
                  lossRisk: 'Re-evaluate if the state changes.',
                  candidates: [
                    {
                      sequence: [selectedAction.description],
                      budget: 'Search remains advisory.',
                      endPosition: 'Keep a legal position.',
                      opponentReply: 'Respect only current public state.'
                    }
                  ],
                  preferred: 0,
                  firstActionId: selectedAction.id,
                  checks: []
                }
              }
            : {
                actionId: selectedAction.id,
                intent,
                expectedResult: 'Use a fresh decision.',
                planUpdate: null
              }
        const response: AiDecisionResponse = {
          matchId: message.request.matchId,
          requestId: message.request.requestId,
          expectedRevision: message.request.expectedRevision,
          modelId: 'hardware-local-v2',
          reason: 'Fixture response.',
          choice,
          durationMs: 0,
          finishReason: 'fixture-worker-search',
          usage: { plannedActionIntents: [intent] } as unknown as JsonObject
        }
        const envelope: ExpertAiWorkerResponse = {
          type: 'decision',
          requestId: message.request.requestId,
          response
        }
        listeners.get('message')?.({ data: envelope } as MessageEvent)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(session, () => worker)
    const makeRequest = (requestId: string, phase: 'plan' | 'action') =>
      ({
        matchId: 'expert-stale-plan-match',
        requestId,
        expectedRevision: session.getState().revision,
        phase,
        allowInspection: false,
        messages: [],
        actionIds: currentActions().map((action) => action.id)
      }) satisfies AiDecisionRequest

    try {
      await api.decide(makeRequest('expert-stale-plan', 'plan'))
      const commit = await api.decide(makeRequest('expert-stale-plan-commit', 'action'))
      expect(commit.finishReason).toBe('expert-plan-commit-cache')
      expect(
        session.match.dispatch({
          type: 'dev-draw',
          participantId: session.remoteParticipantId
        }).accepted
      ).toBe(true)

      const decision = await api.decide(
        makeRequest('expert-stale-plan-action', 'action')
      )
      expect(decision.finishReason).toBe('fixture-worker-search')
      const workerDecisions = posted.filter(
        (message): message is Extract<ExpertAiWorkerRequest, { type: 'decide' }> =>
          message.type === 'decide'
      )
      expect(workerDecisions.map((message) => message.request.phase)).toEqual([
        'plan',
        'action'
      ])
    } finally {
      api.dispose()
    }
  })

  it('executes only still-legal planned steps when search budget is exhausted', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef6,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: ['basic_the_coin', 'classic_faerie_dragon'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const currentActions = () => {
      const legal = enumerateLegalCommands(
        {
          getState: () => session.getState(),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            session.match.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => session.match.getLegality!(participantId)
        },
        session.remoteParticipantId
      )
      return aiActions(session, legal)
    }
    const player = session.findPlayer(session.getState(), session.remoteParticipantId)
    const coin = player.hand.find((card) => card.cardId === 'basic_the_coin')!
    const faerie = player.hand.find((card) => card.cardId === 'classic_faerie_dragon')!
    const coinAction = currentActions().find(
      (action) =>
        action.command.type === 'play-card' &&
        action.command.cardInstanceId === coin.instanceId
    )
    if (!coinAction) throw new Error('Expected The Coin to be legal.')
    const coinIntent = aiActionIntent(coinAction.command, session.localParticipantId)
    const faerieIntent = aiActionIntent(
      {
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: faerie.instanceId,
        position: 0
      },
      session.localParticipantId
    )
    const endTurnIntent = aiActionIntent(
      { type: 'end-turn', participantId: session.remoteParticipantId },
      session.localParticipantId
    )
    const plannedActionIntents = [coinIntent, faerieIntent, endTurnIntent]
    const listeners = new Map<string, (event: unknown) => void>()
    const posted: ExpertAiWorkerRequest[] = []
    let now = 1_000
    const worker = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function')
          listeners.set(type, listener as (event: unknown) => void)
      },
      postMessage(message: ExpertAiWorkerRequest) {
        posted.push(message)
        if (message.type !== 'decide') return
        if (message.request.phase !== 'plan') return
        now += EXPERT_AI_SEARCH_BUDGET_MS - 101
        const response: AiDecisionResponse = {
          matchId: message.request.matchId,
          requestId: message.request.requestId,
          expectedRevision: message.request.expectedRevision,
          modelId: 'hardware-local-v2',
          reason: 'Search a Coin into Faerie Dragon line.',
          choice: {
            plan: {
              objective: 'Use the full turn efficiently.',
              winCheck: 'Keep the developing board.',
              lossRisk: 'Respect public threats.',
              candidates: [
                {
                  sequence: ['The Coin', 'Faerie Dragon', 'End Turn'],
                  budget: 'Revalidate each step.',
                  endPosition: 'Develop a minion.',
                  opponentReply: 'Respect public information.'
                }
              ],
              preferred: 0,
              firstActionId: coinAction.id,
              checks: []
            }
          },
          durationMs: 0,
          finishReason: 'fixture-plan',
          usage: {
            plannedActionIntents
          } as unknown as JsonObject
        }
        const envelope: ExpertAiWorkerResponse = {
          type: 'decision',
          requestId: message.request.requestId,
          response
        }
        listeners.get('message')?.({ data: envelope } as MessageEvent)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => now
    )
    const makeRequest = (requestId: string, phase: 'plan' | 'action') =>
      ({
        matchId: 'expert-exhausted-line-match',
        requestId,
        expectedRevision: session.getState().revision,
        phase,
        allowInspection: false,
        messages: [],
        actionIds: currentActions().map((action) => action.id)
      }) satisfies AiDecisionRequest

    try {
      await api.decide(makeRequest('expert-exhausted-line-plan', 'plan'))
      const commit = await api.decide(
        makeRequest('expert-exhausted-line-commit', 'action')
      )
      expect(commit.finishReason).toBe('expert-plan-commit-cache')
      expect(session.match.dispatch(coinAction.command).accepted).toBe(true)

      const faerieDecision = await api.decide(
        makeRequest('expert-exhausted-line-faerie', 'action')
      )
      expect(faerieDecision.finishReason).toBe('expert-continuation')
      expect(
        'actionId' in faerieDecision.choice ? faerieDecision.choice.intent : null
      ).toEqual(faerieIntent)
      const faerieAction = currentActions().find(
        (action) =>
          'actionId' in faerieDecision.choice &&
          action.id === faerieDecision.choice.actionId
      )
      expect(faerieAction?.command.type).toBe('play-card')
      expect(
        faerieAction && session.match.dispatch(faerieAction.command).accepted
      ).toBe(true)

      now += 1
      const endTurnDecision = await api.decide(
        makeRequest('expert-exhausted-line-end-turn', 'action')
      )
      expect(endTurnDecision.finishReason).toBe('expert-continuation')
      expect(
        'actionId' in endTurnDecision.choice ? endTurnDecision.choice.intent : null
      ).toEqual(endTurnIntent)
      expect(posted.filter((message) => message.type === 'decide')).toHaveLength(1)
    } finally {
      api.dispose()
    }
  })

  it('keeps the Expert decision invariant to hidden hand and deck order', async () => {
    const makeFixture = (
      hiddenHandCard: string,
      hiddenDeck: readonly string[],
      hiddenSecret: string
    ) =>
      createAiFixture({
        seed: 0x5eed,
        aiHeroId: 'jaina',
        opponentHeroId: 'jaina',
        aiHand: ['basic_acidic_swamp_ooze'],
        aiMana: 2,
        aiDeck: ['basic_acidic_swamp_ooze'],
        opponentDeck: hiddenDeck,
        opponentHand: [hiddenHandCard],
        opponentSecrets: [{ cardId: hiddenSecret }]
      })
    const firstFixture = makeFixture(
      'classic_counterspell',
      ['classic_counterspell', 'classic_ice_barrier', 'classic_mirror_entity'],
      'classic_counterspell'
    )
    const secondFixture = makeFixture(
      'classic_ice_barrier',
      ['classic_mirror_entity', 'classic_counterspell', 'classic_ice_barrier'],
      'classic_ice_barrier'
    )

    const firstHidden = firstFixture.checkpoint.state.players.find(
      (player) => player.participantId === firstFixture.localParticipantId
    )!
    const secondHidden = secondFixture.checkpoint.state.players.find(
      (player) => player.participantId === secondFixture.localParticipantId
    )!
    expect(firstHidden.hand[0]?.cardId).not.toBe(secondHidden.hand[0]?.cardId)
    expect(firstHidden.deck.map((card) => card.cardId)).not.toEqual(
      secondHidden.deck.map((card) => card.cardId)
    )

    const firstCheckpoint = createFairHypothesisCheckpoint(
      firstFixture.checkpoint,
      firstFixture.aiParticipantId,
      0x10203040
    )
    const secondCheckpoint = createFairHypothesisCheckpoint(
      secondFixture.checkpoint,
      secondFixture.aiParticipantId,
      0x10203040
    )
    expect(firstCheckpoint).toEqual(secondCheckpoint)

    const firstSession = new GameBoardSession({
      setup: firstCheckpoint.setup,
      decks: firstCheckpoint.decks,
      checkpoint: firstCheckpoint
    })
    const secondSession = new GameBoardSession({
      setup: secondCheckpoint.setup,
      decks: secondCheckpoint.decks,
      checkpoint: secondCheckpoint
    })
    expect(firstSession.getAiObservation()).toEqual(secondSession.getAiObservation())

    const decide = async (session: GameBoardSession) => {
      const legal = enumerateLegalCommands(
        {
          getState: () => session.getState(),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            session.match.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => session.match.getLegality!(participantId)
        },
        session.remoteParticipantId
      )
      const actions = aiActions(session, legal)
      const api = new LocalAiDecisionApi(session, undefined, {
        profile: 'expert',
        workBudget: 512,
        fairHypothesis: true
      })
      const response = await api.decide({
        matchId: 'expert-hidden-information-invariance',
        requestId: 'expert-hidden-information-invariance-request',
        expectedRevision: session.getState().revision,
        phase: 'action',
        allowInspection: false,
        messages: [],
        actionIds: actions.map((action) => action.id)
      })
      if (!('actionId' in response.choice))
        throw new Error('Expected an Expert action decision.')
      const trace = api.getLastTrace()
      if (!trace) throw new Error('Expected Expert search diagnostics.')
      return {
        actionId: response.choice.actionId,
        evaluatedActions: trace.evaluatedActions,
        sequenceNodes: trace.sequenceNodes ?? 0,
        workUnits: trace.workUnits ?? 0,
        workBudgetHit: trace.workBudgetHit ?? false,
        candidates: trace.candidates.map(({ actionId, score }) => ({ actionId, score }))
      }
    }

    const firstDecision = await decide(firstSession)
    await expect(decide(secondSession)).resolves.toEqual(firstDecision)
  }, 15_000)

  it('backs up face damage against the opponent turn before choosing a spell', async () => {
    const fixture = createAiFixture({
      seed: 0x5eef,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_fireball', 'basic_polymorph'],
      aiMana: 4,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentBoard: [{ cardId: 'basic_core_hound', ready: true }]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x55667788
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const response = await api.decide({
      matchId: 'expert-public-reply-match',
      requestId: 'expert-public-reply-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const selectedActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedActionId)
    if (!selected) throw new Error('Expert selected an unknown action.')
    expect(selected.command.type).toBe('play-card')
    if (selected.command.type !== 'play-card') return
    const selectedCommand = selected.command

    const selectedCard = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.instanceId === selectedCommand.cardInstanceId)
    const attacksTheEnemyHero = selectedCommand.targets?.some(
      (target) =>
        target.kind === 'hero' && target.participantId === fixture.localParticipantId
    )
    expect(attacksTheEnemyHero).not.toBe(true)
    expect(['basic_fireball', 'basic_polymorph']).toContain(selectedCard?.cardId)
  })

  it('evaluates engine-legal card plays from a fair opponent hypothesis', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef8,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: [],
      aiMana: 0,
      aiMaximumMana: 0,
      aiHeroPowerAvailable: false,
      opponentHand: ['basic_fireball'],
      opponentMaximumMana: 10,
      opponentHeroPowerAvailable: false,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      turnNumber: 10
    })
    const fairCheckpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5ef8
    )
    const players = fairCheckpoint.state.players.map((player) =>
      player.participantId === fixture.localParticipantId
        ? {
            ...player,
            hand: player.hand.map((card, index) =>
              index === 0
                ? {
                    ...card,
                    cardId: asCardId('basic_fireball'),
                    baseCost: 4,
                    currentCost: 4,
                    instanceId: 'expert-hidden:hand:fireball-test'
                  }
                : card
            )
          }
        : player
    ) as unknown as typeof fairCheckpoint.state.players
    const checkpoint = {
      ...fairCheckpoint,
      state: { ...fairCheckpoint.state, players }
    }
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      fairHypothesis: true,
      budgetMs: 1_000
    })

    await api.decide({
      matchId: 'expert-sampled-opponent-play-match',
      requestId: 'expert-sampled-opponent-play-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    expect(api.getLastTrace()?.mctsProfile?.opponentActionsSimulated).toBeGreaterThan(0)
    expect(api.getLastTrace()?.mctsProfile?.opponentCardPlaysSimulated).toBeGreaterThan(
      0
    )
  }, 15_000)

  it('uses The Coin to develop a playable minion instead of only taking armor', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef4,
      aiHeroId: 'garrosh',
      opponentHeroId: 'guldan',
      aiHand: ['basic_the_coin', 'classic_faerie_dragon'],
      aiMana: 1,
      aiMaximumMana: 1,
      aiHealth: 30,
      aiHeroPowerAvailable: true,
      turnNumber: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false,
      opponentBoard: [{ cardId: 'basic_voidwalker', ready: false }]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5566778e
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const firstDecision = await api.decide({
      matchId: 'expert-coin-tempo-match',
      requestId: 'expert-coin-tempo-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })

    if (!('actionId' in firstDecision.choice))
      throw new Error('Expected an Expert action decision.')
    const firstActionId = firstDecision.choice.actionId
    const coin = actions.find((action) => action.id === firstActionId)
    expect(coin?.command.type).toBe('play-card')
    if (coin?.command.type !== 'play-card') throw new Error('Expected card play')
    const coinInstanceId = coin.command.cardInstanceId
    expect(
      session
        .findPlayer(session.getState(), session.remoteParticipantId)
        .hand.find((card) => card.instanceId === coinInstanceId)?.cardId
    ).toBe('basic_the_coin')
    const coinResult = session.match.dispatch(coin.command)
    expect(coinResult.accepted).toBe(true)

    const followUpLegal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const followUpActions = aiActions(session, followUpLegal)
    const followUpDecision = await api.decide({
      matchId: 'expert-coin-tempo-match',
      requestId: 'expert-coin-tempo-follow-up',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: followUpActions.map((action) => action.id)
    })
    if (!('actionId' in followUpDecision.choice))
      throw new Error('Expected an Expert follow-up action decision.')
    const followUpActionId = followUpDecision.choice.actionId
    const followUp = followUpActions.find((action) => action.id === followUpActionId)
    expect(followUp?.command.type).toBe('play-card')
    if (followUp?.command.type !== 'play-card') throw new Error('Expected card play')
    const followUpInstanceId = followUp.command.cardInstanceId
    expect(
      session
        .findPlayer(session.getState(), session.remoteParticipantId)
        .hand.find((card) => card.instanceId === followUpInstanceId)?.cardId
    ).toBe('classic_faerie_dragon')
  }, 15_000)

  it('avoids cumulative public attack lethal by playing a Taunt', async () => {
    const fixture = createAiFixture({
      seed: 0x5eef,
      aiHeroId: 'garrosh',
      opponentHeroId: 'jaina',
      aiHand: ['whispers_of_the_old_gods_bloodhoof_brave'],
      aiMana: 4,
      aiHealth: 17,
      aiHeroPowerAvailable: false,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true }
      ]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5566778a
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const response = await api.decide({
      matchId: 'expert-cumulative-public-attack-match',
      requestId: 'expert-cumulative-public-attack-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const selectedActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedActionId)
    if (!selected) throw new Error('Expert selected an unknown action.')
    expect(selected.command.type).toBe('play-card')
    if (selected.command.type !== 'play-card') return
    const selectedCommand = selected.command
    const selectedCard = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.instanceId === selectedCommand.cardInstanceId)
    expect(selectedCard?.cardId).toBe('whispers_of_the_old_gods_bloodhoof_brave')

    const endTurnTrace = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.type === 'end-turn')
    const selectedTrace = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.actionId === selectedActionId)
    expect(endTurnTrace?.meanValue).toBeDefined()
    expect(selectedTrace?.meanValue).toBeDefined()
    expect(endTurnTrace?.meanValue).toBeLessThan(selectedTrace?.meanValue ?? 1)
  }, 15_000)

  it('uses Vanish instead of partial removal against a lethal public board', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef7,
      aiHeroId: 'valeera',
      opponentHeroId: 'rexxar',
      aiHand: [
        'classic_argent_commander',
        'knights_of_the_frozen_throne_valeera_the_hollow',
        'journey_to_ungoro_bright_eyed_scout',
        'basic_backstab',
        'basic_vanish',
        'league_of_explorers_tomb_pillager',
        'whispers_of_the_old_gods_bladed_cultist'
      ],
      aiMana: 9,
      aiMaximumMana: 9,
      aiHealth: 11,
      aiHeroPowerAvailable: true,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHand: [
        'basic_acidic_swamp_ooze',
        'basic_fireball',
        'basic_frostbolt',
        'basic_arcane_intellect',
        'basic_mirror_image',
        'basic_fireball',
        'basic_acidic_swamp_ooze'
      ],
      opponentWeapon: { cardId: 'basic_wicked_knife', attack: 1, durability: 1 },
      opponentMaximumMana: 9,
      opponentBoard: [
        { cardId: 'knights_of_the_frozen_throne_the_lich_king', ready: true },
        {
          cardId: 'the_grand_tournament_injured_kvaldir',
          attack: 2,
          health: 1,
          ready: true
        },
        { cardId: 'classic_hyena', ready: true },
        {
          cardId: 'journey_to_ungoro_ornery_direhorn',
          attack: 6,
          health: 4,
          ready: true
        }
      ],
      turnNumber: 18
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5566778f
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, {
      profile: 'expert',
      fairHypothesis: true,
      workBudget: 256
    })

    const response = await api.decide({
      matchId: 'expert-vanish-lethal-defense-match',
      requestId: 'expert-vanish-lethal-defense-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const selectedActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedActionId)
    if (!selected) throw new Error('Expert selected an unknown action.')
    expect(selected.command.type).toBe('play-card')
    if (selected.command.type !== 'play-card') return
    const selectedCommand = selected.command
    const selectedCard = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.instanceId === selectedCommand.cardInstanceId)
    expect(
      selectedCard?.cardId,
      JSON.stringify(
        api
          .getLastTrace()
          ?.candidates.map((c) => ({
            action: c.description,
            value: c.recommendationValue,
            mean: c.meanValue,
            visits: c.visits
          }))
      )
    ).toBe('basic_vanish')
  }, 60_000)

  it('simulates attacks through a Taunt before choosing to end the turn', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef1,
      aiHeroId: 'garrosh',
      opponentHeroId: 'jaina',
      aiHand: [
        'whispers_of_the_old_gods_bloodhoof_brave',
        'whispers_of_the_old_gods_bloodhoof_brave'
      ],
      aiBoard: [{ cardId: 'basic_ironfur_grizzly', ready: false }],
      aiMana: 8,
      aiHealth: 12,
      aiHeroPowerAvailable: false,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true }
      ]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5566778b
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const response = await api.decide({
      matchId: 'expert-taunt-response-sequence-match',
      requestId: 'expert-taunt-response-sequence-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const selectedActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedActionId)
    if (!selected) throw new Error('Expert selected an unknown action.')
    expect(selected.command.type).toBe('play-card')
    if (selected.command.type !== 'play-card') return
    const selectedCommand = selected.command
    const selectedCard = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.instanceId === selectedCommand.cardInstanceId)
    expect(selectedCard?.cardId).toBe('whispers_of_the_old_gods_bloodhoof_brave')

    const trace = api.getLastTrace()
    expect(trace?.mctsProfile?.opponentActionsSimulated).toBeGreaterThan(0)
    const endTurnTrace = trace?.candidates.find(
      (candidate) => candidate.type === 'end-turn'
    )
    const selectedTrace = trace?.candidates.find(
      (candidate) => candidate.actionId === selectedActionId
    )
    expect(endTurnTrace?.meanValue).toBeLessThan(selectedTrace?.meanValue ?? 1)
  }, 15_000)

  it('projects multiple non-taunt public attacks in sequence', async () => {
    const endTurnScore = async (attackerCount: number): Promise<number> => {
      const fixture = createAiFixture({
        seed: 0x5ef3,
        aiHeroId: 'garrosh',
        opponentHeroId: 'jaina',
        aiHand: [],
        aiMana: 0,
        aiMaximumMana: 0,
        aiHealth: 30,
        aiHeroPowerAvailable: false,
        aiDeck: ['basic_acidic_swamp_ooze'],
        opponentDeck: ['basic_acidic_swamp_ooze'],
        opponentHeroPowerAvailable: false,
        opponentBoard: Array.from({ length: attackerCount }, () => ({
          cardId: 'basic_boulderfist_ogre',
          ready: true
        }))
      })
      const checkpoint = createFairHypothesisCheckpoint(
        fixture.checkpoint,
        fixture.aiParticipantId,
        0x5566778d
      )
      const session = new GameBoardSession({
        setup: checkpoint.setup,
        decks: checkpoint.decks,
        checkpoint
      })
      const legal = enumerateLegalCommands(
        {
          getState: () => session.getState(),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            session.match.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => session.match.getLegality!(participantId)
        },
        session.remoteParticipantId
      )
      const actions = aiActions(session, legal)
      const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
      await api.decide({
        matchId: `expert-public-attack-sequence-${attackerCount}`,
        requestId: `expert-public-attack-sequence-${attackerCount}`,
        expectedRevision: session.getState().revision,
        phase: 'action',
        allowInspection: false,
        messages: [],
        actionIds: actions.map((action) => action.id)
      })

      const trace = api.getLastTrace()
      expect(trace?.mctsProfile?.opponentActionsSimulated).toBeGreaterThan(0)
      const score = trace?.candidates.find(
        (candidate) => candidate.type === 'end-turn'
      )?.score
      if (score === undefined) throw new Error('Expected an end-turn candidate.')
      return score
    }

    const oneAttackerScore = await endTurnScore(1)
    const twoAttackerScore = await endTurnScore(2)
    expect(twoAttackerScore).toBeLessThan(oneAttackerScore)
  }, 15_000)

  it('accounts for a lethal public opponent hero-power reply', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef0,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiHand: ['classic_earthen_ring_farseer'],
      aiMana: 3,
      aiHealth: 1,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentMaximumMana: 2,
      opponentHeroPowerAvailable: true
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x55667789
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const response = await api.decide({
      matchId: 'expert-public-hero-power-match',
      requestId: 'expert-public-hero-power-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const selectedActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedActionId)
    if (!selected) throw new Error('Expert selected an unknown action.')
    expect(selected.command.type).toBe('play-card')
    if (selected.command.type !== 'play-card') return
    const selectedCommand = selected.command
    const selectedCard = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.instanceId === selectedCommand.cardInstanceId)
    expect(selectedCard?.cardId).toBe('classic_earthen_ring_farseer')
    expect(selectedCommand.targets).toContainEqual({
      kind: 'hero',
      participantId: fixture.aiParticipantId
    })

    const endTurnTrace = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.type === 'end-turn')
    expect(endTurnTrace).toBeDefined()
    const selectedTrace = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.actionId === selectedActionId)
    expect(endTurnTrace?.meanValue).toBeLessThan(selectedTrace?.meanValue ?? 1)
  })

  it('does not forecast face lethal from a public minion barred from attacking heroes', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef1,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: [],
      aiMana: 0,
      aiMaximumMana: 0,
      aiHealth: 3,
      aiHeroPowerAvailable: false,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentHeroPowerAvailable: false,
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 4,
          ready: true,
          keywords: ['cannot-attack-heroes']
        }
      ]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5566778a
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legalityComparison = session.match.analyze((fork) => {
      const ended = fork.dispatch({
        type: 'end-turn',
        participantId: session.remoteParticipantId
      })
      if (!ended.accepted) throw new Error('Expected the fixture turn to end.')
      const attackerId = fork.getState().activePlayerId!
      return {
        attackOnly: fork.getAttackLegality?.(attackerId),
        full: fork.getLegality(attackerId)
      }
    })
    expect(legalityComparison.attackOnly).toEqual({
      legalAttackerInstanceIds: legalityComparison.full.legalAttackerInstanceIds,
      legalAttackTargets: legalityComparison.full.legalAttackTargets
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const response = await api.decide({
      matchId: 'expert-cannot-attack-heroes-match',
      requestId: 'expert-cannot-attack-heroes-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')

    const endTurn = api
      .getLastTrace()
      ?.candidates.find((candidate) => candidate.type === 'end-turn')
    expect(endTurn).toBeDefined()
    expect(endTurn?.score).toBeGreaterThan(-500_000)
  })

  it('prefers a predicted turn loss over an immediately terminal attack', async () => {
    const fixture = createAiFixture({
      seed: 0x5ef2,
      aiHeroId: 'garrosh',
      opponentHeroId: 'jaina',
      aiHealth: 1,
      aiHeroPowerAvailable: false,
      aiWeapon: { cardId: 'one_night_in_karazhan_fools_bane' },
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      opponentBoard: [{ cardId: 'basic_core_hound', ready: true }]
    })
    const checkpoint = createFairHypothesisCheckpoint(
      fixture.checkpoint,
      fixture.aiParticipantId,
      0x5566778c
    )
    const session = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const legal = enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => session.match.getLegality!(participantId)
      },
      session.remoteParticipantId
    )
    const actions = aiActions(session, legal)
    const api = new LocalAiDecisionApi(session, undefined, { profile: 'expert' })
    const response = await api.decide({
      matchId: 'expert-terminal-loss-ordering-match',
      requestId: 'expert-terminal-loss-ordering-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((action) => action.id)
    })
    if (!('actionId' in response.choice))
      throw new Error('Expected an Expert action decision.')
    const chosenActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === chosenActionId)
    if (!selected) throw new Error('Expert selected an unknown action.')
    expect(selected.command.type).toBe('end-turn')

    const trace = api.getLastTrace()
    const endTurnScore = trace?.candidates.find(
      (candidate) => candidate.type === 'end-turn'
    )?.score
    const attackScores = trace?.candidates
      .filter((candidate) => candidate.type === 'attack-character')
      .map((candidate) => candidate.score)
    expect(attackScores).toBeDefined()
    expect(attackScores?.length).toBeGreaterThan(0)
    expect(endTurnScore).toBeGreaterThan(Math.max(...(attackScores ?? [])))
  })

  it('restarts a failed worker and cancels its pending request cleanly', async () => {
    const fixture = createAiFixture({
      seed: 0x5eed,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const makeWorker = () => {
      const listeners = new Map<string, (event: unknown) => void>()
      const posted: ExpertAiWorkerRequest[] = []
      let terminated = false
      const worker = {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          if (typeof listener === 'function')
            listeners.set(type, listener as (event: unknown) => void)
        },
        postMessage(message: ExpertAiWorkerRequest) {
          posted.push(message)
        },
        terminate() {
          terminated = true
        }
      } as unknown as Worker
      return {
        worker,
        posted,
        emit(type: string, event: unknown) {
          listeners.get(type)?.(event)
        },
        isTerminated: () => terminated
      }
    }
    const firstWorker = makeWorker()
    const secondWorker = makeWorker()
    const workers = [firstWorker, secondWorker]
    let workerIndex = 0
    const api = new ExpertAiDecisionApi(session, () => workers[workerIndex++]!.worker)
    const firstRequest: AiDecisionRequest = {
      matchId: 'expert-worker-restart-match',
      requestId: 'expert-worker-crash-request',
      expectedRevision: session.getState().revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: ['a0']
    }
    const firstPending = api.decide(firstRequest)
    const firstRejection = expect(firstPending).rejects.toThrow(
      'simulated worker crash'
    )
    firstWorker.emit('error', {
      message: 'simulated worker crash',
      currentTarget: firstWorker.worker
    } as unknown as ErrorEvent)
    await firstRejection
    expect(firstWorker.isTerminated()).toBe(true)

    const secondRequest = {
      ...firstRequest,
      requestId: 'expert-worker-cancel-request'
    }
    const secondPending = api.decide(secondRequest)
    expect(secondWorker.posted.some((message) => message.type === 'decide')).toBe(true)
    const secondRejection = expect(secondPending).rejects.toThrow(
      'AI request cancelled.'
    )
    await api.cancel(secondRequest)
    await secondRejection
    expect(secondWorker.posted.some((message) => message.type === 'cancel')).toBe(true)
    api.dispose()
  })
})
