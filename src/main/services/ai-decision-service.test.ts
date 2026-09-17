import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { AiDecisionService } from './ai-decision-service'
import { AiRequestError, parseAiRequestProgress } from '../../shared/ipc/ai'
import type { Post } from './ai-transport'
import { parseAiConfig } from './ai-config'
import type { OpenRouterConfig } from './ai-config'
import { AiLog } from './ai-log'
import { AiConversationTranscript } from './ai-conversation-transcript'
import type { JsonValue, JsonObject } from '../../shared/ipc/ai'

const config: OpenRouterConfig = {
  enabled: true,
  provider: 'openrouter',
  modelId: 'test',
  reasoningEffort: 'low',
  maxCompletionTokens: 1000,
  apiKey: 'secret-key'
}
const request = {
  matchId: 'm',
  requestId: 'r',
  expectedRevision: 1,
  actionIds: ['a0'],
  messages: [{ role: 'user', content: 'Choose' }]
}
const usage = { prompt_tokens: 100, completion_tokens: 12 }
const commit = (actionId = 'a0') =>
  JSON.stringify({
    reason: 'End.',
    choice: {
      actionId,
      intent: {
        type: 'end-turn',
        source: null,
        targets: [],
        position: null,
        option: null
      },
      expectedResult: 'Pass initiative.',
      planUpdate: null
    }
  })
