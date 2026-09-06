import {
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  parseAiDeckPlan,
  parseAiDeckPlanRequest,
  parseAiDeckPlanResponse,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type AiDeckPlanRequest,
  type AiDeckPlanResponse,
  type AiProviderDebug,
  type JsonObject,
  type JsonValue
} from '../../shared/ipc/ai'
import type { AzureOpenAiConfig } from './ai-config'

type FetchImplementation = typeof fetch

interface AzureOpenAiDecisionServiceOptions {
  readonly record?: (
    matchId: string,
    requestId: string,
    kind: string,
    data: JsonObject
  ) => void
  readonly loadConfig: () => Promise<AzureOpenAiConfig>
  readonly fetch?: FetchImplementation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function object(value: unknown): JsonObject {
  const parsed = json(value)
  if (!isRecord(parsed)) throw new Error('Expected a JSON object.')
  return parsed as JsonObject
}

function requestUrl(config: AzureOpenAiConfig): string {
  const url = new URL(
    `openai/deployments/${encodeURIComponent(config.deploymentName)}/chat/completions`,
    config.endpoint
  )
  url.searchParams.set('api-version', config.apiVersion)
  return url.toString()
}

function assistantContent(response: JsonValue): string {
  if (!isRecord(response) || !Array.isArray(response['choices'])) {
    throw new Error('Azure OpenAI response did not contain choices.')
  }
  const choice = response['choices'][0]
  if (!isRecord(choice) || !isRecord(choice['message'])) {
    throw new Error('Azure OpenAI response did not contain a message.')
  }
  const content = choice['message']['content']
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Azure OpenAI returned no JSON content.')
  }
  return content
}

function metadata(response: JsonValue): Readonly<{
  modelId?: string
  usage?: JsonObject
}> {
  if (!isRecord(response)) return {}
  return {
    ...(typeof response['model'] === 'string' ? { modelId: response['model'] } : {}),
    ...(isRecord(response['usage']) ? { usage: object(response['usage']) } : {})
  }
}

function assertNano(modelId: string): void {
  if (!modelId.toLowerCase().includes('gpt-5.4-nano')) {
    throw new Error(`Azure OpenAI returned disallowed model ${modelId}.`)
  }
}

function planSchema(cardIds: readonly string[]): JsonObject {
  const cardId = { type: 'string', enum: [...new Set(cardIds)] }
  return object({
    type: 'object',
    additionalProperties: false,
    properties: {
      plan: {
        type: 'object',
        additionalProperties: false,
        properties: {
          strategy: { type: 'string', maxLength: 700 },
          winConditions: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', maxLength: 300 }
          },
          priorities: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', maxLength: 300 }
          },
          preserve: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                cardId,
                reason: { type: 'string', maxLength: 260 },
                releaseWhen: { type: 'string', maxLength: 260 }
              },
              required: ['cardId', 'reason', 'releaseWhen']
            }
          },
          mulligan: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', maxLength: 260 }
          }
        },
        required: ['strategy', 'winConditions', 'priorities', 'preserve', 'mulligan']
      },
      rationale: { type: 'string', maxLength: 500 }
    },
    required: ['plan', 'rationale']
  })
}

function decisionSchema(policyIds: readonly string[]): JsonObject {
  return object({
    type: 'object',
    additionalProperties: false,
    properties: {
      policyId: { type: 'string', enum: policyIds },
      rationale: { type: 'string', maxLength: 500 }
    },
    required: ['policyId', 'rationale']
  })
}

function body(
  config: AzureOpenAiConfig,
  prompt: string,
  payload: unknown,
  schemaName: string,
  schema: JsonObject,
  maxCompletionTokens: number
): JsonObject {
  return object({
    messages: [
      { role: 'system', content: config.prompts.system },
      { role: 'user', content: prompt },
      { role: 'user', content: JSON.stringify(payload) }
    ],
    reasoning_effort: config.reasoningEffort,
    max_completion_tokens: maxCompletionTokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema }
    }
  })
}

export class AzureOpenAiDecisionService {
  private readonly fetch: FetchImplementation

