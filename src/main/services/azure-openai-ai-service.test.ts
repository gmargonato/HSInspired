import { describe, expect, it, vi } from 'vitest'
import type { AiDeckPlanRequest, AiDecisionRequest } from '../../shared/ipc/ai'
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
  decisionPolicies: {
    deckPlan: {
      requestTimeoutMs: 30000,
      reasoningEffort: 'low',
      maxCompletionTokens: 3072
    },
    mulligan: {
      requestTimeoutMs: 25000,
      reasoningEffort: 'low',
      maxCompletionTokens: 2048
    },
    discover: {
      requestTimeoutMs: 15000,
      reasoningEffort: 'low',
      maxCompletionTokens: 1024
    },
    turn: {
      requestTimeoutMs: 12000,
      reasoningEffort: 'low',
      maxCompletionTokens: 512
    },
    rank: {
      requestTimeoutMs: 10000,
      reasoningEffort: 'low',
      maxCompletionTokens: 1536
    },
    critic: {
      requestTimeoutMs: 10000,
      reasoningEffort: 'low',
      maxCompletionTokens: 1024
    },
    strategyReview: {
      requestTimeoutMs: 8000,
      reasoningEffort: 'low',
      maxCompletionTokens: 3072
    }
  },
  prompts: {
    system: 'Configured system prompt.',
    deckPlan: 'Configured deck-plan prompt.',
    mulligan: 'Configured mulligan prompt.',
    turn: 'Configured turn prompt.'
  },
  debug: true,
  apiKey: 'super-secret-key'
}

