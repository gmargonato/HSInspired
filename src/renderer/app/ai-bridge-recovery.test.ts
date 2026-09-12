import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AI_IPC_CHANNELS,
  AiRequestError,
  aiIpcFailure,
  aiIpcSuccess,
  type AiDecisionBridge,
  type AiDecisionRequest
} from '../../shared/ipc/ai'
import { createAiDecisionApi } from './ai-decision-api'
import { AiTurnController } from '../features/game/ai-turn-controller'
import type { GameBoardSession } from '../features/game/game-board-session'
import { aiActionIntent } from '../features/game/ai-action-intent'
import type { AiDecisionChoice } from '../../shared/ipc/ai-deliberation'

const electron = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }))
const legal = vi.hoisted(() => ({
  commands: [{ type: 'end-turn' }, { type: 'use-hero-power' }]
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke, on: vi.fn(), removeListener: vi.fn() }
}))
vi.mock('../../game/match/ai', () => ({
  enumerateLegalCommands: () => legal.commands
}))
vi.mock('../features/game/ai-context', () => ({
  aiSystemContext: () => ({ role: 'system', content: 'Choose a legal action.' }),
  aiActions: (_session, commands) =>
    commands.map((command, i) => ({
      id: `a${i}`,
      command,
      description: command.type,
      intent: aiActionIntent(command, 'human')
    })),
  aiActionFacts: (actions) => actions,
  aiModelState: () => ({ mana: 7 }),
  aiJson: (value) => JSON.parse(JSON.stringify(value))
}))

let preload: AiDecisionBridge
beforeAll(async () => {
  const previous = Object.getOwnPropertyDescriptor(process, 'contextIsolated')
  Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  try {
    await import('../../preload/index')
    preload = electron.expose.mock.calls[0][1].ai
  } finally {
    if (previous) Object.defineProperty(process, 'contextIsolated', previous)
    else delete (process as unknown as Record<string, unknown>).contextIsolated
  }
})
afterEach(() => {
  electron.invoke.mockReset()
  legal.commands = [{ type: 'end-turn' }, { type: 'use-hero-power' }]
})

