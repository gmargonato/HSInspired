import {
  AI_DECK_PLAN_LIMITS,
  parseAiDeckPlanRequest,
  parseAiDeckPlanResponse,
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  parseAiRankDecisionResponse,
  parseAiCriticDecisionResponse,
  parseAiStrategyReviewRequest,
  parseAiStrategyReviewResponse,
  type AiDeckPlanRequest,
  type AiDeckPlanResponse,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type AiStrategyReviewRequest,
  type AiStrategyReviewResponse,
  type JsonObject,
  type JsonValue
} from '../../shared/ipc/ai'
import type { AzureOpenAiConfig } from './ai-config'

type FetchImplementation = typeof globalThis.fetch

interface ModelDecision {
  readonly actionId: string
  readonly decisionClass: AiDecisionRequest['decisionClass']
  readonly rationale: string
}

interface ModelDeckPlan {
  readonly plan: unknown
  readonly rationale: string
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

function normalizeDeckPlanSetLists(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value['mulliganPriorityCardIds'])) {
    return value
  }
  const seen = new Set<string>()
  const mulliganPriorityCardIds = value['mulliganPriorityCardIds'].filter((entry) => {
    if (typeof entry !== 'string') return true
    const normalized = entry.trim()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
  return { ...value, mulliganPriorityCardIds }
}

function normalizeStrategyReviewSetLists(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    revisedPlan: normalizeDeckPlanSetLists(value['revisedPlan'])
  }
}

