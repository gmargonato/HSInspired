import { describe, expect, it, vi } from 'vitest'
import type {
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject
} from '../../../desktop/contracts/ipc/ai'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game-rules/match'
import { GameBoardSession } from '../game-board-session'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import { ExpertAiDecisionApi } from './expert-ai-decision-api'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'

type Mode =
  | 'attack'
  | 'pass'
  | 'failure-progress'
  | 'timeout-progress'
  | 'error-progress'
  | 'failure-empty'
  | 'timeout-empty'
  | 'error-empty'
  | 'throw-empty'

function fixture(ready = true, plannedAttack = false, mode: Mode = 'attack') {
  const built = createAiFixture({
    seed: 610386,
    aiHeroId: 'garrosh',
    opponentHeroId: 'guldan',
    turnNumber: 9,
    aiMana: 2,
    aiMaximumMana: 2,
    aiHand: ['basic_sap'],
    aiBoard: [{ cardId: 'basic_chillwind_yeti', ready }],
    aiDeck: ['basic_bloodfen_raptor'],
    opponentDeck: ['basic_bloodfen_raptor'],
    opponentHeroPowerAvailable: false
  })
  const session = new GameBoardSession({
    setup: built.setup,
    decks: built.decks,
    checkpoint: built.checkpoint
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
  const power = actions().find((a) => a.command.type === 'use-hero-power')!
  const attack = () =>
    actions().find(
      (a) => a.command.type === 'attack-character' && a.command.defender.kind === 'hero'
    )!
  const pass = () => actions().find((a) => a.command.type === 'end-turn')!
  const intent = (action: ReturnType<typeof actions>[number]) =>
    aiActionIntent(action.command, session.localParticipantId)
  const line = [
    intent(power),
    ...(plannedAttack ? [intent(attack())] : []),
    intent(pass())
  ]
  let now = 0
  let receive: ((event: MessageEvent<ExpertAiWorkerResponse>) => void) | undefined
  let workerError: ((event: ErrorEvent) => void) | undefined
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
      const selected = first ? power : mode === 'pass' ? pass() : attack()
      const response: AiDecisionResponse = {
        matchId: message.request.matchId,
        requestId: message.request.requestId,
        expectedRevision: message.request.expectedRevision,
        modelId: 'hardware-local-v2',
        reason: 'Controlled incumbent review.',
        durationMs: 0,
        finishReason: 'fixture-search',
        choice: {
          actionId: selected.id,
          intent: intent(selected),
          expectedResult: 'Controlled fixture.',
          planUpdate: null
        },
        usage: {
          plannedActionIntents: first ? line : [intent(selected)]
        } as unknown as JsonObject
      }
      if (!first) {
        if (mode.endsWith('progress'))
          receive?.({
            data: {
              type: 'progress',
              requestId: message.request.requestId,
              response,
              recommendationValue: 0.2,
              worldIndex: 0,
              iterations: 2
            }
          } as MessageEvent<ExpertAiWorkerResponse>)
        if (mode.startsWith('failure')) {
          receive?.({
            data: {
              type: 'failure',
              requestId: message.request.requestId,
              error: 'fixture failure'
            }
          } as MessageEvent<ExpertAiWorkerResponse>)
          return
        }
        if (mode.startsWith('error')) {
          workerError?.({
            currentTarget: worker,
            message: 'fixture worker error'
          } as unknown as ErrorEvent)
          return
        }
        if (mode.startsWith('throw')) throw new Error('fixture postMessage throw')
        if (mode.startsWith('timeout')) return
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
    () => now
  )
  const request = (suffix: string): AiDecisionRequest => ({
    matchId: 'reconsidered-pass',
    requestId: 'reconsidered-pass-' + suffix,
    expectedRevision: session.getState().revision,
    phase: 'action',
    allowInspection: false,
    messages: [],
    actionIds: actions().map((a) => a.id)
  })
  return {
    session,
    api,
    actions,
    power,
    attack,
    pass,
    posted,
    request,
    setNow: (value: number) => {
      now = value
    }
  }
}

describe('Explicitly reconsidered pass preference', () => {
  it.each<Mode>([
    'attack',
    'pass',
    'failure-progress',
    'timeout-progress',
    'error-progress'
  ])(
    'reopens without incumbent preference and preserves safe result path: %s',
    async (mode) => {
      if (mode.startsWith('timeout')) vi.useFakeTimers()
      const f = fixture(true, false, mode)
      try {
        await f.api.decide(f.request('first'))
        expect(f.session.dispatch(f.power.command).accepted).toBe(true)
        const pending = f.api.decide(f.request('second'))
        if (mode.startsWith('timeout')) {
          f.setNow(60_000)
          await vi.advanceTimersByTimeAsync(60_000)
        }
        const response = await pending
        expect(f.posted).toHaveLength(2)
        expect(f.posted[1]!.preferredContinuation).toBeUndefined()
        const selected = f
          .actions()
          .find(
            (a) => 'actionId' in response.choice && a.id === response.choice.actionId
          )!
        expect(selected.command.type).toBe(
          mode === 'pass' ? 'end-turn' : 'attack-character'
        )
        expect(
          (f.api as unknown as { continuation?: { reconsidering?: boolean } })
            .continuation?.reconsidering
        ).toBeUndefined()
        expect(f.session.dispatch(selected.command).accepted).toBe(true)
      } finally {
        f.api.dispose()
        if (mode.startsWith('timeout')) vi.useRealTimers()
      }
    }
  )

  it.each<Mode>(['failure-empty', 'timeout-empty', 'error-empty', 'throw-empty'])(
    'does not bypass the existing pass rejection on an empty failed search: %s',
    async (mode) => {
      if (mode.startsWith('timeout')) vi.useFakeTimers()
      const f = fixture(true, false, mode)
      try {
        await f.api.decide(f.request('first'))
        expect(f.session.dispatch(f.power.command).accepted).toBe(true)
        const pending = f.api.decide(f.request('second'))
        const result = pending.then(
          () => ({ rejected: false }),
          () => ({ rejected: true })
        )
        if (mode.startsWith('timeout')) {
          f.setNow(60_000)
          await vi.advanceTimersByTimeAsync(60_000)
        }
        expect((await result).rejected).toBe(true)
        expect(f.posted[1]!.preferredContinuation).toBeUndefined()
      } finally {
        f.api.dispose()
        if (mode.startsWith('timeout')) vi.useRealTimers()
      }
    }
  )

  it.each([false, true])(
    'keeps a legitimate cached pass and holds unusable Sap, exhausted=%s',
    async (exhausted) => {
      const f = fixture(false)
      try {
        await f.api.decide(f.request('first'))
        expect(f.session.dispatch(f.power.command).accepted).toBe(true)
        if (exhausted) f.setNow(60_000)
        expect(
          (f.api as unknown as { continuation?: { reconsidering?: boolean } })
            .continuation?.reconsidering
        ).toBeUndefined()
        const response = await f.api.decide(f.request('second'))
        expect(f.posted).toHaveLength(1)
        expect(response.finishReason).toBe('expert-continuation')
        expect('actionId' in response.choice && response.choice.actionId).toBe(
          f.pass().id
        )
        expect(
          f.session
            .getState()
            .players.find((p) => p.participantId === f.session.remoteParticipantId)!
            .hand.some((c) => c.cardId === 'basic_sap')
        ).toBe(true)
      } finally {
        f.api.dispose()
      }
    }
  )

  it.each([false, true])(
    'keeps an ordinary cached attack without extra search, exhausted=%s',
    async (exhausted) => {
      const f = fixture(true, true)
      try {
        await f.api.decide(f.request('first'))
        expect(f.session.dispatch(f.power.command).accepted).toBe(true)
        if (exhausted) f.setNow(60_000)
        const response = await f.api.decide(f.request('second'))
        expect(f.posted).toHaveLength(1)
        expect(response.finishReason).toBe('expert-continuation')
        expect('actionId' in response.choice && response.choice.actionId).toBe(
          f.attack().id
        )
      } finally {
        f.api.dispose()
      }
    }
  )
})
