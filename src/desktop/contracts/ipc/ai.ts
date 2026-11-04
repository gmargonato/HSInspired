import { parseAiDecisionChoice, type AiDecisionChoice } from './ai-deliberation'

export const AI_LOG_SCHEMA_VERSION = 7

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}
export interface AiMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}
export type AiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'
// Legacy 'none' metadata identifies the in-process local engine.
export type AiProviderId = 'none'
export const AI_REQUEST_LIMITS = {
  timeoutMs: 45_000,
  maxContextBytes: 200_000,
  schemaAllowanceBytes: 50_000
} as const
export function isAiReasoningEffort(value: unknown): value is AiReasoningEffort {
  return (
    typeof value === 'string' &&
    ['none', 'low', 'medium', 'high', 'xhigh'].includes(value)
  )
}
export interface AiSettings {
  readonly enabled: boolean
  readonly provider: AiProviderId
  readonly modelId: string
  readonly reasoningEffort: AiReasoningEffort
  readonly maxCompletionTokens: number
  readonly maxContextBytes?: number
}
export interface AiDecisionIdentity {
  readonly matchId: string
  readonly requestId: string
  readonly expectedRevision: number
}
export const AI_REQUEST_STAGES = [
  'transport-started',
  'socket-assigned',
  'dns-resolved',
  'tcp-connected',
  'tls-connected',
  'request-sent',
  'response-headers',
  'response-body',
  'response-complete',
  'response-validated',
  'waiting',
  'failed',
  'cancelled',
  'attempt-failed',
  'retry-scheduled',
  'recovery-complete',
  'recovery-exhausted'
] as const
export type AiRequestStage = (typeof AI_REQUEST_STAGES)[number]
export interface AiRequestProgress extends AiDecisionIdentity {
  readonly recovery?: JsonObject
  readonly stage: AiRequestStage
  readonly elapsedMs: number
  readonly lastStage?: AiRequestStage
  readonly receivedBytes?: number
  readonly httpStatus?: number
  readonly providerRequestId?: string
}
export interface AiDecisionRequest extends AiDecisionIdentity {
  readonly phase?: 'plan' | 'action' | 'mulligan'
  readonly allowInspection?: boolean
  readonly messages: readonly AiMessage[]
  readonly actionIds: readonly string[]
}
export type AiChoice = {
  readonly reason: string
  readonly choice: AiDecisionChoice
}
export interface AiDecisionResponse extends AiDecisionIdentity, AiChoice {
  readonly modelId: string
  readonly durationMs: number
  readonly finishReason: string
  readonly usage?: JsonObject
}
export interface AiDecisionApi {
  onProgress?(listener: (progress: AiRequestProgress) => void): () => void
  settings(): Promise<AiSettings>
  decide(request: AiDecisionRequest): Promise<AiDecisionResponse>
  cancel(identity: AiDecisionIdentity): Promise<void>
}
export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly details?: JsonObject
  ) {
    super(message)
    this.name = 'AiRequestError'
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(label + ' must be a non-empty string.')
  return value
}
export function parseAiIdentity(value: unknown): AiDecisionIdentity {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 0
  )
    throw new Error('Invalid AI decision identity.')
  return {
    matchId: requiredString(value.matchId, 'matchId'),
    requestId: requiredString(value.requestId, 'requestId'),
    expectedRevision: value.expectedRevision as number
  }
}
export function parseAiDecisionRequest(value: unknown): AiDecisionRequest {
  const identity = parseAiIdentity(value)
  const data = value as Record<string, unknown>
  if (
    data.phase !== undefined &&
    data.phase !== 'plan' &&
    data.phase !== 'action' &&
    data.phase !== 'mulligan'
  )
    throw new Error('Invalid AI request phase.')
  if (data.allowInspection !== undefined && typeof data.allowInspection !== 'boolean')
    throw new Error('Invalid inspection allowance.')
  if (
    !Array.isArray(data.messages) ||
    !data.messages.length ||
    !Array.isArray(data.actionIds) ||
    (data.phase !== 'mulligan' && !data.actionIds.length)
  )
    throw new Error('AI request requires messages and legal action IDs.')
  const messages = data.messages.map((message): AiMessage => {
    if (
      !isRecord(message) ||
      !['system', 'user', 'assistant'].includes(String(message.role))
    )
      throw new Error('Invalid AI message.')
    return {
      role: message.role as AiMessage['role'],
      content: requiredString(message.content, 'message content')
    }
  })
  const actionIds = data.actionIds.map((id) => requiredString(id, 'actionId'))
  if (new Set(actionIds).size !== actionIds.length)
    throw new Error('Duplicate AI action IDs.')
  return {
    ...identity,
    phase: data.phase as 'plan' | 'action' | 'mulligan' | undefined,
    allowInspection: data.allowInspection === true,
    messages,
    actionIds
  }
}
export function parseAiChoice(value: unknown): AiChoice {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.choice))
    throw new Error('AI response must contain reason and exactly one choice.')
  const reason = requiredString(value.reason, 'reason')
  if (reason.length > 600) throw new Error('AI reason exceeds 600 characters.')
  return { reason, choice: parseAiDecisionChoice(value.choice) }
}
export function parseAiDecisionResponse(value: unknown): AiDecisionResponse {
  const identity = parseAiIdentity(value)
  const data = value as Record<string, unknown>
  if (
    typeof data.durationMs !== 'number' ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs < 0 ||
    (data.usage !== undefined && !isRecord(data.usage))
  )
    throw new Error('Invalid AI response metadata.')
  return {
    ...identity,
    ...parseAiChoice({ choice: data.choice, reason: data.reason }),
    modelId: requiredString(data.modelId, 'modelId'),
    durationMs: data.durationMs,
    finishReason: requiredString(data.finishReason, 'finishReason'),
    ...(data.usage === undefined
      ? {}
      : { usage: JSON.parse(JSON.stringify(data.usage)) as JsonObject })
  }
}
