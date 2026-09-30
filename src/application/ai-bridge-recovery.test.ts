import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AI_IPC_CHANNELS,
  AiRequestError,
  aiIpcFailure,
  aiIpcSuccess,
  type AiDecisionBridge,
  type AiDecisionRequest,
  type JsonObject
} from '../desktop/contracts/ipc/ai'
import { createAiDecisionApi } from './ai-decision-api'
import { AiTurnController } from '../scenes/match/ai/ai-turn-controller'
import type { GameBoardSession } from '../scenes/match/game-board-session'
import { aiActionIntent } from '../scenes/match/ai/ai-action-intent'
import type { AiDecisionChoice } from '../desktop/contracts/ipc/ai-deliberation'
import type { OpeningMatchPublicEvent } from '../game-rules/match'
import { asPlayerId } from '../game-rules/match/match-types'

const electron = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }))
const modelSnapshot = vi.hoisted(() => ({ value: { mana: 7 } as JsonObject }))
const legal = vi.hoisted(() => {
  const defaultLegalCommands = (): Record<string, unknown>[] => [
    { type: 'end-turn', participantId: 'ai' },
    { type: 'use-hero-power', participantId: 'ai' },
    {
      type: 'attack-character',
      participantId: 'ai',
      attacker: { kind: 'hero' },
      defender: { kind: 'hero' }
    }
  ]
  return {
    commands: defaultLegalCommands(),
    defaultLegalCommands
  }
})
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke, on: vi.fn(), removeListener: vi.fn() }
}))
vi.mock('../game-rules/match/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../game-rules/match/ai')>()
  return {
    ...actual,
    enumerateLegalCommands: () => legal.commands
  }
})
vi.mock('../scenes/match/ai/ai-context', () => ({
  aiSystemContext: () => ({ role: 'system', content: 'Choose a legal action.' }),
  aiMulliganSystemContext: () => ({
    role: 'system',
    content: 'Mulligan opening hand.'
  }),
  aiMulliganModelState: () => ({
    phase: 'mulligan',
    self: { hand: [{ ref: 'c1' }, { ref: 'c2' }] }
  }),
  aiActions: (_session, commands) =>
    commands.map((command, i) => ({
      id: `a${i}`,
      command,
      description: command.type,
      intent: aiActionIntent(command, 'human')
    })),
  aiActionFacts: (actions) => actions,
  aiModelState: () => modelSnapshot.value,
  aiJson: (value) => JSON.parse(JSON.stringify(value))
}))

