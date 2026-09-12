import { describe, expect, it, vi } from 'vitest'
import { AiDecisionService } from './ai-decision-service'
import type { Post } from './ai-transport'
import { parseAiConfig } from './ai-config'
import type { OpenRouterConfig } from './ai-config'
import { AiLog } from './ai-log'
import { AiConversationTranscript } from './ai-conversation-transcript'
import type { JsonValue } from '../../shared/ipc/ai'

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
    expect(post.mock.calls[0]?.[6]).toBe(5000)
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
