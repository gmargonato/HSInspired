import { describe, expect, it, vi } from 'vitest'
import type { AiDecisionRequest } from '../../shared/ipc/ai'
import type { AzureOpenAiConfig } from './ai-config'
import { AzureOpenAiDecisionService } from './azure-openai-ai-service'

const config: AzureOpenAiConfig = {
  enabled: true,
  provider: 'azure-openai',
  modelId: 'gpt-test-nano',
  deploymentName: 'game-ai',
  endpoint: 'https://example.openai.azure.com/',
  apiVersion: '2024-12-01-preview',
  requestTimeoutMs: 5000,
  reasoningEffort: 'low',
  maxCompletionTokens: 2048,
  prompts: {
    system: 'Configured system prompt.',
    mulligan: 'Configured mulligan prompt.',
    turn: 'Configured turn prompt.'
  },
  debug: true,
  apiKey: 'super-secret-key'
}

const request: AiDecisionRequest = {
  decisionId: 'turn-7-0',
  phase: 'turn',
  matchRevision: 7,
  strategySummary: 'Play for value.',
  gameState: { turnNumber: 4 },
  legalActions: [
    {
      id: 'action-0',
      kind: 'end-turn',
      description: 'End the current turn.',
      details: {}
    }
  ]
}

describe('AzureOpenAiDecisionService', () => {
  it('uses the deployment endpoint and keeps the key out of debug data', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    actionId: 'action-0',
                    rationale: 'There are no productive actions.',
                    strategicIntent: 'Preserve resources.',
                    strategySummary: 'Play for value.'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    const service = new AzureOpenAiDecisionService({
      loadConfig: async () => config,
      fetch
    })

    const response = await service.decide(request)

    expect(response.actionId).toBe('action-0')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toContain('/openai/deployments/game-ai/chat/completions')
    expect(String(url)).toContain('api-version=2024-12-01-preview')
    expect(new Headers(init?.headers).get('api-key')).toBe('super-secret-key')
    const requestBody = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
      reasoning_effort: string
      max_completion_tokens: number
      response_format: { type: string }
    }
    expect(requestBody.messages[0]).toEqual({
      role: 'system',
      content: config.prompts.system
    })
    expect(requestBody.messages[1]).toEqual({
      role: 'user',
      content: config.prompts.turn
    })
    expect(requestBody.reasoning_effort).toBe('low')
    expect(requestBody.max_completion_tokens).toBe(2048)
    expect(requestBody.response_format.type).toBe('json_schema')
    expect(JSON.stringify(response.debug)).not.toContain('super-secret-key')
    expect(JSON.stringify(init?.body)).not.toContain('super-secret-key')
  })

  it('selects the configured prompt for the decision phase', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    actionId: 'action-0',
                    rationale: 'Keep the hand.',
                    strategicIntent: 'Execute the opening plan.',
                    strategySummary: 'Keep the strong opener.'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    const service = new AzureOpenAiDecisionService({
      loadConfig: async () => config,
      fetch
    })

    await service.decide({ ...request, phase: 'mulligan' })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>
    }
    expect(body.messages[1]?.content).toBe(config.prompts.mulligan)
  })

  it('rejects a model action that is not in the engine-issued list', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    actionId: 'invented-action',
                    rationale: 'Invented.',
                    strategicIntent: 'Invented.',
                    strategySummary: 'Invented.'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    const service = new AzureOpenAiDecisionService({
      loadConfig: async () => config,
      fetch
    })

    await expect(service.decide(request)).rejects.toThrow('unknown or stale action id')
  })
})
