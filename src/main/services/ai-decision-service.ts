import { randomUUID } from 'node:crypto'
import { withProviderRecovery } from './ai-provider-recovery'
import {
  AiRequestError,
  AI_REQUEST_LIMITS,
  parseAiChoice,
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type AiSettings,
  type AiRequestProgress,
  type JsonObject
} from '../../shared/ipc/ai'
import {
  post,
  rejectedContent,
  redactDiagnosticText,
  type Post,
  type TransportProgress
} from './ai-transport'
import type { AiProviderConfig } from './ai-config'
import { aiChoiceSchema, validateAiChoicePhase } from '../../shared/ipc/ai-deliberation'

function providerRequest(config: AiProviderConfig): Readonly<{
  url: URL
  headers: Readonly<Record<string, string>>
  body: JsonObject
}> {
  if (config.provider === 'azure-openai') {
    const url = new URL(
      'openai/deployments/' +
        encodeURIComponent(config.deploymentName) +
        '/chat/completions',
      config.endpoint
    )
    url.searchParams.set('api-version', config.apiVersion)
    return {
      url,
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
      body: {}
    }
  }
  return {
    url: new URL('https://openrouter.ai/api/v1/chat/completions'),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://github.com/gmargonato/HSInspired',
      'X-OpenRouter-Title': 'HSInspired'
    },
    body: {
      model: config.modelId,
      provider: { require_parameters: true }
    }
  }
}

export interface AiDecisionServiceContract {
  settings(): Promise<AiSettings>
  decide(
    value: unknown,
    signal: AbortSignal,
    progress?: (value: AiRequestProgress) => void
  ): Promise<AiDecisionResponse>
}

export class AiDecisionService implements AiDecisionServiceContract {
  constructor(
    private readonly options: {
      readonly loadConfig: () => Promise<AiProviderConfig | null>
      readonly post?: Post
    }
  ) {}

  async settings(): Promise<AiSettings> {
    const config = await this.options.loadConfig()
    if (!config) {
      return {
        enabled: false,
        provider: 'none',
        modelId: 'none',
        reasoningEffort: 'none',
        maxCompletionTokens: 1
      }
    }
    return {
      enabled: true,
      provider: config.provider,
      modelId: config.modelId,
      reasoningEffort: config.reasoningEffort,
      maxCompletionTokens: config.maxCompletionTokens,
      maxContextBytes: config.maxContextBytes ?? AI_REQUEST_LIMITS.maxContextBytes
    }
  }