  constructor(private readonly options: AzureOpenAiDecisionServiceOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  private async loggedPost(
    request: AiDecisionRequest | AiDeckPlanRequest,
    config: AzureOpenAiConfig,
    requestBody: JsonObject,
    timeoutMs: number
  ): Promise<Readonly<{ response: JsonValue; debug?: AiProviderDebug }>> {
    const record = (kind: string, data: unknown): void => {
      if (!request.logMatchId) return
      try {
        this.options.record?.(
          request.logMatchId,
          request.requestId,
          kind,
          data as JsonObject
        )
      } catch {
        /* Diagnostics must never change a provider decision. */
      }
    }
    const loggedRequest = { ...request }
    delete loggedRequest.logMatchId
    record('provider-request', {
      request: loggedRequest,
      config: {
        enabled: config.enabled,
        provider: config.provider,
        modelId: config.modelId,
        deploymentName: config.deploymentName,
        endpoint: config.endpoint,
        apiVersion: config.apiVersion,
        reasoningEffort: config.reasoningEffort,
        planTimeoutMs: config.planTimeoutMs,
        decisionTimeoutMs: config.decisionTimeoutMs,
        planMaxCompletionTokens: config.planMaxCompletionTokens,
        decisionMaxCompletionTokens: config.decisionMaxCompletionTokens,
        prompts: config.prompts,
        debug: config.debug
      }
    })
    const startedAt = performance.now()
    const result = await this.post(
      config,
      requestBody,
      request.deadlineAtMs,
      timeoutMs,
      !request.logMatchId
    )
    let content: unknown
    try {
      content = JSON.parse(assistantContent(result.response))
    } catch {
      content = { invalidContent: true }
    }
    record('provider-response', {
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      response: content,
      ...metadata(result.response)
    })
    return result
  }

  private async post(
    config: AzureOpenAiConfig,
    requestBody: JsonObject,
    deadlineAtMs: number,
    configuredTimeoutMs: number,
    includeDebug = true
  ): Promise<Readonly<{ response: JsonValue; debug?: AiProviderDebug }>> {
    if (!config.enabled) throw new Error('The external game AI is disabled.')
    if (!config.apiKey) {
      throw new Error('The Azure OpenAI key is missing from ai-key.local.txt.')
    }
    const timeoutMs = Math.min(configuredTimeoutMs, deadlineAtMs - Date.now())
    if (timeoutMs <= 0) throw new Error('The AI request deadline already elapsed.')

    const url = requestUrl(config)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = performance.now()
    let providerResponse: Response
    try {
      providerResponse = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Azure OpenAI request timed out after ${timeoutMs}ms.`, {
          cause: error
        })
      }
      throw new Error(`Azure OpenAI request failed: ${String(error)}`, { cause: error })
    } finally {
      clearTimeout(timer)
    }

    const responseText = await providerResponse.text()
    if (!providerResponse.ok) {
      throw new Error(`Azure OpenAI returned HTTP ${providerResponse.status}.`)
    }
    let response: JsonValue
    try {
      response = json(JSON.parse(responseText))
    } catch (error) {
      throw new Error('Azure OpenAI returned invalid JSON.', { cause: error })
    }
    const providerMetadata = metadata(response)
    assertNano(providerMetadata.modelId ?? config.modelId)
    return {
      response,
      ...(config.debug && includeDebug
        ? {
            debug: {
              durationMs: Number((performance.now() - startedAt).toFixed(2)),
              url,
              requestBody,
              responseBody: response,
              ...(providerMetadata.usage ? { usage: providerMetadata.usage } : {})
            }
          }
        : {})
    }
  }

  async planDeck(value: unknown): Promise<AiDeckPlanResponse> {
    const request: AiDeckPlanRequest = parseAiDeckPlanRequest(value)
    const config = await this.options.loadConfig()
    const requestBody = body(
      config,
      config.prompts.deckPlan,
      { requestId: request.requestId, deck: request.deck },
      'game_ai_deck_plan',
      planSchema(request.deck.cards.map((card) => card.cardId)),
      config.planMaxCompletionTokens
    )
    const result = await this.loggedPost(
      request,
      config,
      requestBody,
      config.planTimeoutMs
    )
    const content = JSON.parse(assistantContent(result.response)) as unknown
    if (!isRecord(content)) throw new Error('AI deck-plan content must be an object.')
    const providerMetadata = metadata(result.response)
    return parseAiDeckPlanResponse({
      requestId: request.requestId,
      plan: parseAiDeckPlan(content['plan']),
      rationale: content['rationale'],
      modelId: providerMetadata.modelId ?? config.modelId,
      ...(result.debug ? { debug: result.debug } : {})
    })
  }

  async decide(value: unknown): Promise<AiDecisionResponse> {
    const request: AiDecisionRequest = parseAiDecisionRequest(value)
    const payload = { ...request }
    delete payload.logMatchId
    const config = await this.options.loadConfig()
    const policyIds = request.policies.map((policy) => policy.id)
    const requestBody = body(
      config,
      config.prompts.decision,
      payload,
      'game_ai_policy_choice',
      decisionSchema(policyIds),
      config.decisionMaxCompletionTokens
    )
    const result = await this.loggedPost(
      request,
      config,
      requestBody,
      config.decisionTimeoutMs
    )
    const content = JSON.parse(assistantContent(result.response)) as unknown
    if (!isRecord(content)) throw new Error('AI decision content must be an object.')
    const policyId = content['policyId']
    if (typeof policyId !== 'string' || !policyIds.includes(policyId)) {
      throw new Error(`AI selected unknown policy ${String(policyId)}.`)
    }
    const providerMetadata = metadata(result.response)
    return parseAiDecisionResponse({
      requestId: request.requestId,
      policyId,
      rationale: content['rationale'],
      modelId: providerMetadata.modelId ?? config.modelId,
      ...(result.debug ? { debug: result.debug } : {})
    })
  }
}
