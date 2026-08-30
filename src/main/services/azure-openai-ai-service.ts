import {
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type JsonObject,
  type JsonValue
} from '../../shared/ipc/ai'
import type { AzureOpenAiConfig } from './ai-config'

type FetchImplementation = typeof globalThis.fetch

interface ModelDecision {
  readonly actionId: string
  readonly rationale: string
  readonly strategicIntent: string
  readonly strategySummary: string
}

interface AzureOpenAiDecisionServiceOptions {
  readonly loadConfig: () => Promise<AzureOpenAiConfig>
  readonly fetch?: FetchImplementation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string, label: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    throw new Error(`${label} did not contain valid JSON.`)
  }
}

function requiredModelString(
  record: Readonly<Record<string, unknown>>,
  key: keyof ModelDecision
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AI model response ${key} must be a non-empty string.`)
  }
  return value.trim()
}

function parseModelDecision(value: unknown, request: AiDecisionRequest): ModelDecision {
  if (!isRecord(value)) throw new Error('AI model response must be a JSON object.')
  const actionId = requiredModelString(value, 'actionId')
  if (!request.legalActions.some((action) => action.id === actionId)) {
    throw new Error(`AI model selected unknown or stale action id ${actionId}.`)
  }
  return {
    actionId,
    rationale: requiredModelString(value, 'rationale'),
    strategicIntent: requiredModelString(value, 'strategicIntent'),
    strategySummary: requiredModelString(value, 'strategySummary')
  }
}

function extractAssistantContent(response: JsonValue): string {
  if (!isRecord(response)) throw new Error('Azure OpenAI response must be an object.')
  const choices = response['choices']
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new Error('Azure OpenAI response did not contain a choice.')
  }
  const message = choices[0]['message']
  if (!isRecord(message) || typeof message['content'] !== 'string') {
    throw new Error('Azure OpenAI response did not contain assistant JSON content.')
  }
  return message['content']
}

function buildRequestBody(
  request: AiDecisionRequest,
  config: AzureOpenAiConfig
): JsonObject {
  const actionIds = request.legalActions.map((action) => action.id)
  const phasePrompt =
    request.phase === 'mulligan' ? config.prompts.mulligan : config.prompts.turn
  return {
    messages: [
      { role: 'system', content: config.prompts.system },
      { role: 'user', content: phasePrompt },
      {
        role: 'user',
        content: JSON.stringify({
          decisionId: request.decisionId,
          phase: request.phase,
          matchRevision: request.matchRevision,
          strategySummary: request.strategySummary,
          gameState: request.gameState,
          legalActions: request.legalActions
        })
      }
    ],
    reasoning_effort: config.reasoningEffort,
    max_completion_tokens: config.maxCompletionTokens,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'game_ai_decision',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            actionId: { type: 'string', enum: actionIds },
            rationale: { type: 'string' },
            strategicIntent: { type: 'string' },
            strategySummary: { type: 'string' }
          },
          required: ['actionId', 'rationale', 'strategicIntent', 'strategySummary']
        }
      }
    }
  }
}

function buildRequestUrl(config: AzureOpenAiConfig): string {
  const url = new URL(
    `openai/deployments/${encodeURIComponent(config.deploymentName)}/chat/completions`,
    config.endpoint
  )
  url.searchParams.set('api-version', config.apiVersion)
  return url.toString()
}

export class AzureOpenAiDecisionService {
  private readonly fetch: FetchImplementation

  constructor(private readonly options: AzureOpenAiDecisionServiceOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async decide(value: unknown): Promise<AiDecisionResponse> {
    const request = parseAiDecisionRequest(value)
    const config = await this.options.loadConfig()
    if (!config.enabled)
      throw new Error('The external game AI is disabled in config/ai.json.')
    if (!config.apiKey) {
      throw new Error(
        'The Azure OpenAI key is missing. Put only the key in config/ai-key.local.txt.'
      )
    }

    const url = buildRequestUrl(config)
    const requestBody = buildRequestBody(request, config)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    const startedAt = performance.now()
    let response: Response
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.apiKey
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Azure OpenAI request timed out after ${config.requestTimeoutMs}ms.`,
          { cause: error }
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Azure OpenAI request failed: ${message}`, { cause: error })
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    const responseBody = parseJson(responseText, 'Azure OpenAI response')
    if (!response.ok) {
      throw new Error(`Azure OpenAI returned HTTP ${response.status}: ${responseText}`)
    }
    const decision = parseModelDecision(
      parseJson(extractAssistantContent(responseBody), 'AI assistant content'),
      request
    )
    return parseAiDecisionResponse({
      ...decision,
      modelId: config.modelId,
      ...(config.debug
        ? {
            debug: {
              url,
              durationMs: Math.round(performance.now() - startedAt),
              requestBody,
              responseBody
            }
          }
        : {})
    })
  }
}