// Use the actual preload, with a bridge double that strips Error custom fields.
// A direct mocked AiRequestError would conceal the original integration failure.
function bridge(): AiDecisionBridge {
  const cross = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return structuredClone(await call())
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error), {
        cause: error
      })
    }
  }
  return {
    settings: () => cross(() => preload.settings()),
    decide: (request) => cross(() => preload.decide(structuredClone(request))),
    cancel: (identity) => preload.cancel(identity)
  }
}
const details = {
  repairable: true,
  failureKind: 'invalid-structure',
  rejectedContent: '{"actionId":"a0"}',
  contentTruncated: false
}
const reject = () => aiIpcFailure(new AiRequestError('Invalid structure.', details))
const commitChoice = () => ({
  actionId: 'a0',
  intent: { type: 'end-turn', source: null, targets: [], position: null, option: null },
  expectedResult: 'Pass initiative.',
  planUpdate: null
})
const planChoice = () => ({
  plan: {
    objective: 'Conserve resources.',
    winCheck: 'Not found.',
    lossRisk: 'Opponent develops.',
    candidates: [
      {
        sequence: ['End turn.'],
        budget: '0 mana.',
        endPosition: 'Unchanged board.',
        opponentReply: 'Develop.'
      }
    ],
    preferred: 0,
    firstActionId: 'a0',
    checks: []
  }
})
function setup(
  mode:
    | 'recover'
    | 'reject'
    | 'provider'
    | 'pending'
    | 'timeout'
    | 'plan-timeout'
    | 'stale-timeout'
    | 'plan-repair'
    | 'plan' = 'recover',
  choose?: (request: AiDecisionRequest, count: number) => AiDecisionChoice
) {
  const requests: AiDecisionRequest[] = []
  electron.invoke.mockImplementation(async (channel, request) => {
    if (channel === AI_IPC_CHANNELS.settings)
      return aiIpcSuccess({
        enabled: true,
        provider: 'openrouter',
        modelId: 'test',
        reasoningEffort: 'low',
        maxCompletionTokens: 1000
      })
    if (channel === AI_IPC_CHANNELS.decide) {
      requests.push(structuredClone(request))
      if (mode === 'pending') return new Promise(() => {})
      if (mode === 'stale-timeout') state.revision++
      if (mode === 'timeout' || mode === 'plan-timeout' || mode === 'stale-timeout')
        return aiIpcFailure(
          new AiRequestError('Deadline exceeded.', {
            failureKind: 'timeout',
            repairable: false
          })
        )
      if (mode === 'plan-repair' && (requests.length === 1 || requests.length === 3))
        return reject()
      if (mode === 'plan' || mode === 'plan-repair' || request.phase === 'plan')
        return aiIpcSuccess({
          ...request,
          reason: 'Objective',
          choice: choose
            ? choose(request, requests.length)
            : request.phase === 'plan'
              ? planChoice()
              : commitChoice(),
          modelId: 'test',
          durationMs: 1,
          finishReason: 'stop'
        })
      if (mode === 'provider')
        return aiIpcFailure(
          new AiRequestError('Provider failure.', { repairable: false })
        )
      if (mode === 'reject' || requests.length === 1) return reject()
      return aiIpcSuccess({
        ...request,
        reason: 'Choose.',
        choice: commitChoice(),
        modelId: 'test',
        durationMs: 1,
        finishReason: 'stop'
      })
    }
    return undefined
  })
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const onFailure = vi.fn()
  const state = {
    revision: 43,
    turnNumber: 13,
    phase: mode.startsWith('plan') ? 'turns' : 'mulligan',
    activePlayerId: 'ai'
  }
  const session = {
    remoteParticipantId: 'ai',
    localParticipantId: 'human',
    getState: () => state,
    subscribe: () => () => {},
    getAiEventCursor: () => 0,
    getAiEventsSince: () => [],
    getAiPublicHistory: () => ({ recentEvents: [] }),
    acknowledgeAiEvents: () => {},
    match: { getState: () => ({}), getPlayInput: () => {}, getLegality: () => ({}) }
  } as unknown as GameBoardSession
  const controller = new AiTurnController({
    session,
    api: createAiDecisionApi(bridge()),
    logger,
    onFailure
  })
  return { controller, requests, logger, onFailure, state }
}
describe('preload to renderer recovery', () => {
  const check = {
    topic: 'action' as const,
    ref: 'a0',
    question: 'Which input?',
    decisionImpact: 'Confirm the exact input before committing.'
  }
  it('answers initial checks in the mandatory exchange and replaces a stale plan', async () => {
    const note = {
      objective: 'Updated objective.',
      continuation: 'Updated continuation.',
      reconsiderIf: 'New information.'
    }
    const { controller, requests, state, logger } = setup('plan', (r) =>
      r.phase === 'plan'
        ? { plan: { ...planChoice().plan, checks: [check] } }
        : { ...commitChoice(), planUpdate: note }
    )
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        source: 'model',
        expectedResult: 'Pass initiative.'
      })
      expect(requests).toHaveLength(2)
      const challenge = JSON.parse(requests[1].messages.at(-1)!.content)
      expect(challenge.information[0]).toMatchObject({
        status: 'known',
        revision: 43,
        facts: { id: 'a0' }
      })
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] plan-updated',
        expect.objectContaining({ turnPlan: note })
      )
      state.revision++
      await controller.chooseTurnAction()
      expect(JSON.parse(requests[2].messages.at(-1)!.content).turnPlan).toEqual(note)
      expect(requests[2].phase).toBe('action')
    } finally {
      controller.dispose()
    }
  })
  it('bounds inspection by revision and turn, without restarting planning after each question', async () => {
    const { controller, requests, state } = setup('plan', (r) =>
      r.phase === 'plan'
        ? planChoice()
        : r.allowInspection
          ? { inspect: [check] }
          : commitChoice()
    )
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({ source: 'model' })
      expect(requests.map((r) => r.phase)).toEqual(['plan', 'action', 'action'])
      expect(requests[2].allowInspection).toBe(false)
      expect(requests[2].messages.at(-1)?.content).toContain('COMMIT NOW')
      await controller.chooseTurnAction()
      expect(requests).toHaveLength(4)
      expect(requests[3].allowInspection).toBe(false)
      state.revision++
      await controller.chooseTurnAction()
      expect(requests).toHaveLength(6)
      state.revision++
      await controller.chooseTurnAction()
      expect(requests).toHaveLength(7)
      expect(requests[6].allowInspection).toBe(false)
      state.turnNumber += 2
      state.revision++
      await controller.chooseTurnAction()
      expect(requests.slice(7).map((r) => r.phase)).toEqual([
        'plan',
        'action',
        'action'
      ])
    } finally {
      controller.dispose()
    }
  })
  it('cuts off repeated inspection, and a manual retry cannot replenish that decision allowance', async () => {
    const { controller, requests, onFailure } = setup('plan', (r) =>
      r.phase === 'plan' ? planChoice() : { inspect: [check] }
    )
    try {
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(requests).toHaveLength(4)
      expect(onFailure).toHaveBeenCalledOnce()
      onFailure.mock.calls[0][1]()
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(requests).toHaveLength(6)
      expect(requests.slice(4).every((r) => !r.allowInspection)).toBe(true)
    } finally {
      controller.dispose()
    }
  })
  it.each([true, false])(
    'repairs an ID/intent mismatch without dispatching it (correction=%s)',
    async (correct) => {
      const { controller, requests, onFailure, logger } = setup('plan', (r, count) =>
        r.phase === 'plan'
          ? planChoice()
          : correct && count === 3
            ? commitChoice()
            : {
                ...commitChoice(),
                intent: { ...commitChoice().intent, targets: ['human:hero'] }
              }
      )
      try {
        const decision = await controller.chooseTurnAction()
        expect(requests).toHaveLength(3)
        expect(requests[2].messages.at(-1)?.content).toContain(
          'Action ID and intent disagree'
        )
        if (correct) {
          expect(decision).toMatchObject({ source: 'model', actionId: 'a0' })
          expect(onFailure).not.toHaveBeenCalled()
        } else {
          expect(decision).toBeNull()
          expect(onFailure).toHaveBeenCalledOnce()
          expect(
            logger.info.mock.calls.some(
              ([kind]) => kind === '[Game AI] response-received'
            )
          ).toBe(false)
        }
      } finally {
        controller.dispose()
      }
    }
  )
  it('discards an inspection response if the board changed while awaiting it', async () => {
    const test = setup('plan', (r) => {
      if (r.phase === 'plan') return planChoice()
      test.state.revision++
      return { inspect: [check] }
    })
    try {
      expect(await test.controller.chooseTurnAction()).toBeNull()
      expect(test.requests).toHaveLength(2)
      expect(test.onFailure).not.toHaveBeenCalled()
      expect(
        test.logger.info.mock.calls.some(
          ([kind]) => kind === '[Game AI] fact-inspection'
        )
      ).toBe(false)
    } finally {
      test.controller.dispose()
    }
  })
  it('skips planning and model calls for a forced input', async () => {
    const { controller, requests } = setup('plan')
    legal.commands = [{ type: 'end-turn' }]
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({ source: 'forced' })
      expect(requests).toHaveLength(0)
    } finally {
      controller.dispose()
    }
  })
  it.each(['pendingDiscover', 'pendingCardChoice'])(
    'skips planning for %s',
    async (key) => {
      const { controller, requests, state } = setup('plan')
      Object.assign(state, { [key]: {} })
      try {
        expect(await controller.chooseTurnAction()).toMatchObject({ source: 'model' })
        expect(requests.map((request) => request.phase)).toEqual(['action'])
      } finally {
        controller.dispose()
      }
    }
  )
  it('falls back on a planning timeout and retries the provider on the next decision', async () => {
    const { controller, requests, onFailure } = setup('plan-timeout')
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        source: 'random-timeout'
      })
      expect(requests).toHaveLength(1)
      expect(requests[0].phase).toBe('plan')
      expect(await controller.chooseTurnAction()).toMatchObject({
        source: 'random-timeout'
      })
      expect(requests).toHaveLength(2)
      expect(onFailure).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('does not select a fallback for a stale request', async () => {
    const { controller, logger, onFailure } = setup('stale-timeout')
    try {
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(
        logger.info.mock.calls.some(([kind]) => kind === '[Game AI] timeout-fallback')
      ).toBe(false)
      expect(onFailure).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('manual recovery still refreshes state after a non-timeout failure', async () => {
    const { controller, requests, onFailure, state } = setup('provider')
    try {
      expect(await controller.chooseTurnAction()).toBeNull()
      const resumed = controller.waitForResume()
      state.revision++
      onFailure.mock.calls[0][1]()
      await expect(resumed).resolves.toBe(true)
      await controller.chooseTurnAction()
      expect(requests).toHaveLength(2)
      expect(requests[1].expectedRevision).toBe(44)
      onFailure.mock.calls[0][1]()
      expect(controller.isPaused).toBe(true)
    } finally {
      controller.dispose()
    }
  })
  it('selects a legal random input on the first timeout without pausing or retrying', async () => {
    const { controller, requests, logger, onFailure } = setup('timeout')
    try {
      const decision = await controller.chooseTurnAction()
      expect(decision?.source).toBe('random-timeout')
      expect(['a0', 'a1']).toContain(decision?.actionId)
      expect(decision?.command.type).toBe(
        decision?.actionId === 'a0' ? 'end-turn' : 'use-hero-power'
      )
      expect(requests).toHaveLength(1)
      expect(onFailure).not.toHaveBeenCalled()
      expect(controller.isPaused).toBe(false)
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] timeout-fallback',
        expect.objectContaining({ source: 'random-timeout' })
      )
    } finally {
      controller.dispose()
    }
  })
  it('automatically repairs both planning and action format failures', async () => {
    const { controller, requests, onFailure } = setup('plan-repair')
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        actionId: 'a0',
        source: 'model'
      })
      expect(requests).toHaveLength(4)
      expect(requests.map((request) => request.phase)).toEqual([
        'plan',
        'plan',
        'action',
        'action'
      ])
      expect(onFailure).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('invalidates retry controls and releases paused waiters on exit', async () => {
    const { controller, onFailure } = setup('provider')
    await controller.chooseTurnAction()
    const resumed = controller.waitForResume()
    controller.dispose()
    onFailure.mock.calls[0][1]()
    await expect(resumed).resolves.toBe(false)
    expect(await controller.chooseTurnAction()).toBeNull()
  })
  it('plans once per turn, checks the plan before acting, and skips mulligans', async () => {
    const { controller, requests, state, logger } = setup('plan')
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({ actionId: 'a0' })
      expect(requests.map((r) => r.phase)).toEqual(['plan', 'action'])
      expect(requests[1].messages.at(-1)?.content).toContain(
        'Correct mistaken arithmetic'
      )
      for (const check of [
        'battlecryConditions',
        'friendly casualties',
        'source is already present'
      ]) {
        expect(requests[1].messages.at(-1)?.content).toContain(check)
      }
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] turn-plan',
        expect.objectContaining({
          choice: expect.objectContaining({ plan: expect.any(Object) })
        })
      )
      await controller.chooseTurnAction()
      expect(requests.map((r) => r.phase)).toEqual(['plan', 'action', 'action'])
      state.turnNumber += 2
      state.revision++
      await controller.chooseTurnAction()
      expect(requests.slice(-2).map((r) => r.phase)).toEqual(['plan', 'action'])
      state.phase = 'mulligan'
      state.turnNumber = 0
      await controller.chooseMulligan()
      expect(requests.at(-1)?.phase).toBe('action')
    } finally {
      controller.dispose()
    }
  })
  it('preserves rejection data and reconstructs a renderer-local error', async () => {
    electron.invoke.mockResolvedValue(reject())
    const request = {
      matchId: 'm',
      requestId: 'r',
      expectedRevision: 1,
      actionIds: ['a0'],
      messages: [{ role: 'user' as const, content: 'Choose' }]
    }
    await expect(bridge().decide(request)).resolves.toEqual(reject())
    const error = await createAiDecisionApi(bridge())
      .decide(request)
      .catch((error) => error)
    expect(error).toBeInstanceOf(AiRequestError)
    expect(error.details).toEqual(details)
  })
  it('corrects once using the same facts and logs successful recovery', async () => {
    const { controller, requests, logger, onFailure } = setup()
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        actionId: 'a0',
        source: 'model'
      })
      expect(requests).toHaveLength(2)
      expect(requests[1].actionIds).toEqual(requests[0].actionIds)
      expect(requests[1].expectedRevision).toBe(requests[0].expectedRevision)
      expect(requests[1].messages.slice(0, -2)).toEqual(requests[0].messages)
      expect(requests[1].messages.at(-2)?.content).toBe(details.rejectedContent)
      expect(requests[1].messages.at(-1)?.content).toContain(
        'Your response failed validation'
      )
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] response-rejected',
        expect.objectContaining({ diagnostics: details })
      )
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] format-repair',
        expect.objectContaining({ repairCount: 1 })
      )
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] response-received',
        expect.objectContaining({ repairCount: 1 })
      )
      expect(onFailure).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it.each([
    ['reject', 2],
    ['provider', 1]
  ] as const)('pauses without a retry loop for %s', async (mode, count) => {
    const { controller, requests, onFailure } = setup(mode)
    try {
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(requests).toHaveLength(count)
      expect(onFailure).toHaveBeenCalledOnce()
      expect(controller.hasLegalActions()).toBe(false)
    } finally {
      controller.dispose()
    }
  })
  it('cancels pending work on exit without repair or a failure notice', async () => {
    const { controller, requests, onFailure } = setup('pending')
    const pending = controller.chooseTurnAction()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    controller.dispose()
    await expect(pending).resolves.toBeNull()
    expect(onFailure).not.toHaveBeenCalled()
    expect(electron.invoke).toHaveBeenCalledWith(
      AI_IPC_CHANNELS.cancel,
      expect.any(Object)
    )
  })
  it('reports external turn-loop failures once and stops future work', async () => {
    const { controller, onFailure, logger } = setup()
    controller.pause(new Error('Engine rejected move'))
    controller.pause(new Error('Second failure'))
    expect(await controller.chooseTurnAction()).toBeNull()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(
      '[Game AI] failure',
      expect.objectContaining({ reason: 'Engine rejected move', source: 'paused' })
    )
    controller.dispose()
  })
})