function parseModelDecision(value: unknown, request: AiDecisionRequest): ModelDecision {
  if (!isRecord(value)) throw new Error('AI model response must be a JSON object.')
  if (request.pass === 'rank') {
    const ranking = parseAiRankDecisionResponse(
      value,
      new Set(request.legalActions.map((action) => action.id))
    )
    return {
      actionId: ranking.preferredActionId,
      decisionClass: request.decisionClass,
      rationale: ranking.rationale
    }
  }
  if (request.pass === 'critic') {
    const criticism = parseAiCriticDecisionResponse(
      value,
      new Set(request.legalActions.map((action) => action.id))
    )
    return {
      actionId: criticism.finalActionId,
      decisionClass: request.decisionClass,
      rationale: criticism.rationale
    }
  }
  const actionId = requiredModelString(value, 'actionId')
  if (!request.legalActions.some((action) => action.id === actionId)) {
    throw new Error(`AI model selected unknown or stale action id ${actionId}.`)
  }
  return {
    actionId,
    decisionClass:
      value['decisionClass'] === request.decisionClass
        ? request.decisionClass
        : (() => {
            throw new Error(
              'AI model response decisionClass does not match the request.'
            )
          })(),
    rationale: requiredModelString(value, 'rationale')
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
  const content = message['content']
  if (content.trim() === '') {
    const finishReason = choices[0]['finish_reason']
    if (finishReason === 'length') {
      throw new Error(
        'Azure OpenAI exhausted max_completion_tokens before producing assistant JSON content.'
      )
    }
    throw new Error('Azure OpenAI returned empty assistant JSON content.')
  }
  return content
}

function providerMetadata(response: JsonValue): {
  readonly actualModelId?: string
  readonly finishReason?: string
  readonly usage?: JsonObject
} {
  if (!isRecord(response)) return {}
  const choices = response['choices']
  const firstChoice = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : null
  const actualModelId =
    typeof response['model'] === 'string' ? response['model'] : undefined
  const finishReason =
    firstChoice && typeof firstChoice['finish_reason'] === 'string'
      ? firstChoice['finish_reason']
      : undefined
  const usage = isRecord(response['usage'])
    ? (response['usage'] as JsonObject)
    : undefined
  return {
    ...(actualModelId ? { actualModelId } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {})
  }
}

function responseDiagnosticError(
  config: AzureOpenAiConfig,
  url: string,
  response: Response,
  responseText: string,
  message: string,
  assistantContent?: string,
  cause?: unknown
): Error {
  if (!config.debug) return new Error(message, cause === undefined ? {} : { cause })
  const diagnostic = [
    '[Azure OpenAI diagnostic]',
    `URL: ${url}`,
    `HTTP status: ${response.status} ${response.statusText}`,
    ...(assistantContent === undefined
      ? []
      : ['Raw assistant content:', assistantContent]),
    'Raw Azure response body:',
    responseText,
    '[/Azure OpenAI diagnostic]'
  ].join('\n')
  console.error(diagnostic)
  return new Error(`${message}\n${diagnostic}`, cause === undefined ? {} : { cause })
}

function buildRequestBody(
  request: AiDecisionRequest,
  config: AzureOpenAiConfig
): JsonObject {
  const actionIds = request.legalActions.map((action) => action.id)
  const phasePrompt =
    request.pass === 'critic'
      ? (config.prompts.critic ?? config.prompts.strategicTurn ?? config.prompts.turn)
      : request.pass
        ? request.phase === 'mulligan'
          ? (config.prompts.strategicMulligan ?? config.prompts.mulligan)
          : (config.prompts.strategicTurn ?? config.prompts.turn)
        : request.phase === 'mulligan'
          ? config.prompts.mulligan
          : config.prompts.turn
  const systemPrompt = request.pass
    ? (config.prompts.strategicSystem ?? config.prompts.system)
    : config.prompts.system
  const policy =
    request.pass === 'rank'
      ? config.decisionPolicies.rank
      : request.pass === 'critic'
        ? config.decisionPolicies.critic
        : config.decisionPolicies[request.decisionClass]
  let responseSchema: JsonObject
  if (request.pass === 'rank') {
    responseSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        pass: { type: 'string', enum: ['rank'] },
        preferredActionId: { type: 'string', enum: actionIds },
        orderedActionIds: {
          type: 'array',
          items: { type: 'string', enum: actionIds },
          minItems: actionIds.length,
          maxItems: actionIds.length
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        rationale: { type: 'string', maxLength: 500 }
      },
      required: [
        'pass',
        'preferredActionId',
        'orderedActionIds',
        'confidence',
        'rationale'
      ]
    } as JsonObject
  } else if (request.pass === 'critic') {
    responseSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        pass: { type: 'string', enum: ['critic'] },
        finalActionId: { type: 'string', enum: actionIds },
        retainedFirstChoice: { type: 'boolean' },
        identifiedRisks: {
          type: 'array',
          items: { type: 'string', maxLength: 240 },
          maxItems: 8
        },
        rationale: { type: 'string', maxLength: 500 }
      },
      required: [
        'pass',
        'finalActionId',
        'retainedFirstChoice',
        'identifiedRisks',
        'rationale'
      ]
    } as JsonObject
  } else {
    responseSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        actionId: { type: 'string', enum: actionIds },
        decisionClass: { type: 'string', enum: [request.decisionClass] },
        rationale: { type: 'string' }
      },
      required: ['actionId', 'decisionClass', 'rationale']
    } as JsonObject
  }
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: phasePrompt },
      {
        role: 'user',
        content: JSON.stringify({
          decisionId: request.decisionId,
          phase: request.phase,
          decisionClass: request.decisionClass,
          matchRevision: request.matchRevision,
          promptVersion: request.promptVersion,
          contextVersion: request.contextVersion,
          schemaVersion: request.schemaVersion,
          gameState: request.gameState,
          legalActions: request.legalActions,
          pass: request.pass ?? 'legacy',
          candidateDossiers: (request.candidateDossiers ?? []).map((dossier) => ({
            actionId: dossier.actionId,
            recommendedContinuation: dossier.recommendedContinuation,
            projectedSuccessor: dossier.projectedSuccessor,
            opponentStrongestResponse: dossier.opponentStrongestResponse,
            tacticalProofs: dossier.tacticalProofs.map((proof) => ({
              kind: proof.kind,
              proven: proof.proven,
              complete: proof.complete,
              annotation: proof.annotation
            })),
            evaluation: dossier.evaluation,
            score: dossier.score,
            meanScenarioValue: dossier.meanScenarioValue,
            downsideScenarioValue: dossier.downsideScenarioValue,
            worstCaseScenarioValue: dossier.worstCaseScenarioValue,
            resourceUsage: dossier.resourceUsage,
            uncertainty: dossier.uncertainty,
            strategyProgress: dossier.strategyProgress
          })),
          firstPassRanking: request.firstPassRanking ?? []
        })
      }
    ],
    reasoning_effort: policy.reasoningEffort,
    max_completion_tokens: policy.maxCompletionTokens,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'game_ai_decision',
        strict: true,
        schema: responseSchema
      }
    }
  }
}

