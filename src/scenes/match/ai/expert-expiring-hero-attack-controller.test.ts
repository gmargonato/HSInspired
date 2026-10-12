import { describe, expect, it } from 'vitest'
import type {
  AiDecisionRequest,
  AiDecisionResponse
} from '../../../desktop/contracts/ipc/ai'
import {
  terminalOutcome,
  type TacticalOutcome
} from '../../../game-rules/match/ai/tactical-search'
import type { OpeningMatchCheckpoint } from '../../../game-rules/match'
import { canonicalCommandKey, enumerateLegalCommands } from '../../../game-rules/match'
import { asPlayerId } from '../../../game-rules/match/match-types'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { GameBoardSession } from '../game-board-session'
import {
  ExpertAiDecisionApi,
  EXPERT_AI_SEARCH_BUDGET_MS
} from './expert-ai-decision-api'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'
import recorded from './expert-expiring-hero-attack-recorded.json'
import tacticalRecorded from './expert-tactical-recorded-states.json'

function session() {
  const checkpoint = createFairHypothesisCheckpoint(
    recorded.checkpoint as unknown as OpeningMatchCheckpoint,
    asPlayerId(recorded.actorId),
    0x71ac71c
  )
  return new GameBoardSession({
    setup: checkpoint.setup,
    decks: checkpoint.decks,
    checkpoint
  })
}

function inputs(match: GameBoardSession, phase: 'plan' | 'action' = 'action') {
  const actions = aiActions(
    match,
    enumerateLegalCommands(
      {
        getState: match.match.getState,
        getPlayInput: match.match.getPlayInput!,
        getLegality: match.match.getLegality!
      },
      match.remoteParticipantId
    )
  )
  const request: AiDecisionRequest = {
    matchId: 'recorded-a004',
    requestId: 'recorded-a004:' + phase,
    expectedRevision: match.getState().revision,
    phase,
    allowInspection: false,
    messages: [],
    actionIds: actions.map((action) => action.id)
  }
  return { actions, request }
}

function reply(
  match: GameBoardSession,
  request: AiDecisionRequest
): AiDecisionResponse {
  const { actions } = inputs(match)
  const pass = actions.find((action) => action.command.type === 'end-turn')!
  const raw = recorded.response as unknown as AiDecisionResponse
  return {
    ...structuredClone(raw),
    matchId: request.matchId,
    requestId: request.requestId,
    expectedRevision: request.expectedRevision,
    choice:
      request.phase === 'plan'
        ? {
            plan: {
              objective: 'Recorded pass.',
              winCheck: 'No proven win.',
              lossRisk: 'Recorded risk.',
              candidates: [
                {
                  sequence: [pass.description, 'Stale suffix.'],
                  budget: 'No cost.',
                  endPosition: 'Recorded position.',
                  opponentReply: 'Unknown.'
                }
              ],
              preferred: 0,
              firstActionId: pass.id,
              checks: []
            }
          }
        : {
            actionId: pass.id,
            intent: aiActionIntent(pass.command, match.localParticipantId),
            expectedResult: 'Recorded pass.',
            planUpdate: null
          }
  }
}

function transport(
  match: GameBoardSession,
  mode: 'decision' | 'progress-failure' = 'decision',
  select?: (response: AiDecisionResponse) => AiDecisionResponse
) {
  let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
  const rawReplies: AiDecisionResponse[] = []
  const requests: ExpertAiWorkerRequest[] = []
  const worker = {
    addEventListener(type: string, listener: unknown) {
      if (type === 'message') receive = listener as typeof receive
    },
    postMessage(message: ExpertAiWorkerRequest) {
      requests.push(message)
      if (message.type !== 'decide') return
      const original = reply(match, message.request)
      const response = select?.(original) ?? original
      rawReplies.push(structuredClone(response))
      const preserved = JSON.stringify(response)
      if (mode === 'progress-failure') {
        receive?.({
          data: {
            type: 'progress',
            requestId: message.request.requestId,
            response,
            recommendationValue: 0,
            worldIndex: 0,
            iterations: 1
          }
        } as MessageEvent<ExpertAiWorkerResponse>)
        receive?.({
          data: {
            type: 'failure',
            requestId: message.request.requestId,
            error: 'Fixture worker stopped.'
          }
        } as MessageEvent<ExpertAiWorkerResponse>)
      } else
        receive?.({
          data: { type: 'decision', requestId: message.request.requestId, response }
        } as MessageEvent<ExpertAiWorkerResponse>)
      expect(JSON.stringify(response)).toBe(preserved)
    },
    terminate() {}
  } as unknown as Worker
  return { worker, rawReplies, requests }
}

