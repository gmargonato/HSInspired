import { describe, expect, it, vi } from 'vitest'
import type {
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject
} from '../../../desktop/contracts/ipc/ai'
import {
  sameAiIntent,
  type AiActionIntent
} from '../../../desktop/contracts/ipc/ai-deliberation'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game-rules/match'
import { asCardId } from '../../../game-rules/content/cards'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import {
  EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
  EXPERT_AI_SEARCH_BUDGET_MS,
  ExpertAiDecisionApi
} from './expert-ai-decision-api'
import { GameBoardSession } from '../game-board-session'
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
  it('replans a cached zero-value heal and records the rejection', async () => {
    const fixture = createAiFixture({
      seed: 100506,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiMana: 6,
      aiHand: ['basic_chillwind_yeti']
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
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
          session.remoteParticipantId
        )
      )
    const play = actions().find((a) => a.command.type === 'play-card')!
    const heal = actions().find(
      (a) =>
        a.command.type === 'use-hero-power' &&
        a.command.target?.kind === 'hero' &&
        a.command.target.participantId === session.remoteParticipantId
    )!
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    let calls = 0
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        const selected =
          calls++ === 0 ? play : actions().find((a) => a.command.type === 'end-turn')!
        const response: AiDecisionResponse = {
          matchId: message.request.matchId,
          requestId: message.request.requestId,
          expectedRevision: message.request.expectedRevision,
          modelId: 'hardware-local-v2',
          reason: 'Fixture line.',
          durationMs: 0,
          finishReason: 'fixture',
          choice: {
            actionId: selected.id,
            intent: aiActionIntent(selected.command, session.localParticipantId),
            expectedResult: 'Fixture.',
            planUpdate: null
          },
          usage: {
            plannedActionIntents: [play, heal].map((a) =>
              aiActionIntent(a.command, session.localParticipantId)
            )
          } as unknown as JsonObject
        }
        receive?.({
          data: { type: 'decision', requestId: message.request.requestId, response }
        } as MessageEvent<ExpertAiWorkerResponse>)
      },
      terminate() {}
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(session, () => worker)
    const request = (id: string): AiDecisionRequest => ({
      matchId: 'october',
      requestId: id,
      phase: 'action',
      expectedRevision: session.getState().revision,
      allowInspection: false,
      messages: [],
      actionIds: actions().map((a) => a.id)
    })
    try {
      await api.decide(request('first'))
      expect(session.match.dispatch(play.command).accepted).toBe(true)
      const response = await api.decide(request('second'))
      expect(calls).toBe(2)
      expect(response.usage?.continuationRejection).toBe('no-payoff')
      expect(response.finishReason).not.toBe('expert-continuation')
    } finally {
      api.dispose()
    }
  })
  it('keeps proven wins ahead of positional scores and preserves their sequence across worlds', () => {
    const candidate = (actionId: string, score: number, provenWin = false) => ({
      actionId,
      type: 'attack-character',
      description: actionId,
      score,
      recommendationValue: score,
      provenWin,
      accepted: true,
      outcome: provenWin ? 'win' : 'ongoing',
      recommendationTacticalPenalty: provenWin ? 100 : 0
    })
    const results = [
      {
        response: { choice: { actionId: 'win' } },
        trace: {
          chosenActionId: 'win',
          chosenSequence: ['Win now'],
          candidates: [candidate('win', -0.9, true), candidate('board', 0.99)]
        }
      },
      {
        response: { choice: { actionId: 'board' } },
        trace: {
          chosenActionId: 'board',
          candidates: [candidate('win', -0.9), candidate('board', 0.99)]
        }
      }
    ] as unknown as Parameters<typeof chooseExpertConsensus>[0]
    const result = chooseExpertConsensus(results, ['win', 'board'])
    expect(result.actionId).toBe('win')
    expect(result.scores.get('win')?.trace?.sequence).toEqual(['Win now'])
  })

  it('ranks a demonstrated terminal loss below an ongoing position regardless of soft penalties', () => {
    const results = [
      {
        response: { choice: { actionId: 'loss' } },
        trace: {
          candidates: [
            { actionId: 'loss', accepted: true, outcome: 'loss', score: -1 },
            { actionId: 'continue', accepted: true, outcome: 'ongoing', score: -5 }
          ]
        }
      }
    ] as unknown as Parameters<typeof chooseExpertConsensus>[0]
    expect(chooseExpertConsensus(results, ['loss', 'continue']).actionId).toBe(
      'continue'
    )
  })
  it('prioritizes escaping a demonstrated public lethal over soft position scores', () => {
    const results = [
      {
        response: { choice: { actionId: 'greed' } },
        trace: {
          candidates: [
            {
              actionId: 'greed',
              accepted: true,
              outcome: 'ongoing',
              publicReply: 'lethal',
              score: 1
            },
            {
              actionId: 'defend',
              accepted: true,
              outcome: 'ongoing',
              publicReply: 'clear',
              score: -5
            }
          ]
        }
      }
    ] as unknown as Parameters<typeof chooseExpertConsensus>[0]
    expect(chooseExpertConsensus(results, ['greed', 'defend']).actionId).toBe('defend')
  })

  it('retains the safer continuation when another world finds a losing line with the same first action', () => {
    const results = ['clear', 'lethal'].map((publicReply) => ({
      response: { choice: { actionId: 'setup' } },
      trace: {
        chosenActionId: 'setup',
        chosenSequence:
          publicReply === 'clear' ? ['Setup', 'Defend'] : ['Setup', 'Pass'],
        candidates: [
          {
            actionId: 'setup',
            accepted: true,
            outcome: 'ongoing',
            publicReply,
            score: 0
          }
        ]
      }
    })) as unknown as Parameters<typeof chooseExpertConsensus>[0]
    const score = chooseExpertConsensus(results, ['setup']).scores.get('setup')
    expect(score?.publicLethal).toBe(false)
    expect(score?.trace?.sequence).toEqual(['Setup', 'Defend'])
  })

  describe('root-supported continuation boundaries', () => {
    const intent = (source: string, position: number | null = null) => ({
      type: source === 'attacker' ? 'attack-character' : 'play-card',
      source,
      targets: source === 'attacker' ? ['opponent:hero'] : [],
      position,
      option: null
    })
    const world = (
      chosen: string,
      line: ReturnType<typeof intent>[],
      extra: Record<string, unknown> = {}
    ) => ({
      response: { choice: { actionId: chosen } },
      trace: {
        chosenActionId: chosen,
        chosenSequence: line.map((entry) => entry.source),
        candidates: [
          {
            actionId: 'root',
            description: 'Root',
            accepted: true,
            outcome: 'ongoing',
            publicReply: 'unknown',
            score: 0.7,
            visits: 20,
            meanValue: 0.7,
            recommendationValue: 0.7,
            sequenceIntents: line,
            ...extra
          },
          { actionId: 'other', accepted: true, outcome: 'ongoing', score: 0 }
        ]
      }
    })
    const choose = (results: ReturnType<typeof world>[]) =>
      chooseExpertConsensus(
        results as unknown as Parameters<typeof chooseExpertConsensus>[0],
        ['root', 'other']
      )

    it('replans an orphaned dissenting-world tail without changing root scores or votes', () => {
      const attack = intent('attacker')
      const results = [
        world('root', [attack, intent('develop', 0)]),
        world('root', [attack, intent('develop', 1)]),
        world('other', [attack, intent('bounce')])
      ]
      const original = structuredClone(results)
      const result = choose(results)
      expect(result.actionId).toBe('root')
      expect(result.scores.get('root')?.votes).toBe(2)
      expect(result.scores.get('root')?.samples).toBe(3)
      expect(result.scores.get('root')?.score).toBeCloseTo(2.1)
      expect(result.scores.get('root')?.trace?.sequenceIntents).toEqual([
        attack,
        intent('bounce')
      ])
      expect(result.scores.get('root')?.trace?.reconsiderAfterPrefix).toBe(1)
      expect(results).toEqual(original)
    })

    it('retains the entire line when any recommending world supports it exactly', () => {
      const line = [intent('attacker'), intent('develop', 0)]
      const result = choose([
        world('root', line),
        world('root', [intent('attacker'), intent('develop', 1)]),
        world('other', line)
      ])
      expect(result.scores.get('root')?.trace?.sequenceIntents).toEqual(line)
    })

    it('keeps existing single-world and singly endorsed continuations', () => {
      const line = [intent('attacker'), intent('bounce')]
      for (const results of [
        [world('root', line)],
        [
          world('root', [intent('attacker'), intent('develop')]),
          world('other', line),
          world('other', line)
        ]
      ])
        expect(choose(results).scores.get('root')?.trace?.sequenceIntents).toEqual(line)
    })

    it('retains an exact longer common prefix but does not merge different positions', () => {
      const prefix = [
        intent('attacker'),
        { ...intent('attacker'), source: 'second-attacker' }
      ]
      const result = choose([
        world('root', [...prefix, intent('develop', 0)]),
        world('root', [...prefix, intent('develop', 1)]),
        world('other', [...prefix, intent('bounce')])
      ])
      expect(result.scores.get('root')?.trace?.sequenceIntents).toEqual([
        ...prefix,
        intent('bounce')
      ])
      expect(result.scores.get('root')?.trace?.reconsiderAfterPrefix).toBe(2)
    })

    it.each(['play-card', 'use-hero-power'])(
      'does not reconsider a shared %s setup, alone or after an attack',
      (type) => {
        const setup = { ...intent('setup'), type }
        for (const prefix of [[setup], [intent('attacker'), setup]]) {
          const line = [...prefix, intent('payoff')]
          const result = choose([
            world('root', [...prefix, intent('alternative', 0)]),
            world('root', [...prefix, intent('alternative', 1)]),
            world('other', line)
          ])
          expect(result.scores.get('root')?.trace?.sequenceIntents).toEqual(line)
          expect(
            result.scores.get('root')?.trace?.reconsiderAfterPrefix
          ).toBeUndefined()
          expect(result.scores.get('root')?.votes).toBe(2)
        }
      }
    )

    it('preserves stronger verified-win and public-defense continuations', () => {
      const winning = [intent('attacker'), intent('win')]
      const win = choose([
        world('root', [intent('attacker'), intent('develop')]),
        world('root', [intent('attacker'), intent('other-development')]),
        world('other', winning, { provenWin: true, outcome: 'win' })
      ])
      expect(win.scores.get('root')?.trace?.sequenceIntents).toEqual(winning)
      const defense = [intent('attacker'), intent('defend')]
      const safe = choose([
        world('root', [intent('attacker'), intent('greed')], { publicReply: 'lethal' }),
        world('root', [intent('attacker'), intent('greed')], { publicReply: 'lethal' }),
        world('other', defense, { publicReply: 'clear' })
      ])
      expect(safe.scores.get('root')?.trace?.sequenceIntents).toEqual(defense)
    })

    it('retains a complete clear-defense line while requesting a budgeted reconsideration', () => {
      const line = [intent('attacker'), intent('defend')]
      const result = choose([
        world('root', [intent('attacker'), intent('develop')]),
        world('root', [intent('attacker'), intent('other-development')]),
        world('other', line, { publicReply: 'clear' })
      ])
      expect(result.scores.get('root')?.trace?.sequenceIntents).toEqual(line)
      expect(result.scores.get('root')?.trace?.publicReply).toBe('clear')
      expect(result.scores.get('root')?.trace?.reconsiderAfterPrefix).toBe(1)
    })

    it('does not count rejected candidates as continuation endorsements', () => {
      const line = [intent('attacker'), intent('bounce')]
      const result = choose([
        world('root', [intent('attacker'), intent('develop')]),
        world('root', [intent('attacker'), intent('develop')], { accepted: false }),
        world('other', line)
      ])
      expect(result.scores.get('root')?.trace?.sequenceIntents).toEqual(line)
    })
  })

  it.each([
    'normal',
    'action-entry',
    'wall-exhausted',
    'search-exhausted',
    'exact-reserve',
    'throw',
    'failure',
    'failure-progress',
    'timeout',
    'mismatched-line',
    'card-setup-prefix',
    'power-setup-prefix',
    'construction-failure'
  ])(
    'keeps a bound continuation backup during consensus reconsideration: %s',
    async (mode) => {
      const fixture = createAiFixture({
        seed: 813,
        aiHeroId: 'valeera',
        opponentHeroId: 'garrosh',
        turnNumber: 5,
        aiMana: mode === 'power-setup-prefix' ? 4 : 3,
        aiMaximumMana: mode === 'power-setup-prefix' ? 4 : 3,
        aiHeroPowerCost: 2,
        aiHand: [
          'basic_sap',
          'classic_earthen_ring_farseer',
          ...(mode === 'card-setup-prefix' ? ['classic_preparation'] : [])
        ],
        aiBoard: [{ cardId: 'classic_bloodmage_thalnos', ready: true }],
        opponentBoard: [{ cardId: 'classic_acolyte_of_pain', ready: true }],
        aiDeck: ['basic_chillwind_yeti'],
        opponentDeck: ['basic_chillwind_yeti']
      })
      const session = new GameBoardSession({
        setup: fixture.setup,
        decks: fixture.decks,
        checkpoint: fixture.checkpoint
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
            session.remoteParticipantId
          )
        )
      const attack = actions().find((a) => {
        if (mode === 'power-setup-prefix') return a.command.type === 'use-hero-power'
        if (mode === 'card-setup-prefix') {
          const preparation = session
            .getState()
            .players.find((p) => p.participantId === session.remoteParticipantId)!
            .hand.find((card) => card.cardId === 'classic_preparation')!
          return (
            a.command.type === 'play-card' &&
            a.command.cardInstanceId === preparation.instanceId
          )
        }
        return (
          a.command.type === 'attack-character' && a.command.defender.kind === 'hero'
        )
      })!
      const hand = session
        .getState()
        .players.find((p) => p.participantId === session.remoteParticipantId)!.hand
      const sapId = hand.find((c) => c.cardId === 'basic_sap')!.instanceId
      const farseerId = hand.find(
        (c) => c.cardId === 'classic_earthen_ring_farseer'
      )!.instanceId
      const sap = actions().find(
        (a) => a.command.type === 'play-card' && a.command.cardInstanceId === sapId
      )!
      const line = [attack, sap].map((a) =>
        aiActionIntent(a.command, session.localParticipantId)
      )
      const annotationLine = structuredClone(line)
      if (mode === 'mismatched-line')
        annotationLine[1] = { ...annotationLine[1]!, source: farseerId }
      let now = 0
      let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
      let workerError: ((event: ErrorEvent) => void) | undefined
      let factoryCalls = 0
      const posted: Extract<ExpertAiWorkerRequest, { type: 'decide' }>[] = []
      const worker = {
        addEventListener(type: string, listener: unknown) {
          if (type === 'message') receive = listener as typeof receive
          if (type === 'error') workerError = listener as typeof workerError
        },
        postMessage(message: ExpertAiWorkerRequest) {
          if (message.type !== 'decide') return
          posted.push(message)
          const first = posted.length === 1
          const selected = first
            ? attack
            : actions().find(
                (a) =>
                  a.command.type === 'play-card' &&
                  a.command.cardInstanceId === farseerId &&
                  a.command.targets?.some(
                    (t) =>
                      t.kind === 'hero' &&
                      t.participantId === session.remoteParticipantId
                  )
              )!
          const selectedIntent = aiActionIntent(
            selected.command,
            session.localParticipantId
          )
          const response: AiDecisionResponse = {
            matchId: message.request.matchId,
            requestId: message.request.requestId,
            expectedRevision: message.request.expectedRevision,
            modelId: 'hardware-local-v2',
            reason: 'Bounded continuation fixture.',
            durationMs: 0,
            finishReason: 'fixture',
            choice:
              message.request.phase === 'plan'
                ? {
                    plan: {
                      firstActionId: selected.id,
                      objective: 'Fixture',
                      winCheck: 'None',
                      lossRisk: 'Fixture',
                      candidates: [
                        {
                          sequence: ['Attack', 'Sap'],
                          budget: 'Fixture',
                          endPosition: 'Fixture',
                          opponentReply: 'Fixture'
                        }
                      ],
                      preferred: 0,
                      checks: []
                    }
                  }
                : {
                    actionId: selected.id,
                    intent: selectedIntent,
                    expectedResult: 'Fixture',
                    planUpdate: null
                  },
            usage: (first
              ? {
                  plannedActionIntents: line,
                  continuationReconsideration: {
                    prefixLength: 1,
                    actions: annotationLine
                  }
                }
              : { plannedActionIntents: [selectedIntent] }) as unknown as JsonObject
          }
          if (!first) {
            expect(message.preferredContinuation).toBeUndefined()
            if (mode === 'throw') throw new Error('Fixture worker failure')
            if (mode === 'timeout') return
            if (mode === 'failure-progress')
              receive?.({
                data: {
                  type: 'progress',
                  requestId: message.request.requestId,
                  response,
                  recommendationValue: 0.9,
                  worldIndex: 0,
                  iterations: 1
                }
              } as MessageEvent<ExpertAiWorkerResponse>)
            if (mode === 'failure' || mode === 'failure-progress') {
              receive?.({
                data: {
                  type: 'failure',
                  requestId: message.request.requestId,
                  error: 'Fixture worker failure'
                }
              } as MessageEvent<ExpertAiWorkerResponse>)
              return
            }
          }
          receive?.({
            data: { type: 'decision', requestId: message.request.requestId, response }
          } as MessageEvent<ExpertAiWorkerResponse>)
        },
        terminate() {}
      } as unknown as Worker
      if (mode === 'timeout') vi.useFakeTimers()
      const api = new ExpertAiDecisionApi(
        session,
        () => {
          factoryCalls++
          if (mode === 'construction-failure' && factoryCalls > 1) {
            now += 7
            throw new Error('Fixture replacement worker construction failure')
          }
          return worker
        },
        () => now
      )
      const request = (
        id: string,
        phase: 'plan' | 'action' = 'action'
      ): AiDecisionRequest => ({
        matchId: 'consensus-boundary',
        requestId: id,
        phase,
        expectedRevision: session.getState().revision,
        allowInspection: false,
        messages: [],
        actionIds: actions().map((a) => a.id)
      })
      try {
        const before = session.match.getCheckpoint()
        await api.decide(request('first', mode === 'action-entry' ? 'action' : 'plan'))
        if (mode !== 'action-entry') {
          const commit = await api.decide(request('commit'))
          expect('actionId' in commit.choice && commit.choice.actionId).toBe(attack.id)
        }
        expect(session.match.getCheckpoint()).toEqual(before)
        expect(posted).toHaveLength(1)
        expect(session.dispatch(attack.command).accepted).toBe(true)
        if (mode === 'construction-failure')
          workerError?.({
            currentTarget: worker,
            message: 'Worker crashed between actions'
          } as unknown as ErrorEvent)
        if (mode === 'wall-exhausted') now = 60_000
        if (mode === 'exact-reserve') now = EXPERT_AI_SEARCH_BUDGET_MS - 4_000
        if (mode === 'search-exhausted')
          (api as unknown as { searchUsedMs: number }).searchUsedMs =
            EXPERT_AI_SEARCH_BUDGET_MS
        const pending = api.decide(request('second'))
        if (mode === 'timeout') {
          now = 60_000
          await vi.advanceTimersByTimeAsync(60_000)
        }
        const response = await pending
        const selected = actions().find(
          (a) => 'actionId' in response.choice && a.id === response.choice.actionId
        )!
        const fresh = mode === 'normal' || mode === 'action-entry'
        expect(
          selected.command.type === 'play-card' && selected.command.cardInstanceId
        ).toBe(fresh ? farseerId : sapId)
        expect(posted).toHaveLength(
          [
            'wall-exhausted',
            'search-exhausted',
            'exact-reserve',
            'mismatched-line',
            'card-setup-prefix',
            'power-setup-prefix',
            'construction-failure'
          ].includes(mode)
            ? 1
            : 2
        )
        expect(response.usage?.continuationReconsideration).toBeUndefined()
        if (mode === 'construction-failure') {
          expect(factoryCalls).toBe(2)
          expect(
            (api as unknown as { searchUsedMs: number }).searchUsedMs
          ).toBeGreaterThanOrEqual(7)
          expect(response.durationMs).toBeGreaterThanOrEqual(7)
        }
        expect(session.dispatch(selected.command).accepted).toBe(true)
      } finally {
        api.dispose()
        if (mode === 'timeout') vi.useRealTimers()
      }
    }
  )

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
      expect(EXPERT_AI_TURN_BUDGET_MS).toBe(60_000)
      expect(EXPERT_AI_SEARCH_BUDGET_MS).toBe(54_500)
      expect(EXPERT_AI_DECISION_SEARCH_BUDGET_MS).toBe(46_500)
      expect(expertAiBudgetForTurn(10_000)).toMatchObject({
        turnBudgetMs: 10_000,
        searchBudgetMs: 4_500,
        decisionSearchBudgetMs: 3_000,
        planSearchLimitMs: 2_000,
        replanSearchLimitMs: 1_000
      })
      expect(message.remainingSearchBudgetMs).toBeLessThanOrEqual(46_500)
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
      expect(decisionsPosted[1]?.remainingSearchBudgetMs).toBe(8_000)

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
        Math.min(
          EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
          EXPERT_AI_SEARCH_BUDGET_MS - 7_200
        )
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
        api.getLastTrace()?.candidates.map((c) => ({
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

it.each([
  ['action', 'refresh'],
  ['plan', 'refresh'],
  ['action', 'buff'],
  ['plan', 'buff']
] as const)(
  'repairs a committed %s/%s pair and retains it after search exhaustion',
  async (phase, kind) => {
    const fixture = createAiFixture({
      seed: 613,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiMana: 2,
      aiHand: kind === 'buff' ? ['basic_deadly_poison'] : [],
      aiWeapon: { cardId: 'basic_wicked_knife', durability: kind === 'buff' ? 2 : 1 },
      opponentHealth: 12,
      opponentArmor: 9,
      opponentBoard: [{ cardId: 'whispers_of_the_old_gods_ravaging_ghoul', health: 3 }]
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
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
          session.remoteParticipantId
        )
      )
    const setup = actions().find(
      (action) =>
        action.command.type === (kind === 'buff' ? 'play-card' : 'use-hero-power')
    )!
    const attack = actions().find(
      (action) =>
        action.command.type === 'attack-character' &&
        action.command.defender.kind === (kind === 'buff' ? 'hero' : 'minion')
    )!
    const first = kind === 'buff' ? attack : setup
    const second = kind === 'buff' ? setup : attack
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    let calls = 0
    let original: AiDecisionResponse | undefined
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        calls++
        original = {
          ...message.request,
          modelId: 'hardware-local-v2',
          reason: 'Recorded pair.',
          durationMs: 0,
          finishReason: 'fixture',
          choice:
            phase === 'plan'
              ? {
                  plan: {
                    objective: 'Recorded pair.',
                    winCheck: 'No proven win.',
                    lossRisk: 'Test.',
                    candidates: [
                      {
                        sequence: [first.description, second.description],
                        budget: 'Two mana.',
                        endPosition: 'Weapon retained.',
                        opponentReply: 'Unknown.'
                      }
                    ],
                    preferred: 0,
                    firstActionId: first.id,
                    checks: []
                  }
                }
              : {
                  actionId: first.id,
                  intent: aiActionIntent(first.command, session.localParticipantId),
                  expectedResult: 'Test.',
                  planUpdate: null
                },
          usage: {
            plannedActionIntents: [first, second].map((action) =>
              aiActionIntent(action.command, session.localParticipantId)
            )
          } as unknown as JsonObject
        }
        receive?.({
          data: {
            type: 'decision',
            requestId: message.request.requestId,
            response: original
          }
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
      requestId: string,
      requestPhase: 'action' | 'plan' = 'action'
    ): AiDecisionRequest => ({
      matchId: 'refresh-order',
      requestId,
      phase: requestPhase,
      expectedRevision: session.getState().revision,
      allowInspection: false,
      messages: [],
      actionIds: actions().map((action) => action.id)
    })
    try {
      let response = await api.decide(request('first', phase))
      expect(response.usage?.actionOutcomeReason).toBe(
        kind === 'buff'
          ? 'committed-attack-setup-order'
          : 'committed-weapon-refresh-order'
      )
      expect(
        'plan' in original!.choice
          ? original!.choice.plan.firstActionId
          : 'actionId' in original!.choice
            ? original!.choice.actionId
            : null
      ).toBe(first.id)
      ;(api as unknown as { searchUsedMs: number }).searchUsedMs =
        EXPERT_AI_SEARCH_BUDGET_MS
      if (phase === 'plan') response = await api.decide(request('cached'))
      expect(response.choice).toMatchObject({ actionId: second.id })
      expect(session.dispatch(second.command).accepted).toBe(true)
      response = await api.decide(request('continue'))
      const next = actions().find(
        (action) =>
          'actionId' in response.choice && action.id === response.choice.actionId
      )!
      expect(next.command).toEqual(first.command)
      expect(session.dispatch(next.command).accepted).toBe(true)
      expect(
        session
          .getState()
          .players.find(
            (player) => player.participantId === session.remoteParticipantId
          )!.weapon!.durability
      ).toBe(kind === 'buff' ? 1 : 2)
      if (kind === 'buff')
        expect(
          session
            .getState()
            .players.find(
              (player) => player.participantId === session.localParticipantId
            )!.hero.armor
        ).toBe(6)
      expect(calls).toBe(1)
    } finally {
      api.dispose()
    }
  }
)

it.each(['action', 'plan'] as const)(
  'recovers a committed minion attack through %s and an exhausted cache',
  async (phase) => {
    const f = createAiFixture({
      seed: 613,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiMana: 1,
      aiHand: ['classic_southsea_deckhand'],
      aiWeapon: { cardId: 'basic_wicked_knife', durability: 1 },
      opponentHealth: 12,
      opponentArmor: 9
    })
    const session = new GameBoardSession({
      setup: f.setup,
      decks: f.decks,
      checkpoint: f.checkpoint
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
          session.remoteParticipantId
        )
      )
    const attack = actions().find(
      (a) =>
        a.command.type === 'attack-character' &&
        a.command.attacker.kind === 'hero' &&
        a.command.defender.kind === 'hero'
    )!
    const play = actions().find((a) => a.command.type === 'play-card')!
    const end = actions().find((a) => a.command.type === 'end-turn')!
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
    let calls = 0
    let original: AiDecisionResponse | undefined
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        calls++
        original = {
          ...message.request,
          modelId: 'hardware-local-v2',
          reason: 'Full selected line.',
          durationMs: 0,
          finishReason: 'fixture',
          choice:
            phase === 'plan'
              ? {
                  plan: {
                    objective: 'Test',
                    winCheck: 'No win',
                    lossRisk: 'Test',
                    candidates: [
                      {
                        sequence: [
                          attack.description,
                          play.description,
                          end.description
                        ],
                        budget: 'One mana',
                        endPosition: 'Test',
                        opponentReply: 'Unknown'
                      }
                    ],
                    preferred: 0,
                    firstActionId: attack.id,
                    checks: []
                  }
                }
              : {
                  actionId: attack.id,
                  intent: aiActionIntent(attack.command, session.localParticipantId),
                  expectedResult: 'Test',
                  planUpdate: null
                },
          usage: {
            plannedActionIntents: [attack, play, end].map((a) =>
              aiActionIntent(a.command, session.localParticipantId)
            )
          } as unknown as JsonObject
        }
        receive?.({
          data: {
            type: 'decision',
            requestId: message.request.requestId,
            response: original
          }
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
      requestId: string,
      requestPhase: 'action' | 'plan' = 'action'
    ): AiDecisionRequest => ({
      matchId: 'complete-order',
      requestId,
      phase: requestPhase,
      expectedRevision: session.getState().revision,
      allowInspection: false,
      messages: [],
      actionIds: actions().map((a) => a.id)
    })
    try {
      let response = await api.decide(request('first', phase))
      expect(response.usage?.actionOutcomeReason).toBe(
        'committed-expiring-minion-attack'
      )
      expect(
        'plan' in original!.choice
          ? original!.choice.plan.firstActionId
          : 'actionId' in original!.choice
            ? original!.choice.actionId
            : null
      ).toBe(attack.id)
      ;(api as unknown as { searchUsedMs: number }).searchUsedMs =
        EXPERT_AI_SEARCH_BUDGET_MS
      if (phase === 'plan') response = await api.decide(request('cached'))
      expect(response.choice).toMatchObject({ actionId: play.id })
      expect(session.dispatch(play.command).accepted).toBe(true)
      for (const kind of ['minion', 'hero']) {
        response = await api.decide(request('continue-' + kind))
        const chosen = actions().find(
          (a) => 'actionId' in response.choice && a.id === response.choice.actionId
        )!
        expect(chosen.command).toMatchObject({
          type: 'attack-character',
          attacker: { kind },
          defender: { kind: 'hero' }
        })
        expect(session.dispatch(chosen.command).accepted).toBe(true)
      }
      expect(
        session
          .getState()
          .players.find((p) => p.participantId === session.localParticipantId)!.hero
          .armor
      ).toBe(6)
      expect(calls).toBe(1)
    } finally {
      api.dispose()
    }
  }
)

it.each([
  'replan-hold',
  'replan-attack',
  'fresh',
  'exhausted',
  'restricted',
  'verified'
] as const)('keeps the all-outcome cache gate conditional: %s', async (mode) => {
  const fixture = createAiFixture({
    seed: 613,
    aiHeroId: 'valeera',
    opponentHeroId: 'garrosh',
    aiMana: 1,
    aiHeroPowerAvailable: false,
    aiHand: ['classic_preparation', 'goblins_vs_gnomes_tinkers_sharpsword_oil'],
    aiBoard: [{ cardId: 'classic_violet_teacher' }, { cardId: 'basic_chillwind_yeti' }],
    aiWeapon: { cardId: 'basic_wicked_knife', durability: 2 },
    opponentHealth: 12,
    opponentArmor: 12
  })
  const session = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
  const own = session
    .getState()
    .players.find((p) => p.participantId === session.remoteParticipantId)!
  expect(
    session.dispatch({
      type: 'play-card',
      participantId: session.remoteParticipantId,
      cardInstanceId: own.hand.find((c) => c.cardId === 'classic_preparation')!
        .instanceId
    }).accepted
  ).toBe(true)
  const actions = aiActions(
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
  const attack = actions.find(
    (a) =>
      a.command.type === 'attack-character' &&
      a.command.attacker.kind === 'hero' &&
      a.command.defender.kind === 'hero'
  )!
  const pass = actions.find((a) => a.command.type === 'end-turn')!
  const oil = actions.find((a) => a.command.type === 'play-card')!
  let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined,
    calls = 0
  const worker = {
    addEventListener(type: string, listener: unknown) {
      if (type === 'message') receive = listener as typeof receive
    },
    removeEventListener() {},
    terminate() {},
    postMessage(message: ExpertAiWorkerRequest) {
      if (message.type !== 'decide') return
      calls++
      const selected = mode === 'replan-attack' ? attack : pass
      const response: AiDecisionResponse = {
        ...message.request,
        modelId: 'hardware-local-v2',
        reason: 'Independent worker strategy',
        durationMs: 1,
        finishReason: 'fixture-search',
        choice: {
          actionId: selected.id,
          intent: aiActionIntent(selected.command, session.localParticipantId),
          expectedResult: 'Worker choice',
          planUpdate: null
        },
        usage: {
          plannedActionIntents: [
            aiActionIntent(selected.command, session.localParticipantId)
          ]
        } as unknown as JsonObject
      }
      receive?.({
        data: { type: 'decision', requestId: message.request.requestId, response }
      } as MessageEvent<ExpertAiWorkerResponse>)
    }
  } as unknown as Worker
  const api = new ExpertAiDecisionApi(
    session,
    () => worker,
    () => 0
  )
  const request: AiDecisionRequest = {
    matchId: 'chance-gate',
    requestId: 'chance-gate:54',
    phase: 'action',
    expectedRevision: session.getState().revision,
    allowInspection: false,
    messages: [],
    actionIds: actions
      .filter((a) => mode !== 'restricted' || a.id !== oil.id)
      .map((a) => a.id)
  }
  const internal = api as unknown as { continuation: unknown; searchUsedMs: number }
  if (mode !== 'fresh')
    internal.continuation = {
      turn: session.getState().turnNumber,
      expectedRevision: session.getState().revision - 1,
      nextIndex: 1,
      provenWin: mode === 'verified',
      actions: [
        aiActionIntent(attack.command, session.localParticipantId),
        aiActionIntent(attack.command, session.localParticipantId)
      ]
    }
  if (mode === 'exhausted') internal.searchUsedMs = EXPERT_AI_SEARCH_BUDGET_MS
  const before = session.match.getCheckpoint()
  try {
    const response = await api.decide(request)
    const replanned = mode === 'replan-hold' || mode === 'replan-attack'
    expect(calls).toBe(replanned || mode === 'fresh' ? 1 : 0)
    expect(response.choice).toMatchObject({
      actionId: mode === 'replan-hold' || mode === 'fresh' ? pass.id : attack.id
    })
    if (replanned) {
      expect(response.usage?.continuationRejection).toBe('attack-before-setup')
      expect(response.usage?.chanceOrderReview).toMatchObject({
        outcomes: 4,
        targets: 4,
        dispatches: 13,
        abstained: false
      })
    }
    expect(session.match.getCheckpoint()).toEqual(before)
  } finally {
    api.dispose()
  }
})

it.each(['action', 'plan'] as const)(
  'executes a proved singleton setup continuation after budget exhaustion from %s',
  async (phase) => {
    const fixture = createAiFixture({
      seed: 613,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiMana: 6,
      aiHand: ['basic_the_coin', 'goblins_vs_gnomes_tinkers_sharpsword_oil'],
      aiBoard: [{ cardId: 'classic_si_7_agent', ready: true, health: 1 }],
      opponentHealth: 12,
      opponentArmor: 5
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const actor = session.remoteParticipantId,
      opponent = session.localParticipantId
    const own = session.getState().players.find((p) => p.participantId === actor)!
    expect(
      session.dispatch({
        type: 'play-card',
        participantId: actor,
        cardInstanceId: own.hand.find((c) => c.cardId === 'basic_the_coin')!.instanceId
      }).accepted
    ).toBe(true)
    const actions = () =>
      aiActions(
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
    const first = actions().find(
      (a) =>
        a.command.type === 'attack-character' &&
        a.command.attacker.kind === 'minion' &&
        a.command.defender.kind === 'hero'
    )!
    const power = actions().find((a) => a.command.type === 'use-hero-power')!
    const oil = actions().find((a) => a.command.type === 'play-card')!
    const hero = {
      type: 'attack-character' as const,
      participantId: actor,
      attacker: { kind: 'hero' as const },
      defender: { kind: 'hero' as const }
    }
    const intents = [first.command, power.command, oil.command, hero].map((c) =>
      aiActionIntent(c, opponent)
    )
    let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined,
      calls = 0
    const worker = {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') receive = listener as typeof receive
      },
      removeEventListener() {},
      terminate() {},
      postMessage(message: ExpertAiWorkerRequest) {
        if (message.type !== 'decide') return
        calls++
        const response: AiDecisionResponse = {
          ...message.request,
          modelId: 'hardware-local-v2',
          reason: 'Committed complete sequence',
          finishReason: 'fixture-search',
          durationMs: 1,
          choice:
            phase === 'plan'
              ? {
                  plan: {
                    firstActionId: first.id,
                    objective: 'Committed sequence',
                    winCheck: 'none',
                    lossRisk: 'test',
                    candidates: [
                      {
                        sequence: ['attack', 'power', 'setup', 'hero'],
                        budget: 'test',
                        endPosition: 'test',
                        opponentReply: 'test'
                      }
                    ],
                    preferred: 0,
                    checks: []
                  }
                }
              : {
                  actionId: first.id,
                  intent: intents[0]!,
                  expectedResult: 'Test',
                  planUpdate: null
                },
          usage: { plannedActionIntents: intents } as unknown as JsonObject
        }
        receive?.({
          data: { type: 'decision', requestId: message.request.requestId, response }
        } as MessageEvent<ExpertAiWorkerResponse>)
      }
    } as unknown as Worker
    const api = new ExpertAiDecisionApi(
      session,
      () => worker,
      () => 0
    )
    const internal = api as unknown as { searchUsedMs: number; singletonOrder: unknown }
    const request = (
      id: string,
      requestPhase: 'action' | 'plan' = 'action'
    ): AiDecisionRequest => ({
      matchId: 'singleton',
      requestId: 'singleton:' + id,
      phase: requestPhase,
      expectedRevision: session.getState().revision,
      allowInspection: false,
      actionIds: actions().map((a) => a.id),
      messages: []
    })
    const before = session.match.getCheckpoint()
    try {
      let response = await api.decide(request('initial', phase))
      expect(response.usage?.singletonOrderReview).toMatchObject({
        dispatches: 8,
        targets: 1,
        outcomes: 1
      })
      expect(session.match.getCheckpoint()).toEqual(before)
      internal.searchUsedMs = EXPERT_AI_SEARCH_BUDGET_MS
      if (phase === 'plan') response = await api.decide(request('cached'))
      expect(response.choice).toMatchObject({ actionId: power.id })
      expect(session.dispatch(power.command).accepted).toBe(true)
      for (const expected of ['play-card', 'minion', 'hero']) {
        response = await api.decide(request(expected))
        const selected = actions().find(
          (a) => 'actionId' in response.choice && a.id === response.choice.actionId
        )!
        expect(
          selected.command.type === 'attack-character'
            ? selected.command.attacker.kind
            : selected.command.type
        ).toBe(expected)
        if (expected === 'play-card') {
          const certificate = internal.singletonOrder
          session.match.analyze((fork) => fork.dispatch(selected.command))
          session.match.analyze((fork) => fork.dispatch(selected.command))
          expect(internal.singletonOrder).toBe(certificate)
        }
        expect(session.dispatch(selected.command).accepted).toBe(true)
        expect(internal.singletonOrder).toBeNull()
      }
      expect(
        session.getState().players.find((p) => p.participantId === opponent)!.hero
          .health
      ).toBe(7)
      expect(calls).toBe(1)
    } finally {
      api.dispose()
    }
  }
)