function buildDeckPlanRequestBody(
  request: AiDeckPlanRequest,
  config: AzureOpenAiConfig,
  allowedCardIds: readonly string[] = deckCardIds(request.deck)
): JsonObject {
  const cardRoleValues = [
    'win-condition',
    'combo-piece',
    'enabler',
    'draw',
    'removal',
    'survival',
    'tempo',
    'finisher',
    'flex'
  ]
  const cardIdSchema: JsonObject =
    allowedCardIds.length > 0
      ? { type: 'string', enum: [...new Set(allowedCardIds)] }
      : {
          type: 'string',
          minLength: 1,
          maxLength: AI_DECK_PLAN_LIMITS.cardIdLength
        }
  return {
    messages: [
      { role: 'system', content: config.prompts.deckPlan },
      {
        role: 'user',
        content: JSON.stringify({
          planId: request.planId,
          promptVersion: request.promptVersion,
          schemaVersion: request.schemaVersion,
          mode: request.mode,
          deck: request.deck
        })
      }
    ],
    reasoning_effort: config.decisionPolicies.deckPlan.reasoningEffort,
    max_completion_tokens: config.decisionPolicies.deckPlan.maxCompletionTokens,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'game_ai_deck_plan',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plan: {
              type: 'object',
              additionalProperties: false,
              properties: {
                planVersion: { type: 'integer', enum: [1] },
                archetype: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 120
                },
                primaryWinCondition: {
                  type: 'string',
                  minLength: 1,
                  maxLength: AI_DECK_PLAN_LIMITS.strategyTextLength
                },
                secondaryWinCondition: {
                  type: 'string',
                  minLength: 1,
                  maxLength: AI_DECK_PLAN_LIMITS.strategyTextLength
                },
                earlyGamePriority: {
                  type: 'string',
                  minLength: 1,
                  maxLength: AI_DECK_PLAN_LIMITS.strategyTextLength
                },
                midGamePriority: {
                  type: 'string',
                  minLength: 1,
                  maxLength: AI_DECK_PLAN_LIMITS.strategyTextLength
                },
                lateGamePriority: {
                  type: 'string',
                  minLength: 1,
                  maxLength: AI_DECK_PLAN_LIMITS.strategyTextLength
                },
                cardRoles: {
                  type: 'array',
                  minItems: 1,
                  maxItems: AI_DECK_PLAN_LIMITS.cardRoles,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      cardId: {
                        ...cardIdSchema
                      },
                      roles: {
                        type: 'array',
                        minItems: 1,
                        maxItems: AI_DECK_PLAN_LIMITS.rolesPerCard,
                        items: { type: 'string', enum: cardRoleValues }
                      }
                    },
                    required: ['cardId', 'roles']
                  }
                },
                combos: {
                  type: 'array',
                  maxItems: AI_DECK_PLAN_LIMITS.combos,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      cardIds: {
                        type: 'array',
                        minItems: 1,
                        maxItems: AI_DECK_PLAN_LIMITS.cardIdsPerCombo,
                        items: {
                          ...cardIdSchema
                        }
                      },
                      purpose: {
                        type: 'string',
                        minLength: 1,
                        maxLength: AI_DECK_PLAN_LIMITS.comboPurposeLength
                      }
                    },
                    required: ['cardIds', 'purpose']
                  }
                },
                resourceRules: {
                  type: 'array',
                  maxItems: AI_DECK_PLAN_LIMITS.resourceRules,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      cardIds: {
                        type: 'array',
                        minItems: 1,
                        maxItems: AI_DECK_PLAN_LIMITS.cardIdsPerResourceRule,
                        items: { ...cardIdSchema }
                      },
                      preserveUntil: {
                        type: 'string',
                        minLength: 1,
                        maxLength: AI_DECK_PLAN_LIMITS.resourceRuleTextLength
                      },
                      releaseWhen: {
                        type: 'string',
                        minLength: 1,
                        maxLength: AI_DECK_PLAN_LIMITS.resourceRuleTextLength
                      },
                      releaseTriggers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: AI_DECK_PLAN_LIMITS.releaseTriggersPerResourceRule,
                        items: {
                          type: 'string',
                          enum: [
                            'lethal',
                            'forced-survival',
                            'combo-ready',
                            'redundant-copy',
                            'invalidated-combo',
                            'critical-threat'
                          ]
                        }
                      }
                    },
                    required: [
                      'cardIds',
                      'preserveUntil',
                      'releaseWhen',
                      'releaseTriggers'
                    ]
                  }
                },
                mulliganPriorityCardIds: {
                  type: 'array',
                  maxItems: AI_DECK_PLAN_LIMITS.mulliganPriorityCards,
                  items: { ...cardIdSchema }
                }
              },
              required: [
                'planVersion',
                'archetype',
                'primaryWinCondition',
                'secondaryWinCondition',
                'earlyGamePriority',
                'midGamePriority',
                'lateGamePriority',
                'cardRoles',
                'combos',
                'resourceRules',
                'mulliganPriorityCardIds'
              ]
            },
            rationale: {
              type: 'string',
              minLength: 1,
              maxLength: AI_DECK_PLAN_LIMITS.rationaleLength
            }
          },
          required: ['plan', 'rationale']
        }
      }
    }
  }
}