const plan = {
  objective: 'Conserve resources.',
  winCheck: 'Not found.',
  lossRisk: 'Opponent develops.',
  candidates: [
    {
      sequence: ['End turn.'],
      budget: '0 mana.',
      endPosition: 'Unchanged board.',
      opponentReply: 'Develop a minion.'
    }
  ],
  preferred: 0,
  firstActionId: 'a0',
  checks: []
}
function setup(content: string, finish = 'stop') {
  const post = vi.fn(async () => ({
    model: 'test',
    choices: [{ finish_reason: finish, message: { content } }],
    usage
  }))
  return new AiDecisionService({ loadConfig: async () => config, post })
}
describe('AI decision validation and diagnostics', () => {
  it('retains planning phase across recovery and still validates the recovered response', async () => {
    const post = vi.fn<Post>(async () =>
      post.mock.calls.length === 1
        ? { choices: [{ finish_reason: 'error' }] }
        : {
            model: 'test',
            choices: [{ finish_reason: 'stop', message: { content: commit() } }]
          }
    )
    const progress = vi.fn()
    await expect(
      new AiDecisionService({ loadConfig: async () => config, post }).decide(
        { ...request, phase: 'plan' },
        new AbortController().signal,
        progress
      )
    ).rejects.toMatchObject({
      details: { repairable: true, failureKind: 'invalid-choice' }
    })
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]![1]).toBe(post.mock.calls[1]![1])
    expect(
      progress.mock.calls.find(([p]) => p.stage === 'retry-scheduled')?.[0].recovery
        .phase
    ).toBe('plan')
  })
  it('recognizes nested non-streaming errors and preserves permanent classifications', async () => {
    const post = vi.fn<Post>(async () => ({
      model: 'test',
      choices: [
        {
          finish_reason: 'error',
          error: {
            code: 503,
            metadata: {
              error_type: 'content_policy_violation',
              provider_code: 'blocked'
            },
            message: 'Declined'
          }
        }
      ]
    }))
    await expect(
      new AiDecisionService({ loadConfig: async () => config, post }).decide(
        request,
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      details: {
        retryable: false,
        providerErrorType: 'content_policy_violation',
        providerNativeCode: 'blocked'
      }
    })
    expect(post).toHaveBeenCalledOnce()
  })
  it.each([1, 2])(
    'recovers after %i interrupted responses using identical request bytes',
    async (failures) => {
      const progress: unknown[] = []
      const post = vi.fn<Post>(async () =>
        post.mock.calls.length <= failures
          ? {
              model: 'test',
              id: 'generation',
              error: {
                code: 503,
                message: 'secret-key overloaded',
                metadata: { error_type: 'provider_unavailable' }
              },
              choices: [
                { finish_reason: 'error', message: { content: '{incomplete' } }
              ],
              usage: { prompt_tokens: 12 }
            }
          : {
              model: 'test',
              choices: [{ finish_reason: 'stop', message: { content: commit() } }]
            }
      )
      const loadConfig = vi.fn(async () => config)
      const service = new AiDecisionService({ loadConfig, post })
      const result = await service.decide(request, new AbortController().signal, (p) =>
        progress.push(parseAiRequestProgress(p))
      )
      expect(result.choice).toMatchObject({ actionId: 'a0' })
      expect(post).toHaveBeenCalledTimes(failures + 1)
      expect(loadConfig).toHaveBeenCalledOnce()
      expect(new Set(post.mock.calls.map((c) => c[1])).size).toBe(1)
      expect(progress).toContainEqual(
        expect.objectContaining({
          stage: 'recovery-complete',
          recovery: expect.objectContaining({ attempt: failures + 1, phase: 'action' })
        })
      )
      expect(JSON.stringify(progress)).not.toContain('secret-key')
      expect(JSON.stringify(progress)).not.toContain('incomplete')
    }
  )
  it('exhausts recovery after three errors and never returns partial actions', async () => {
    const post = vi.fn<Post>(async () => ({
      model: 'test',
      choices: [{ finish_reason: 'error', message: { content: commit() } }]
    }))
    const progress = vi.fn()
    const service = new AiDecisionService({ loadConfig: async () => config, post })
    await expect(
      service.decide(request, new AbortController().signal, progress)
    ).rejects.toMatchObject({ details: { repairable: false, recoveryAttempts: 3 } })
    expect(post).toHaveBeenCalledTimes(3)
    expect(
      progress.mock.calls.filter(([p]) => p.stage === 'recovery-exhausted')
    ).toHaveLength(1)
  })
  it.each([401, 402, 403, 400])(
    'does not retry a permanent HTTP-200 provider error %i',
    async (code) => {
      const post = vi.fn<Post>(async () => ({
        error: { code, message: 'Permanent error' },
        choices: [{ finish_reason: 'error' }]
      }))
      await expect(
        new AiDecisionService({ loadConfig: async () => config, post }).decide(
          request,
          new AbortController().signal
        )
      ).rejects.toMatchObject({
        details: { providerErrorCode: code, retryable: false }
      })
      expect(post).toHaveBeenCalledOnce()
    }
  )
  it('cancels backoff and prevents subsequent transport attempts', async () => {
    const controller = new AbortController()
    const post = vi.fn<Post>(async () => {
      throw new AiRequestError('Disconnected', {
        failureKind: 'network',
        repairable: false
      })
    })
    const service = new AiDecisionService({ loadConfig: async () => config, post })
    const pending = service.decide(request, controller.signal, (p) => {
      if (p.stage === 'retry-scheduled') controller.abort(new Error('State changed'))
    })
    await expect(pending).rejects.toBeDefined()
    expect(post).toHaveBeenCalledOnce()
  })
  it('does not retry timeouts or wait beyond the recovery deadline', async () => {
    for (const details of [
      { failureKind: 'timeout' },
      { failureKind: 'provider-http', httpStatus: 429, retryAfterMs: 60_000 }
    ] as JsonObject[]) {
      const post = vi.fn<Post>(async () => {
        throw new AiRequestError('Unavailable', { ...details, repairable: false })
      })
      await expect(
        new AiDecisionService({ loadConfig: async () => config, post }).decide(
          request,
          new AbortController().signal
        )
      ).rejects.toBeDefined()
      expect(post).toHaveBeenCalledOnce()
    }
  })
  afterEach(() => vi.unstubAllEnvs())
  it('summarizes cache unknowns separately from reported zero and keeps phase timings distinct', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hs-ai-telemetry-'))
    try {
      writeFileSync(
        join(directory, 'ai.json'),
        JSON.stringify({
          decisions: [
            {
              kind: 'request-started',
              provider: 'openrouter',
              modelId: 'test',
              reasoningEffort: 'low'
            },
            { kind: 'request-progress', stage: 'transport-started' },
            { kind: 'turn-plan', durationMs: 1000, usage: { prompt_tokens: 100 } },
            { kind: 'request-progress', stage: 'transport-started' },
            { kind: 'request-progress', stage: 'response-validated', elapsedMs: 1000 },
            {
              kind: 'request-progress',
              stage: 'attempt-failed',
              recovery: { attemptDurationMs: 10, usage: { prompt_tokens: 12 } }
            },
            {
              kind: 'request-progress',
              stage: 'retry-scheduled',
              recovery: { delayMs: 500 }
            },
            { kind: 'request-progress', stage: 'transport-started' },
            {
              kind: 'request-progress',
              stage: 'recovery-complete',
              recovery: { totalDurationMs: 760 }
            },
            { kind: 'failure', diagnostics: { usage: { prompt_tokens: 12 } } },
            {
              kind: 'response-received',
              durationMs: 250,
              usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } }
            },
            {
              kind: 'decision-timing',
              decisionMs: 1250,
              presentationMs: 600,
              presentationOverlapMs: 600,
              visibleWaitMs: 650
            }
          ]
        })
      )
      const report = JSON.parse(
        execFileSync(
          process.execPath,
          [resolve('scripts/summarize-ai-telemetry.cjs'), directory],
          { encoding: 'utf8' }
        )
      )
      expect(report.matches).toBe(1)
      expect(report.groups[0]).toMatchObject({
        transportCalls: 3,
        input: { reportedResponses: 3, tokens: 212 },
        recovery: {
          additionalAttemptsScheduled: 1,
          providerCallsRecovered: 1,
          failedAttemptTimeMs: 10
        },
        successfulRequestDuration: {
          plan: { samples: 1, medianMs: 1000 },
          action: { samples: 1, medianMs: 250 }
        },
        cachedInput: { reportedResponses: 1, tokens: 0 },
        reasoning: { reportedResponses: 0, tokens: null },
        visibleWaitMs: { medianMs: 650 }
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
  it('can disable session affinity without changing any other request field', async () => {
    const post = vi.fn<Post>(async () => ({
      model: 'test',
      choices: [{ finish_reason: 'stop', message: { content: commit() } }]
    }))
    const service = new AiDecisionService({ loadConfig: async () => config, post })
    vi.stubEnv('HSINSPIRED_AI_SESSION_AFFINITY', '1')
    await service.decide(request, new AbortController().signal)
    const enabled = JSON.parse(post.mock.calls[0]![1])
    vi.stubEnv('HSINSPIRED_AI_SESSION_AFFINITY', '0')
    await service.decide(request, new AbortController().signal)
    const baseline = JSON.parse(post.mock.calls[1]![1])
    expect(enabled).toEqual({ ...baseline, session_id: request.matchId })
    expect(baseline).not.toHaveProperty('session_id')
  })
  it('keeps OpenRouter session identity across decisions without changing messages', async () => {
    vi.stubEnv('HSINSPIRED_AI_SESSION_AFFINITY', '1')
    const post = vi.fn<Post>(async () => ({
      model: 'test',
      choices: [{ finish_reason: 'stop', message: { content: commit() } }]
    }))
    const service = new AiDecisionService({ loadConfig: async () => config, post })
    for (const value of [
      request,
      { ...request, requestId: 'r2', expectedRevision: 2 },
      { ...request, matchId: 'new-match' }
    ]) {
      await service.decide(value, new AbortController().signal)
      const body = JSON.parse(post.mock.calls.at(-1)![1])
      expect(body.session_id).toBe(value.matchId)
      expect(body.messages).toEqual(value.messages)
      expect(body.provider).toEqual({ require_parameters: true })
      expect(body.reasoning).toEqual({ effort: 'low' })
    }
  })
  it('accepts plans only during planning and actions only during action selection', async () => {
    const service = setup(JSON.stringify({ reason: 'Objective.', choice: { plan } }))
    await expect(
      service.decide({ ...request, phase: 'plan' }, new AbortController().signal)
    ).resolves.toMatchObject({ choice: { plan } })
    await expect(
      service.decide(request, new AbortController().signal)
    ).rejects.toMatchObject({ details: { failureKind: 'invalid-choice' } })
    await expect(
      setup(commit()).decide(
        { ...request, phase: 'plan' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ details: { failureKind: 'invalid-choice' } })
  })
  it('passes the selected deadline to transport and rejects excessive payloads locally', async () => {
    const post = vi.fn<Post>(async () => ({
      model: 'test',
      choices: [
        {
          finish_reason: 'stop',
          message: { content: commit() }
        }
      ]
    }))
    const service = new AiDecisionService({
      loadConfig: async () => ({
        ...config,
        requestTimeoutMs: 5000,
        maxContextBytes: 1000
      }),
      post
    })
    await service.decide(request, new AbortController().signal)
    expect(post.mock.calls[0]?.[6]).toBeGreaterThan(0)
    expect(post.mock.calls[0]?.[6]).toBeLessThanOrEqual(5000)
    post.mockClear()
    await expect(
      service.decide(
        { ...request, messages: [{ role: 'user', content: 'x'.repeat(60_000) }] },
        new AbortController().signal
      )
    ).rejects.toThrow('context allowance')
    expect(post).not.toHaveBeenCalled()
  })
  it.each([
    ['broken', 'invalid-json'],
    ['{"reason":"ask","choice":{"info":"remaining-deck"}}', 'invalid-structure'],
    ['{"reason":"ask","choice":{"cards":["Book Wyrm"]}}', 'invalid-structure'],
    ['{"actionId":"a0"}', 'invalid-structure'],
    [commit('a99'), 'invalid-choice']
  ])('classifies %s and retains rejected completion usage', async (content, kind) => {
    const error = await setup(content)
      .decide(request, new AbortController().signal)
      .catch((error) => error)
    expect(error.details).toMatchObject({
      failureKind: kind,
      repairable: true,
      usage,
      reasoningEffort: 'low'
    })
    const document: Record<string, JsonValue> = { decisions: [] }
    new AiLog(document).accept({
      stream: 'decisions',
      kind: 'response-rejected',
      timestamp: 'now',
      data: { diagnostics: error.details }
    })
    expect(document.decisions).toEqual([
      expect.objectContaining({ diagnostics: expect.objectContaining({ usage }) })
    ])
  })
  it('does not repair truncated completions', async () => {
    await expect(
      setup('{}', 'length').decide(request, new AbortController().signal)
    ).rejects.toMatchObject({ details: { repairable: false, usage } })
  })
  it('returns successful choices unchanged', async () => {
    await expect(
      setup(commit()).decide(request, new AbortController().signal)
    ).resolves.toMatchObject({ choice: { actionId: 'a0' }, usage })
  })
  it('supports bounded per-profile limits without changing existing profiles', () => {
    const parse = (fields = {}) =>
      parseAiConfig(
        { providers: [{ ...config, ...fields }] },
        { openRouter: 'key', azureOpenAi: '' }
      )
    expect(parse()).toMatchObject({
      requestTimeoutMs: 45_000,
      maxContextBytes: 200_000
    })
    expect(parse({ requestTimeoutMs: 300_000, maxContextBytes: 20_000 })).toMatchObject(
      { requestTimeoutMs: 300_000, maxContextBytes: 20_000 }
    )
    expect(() => parse({ requestTimeoutMs: 0 })).toThrow()
    expect(() => parse({ maxContextBytes: 0 })).toThrow()
  })
  it('accepts inspection only when the controller explicitly allows it', async () => {
    const inspect = [
      {
        topic: 'action',
        ref: 'a0',
        question: 'What executes?',
        decisionImpact: 'Confirm the selected input.'
      }
    ]
    const service = setup(JSON.stringify({ reason: 'Check.', choice: { inspect } }))
    await expect(
      service.decide(
        { ...request, allowInspection: true },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ choice: { inspect } })
    for (const extra of [
      { allowInspection: false },
      { phase: 'plan', allowInspection: true }
    ])
      await expect(
        service.decide({ ...request, ...extra }, new AbortController().signal)
      ).rejects.toMatchObject({
        details: { failureKind: 'invalid-choice', repairable: true }
      })
  })
  it('records factual answers and revised plans, and labels timeout executions honestly', () => {
    const document: Record<string, JsonValue> = { decisions: [] }
    const inspection = {
      stream: 'decisions' as const,
      kind: 'fact-inspection',
      timestamp: 'now',
      data: {
        choice: {
          inspect: [
            {
              topic: 'action',
              ref: 'a0',
              question: 'Which input?',
              decisionImpact: 'Check identity.'
            }
          ]
        },
        information: [{ status: 'known', revision: 4, facts: { id: 'a0' } }],
        extraExchangesUsed: 1,
        durationMs: 2
      }
    }
    new AiLog(document).accept(inspection)
    expect(document.decisions).toEqual([
      expect.objectContaining({
        kind: 'fact-inspection',
        information: inspection.data.information,
        extraExchangesUsed: 1
      })
    ])
    const transcript = new AiConversationTranscript()
    expect(transcript.format(inspection)).toContain(
      'FACTUAL INSPECTION (no action executed)'
    )
    expect(transcript.format(inspection)).toContain('Which input?')
    expect(
      transcript.format({
        stream: 'decisions',
        kind: 'plan-updated',
        timestamp: 'now',
        data: { turnPlan: { objective: 'New objective.' } }
      })
    ).toContain('New objective.')
    expect(
      transcript.format({
        stream: 'decisions',
        kind: 'action-executed',
        timestamp: 'now',
        data: { accepted: true, source: 'random-timeout' }
      })
    ).toContain('Random fallback, not an AI decision')
  })
})