const request: AiDecisionRequest = {
  decisionId: 'turn-7-0',
  phase: 'turn',
  decisionClass: 'turn',
  matchRevision: 7,
  promptVersion: 'test-v1',
  contextVersion: 3,
  schemaVersion: 2,
  deadlineAtMs: Date.now() + 60_000,
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
  it('uses the dedicated structured deck-planning prompt and policy', async () => {
    const longRationale = 'Strategic deck explanation. '.repeat(30)
    const longReleaseCondition = 'Release when the winning line requires it. '.repeat(
      12
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    plan: {
                      planVersion: 1,
                      archetype: 'combo',
                      primaryWinCondition: 'Assemble freeze damage.',
                      secondaryWinCondition: 'Control the board.',
                      earlyGamePriority: 'Draw efficiently.',
                      midGamePriority: 'Preserve combo pieces.',
                      lateGamePriority: 'Convert the combo into lethal.',
                      cardRoles: [
                        {
                          cardId: 'basic_frostbolt',
                          roles: ['combo-piece', 'removal']
                        }
                      ],
                      combos: [],
                      resourceRules: [
                        {
                          cardIds: ['basic_frostbolt'],
                          preserveUntil: 'The combo is ready.',
                          releaseWhen: longReleaseCondition,
                          releaseTriggers: ['lethal', 'forced-survival', 'combo-ready']
                        }
                      ],
                      mulliganPriorityCardIds: ['basic_frostbolt', 'basic_frostbolt']
                    },
                    rationale: longRationale
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
    const planRequest: AiDeckPlanRequest = {
      planId: 'plan-1',
      decisionClass: 'deck-plan',
      promptVersion: 'plan-v1',
      schemaVersion: 1,
      deadlineAtMs: Date.now() + 60_000,
      mode: { id: 'constructed' },
      deck: {
        id: 'freeze-mage',
        cards: [
          {
            count: 2,
            definition: { id: 'basic_frostbolt', name: 'Frostbolt' }
          }
        ]
      }
    }

    const response = await service.planDeck(planRequest)

    expect(response.plan.archetype).toBe('combo')
    expect(response.plan.mulliganPriorityCardIds).toEqual(['basic_frostbolt'])
    expect(response.plan.resourceRules[0]?.releaseWhen).toHaveLength(240)
    expect(response.rationale).toHaveLength(500)
    expect(longRationale.length).toBeGreaterThan(500)
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>
      reasoning_effort: string
      max_completion_tokens: number
      response_format: {
        json_schema: {
          schema: {
            properties: {
              rationale: { maxLength: number }
              plan: {
                properties: {
                  primaryWinCondition: { maxLength: number }
                  cardRoles: {
                    maxItems: number
                    items: { properties: { cardId: { enum: string[] } } }
                  }
                  combos: {
                    maxItems: number
                    items: {
                      properties: {
                        cardIds: { maxItems: number }
                        purpose: { maxLength: number }
                      }
                    }
                  }
                  resourceRules: {
                    maxItems: number
                    items: {
                      properties: {
                        cardIds: { maxItems: number }
                        preserveUntil: { maxLength: number }
                        releaseWhen: { maxLength: number }
                        releaseTriggers: { maxItems: number }
                      }
                    }
                  }
                  mulliganPriorityCardIds: { maxItems: number }
                }
              }
            }
          }
        }
      }
    }
    expect(body.messages[0]?.content).toBe(config.prompts.deckPlan)
    expect(body.messages).toHaveLength(2)
    expect(body.reasoning_effort).toBe('low')
    expect(body.max_completion_tokens).toBe(3072)
    expect(body.response_format.json_schema.schema.properties.rationale.maxLength).toBe(
      500
    )
    const planSchema =
      body.response_format.json_schema.schema.properties.plan.properties
    expect(planSchema.primaryWinCondition.maxLength).toBe(500)
    expect(planSchema.cardRoles.maxItems).toBe(30)
    expect(planSchema.cardRoles.items.properties.cardId.enum).toEqual([
      'basic_frostbolt'
    ])
    expect(planSchema.combos.maxItems).toBe(12)
    expect(planSchema.combos.items.properties.cardIds.maxItems).toBe(8)
    expect(planSchema.combos.items.properties.purpose.maxLength).toBe(240)
    expect(planSchema.resourceRules.maxItems).toBe(12)
    expect(planSchema.resourceRules.items.properties.cardIds.maxItems).toBe(8)
    expect(planSchema.resourceRules.items.properties.preserveUntil.maxLength).toBe(240)
    expect(planSchema.resourceRules.items.properties.releaseWhen.maxLength).toBe(240)
    expect(planSchema.resourceRules.items.properties.releaseTriggers.maxItems).toBe(6)
    expect(planSchema.mulliganPriorityCardIds.maxItems).toBe(15)
  })

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
                    decisionClass: 'turn',
                    rationale: 'There are no productive actions.'
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
    expect(requestBody.max_completion_tokens).toBe(512)
    expect(requestBody.response_format.type).toBe('json_schema')
    expect(JSON.stringify(response.debug)).not.toContain('super-secret-key')
    expect(JSON.stringify(init?.body)).not.toContain('super-secret-key')
  })

  it('uses an Azure-compatible strict fair strategy-review schema', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    review: {
                      reviewVersion: 1,
                      changed: false,
                      revisedPlan: null,
                      changeReasons: [],
                      opponentAssessment: 'The opponent remains uncertain.'
                    },
                    rationale: 'No public evidence supports a revision.'
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

    await service.reviewStrategy({
      reviewId: 'strategy-review-1',
      decisionClass: 'strategy-review',
      promptVersion: 'strategy-review-v1',
      schemaVersion: 1,
      deadlineAtMs: Date.now() + 60_000,
      previousPlan: { planVersion: 1 },
      strategicMemory: { informationPolicy: 'fair' },
      gameState: { informationPolicy: 'fair' }
    })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      reasoning_effort: string
      max_completion_tokens: number
      response_format: {
        json_schema: {
          schema: {
            properties: {
              review: {
                properties: { revisedPlan: { anyOf: Array<{ type?: string }> } }
              }
            }
          }
        }
      }
    }
    expect(body.reasoning_effort).toBe('low')
    expect(body.max_completion_tokens).toBe(3072)
    expect(
      body.response_format.json_schema.schema.properties.review.properties.revisedPlan
        .anyOf
    ).toContainEqual({ type: 'null' })
    expect(JSON.stringify(body.response_format)).not.toContain('uniqueItems')
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
                    decisionClass: 'mulligan',
                    rationale: 'Keep the hand.'
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

    await service.decide({ ...request, phase: 'mulligan', decisionClass: 'mulligan' })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>
      reasoning_effort: string
      max_completion_tokens: number
    }
    expect(body.messages[1]?.content).toBe(config.prompts.mulligan)
    expect(body.reasoning_effort).toBe('low')
    expect(body.max_completion_tokens).toBe(2048)
  })

  it('uses independent strategic rank and critic policies', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pass: 'rank',
                    preferredActionId: 'action-0',
                    orderedActionIds: ['action-0'],
                    confidence: 0.75,
                    rationale: 'Ranked the only supplied action.'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pass: 'critic',
                    finalActionId: 'action-0',
                    retainedFirstChoice: true,
                    identifiedRisks: [],
                    rationale: 'The first choice remains valid.'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    const service = new AzureOpenAiDecisionService({
      loadConfig: async () => config,
      fetch
    })

    await service.decide({ ...request, pass: 'rank' })
    await service.decide({
      ...request,
      pass: 'critic',
      firstPassRanking: ['action-0']
    })

    const rankBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      reasoning_effort: string
      max_completion_tokens: number
    }
    const criticBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)) as {
      reasoning_effort: string
      max_completion_tokens: number
    }
    expect(rankBody).toMatchObject({
      reasoning_effort: 'low',
      max_completion_tokens: 1536
    })
    expect(criticBody).toMatchObject({
      reasoning_effort: 'low',
      max_completion_tokens: 1024
    })
    expect(JSON.stringify(rankBody)).not.toContain('uniqueItems')
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
                    decisionClass: 'turn',
                    rationale: 'Invented.'
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

  it('includes the exact provider response when assistant content cannot be parsed', async () => {
    const rawAssistantContent = 'I cannot produce the requested JSON.'
    const rawResponse = JSON.stringify({
      id: 'chatcmpl-test',
      choices: [
        {
          finish_reason: 'length',
          message: { role: 'assistant', content: rawAssistantContent }
        }
      ]
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(rawResponse, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    const service = new AzureOpenAiDecisionService({
      loadConfig: async () => config,
      fetch
    })

    const error = await service.decide(request).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(
      `Raw assistant content:\n${rawAssistantContent}`
    )
    expect((error as Error).message).toContain(
      `Raw Azure response body:\n${rawResponse}`
    )
  })

  it('identifies an empty length-limited response as token exhaustion', async () => {
    const rawResponse = JSON.stringify({
      choices: [
        {
          finish_reason: 'length',
          message: { role: 'assistant', content: '' }
        }
      ],
      usage: {
        completion_tokens: 3072,
        completion_tokens_details: { reasoning_tokens: 3072 }
      }
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(rawResponse, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    const service = new AzureOpenAiDecisionService({
      loadConfig: async () => config,
      fetch
    })

    await expect(service.decide(request)).rejects.toThrow(
      'exhausted max_completion_tokens before producing assistant JSON content'
    )
  })
})