let preload: AiDecisionBridge
beforeAll(async () => {
  const previous = Object.getOwnPropertyDescriptor(process, 'contextIsolated')
  Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  try {
    await import('../desktop/preload/index')
    preload = electron.expose.mock.calls[0][1].ai
  } finally {
    if (previous) Object.defineProperty(process, 'contextIsolated', previous)
    else delete (process as unknown as Record<string, unknown>).contextIsolated
  }
})
afterEach(() => {
  modelSnapshot.value = { mana: 7 }
  electron.invoke.mockReset()
  legal.commands = legal.defaultLegalCommands()
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
/** Still rejected after cosmetic target normalization (wrong source on end-turn). */
const repairableIntentMismatch = () => ({
  ...commitChoice(),
  intent: { ...commitChoice().intent, source: 'wrong-source' }
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
  choose?: (request: AiDecisionRequest, count: number) => AiDecisionChoice,
  handInstanceIds: readonly string[] = ['c1', 'c2']
) {
  const requests: AiDecisionRequest[] = []
  const publicEvents: OpeningMatchPublicEvent[] = []
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
      const priorActionRequests = requests.filter((entry) => entry.phase === 'action')
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
      if (request.phase === 'mulligan')
        return aiIpcSuccess({
          ...request,
          reason: 'Keep the curve.',
          choice: choose
            ? choose(request, requests.length)
            : { replace: [], planUpdate: null },
          modelId: 'test',
          durationMs: 1,
          finishReason: 'stop'
        })
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
      if (mode === 'provider') {
        if (request.phase === 'plan') {
          return aiIpcSuccess({
            ...request,
            reason: 'Objective',
            choice: planChoice(),
            modelId: 'test',
            durationMs: 1,
            finishReason: 'stop'
          })
        }
        return aiIpcFailure(
          new AiRequestError('Provider failure.', { repairable: false })
        )
      }
      if (mode === 'recover') {
        if (request.phase === 'plan') {
          return aiIpcSuccess({
            ...request,
            reason: 'Objective',
            choice: planChoice(),
            modelId: 'test',
            durationMs: 1,
            finishReason: 'stop'
          })
        }
        if (request.phase === 'action' && priorActionRequests.length === 0)
          return reject()
        return aiIpcSuccess({
          ...request,
          reason: 'Choose.',
          choice: commitChoice(),
          modelId: 'test',
          durationMs: 1,
          finishReason: 'stop'
        })
      }
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
  const onAbandoned = vi.fn()
  const state = {
    revision: 43,
    turnNumber: 13,
    phase: 'turns',
    activePlayerId: 'ai'
  }
  const session = {
    remoteParticipantId: 'ai',
    localParticipantId: 'human',
    getState: () => state,
    findPlayer: () => ({
      hand: handInstanceIds.map((instanceId) => ({ instanceId }))
    }),
    subscribe: () => () => {},
    getAiEventCursor: () => 0,
    getAiEventsSince: () => publicEvents,
    getAiPublicHistory: () => ({ recentEvents: [] }),
    acknowledgeAiEvents: () => {},
    match: { getState: () => ({}), getPlayInput: () => {}, getLegality: () => ({}) }
  } as unknown as GameBoardSession
  const controller = new AiTurnController({
    session,
    api: createAiDecisionApi(bridge()),
    logger,
    onAbandoned
  })
  return { controller, requests, logger, onAbandoned, state, publicEvents }
}
describe('preload to renderer recovery', () => {
  it.each([true, false])(
    'reviews an unused-resource pass once and permits a strategic pass (change=%s)',
    async (change) => {
      modelSnapshot.value = {
        players: [
          { role: 'opponent', mana: { available: 1, maximum: 8 } },
          { role: 'self', mana: { available: 8, maximum: 8 }, hero: { health: 13 } }
        ]
      }
      const test = setup('plan', (request, count) => {
        if (request.phase === 'plan') return planChoice()
        if (count === 2) return repairableIntentMismatch()
        if (count === 4 && change)
          return {
            ...commitChoice(),
            actionId: 'a1',
            intent: aiActionIntent(legal.commands[1] as never, 'human')
          }
        return commitChoice()
      })
      try {
        expect(await test.controller.chooseTurnAction()).toMatchObject({
          actionId: change ? 'a1' : 'a0'
        })
        expect(test.requests).toHaveLength(4)
        for (const request of test.requests) {
          const latest = JSON.parse(request.messages.at(-1)!.content)
          expect(latest.currentDecision).toMatchObject({
            self: { mana: { available: 8 } },
            opponent: { mana: { available: 1 } }
          })
          expect(latest.actions.map((a) => a.id)).toEqual(['a0', 'a1', 'a2'])
        }
        expect(test.requests[2].messages.at(-1)!.content).toContain(
          'reconsider any premise'
        )
        expect(
          JSON.parse(test.requests[3].messages.at(-1)!.content).endTurnReview
        ).toBe(true)
        expect(test.requests[3].allowInspection).toBe(false)
        expect(
          test.logger.info.mock.calls.filter(
            ([kind]) => kind === '[Game AI] end-turn-review'
          )
        ).toHaveLength(1)
        expect(test.onAbandoned).not.toHaveBeenCalled()
      } finally {
        test.controller.dispose()
      }
    }
  )
  it('discards an End Turn review response after a revision change', async () => {
    modelSnapshot.value = { players: [{ role: 'self', mana: { available: 8 } }] }
    const test = setup('plan', (request, count) => {
      if (count === 3) test.state.revision++
      return request.phase === 'plan' ? planChoice() : commitChoice()
    })
    try {
      expect(await test.controller.chooseTurnAction()).toBeNull()
      expect(test.requests).toHaveLength(3)
      expect(test.onAbandoned).not.toHaveBeenCalled()
    } finally {
      test.controller.dispose()
    }
  })
  it('silently recovers with fresh facts after a failed correction and drops stale action IDs', async () => {
    const { controller, requests, state, onAbandoned, logger, publicEvents } = setup(
      'plan',
      (request, count) =>
        request.phase === 'plan'
          ? planChoice()
          : count === 3 || count === 4
            ? repairableIntentMismatch()
            : commitChoice()
    )
    publicEvents.push({
      type: 'character-healed',
      participantId: asPlayerId('ai'),
      character: { kind: 'hero' },
      amount: 0,
      healthBefore: 30,
      healthAfter: 30
    })
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({ source: 'model' })
      publicEvents.length = 0
      state.revision++
      expect(await controller.chooseTurnAction()).toMatchObject({
        source: 'model',
        expectedRevision: 44
      })
      expect(requests).toHaveLength(6)
      expect(
        requests[2].messages
          .slice(1, -1)
          .some((m) => m.content.includes('firstActionId'))
      ).toBe(false)
      expect(requests[4].requestId).not.toBe(requests[3].requestId)
      expect(requests[4].messages).toHaveLength(2)
      expect(JSON.parse(requests[4].messages[1].content)).toMatchObject({
        state: { mana: 7 },
        revision: 44,
        recentPublicEvents: []
      })
      expect(JSON.parse(requests[4].messages[1].content).observedCorrections).toEqual([
        expect.objectContaining({
          evidence: expect.objectContaining({
            healthBefore: 30,
            healthAfter: 30,
            restored: 0
          })
        })
      ])
      expect(requests[4].messages.some((m) => m.content.includes('wrong-target'))).toBe(
        false
      )
      expect(requests[5].allowInspection).toBe(false)
      expect(onAbandoned).not.toHaveBeenCalled()
      expect(
        logger.info.mock.calls.filter(
          ([kind]) => kind === '[Game AI] fresh-context-retry'
        )
      ).toHaveLength(1)
    } finally {
      controller.dispose()
    }
  })
  it('discards a fresh recovery response when its revision becomes stale', async () => {
    const test = setup('plan', (request, count) => {
      if (count === 4) test.state.revision++
      return request.phase === 'plan' ? planChoice() : repairableIntentMismatch()
    })
    try {
      expect(await test.controller.chooseTurnAction()).toBeNull()
      expect(test.requests).toHaveLength(4)
      expect(test.onAbandoned).not.toHaveBeenCalled()
    } finally {
      test.controller.dispose()
    }
  })
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
  it('silently retries after repeated inspection without abandoning the match', async () => {
    let inspectCount = 0
    const { controller, requests, onAbandoned } = setup('plan', (r) => {
      if (r.phase === 'plan') return planChoice()
      inspectCount++
      if (inspectCount >= 8) return commitChoice()
      return { inspect: [check] }
    })
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({ source: 'model' })
      expect(requests.length).toBeGreaterThanOrEqual(6)
      expect(requests.slice(4).every((r) => !r.allowInspection)).toBe(true)
      expect(onAbandoned).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it.each([
    ['null', null],
    ['wrong slot', 1]
  ] as const)(
    'accepts position-only intent mismatch (%s) without a repair call',
    async (_label, position) => {
      legal.commands = [
        {
          type: 'play-card',
          participantId: 'ai',
          cardInstanceId: 'ai-player:deck:18',
          position: 0
        },
        {
          type: 'play-card',
          participantId: 'ai',
          cardInstanceId: 'ai-player:deck:19',
          position: 0
        },
        { type: 'end-turn', participantId: 'ai' }
      ]
      const { controller, requests, logger, onAbandoned } = setup('plan', (request) => {
        if (request.phase === 'plan') {
          return {
            ...planChoice(),
            plan: { ...planChoice().plan, firstActionId: 'a0' }
          }
        }
        return {
          actionId: 'a0',
          intent: {
            type: 'play-card',
            source: 'ai-player:deck:18',
            targets: [],
            position,
            option: null
          },
          expectedResult: 'Play the card at the selected slot.',
          planUpdate: null
        }
      })
      try {
        expect(await controller.chooseTurnAction()).toMatchObject({
          source: 'model',
          actionId: 'a0',
          command: {
            type: 'play-card',
            cardInstanceId: 'ai-player:deck:18',
            position: 0
          }
        })
        expect(requests).toHaveLength(2)
        expect(onAbandoned).not.toHaveBeenCalled()
        expect(
          logger.info.mock.calls.some(
            ([kind]) => kind === '[Game AI] intent-normalized'
          )
        ).toBe(true)
        expect(
          logger.info.mock.calls.some(([kind]) => kind === '[Game AI] format-repair')
        ).toBe(false)
      } finally {
        controller.dispose()
      }
    }
  )
  it.each([true, false])(
    'repairs an ID/intent mismatch without dispatching it (correction=%s)',
    async (correct) => {
      let mismatchCount = 0
      const { controller, requests, onAbandoned, logger } = setup(
        'plan',
        (r, count) => {
          if (r.phase === 'plan') return planChoice()
          if (correct && count === 3) return commitChoice()
          mismatchCount++
          if (!correct && mismatchCount >= 6) return commitChoice()
          return repairableIntentMismatch()
        }
      )
      try {
        const decision = await controller.chooseTurnAction()
        expect(requests.length).toBeGreaterThanOrEqual(correct ? 3 : 5)
        expect(requests[2].messages.at(-1)?.content).toContain(
          'Action ID and intent disagree'
        )
        expect(decision).toMatchObject({ source: 'model', actionId: 'a0' })
        expect(onAbandoned).not.toHaveBeenCalled()
        if (!correct) {
          expect(
            logger.warn.mock.calls.some(([kind]) => kind === '[Game AI] failure')
          ).toBe(true)
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
      expect(test.onAbandoned).not.toHaveBeenCalled()
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
  it('asks the model when pass remains a strategic alternative', async () => {
    legal.commands = [
      {
        type: 'play-card',
        participantId: 'ai',
        cardInstanceId: 'ai-player:deck:18',
        position: 0
      },
      { type: 'end-turn', participantId: 'ai' }
    ]
    const { controller, requests } = setup('plan', (request) => {
      if (request.phase === 'plan') return planChoice()
      const command = legal.commands[0]!
      return {
        actionId: 'a0',
        intent: aiActionIntent(command as never, 'human'),
        expectedResult: 'Play the available card.',
        planUpdate: null
      }
    })
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        source: 'model',
        command: {
          type: 'play-card',
          cardInstanceId: 'ai-player:deck:18',
          position: 0
        }
      })
      expect(requests.length).toBeGreaterThan(0)
    } finally {
      controller.dispose()
    }
  })
  it('still calls the model when two actionable commands remain besides pass', async () => {
    legal.commands = [
      {
        type: 'attack-character',
        participantId: 'ai',
        attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
        defender: { kind: 'minion', instanceId: 'human-player:deck:8' }
      },
      {
        type: 'attack-character',
        participantId: 'ai',
        attacker: { kind: 'minion', instanceId: 'ai-player:deck:10' },
        defender: { kind: 'hero' }
      },
      { type: 'end-turn', participantId: 'ai' }
    ]
    const { controller, requests } = setup('plan', (request) => {
      if (request.phase === 'plan') return planChoice()
      const command = legal.commands[0]!
      return {
        actionId: 'a0',
        intent: aiActionIntent(command as never, 'human'),
        expectedResult: 'Attack with the minion.',
        planUpdate: null
      }
    })
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({ source: 'model' })
      expect(requests.length).toBeGreaterThan(0)
    } finally {
      controller.dispose()
    }
  })
  it('accepts extra targets on a targeted play without format repair', async () => {
    legal.commands = [
      {
        type: 'play-card',
        participantId: 'ai',
        cardInstanceId: 'ai-player:deck:18',
        position: 0,
        targets: [{ kind: 'hero', participantId: 'human' }]
      },
      {
        type: 'play-card',
        participantId: 'ai',
        cardInstanceId: 'ai-player:deck:18',
        position: 1,
        targets: [{ kind: 'hero', participantId: 'human' }]
      },
      { type: 'end-turn', participantId: 'ai' }
    ]
    const { controller, requests, logger } = setup('plan', (request) => {
      if (request.phase === 'plan') {
        return {
          ...planChoice(),
          plan: { ...planChoice().plan, firstActionId: 'a0' }
        }
      }
      return {
        actionId: 'a0',
        intent: {
          type: 'play-card',
          source: 'ai-player:deck:18',
          targets: ['human:hero', 'human-player:deck:29'],
          position: null,
          option: null
        },
        expectedResult: 'Damage the hero.',
        planUpdate: null
      }
    })
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        source: 'model',
        actionId: 'a0',
        command: {
          type: 'play-card',
          cardInstanceId: 'ai-player:deck:18',
          position: 0
        }
      })
      expect(requests).toHaveLength(2)
      expect(
        logger.info.mock.calls.some(([kind]) => kind === '[Game AI] intent-normalized')
      ).toBe(true)
      expect(
        logger.info.mock.calls.some(([kind]) => kind === '[Game AI] format-repair')
      ).toBe(false)
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
    const { controller, requests, onAbandoned } = setup('plan-timeout')
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
      expect(onAbandoned).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('does not select a fallback for a stale request', async () => {
    const { controller, logger, onAbandoned } = setup('stale-timeout')
    try {
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(
        logger.info.mock.calls.some(([kind]) => kind === '[Game AI] timeout-fallback')
      ).toBe(false)
      expect(onAbandoned).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('silently retries after a provider failure and keeps the current revision', async () => {
    vi.useFakeTimers()
    let actionFailures = 0
    const { controller, requests, onAbandoned } = setup('provider')
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
        if (request.phase === 'plan') {
          return aiIpcSuccess({
            ...request,
            reason: 'Objective',
            choice: planChoice(),
            modelId: 'test',
            durationMs: 1,
            finishReason: 'stop'
          })
        }
        actionFailures++
        if (actionFailures === 1)
          return aiIpcFailure(
            new AiRequestError('Provider failure.', { repairable: false })
          )
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
    try {
      const pending = controller.chooseTurnAction()
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toMatchObject({ source: 'model' })
      expect(requests.filter((entry) => entry.phase === 'action')).toHaveLength(2)
      expect(onAbandoned).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
      vi.useRealTimers()
    }
  })
  it('selects a legal random input on the first timeout without pausing or retrying', async () => {
    const { controller, requests, logger, onAbandoned } = setup('timeout')
    try {
      const decision = await controller.chooseTurnAction()
      expect(decision?.source).toBe('random-timeout')
      expect(['a0', 'a1', 'a2']).toContain(decision?.actionId)
      expect(
        legal.commands.find((_command, index) => decision?.actionId === 'a' + index)
          ?.type
      ).toBe(decision?.command.type)
      expect(requests).toHaveLength(1)
      expect(onAbandoned).not.toHaveBeenCalled()
      expect(controller.isAbandoned).toBe(false)
      expect(logger.info).toHaveBeenCalledWith(
        '[Game AI] timeout-fallback',
        expect.objectContaining({ source: 'random-timeout' })
      )
    } finally {
      controller.dispose()
    }
  })
  it('automatically repairs both planning and action format failures', async () => {
    const { controller, requests, onAbandoned } = setup('plan-repair')
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
      expect(onAbandoned).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('stops silent retries on exit without abandoning the match', async () => {
    const { controller, onAbandoned } = setup('provider')
    const pending = controller.chooseTurnAction()
    await Promise.resolve()
    controller.dispose()
    await expect(pending).resolves.toBeNull()
    expect(onAbandoned).not.toHaveBeenCalled()
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
      legal.commands = [
        { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: [] },
        { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: ['c1'] },
        { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: ['c2'] },
        {
          type: 'confirm-mulligan',
          participantId: 'ai',
          replaceInstanceIds: ['c1', 'c2']
        }
      ]
      await controller.chooseMulligan()
      expect(requests.at(-1)?.phase).toBe('mulligan')
      expect(requests.at(-1)?.actionIds).toEqual(['c1', 'c2'])
    } finally {
      controller.dispose()
    }
  })
  it('maps mulligan replace refs to a legal confirm-mulligan without format repair', async () => {
    legal.commands = [
      { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: [] },
      { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: ['c1'] }
    ]
    const { controller, requests, logger, state } = setup('recover', () => ({
      replace: ['c1'],
      planUpdate: null
    }))
    try {
      state.phase = 'mulligan'
      expect(await controller.chooseMulligan()).toMatchObject({
        source: 'model',
        actionId: 'mulligan',
        command: {
          type: 'confirm-mulligan',
          participantId: 'ai',
          replaceInstanceIds: ['c1']
        }
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.phase).toBe('mulligan')
      expect(
        logger.info.mock.calls.some(([kind]) => kind === '[Game AI] format-repair')
      ).toBe(false)
    } finally {
      controller.dispose()
    }
  })
  it('accepts a mulligan replace set by ordering refs in hand order, not lexically', async () => {
    const handOrder = ['c3', 'c1', 'c2']
    legal.commands = [
      { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: [] },
      { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: ['c3'] },
      { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: ['c1'] },
      { type: 'confirm-mulligan', participantId: 'ai', replaceInstanceIds: ['c2'] },
      {
        type: 'confirm-mulligan',
        participantId: 'ai',
        replaceInstanceIds: ['c3', 'c1']
      },
      {
        type: 'confirm-mulligan',
        participantId: 'ai',
        replaceInstanceIds: ['c3', 'c1', 'c2']
      }
    ]
    const { controller, requests, state } = setup(
      'recover',
      () => ({
        replace: ['c2', 'c1', 'c3'],
        planUpdate: null
      }),
      handOrder
    )
    try {
      state.phase = 'mulligan'
      expect(await controller.chooseMulligan()).toMatchObject({
        source: 'model',
        actionId: 'mulligan',
        command: {
          type: 'confirm-mulligan',
          participantId: 'ai',
          replaceInstanceIds: ['c3', 'c1', 'c2']
        }
      })
      expect(requests).toHaveLength(1)
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
    const { controller, requests, logger, onAbandoned } = setup()
    try {
      expect(await controller.chooseTurnAction()).toMatchObject({
        actionId: 'a0',
        source: 'model'
      })
      expect(requests.some((entry) => entry.phase === 'action')).toBe(true)
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
      expect(onAbandoned).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
  it('abandons once when the AI has no legal inputs during its turn', async () => {
    legal.commands = []
    const { controller, onAbandoned, logger } = setup('provider')
    try {
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(await controller.chooseTurnAction()).toBeNull()
      expect(onAbandoned).toHaveBeenCalledOnce()
      expect(controller.isAbandoned).toBe(true)
      expect(controller.hasLegalActions()).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        '[Game AI] failure',
        expect.objectContaining({
          reason: 'Active AI has no legal inputs.',
          source: 'abandoned'
        })
      )
    } finally {
      controller.dispose()
      legal.commands = legal.defaultLegalCommands()
    }
  })
  it('cancels pending work on exit without repair or a failure notice', async () => {
    const { controller, requests, onAbandoned } = setup('pending')
    const pending = controller.chooseTurnAction()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    controller.dispose()
    await expect(pending).resolves.toBeNull()
    expect(onAbandoned).not.toHaveBeenCalled()
    expect(electron.invoke).toHaveBeenCalledWith(
      AI_IPC_CHANNELS.cancel,
      expect.any(Object)
    )
  })
  it('does not abandon while legal inputs remain after a logged retry failure', async () => {
    vi.useFakeTimers()
    let actionFailures = 0
    const { controller, onAbandoned, logger } = setup('provider')
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
        if (request.phase === 'plan') {
          return aiIpcSuccess({
            ...request,
            reason: 'Objective',
            choice: planChoice(),
            modelId: 'test',
            durationMs: 1,
            finishReason: 'stop'
          })
        }
        actionFailures++
        if (actionFailures <= 2)
          return aiIpcFailure(
            new AiRequestError('Provider failure.', { repairable: false })
          )
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
    try {
      const pending = controller.chooseTurnAction()
      await vi.advanceTimersByTimeAsync(2000)
      await expect(pending).resolves.toMatchObject({ source: 'model' })
      expect(onAbandoned).not.toHaveBeenCalled()
      expect(
        logger.warn.mock.calls.filter(([kind]) => kind === '[Game AI] failure').length
      ).toBeGreaterThan(0)
    } finally {
      controller.dispose()
      vi.useRealTimers()
    }
  })
})