interface PrivateApi {
  currentLegalActions(): ReturnType<typeof aiActions>
  searchUsedMs: number
  planCommit: unknown
  continuation: unknown
  terminalCheck: { revision: number; outcomes: Map<string, TacticalOutcome> } | null
  guardExpiringAttackPass(
    request: AiDecisionRequest,
    response: AiDecisionResponse
  ): AiDecisionResponse
}

function expectBeneficialAttack(match: GameBoardSession, response: AiDecisionResponse) {
  const { actions } = inputs(match)
  const selectedId =
    'plan' in response.choice
      ? response.choice.plan.firstActionId
      : 'actionId' in response.choice
        ? response.choice.actionId
        : null
  const action = actions.find((entry) => entry.id === selectedId)!
  expect(action.command.type).toBe('attack-character')
  // Archived consensus prefers this legal chip over face, without a target rule.
  expect(action.command).toMatchObject({
    attacker: { kind: 'hero' },
    defender: { kind: 'minion', instanceId: 'study-opponent:deck:4' }
  })
  expect(response.usage?.actionOutcomeReason).toBe('unused-expiring-hero-attack')
  expect(response.usage?.plannedActionIntents).toHaveLength(1)
  const before = match
    .getState()
    .players.find((player) => player.participantId === match.remoteParticipantId)!.hero
  expect(match.dispatch(action.command).accepted).toBe(true)
  const after = match
    .getState()
    .players.find((player) => player.participantId === match.remoteParticipantId)!.hero
  expect(after.health).toBe(before.health)
  expect(after.armor).toBe(before.armor)
}