function deckCardIds(deck: JsonObject): string[] {
  const cards = deck['cards']
  if (!Array.isArray(cards)) return []
  return cards.flatMap((card) => {
    if (!isRecord(card) || !isRecord(card['definition'])) return []
    const id = card['definition']['id']
    return typeof id === 'string' && id.length > 0 ? [id] : []
  })
}

function planCardIds(plan: JsonObject): string[] {
  const roles = plan['cardRoles']
  if (!Array.isArray(roles)) return []
  return roles.flatMap((role) => {
    if (!isRecord(role)) return []
    const id = role['cardId']
    return typeof id === 'string' && id.length > 0 ? [id] : []
  })
}

function buildStrategyReviewRequestBody(
  request: AiStrategyReviewRequest,
  config: AzureOpenAiConfig
): JsonObject {
  const reviewReasons = Array.isArray(request.strategicMemory['reviewReasons'])
    ? request.strategicMemory['reviewReasons'].filter(
        (reason): reason is string => typeof reason === 'string' && reason.length > 0
      )
    : []
  const deckPlanBody = buildDeckPlanRequestBody(
    {
      planId: request.reviewId,
      decisionClass: 'deck-plan',
      promptVersion: request.promptVersion,
      schemaVersion: 1,
      deadlineAtMs: request.deadlineAtMs,
      mode: {},
      deck: {}
    },
    config,
    planCardIds(request.previousPlan)
  ) as unknown as {
    response_format: {
      json_schema: { schema: { properties: { plan: JsonObject } } }
    }
  }
  const planSchema = deckPlanBody.response_format.json_schema.schema.properties.plan
  const policy = config.decisionPolicies.strategyReview
  return {
    messages: [
      {
        role: 'system',
        content:
          config.prompts.strategyReview ??
          'Review the existing strategy using only the supplied public evidence. Preserve it unless new evidence justifies a change.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          reviewId: request.reviewId,
          promptVersion: request.promptVersion,
          previousPlan: request.previousPlan,
          strategicMemory: request.strategicMemory,
          gameState: request.gameState
        })
      }
    ],
    reasoning_effort: policy.reasoningEffort,
    max_completion_tokens: policy.maxCompletionTokens,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'game_ai_strategy_review',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            review: {
              type: 'object',
              additionalProperties: false,
              properties: {
                reviewVersion: { type: 'integer', enum: [1] },
                changed: { type: 'boolean' },
                revisedPlan: {
                  anyOf: [planSchema, { type: 'null' }]
                },
                changeReasons: {
                  type: 'array',
                  maxItems: 8,
                  items:
                    reviewReasons.length > 0
                      ? { type: 'string', enum: reviewReasons }
                      : { type: 'string', minLength: 1, maxLength: 240 }
                },
                opponentAssessment: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 500
                }
              },
              required: [
                'reviewVersion',
                'changed',
                'revisedPlan',
                'changeReasons',
                'opponentAssessment'
              ]
            },
            rationale: { type: 'string', minLength: 1, maxLength: 500 }
          },
          required: ['review', 'rationale']
        }
      }
    }
  } as JsonObject
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

  async reviewStrategy(value: unknown): Promise<AiStrategyReviewResponse> {
    const request = parseAiStrategyReviewRequest(value)
    const config = await this.options.loadConfig()
    if (!config.enabled)
      throw new Error('The external game AI is disabled in config/ai.json.')
    if (!config.apiKey) {
      throw new Error(
        'The Azure OpenAI key is missing. Put only the key in config/ai-key.local.txt.'
      )
    }
    const url = buildRequestUrl(config)
    const requestBody = buildStrategyReviewRequestBody(request, config)
    const remainingDeadlineMs = request.deadlineAtMs - Date.now()
    if (remainingDeadlineMs <= 0) {
      throw new Error(
        'AI strategy-review deadline elapsed before the provider request started.'
      )
    }
    const timeoutMs = Math.max(
      1,
      Math.min(
        config.decisionPolicies.strategyReview.requestTimeoutMs,
        remainingDeadlineMs
      )
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = performance.now()
    let response: Response
    try {
      response = await this.fetch(url, {
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
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Azure OpenAI request failed: ${message}`, { cause: error })
    } finally {
      clearTimeout(timeout)
    }
    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`Azure OpenAI returned HTTP ${response.status}: ${responseText}`)
    }
    let assistantContent: string | undefined
    try {
      const responseBody = parseJson(responseText, 'Azure OpenAI response')
      assistantContent = extractAssistantContent(responseBody)
      const parsed = parseJson(assistantContent, 'AI assistant content')
      if (!isRecord(parsed))
        throw new Error('AI strategy review response must be an object.')
      const metadata = providerMetadata(responseBody)
      if (
        metadata.actualModelId &&
        !metadata.actualModelId.toLowerCase().includes('gpt-5.4-nano')
      ) {
        throw new Error(
          `Azure OpenAI returned disallowed model ${metadata.actualModelId}.`
        )
      }
      return parseAiStrategyReviewResponse({
        review: normalizeStrategyReviewSetLists(parsed['review']),
        rationale: requiredModelString(parsed, 'rationale'),
        modelId: metadata.actualModelId ?? config.modelId,
        ...(config.debug
          ? {
              debug: {
                url,
                durationMs: Math.round(performance.now() - startedAt),
                ...metadata,
                requestBody,
                responseBody
              }
            }
          : {})
      })
    } catch (error) {
      throw responseDiagnosticError(
        config,
        url,
        response,
        responseText,
        error instanceof Error ? error.message : String(error),
        assistantContent,
        error
      )
    }
  }

  async planDeck(value: unknown): Promise<AiDeckPlanResponse> {
    const request = parseAiDeckPlanRequest(value)
    const config = await this.options.loadConfig()
    if (!config.enabled)
      throw new Error('The external game AI is disabled in config/ai.json.')
    if (!config.apiKey) {
      throw new Error(
        'The Azure OpenAI key is missing. Put only the key in config/ai-key.local.txt.'
      )
    }

    const url = buildRequestUrl(config)
    const requestBody = buildDeckPlanRequestBody(request, config)
    const remainingDeadlineMs = request.deadlineAtMs - Date.now()
    if (remainingDeadlineMs <= 0) {
      throw new Error(
        'AI deck-plan deadline elapsed before the provider request started.'
      )
    }
    const timeoutMs = Math.max(
      1,
      Math.min(config.decisionPolicies.deckPlan.requestTimeoutMs, remainingDeadlineMs)
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = performance.now()
    let response: Response
    try {
      response = await this.fetch(url, {
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
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Azure OpenAI request failed: ${message}`, { cause: error })
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`Azure OpenAI returned HTTP ${response.status}: ${responseText}`)
    }
    let responseBody: JsonValue
    try {
      responseBody = parseJson(responseText, 'Azure OpenAI response')
      const assistantContent = extractAssistantContent(responseBody)
      const parsed = parseJson(assistantContent, 'AI assistant content')
      if (!isRecord(parsed)) throw new Error('AI deck plan response must be an object.')
      const modelPlan: ModelDeckPlan = {
        plan: normalizeDeckPlanSetLists(parsed['plan']),
        rationale: requiredModelString(parsed, 'rationale')
      }
      const metadata = providerMetadata(responseBody)
      if (
        metadata.actualModelId &&
        !metadata.actualModelId.toLowerCase().includes('gpt-5.4-nano')
      ) {
        throw new Error(
          `Azure OpenAI returned disallowed model ${metadata.actualModelId}.`
        )
      }
      return parseAiDeckPlanResponse({
        ...modelPlan,
        modelId: metadata.actualModelId ?? config.modelId,
        ...(config.debug
          ? {
              debug: {
                url,
                durationMs: Math.round(performance.now() - startedAt),
                ...metadata,
                requestBody,
                responseBody
              }
            }
          : {})
      })
    } catch (error) {
      throw responseDiagnosticError(
        config,
        url,
        response,
        responseText,
        error instanceof Error ? error.message : String(error),
        undefined,
        error
      )
    }
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
    const policy =
      request.pass === 'rank'
        ? config.decisionPolicies.rank
        : request.pass === 'critic'
          ? config.decisionPolicies.critic
          : config.decisionPolicies[request.decisionClass]
    const remainingDeadlineMs = request.deadlineAtMs - Date.now()
    if (remainingDeadlineMs <= 0) {
      throw new Error(
        'AI decision deadline elapsed before the provider request started.'
      )
    }
    const timeoutMs = Math.max(
      1,
      Math.min(policy.requestTimeoutMs, remainingDeadlineMs)
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
        throw new Error(`Azure OpenAI request timed out after ${timeoutMs}ms.`, {
          cause: error
        })
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Azure OpenAI request failed: ${message}`, { cause: error })
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`Azure OpenAI returned HTTP ${response.status}: ${responseText}`)
    }
    let responseBody: JsonValue
    try {
      responseBody = parseJson(responseText, 'Azure OpenAI response')
    } catch (error) {
      throw responseDiagnosticError(
        config,
        url,
        response,
        responseText,
        'Azure OpenAI response did not contain valid JSON.',
        undefined,
        error
      )
    }
    let assistantContent: string | undefined
    try {
      assistantContent = extractAssistantContent(responseBody)
      const decision = parseModelDecision(
        parseJson(assistantContent, 'AI assistant content'),
        request
      )
      const rawDecision = parseJson(assistantContent, 'AI assistant content')
      const metadata = providerMetadata(responseBody)
      if (
        metadata.actualModelId &&
        !metadata.actualModelId.toLowerCase().includes('gpt-5.4-nano')
      ) {
        throw new Error(
          `Azure OpenAI returned disallowed model ${metadata.actualModelId}.`
        )
      }
      return parseAiDecisionResponse({
        ...decision,
        modelId: metadata.actualModelId ?? config.modelId,
        ...(request.pass === 'rank' && isRecord(rawDecision)
          ? {
              pass: 'rank',
              orderedActionIds: rawDecision['orderedActionIds'],
              confidence: rawDecision['confidence']
            }
          : {}),
        ...(request.pass === 'critic' && isRecord(rawDecision)
          ? {
              pass: 'critic',
              retainedFirstChoice: rawDecision['retainedFirstChoice'],
              identifiedRisks: rawDecision['identifiedRisks']
            }
          : {}),
        ...(config.debug
          ? {
              debug: {
                url,
                durationMs: Math.round(performance.now() - startedAt),
                ...metadata,
                requestBody,
                responseBody
              }
            }
          : {})
      })
    } catch (error) {
      throw responseDiagnosticError(
        config,
        url,
        response,
        responseText,
        error instanceof Error ? error.message : String(error),
        assistantContent,
        error
      )
    }
  }
}