  async decide(
    value: unknown,
    signal: AbortSignal,
    progress?: (value: AiRequestProgress) => void
  ): Promise<AiDecisionResponse> {
    const request: AiDecisionRequest = parseAiDecisionRequest(value)
    const startedAt = performance.now()
    let last: TransportProgress = { stage: 'transport-started', receivedBytes: 0 }
    const report = (value: TransportProgress): void => {
      const repeatedBody =
        value.stage === 'response-body' && last.stage === 'response-body'
      last =
        value.stage === 'transport-started'
          ? { ...value, receivedBytes: 0 }
          : { ...last, ...value }
      if (repeatedBody) return
      // Diagnostics must never fail a decision or reveal request/response payloads.
      try {
        progress?.({
          matchId: request.matchId,
          requestId: request.requestId,
          expectedRevision: request.expectedRevision,
          ...last,
          elapsedMs: performance.now() - startedAt
        })
      } catch {
        /* Observer errors do not affect transport. */
      }
    }
    const config = await this.options.loadConfig()
    signal.throwIfAborted()
    if (!config) throw new Error('External game AI is disabled.')
    if (!config.apiKey) {
      throw new Error(
        config.provider === 'openrouter'
          ? 'OpenRouter API key is missing.'
          : 'Azure OpenAI key is missing.'
      )
    }
    const choiceSchema = aiChoiceSchema(request)
    const transport = providerRequest(config)
    const body = {
      ...transport.body,
      ...(config.provider === 'openrouter' &&
      process.env.HSINSPIRED_AI_SESSION_AFFINITY !== '0'
        ? { session_id: request.matchId }
        : {}),
      messages: request.messages,
      ...(config.provider === 'openrouter'
        ? {
            reasoning: { effort: config.reasoningEffort },
            max_tokens: config.maxCompletionTokens
          }
        : {
            reasoning_effort: config.reasoningEffort,
            max_completion_tokens: config.maxCompletionTokens
          }),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'game_action',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { choice: choiceSchema, reason: { type: 'string' } },
            required: ['choice', 'reason']
          }
        }
      }
    }
    const serializedBody = JSON.stringify(body)
    if (
      Buffer.byteLength(serializedBody, 'utf8') >
      (config.maxContextBytes ?? AI_REQUEST_LIMITS.maxContextBytes) +
        AI_REQUEST_LIMITS.schemaAllowanceBytes
    ) {
      throw new Error('AI request exceeds the context allowance including its schema.')
    }
    const heartbeat = setInterval(() => {
      try {
        progress?.({
          matchId: request.matchId,
          requestId: request.requestId,
          expectedRevision: request.expectedRevision,
          ...last,
          stage: 'waiting',
          lastStage: last.stage,
          elapsedMs: performance.now() - startedAt
        })
      } catch {
        /* Observer errors do not affect transport. */
      }
    }, 30_000)
    heartbeat.unref()
    const response = (await Promise.resolve()
      .then(() =>
        withProviderRecovery(
          this.options.post ?? post,
          randomUUID(),
          request.phase ?? 'action'
        )(
          transport.url,
          serializedBody,
          transport.headers,
          config.apiKey,
          signal,
          report,
          config.requestTimeoutMs ?? AI_REQUEST_LIMITS.timeoutMs
        )
      )
      .catch((error) => {
        report({ stage: signal.aborted ? 'cancelled' : 'failed' })
        if (signal.aborted) throw error
        throw new AiRequestError(
          redactDiagnosticText(
            error instanceof Error ? error.message : String(error),
            config.apiKey
          ).slice(0, 16_000),
          {
            ...(error instanceof AiRequestError
              ? error.details
              : { failureKind: 'network', repairable: false }),
            durationMs: performance.now() - startedAt,
            provider: config.provider,
            modelId: config.modelId,
            reasoningEffort: config.reasoningEffort
          }
        )
      })
      .finally(() => clearInterval(heartbeat))) as {
      model?: string
      choices?: {
        finish_reason?: string
        message?: { content?: string; refusal?: string }
      }[]
      usage?: JsonObject
    }
    signal.throwIfAborted()
    let failureKind = 'provider-response'
    try {
      const choice = response?.choices?.[0]
      if (typeof response?.model !== 'string' || !response.model.trim()) {
        throw new Error('AI provider returned no model identifier.')
      }
      if (choice?.message?.refusal) {
        throw new Error('AI provider refused: ' + choice.message.refusal)
      }
      if (choice?.finish_reason !== 'stop') {
        throw new Error('AI provider finish reason: ' + choice?.finish_reason)
      }
      failureKind = 'invalid-json'
      const parsed = JSON.parse(choice.message?.content ?? 'null')
      failureKind = 'invalid-structure'
      const selection = parseAiChoice(parsed)
      failureKind = 'invalid-choice'
      validateAiChoicePhase(selection.choice, request)
      failureKind = 'provider-response'
      const result = parseAiDecisionResponse({
        matchId: request.matchId,
        requestId: request.requestId,
        expectedRevision: request.expectedRevision,
        ...selection,
        modelId: response.model,
        durationMs: performance.now() - startedAt,
        finishReason: choice.finish_reason,
        usage: response.usage
      })
      report({ stage: 'response-validated' })
      return result
    } catch (error) {
      report({ stage: signal.aborted ? 'cancelled' : 'failed' })
      throw new AiRequestError(
        redactDiagnosticText(
          error instanceof Error ? error.message : String(error),
          config.apiKey
        ).slice(0, 16_000),
        {
          failureKind,
          provider: config.provider,
          reasoningEffort: config.reasoningEffort,
          ...(response?.usage &&
          typeof response.usage === 'object' &&
          !Array.isArray(response.usage)
            ? {
                usage: JSON.parse(
                  JSON.stringify(response.usage, (_key, value: unknown) =>
                    typeof value === 'string'
                      ? redactDiagnosticText(value, config.apiKey)
                      : value
                  )
                ) as JsonObject
              }
            : {}),
          repairable: ['invalid-json', 'invalid-structure', 'invalid-choice'].includes(
            failureKind
          ),
          durationMs: performance.now() - startedAt,
          modelId:
            typeof response?.model === 'string'
              ? redactDiagnosticText(response.model, config.apiKey)
              : null,
          finishReason: response?.choices?.[0]?.finish_reason ?? null,
          ...rejectedContent(response?.choices?.[0]?.message?.content, config.apiKey)
        }
      )
    }
  }
}