describe('Recorded A004 controller response boundary', () => {
  it.each(['decision', 'progress-failure'] as const)(
    'corrects the archived pass via %s without rewriting the worker reply',
    async (mode) => {
      const match = session()
      const io = transport(match, mode)
      const api = new ExpertAiDecisionApi(
        match,
        () => io.worker,
        () => 0
      )
      try {
        const { request } = inputs(match)
        const response = await api.decide(request)
        expect(io.rawReplies[0]!.choice).toMatchObject({ actionId: 'a3' })
        expectBeneficialAttack(match, response)
      } finally {
        api.dispose()
      }
    }
  )

  it('guards a plan and commits only its corrected action, preserving the raw plan', async () => {
    const match = session()
    const io = transport(match)
    const api = new ExpertAiDecisionApi(
      match,
      () => io.worker,
      () => 0
    )
    try {
      const plan = await api.decide(inputs(match, 'plan').request)
      expect(plan.choice).toMatchObject({ plan: { firstActionId: 'a1' } })
      expect(io.rawReplies[0]!.choice).toMatchObject({ plan: { firstActionId: 'a3' } })
      const action = await api.decide(inputs(match).request)
      expect(action.finishReason).toBe('expert-plan-commit-cache')
      expect(io.requests.filter((message) => message.type === 'decide')).toHaveLength(1)
      expectBeneficialAttack(match, action)
    } finally {
      api.dispose()
    }
  })

  it('rechecks an already cached pass without mutating the cached object', async () => {
    const match = session()
    const io = transport(match)
    const api = new ExpertAiDecisionApi(
      match,
      () => io.worker,
      () => 0
    )
    try {
      const { request } = inputs(match)
      const cached = reply(match, inputs(match, 'plan').request)
      const preserved = structuredClone(cached)
      ;(api as unknown as PrivateApi).planCommit = {
        matchId: request.matchId,
        turn: match.getState().turnNumber,
        revision: request.expectedRevision,
        response: cached
      }
      const response = await api.decide(request)
      expect(cached).toEqual(preserved)
      expect(io.requests.filter((message) => message.type === 'decide')).toHaveLength(0)
      expectBeneficialAttack(match, response)
    } finally {
      api.dispose()
    }
  })

  it('replans a stale continuation pass and replaces its suffix', async () => {
    const match = session()
    const io = transport(match)
    const api = new ExpertAiDecisionApi(
      match,
      () => io.worker,
      () => 0
    )
    try {
      const { actions, request } = inputs(match)
      const pass = actions.find((action) => action.command.type === 'end-turn')!
      const intent = aiActionIntent(pass.command, match.localParticipantId)
      ;(api as unknown as PrivateApi).continuation = {
        turn: match.getState().turnNumber,
        expectedRevision: request.expectedRevision - 1,
        nextIndex: 1,
        actions: [intent, intent, intent]
      }
      const response = await api.decide(request)
      expect(response.finishReason).toBe('expert-sampled-search')
      expect(io.requests.filter((message) => message.type === 'decide')).toHaveLength(1)
      expectBeneficialAttack(match, response)
    } finally {
      api.dispose()
    }
  })

  it('leaves non-pass decisions and verified wins alone', () => {
    const match = session()
    const api = new ExpertAiDecisionApi(
      match,
      () => transport(match).worker,
      () => 0
    )
    const internal = api as unknown as PrivateApi
    try {
      const { request, actions } = inputs(match)
      const pass = reply(match, request)
      const attack = actions.find(
        (action) => action.command.type === 'attack-character'
      )!
      const response: AiDecisionResponse = {
        ...pass,
        choice: {
          actionId: attack.id,
          intent: aiActionIntent(attack.command, match.localParticipantId),
          expectedResult: 'Keep searched action.',
          planUpdate: null
        }
      }
      expect(internal.guardExpiringAttackPass(request, response)).toBe(response)
      const win = {
        ...pass,
        usage: { ...pass.usage, decisionPriority: 'verified-win' }
      }
      expect(internal.guardExpiringAttackPass(request, win)).toBe(win)
    } finally {
      api.dispose()
    }
  })

  it.each(['decision', 'progress-failure', 'plan-cache', 'continuation'] as const)(
    'preserves an engine-proven terminal draw through the real cache on %s',
    async (mode) => {
      const original = session().match.getCheckpoint()
      const actor = original.state.activePlayerId!
      const checkpoint = {
        ...original,
        state: {
          ...original.state,
          players: original.state.players.map((player) => ({
            ...player,
            hero: {
              ...player.hero,
              health: 1,
              damageTaken: 29,
              armor: 0,
              attack: 0,
              baseAttack: 0,
              enchantments: []
            }
          })) as unknown as typeof original.state.players,
          scheduledEffects: [
            {
              id: 'known-terminal-boundary',
              sourceInstanceId: `${actor}:hero`,
              sourceCardId: null,
              controllerId: actor,
              trigger: 'end-of-turn' as const,
              executeOnTurn: original.state.turnNumber,
              actions: [
                {
                  action: 'damage',
                  target: { controller: 'any', type: 'hero', selection: 'all' },
                  amount: 2
                }
              ]
            }
          ]
        }
      }
      const match = new GameBoardSession({
        setup: checkpoint.setup,
        decks: checkpoint.decks,
        checkpoint
      })
      const { request, actions } = inputs(match)
      const pass = actions.find((action) => action.command.type === 'end-turn')!
      expect(
        match.match.analyze((fork) =>
          terminalOutcome(fork.dispatch(pass.command).state, actor)
        )
      ).toBe('draw')
      const io = transport(match, mode === 'progress-failure' ? mode : 'decision')
      const api = new ExpertAiDecisionApi(
        match,
        () => io.worker,
        () => 0
      )
      const internal = api as unknown as PrivateApi
      try {
        if (mode === 'plan-cache') await api.decide(inputs(match, 'plan').request)
        if (mode === 'continuation') {
          const intent = aiActionIntent(pass.command, match.localParticipantId)
          internal.continuation = {
            turn: match.getState().turnNumber,
            expectedRevision: request.expectedRevision - 1,
            nextIndex: 1,
            actions: [intent, intent]
          }
        }
        const response = await api.decide(request)
        expect(response.choice).toMatchObject({ actionId: pass.id })
        expect(response.usage?.expiringAttackReview).toBeUndefined()
        expect(internal.terminalCheck?.revision).toBe(request.expectedRevision)
        expect(
          internal.terminalCheck!.outcomes.get(canonicalCommandKey(pass.command))
        ).toBe('draw')
        if (mode === 'plan-cache')
          expect(response.finishReason).toBe('expert-plan-commit-cache')
        if (mode === 'continuation') {
          expect(response.finishReason).toBe('expert-continuation')
          expect(
            io.requests.filter((message) => message.type === 'decide')
          ).toHaveLength(0)
        }
      } finally {
        api.dispose()
      }
    }
  )

  it('preserves an engine-proven winning pass through the existing verified-win path', async () => {
    const original = session().match.getCheckpoint()
    const actor = original.state.activePlayerId!
    const checkpoint = {
      ...original,
      state: {
        ...original.state,
        players: original.state.players.map((player) => ({
          ...player,
          hero: {
            ...player.hero,
            health: player.participantId === actor ? 30 : 1,
            damageTaken: player.participantId === actor ? 0 : 29,
            armor: 0,
            attack: 0,
            baseAttack: 0,
            enchantments: []
          }
        })) as unknown as typeof original.state.players,
        scheduledEffects: [
          {
            id: 'known-winning-boundary',
            sourceInstanceId: `${actor}:hero`,
            sourceCardId: null,
            controllerId: actor,
            trigger: 'end-of-turn' as const,
            executeOnTurn: original.state.turnNumber,
            actions: [
              {
                action: 'damage',
                target: { controller: 'any', type: 'hero', selection: 'all' },
                amount: 2
              }
            ]
          }
        ]
      }
    }
    const match = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const io = transport(match)
    const api = new ExpertAiDecisionApi(
      match,
      () => io.worker,
      () => 0
    )
    try {
      const { request, actions } = inputs(match)
      const pass = actions.find((action) => action.command.type === 'end-turn')!
      expect(
        match.match.analyze((fork) =>
          terminalOutcome(fork.dispatch(pass.command).state, actor)
        )
      ).toBe('win')
      const response = await api.decide(request)
      expect(response.choice).toMatchObject({ actionId: pass.id })
      expect(response.usage?.decisionPriority).toBe('verified-win')
      expect(response.usage?.expiringAttackReview).toBeUndefined()
      expect(io.requests.filter((message) => message.type === 'decide')).toHaveLength(0)
    } finally {
      api.dispose()
    }
  })

  it('ignores a terminal result cached for an earlier revision', () => {
    const match = session()
    const api = new ExpertAiDecisionApi(
      match,
      () => transport(match).worker,
      () => 0
    )
    const internal = api as unknown as PrivateApi
    try {
      const { request, actions } = inputs(match)
      const pass = actions.find((action) => action.command.type === 'end-turn')!
      internal.terminalCheck = {
        revision: request.expectedRevision - 1,
        outcomes: new Map([[canonicalCommandKey(pass.command), 'draw']])
      }
      expectBeneficialAttack(
        match,
        internal.guardExpiringAttackPass(request, reply(match, request))
      )
    } finally {
      api.dispose()
    }
  })

  it('uses the existing consensus target order instead of forcing the recorded minion target', async () => {
    const match = session()
    const { request, actions } = inputs(match)
    const face = actions.find(
      (action) =>
        action.command.type === 'attack-character' &&
        action.command.defender.kind === 'hero'
    )!
    const io = transport(match, 'decision', (response) => ({
      ...response,
      usage: { ...response.usage, candidateConsensus: [{ candidateId: face.id }] }
    }))
    const api = new ExpertAiDecisionApi(
      match,
      () => io.worker,
      () => 0
    )
    try {
      const response = await api.decide(request)
      expect(response.choice).toMatchObject({ actionId: face.id })
      expect(response.usage?.expiringAttackReview).toMatchObject({
        toCommandKey: canonicalCommandKey(face.command)
      })
      const before = match
        .getAiObservation()
        .players.find((player) => player.role === 'self')!.hero
      expect(match.dispatch(face.command).accepted).toBe(true)
      const after = match
        .getAiObservation()
        .players.find((player) => player.role === 'self')!.hero
      expect(after.health).toBe(before.health)
      expect(after.armor).toBe(before.armor)
    } finally {
      api.dispose()
    }
  })

  it('retains terminal safety provenance when adding separately proved free damage', async () => {
    const source = tacticalRecorded.jadeSelfLoss
    const actor = asPlayerId(source.actorId)
    const checkpoint = createFairHypothesisCheckpoint(
      source.checkpoint as unknown as OpeningMatchCheckpoint,
      actor,
      0x71ac71c
    )
    const match = new GameBoardSession({
      setup: checkpoint.setup,
      decks: checkpoint.decks,
      checkpoint
    })
    const { request, actions } = inputs(match)
    const fatal = actions.find(
      (action) =>
        canonicalCommandKey(action.command) ===
        canonicalCommandKey(
          source.historicalCommand as unknown as import('../../../game-rules/match').TurnMatchCommand
        )
    )!
    expect(
      match.match.analyze((fork) =>
        terminalOutcome(fork.dispatch(fatal.command).state, actor)
      )
    ).toBe('loss')
    const io = transport(match, 'decision', (response) => ({
      ...response,
      choice: {
        actionId: fatal.id,
        intent: aiActionIntent(fatal.command, match.localParticipantId),
        expectedResult: 'Historical fatal attack.',
        planUpdate: null
      },
      usage: {
        ...response.usage,
        decisionPriority: 'verified-win',
        candidateConsensus: []
      }
    }))
    const api = new ExpertAiDecisionApi(
      match,
      () => io.worker,
      () => 0
    )
    try {
      const response = await api.decide(request)
      const selected = actions.find(
        (action) =>
          'actionId' in response.choice && action.id === response.choice.actionId
      )!
      expect(selected.command.type).toBe('attack-character')
      expect(selected.id).not.toBe(fatal.id)
      expect(response.usage?.decisionPriority).toBe('tactical-safety')
      expect(response.usage?.actionOutcomeReason).toBe('immediate-terminal-loss')
      const pass = actions.find((action) => action.command.type === 'end-turn')!
      expect(response.usage?.expiringAttackReview).toMatchObject({
        reason: 'unused-expiring-hero-attack',
        fromActionId: pass.id,
        toActionId: selected.id,
        fromCommandKey: canonicalCommandKey(pass.command),
        toCommandKey: canonicalCommandKey(selected.command)
      })
      expect(response.reason).toContain('Tactical safety check skipped')
      expect(response.reason).toContain('Use otherwise expiring hero damage')
      expect(response.usage?.plannedActionIntents).toHaveLength(1)
      const before = match
        .getAiObservation()
        .players.find((player) => player.role === 'self')!.hero
      expect(match.dispatch(selected.command).accepted).toBe(true)
      const after = match
        .getAiObservation()
        .players.find((player) => player.role === 'self')!.hero
      expect(after.health).toBe(before.health)
      expect(after.armor).toBe(before.armor)
      expect(match.getState().phase).toBe('turns')
    } finally {
      api.dispose()
    }
  })

  it.each(['non-pass', 'no replacement'] as const)(
    'charges legal enumeration for %s',
    (kind) => {
      const match = session()
      let time = 0
      const api = new ExpertAiDecisionApi(
        match,
        () => transport(match).worker,
        () => time
      )
      const internal = api as unknown as PrivateApi
      try {
        const { request, actions } = inputs(match)
        const pass = reply(match, request)
        const attack = actions.find(
          (action) => action.command.type === 'attack-character'
        )!
        const response: AiDecisionResponse =
          kind === 'non-pass'
            ? {
                ...pass,
                choice: {
                  actionId: attack.id,
                  intent: aiActionIntent(attack.command, match.localParticipantId),
                  expectedResult: 'Keep searched attack.',
                  planUpdate: null
                }
              }
            : pass
        const original = internal.currentLegalActions.bind(internal)
        internal.currentLegalActions = () => {
          time += 7
          return original()
        }
        const scoped =
          kind === 'no replacement'
            ? {
                ...request,
                actionIds: actions
                  .filter((action) => action.command.type === 'end-turn')
                  .map((action) => action.id)
              }
            : request
        const result = internal.guardExpiringAttackPass(scoped, response)
        expect(result.choice).toEqual(response.choice)
        expect(internal.searchUsedMs).toBe(7)
        expect(result.durationMs).toBe(response.durationMs + 7)
      } finally {
        api.dispose()
      }
    }
  )

  it('reports and charges an eligible-pass time abstention without replacing it', () => {
    const match = session()
    let time = 0
    const api = new ExpertAiDecisionApi(
      match,
      () => transport(match).worker,
      () => (time += 30)
    )
    const internal = api as unknown as PrivateApi
    try {
      const { request } = inputs(match)
      const pass = reply(match, request)
      const response = internal.guardExpiringAttackPass(request, pass)
      expect(response.choice).toEqual(pass.choice)
      expect(response.usage?.expiringAttackReview).toMatchObject({ dispatches: 0 })
      expect(
        (response.usage?.expiringAttackReview as { abstentions: number }).abstentions
      ).toBeGreaterThan(0)
      expect(internal.searchUsedMs).toBeGreaterThan(0)
      expect(response.durationMs).toBeGreaterThan(pass.durationMs)
    } finally {
      api.dispose()
    }
  })

  it('abstains with no remaining budget and charges elapsed controller work with the injected clock', () => {
    const match = session()
    let time = 0
    const api = new ExpertAiDecisionApi(
      match,
      () => transport(match).worker,
      () => (time += 0.1)
    )
    const internal = api as unknown as PrivateApi
    try {
      const { request } = inputs(match)
      const pass = reply(match, request)
      internal.searchUsedMs = EXPERT_AI_SEARCH_BUDGET_MS
      expect(internal.guardExpiringAttackPass(request, pass).choice).toEqual(
        pass.choice
      )
      internal.searchUsedMs = 0
      const response = internal.guardExpiringAttackPass(request, pass)
      expect(internal.searchUsedMs).toBeGreaterThan(0)
      expect(response.durationMs).toBeGreaterThan(pass.durationMs)
      expectBeneficialAttack(match, response)
    } finally {
      api.dispose()
    }
  })
})
