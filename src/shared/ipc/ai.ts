export const AI_IPC_CHANNELS = {
  decide: 'ai:decide'
} as const

export type AiDecisionPhase = 'mulligan' | 'turn'
export type AiActionKind =
  | 'confirm-mulligan'
  | 'play-card'
  | 'choose-discover-card'
  | 'attack-character'
  | 'use-hero-power'
  | 'end-turn'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface AiLegalAction {
  readonly id: string
  readonly kind: AiActionKind
  readonly description: string
  readonly details: JsonObject
}

export interface AiDecisionRequest {
  readonly decisionId: string
  readonly phase: AiDecisionPhase
  readonly matchRevision: number
  readonly strategySummary: string
  readonly gameState: JsonObject
  readonly legalActions: readonly AiLegalAction[]
}

export interface AiProviderDebugTrace {
  readonly url: string
  readonly durationMs: number
  readonly requestBody: JsonObject
  readonly responseBody: JsonValue
}

export interface AiDecisionResponse {
  readonly actionId: string
  readonly rationale: string
  readonly strategicIntent: string
  readonly strategySummary: string
  readonly modelId: string
  readonly debug?: AiProviderDebugTrace
}

export interface AiDecisionApi {
  decide(request: AiDecisionRequest): Promise<AiDecisionResponse>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 40) return false
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1))
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => isJsonValue(item, depth + 1))
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}.${key} must be a non-empty string`)
  }
  return value
}

function parseLegalAction(value: unknown, index: number): AiLegalAction {
  if (!isRecord(value)) throw new Error(`AI request legalActions[${index}] is invalid`)
  const kind = requireString(value, 'kind', `AI request legalActions[${index}]`)
  if (
    kind !== 'confirm-mulligan' &&
    kind !== 'play-card' &&
    kind !== 'choose-discover-card' &&
    kind !== 'attack-character' &&
    kind !== 'use-hero-power' &&
    kind !== 'end-turn'
  ) {
    throw new Error(`AI request legalActions[${index}].kind is invalid`)
  }
  const details = value['details']
  if (!isRecord(details) || !isJsonValue(details)) {
    throw new Error(`AI request legalActions[${index}].details must be JSON`)
  }
  return {
    id: requireString(value, 'id', `AI request legalActions[${index}]`),
    kind,
    description: requireString(
      value,
      'description',
      `AI request legalActions[${index}]`
    ),
    details
  }
}

export function parseAiDecisionRequest(value: unknown): AiDecisionRequest {
  if (!isRecord(value)) throw new Error('AI decision request must be an object')
  const phase = requireString(value, 'phase', 'AI decision request')
  if (phase !== 'mulligan' && phase !== 'turn') {
    throw new Error('AI decision request phase is invalid')
  }
  const matchRevision = value['matchRevision']
  if (!Number.isSafeInteger(matchRevision) || (matchRevision as number) < 0) {
    throw new Error('AI decision request matchRevision must be a non-negative integer')
  }
  const strategySummary = value['strategySummary']
  if (typeof strategySummary !== 'string') {
    throw new Error('AI decision request strategySummary must be a string')
  }
  const gameState = value['gameState']
  if (!isRecord(gameState) || !isJsonValue(gameState)) {
    throw new Error('AI decision request gameState must be JSON')
  }
  const legalActionValues = value['legalActions']
  if (!Array.isArray(legalActionValues) || legalActionValues.length === 0) {
    throw new Error('AI decision request must contain at least one legal action')
  }
  if (legalActionValues.length > 2000) {
    throw new Error('AI decision request contains too many legal actions')
  }
  const legalActions = legalActionValues.map(parseLegalAction)
  const ids = new Set(legalActions.map((action) => action.id))
  if (ids.size !== legalActions.length) {
    throw new Error('AI decision request action ids must be unique')
  }
  return {
    decisionId: requireString(value, 'decisionId', 'AI decision request'),
    phase,
    matchRevision: matchRevision as number,
    strategySummary,
    gameState,
    legalActions
  }
}

function parseDebugTrace(value: unknown): AiProviderDebugTrace | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('AI decision response debug trace is invalid')
  const durationMs = value['durationMs']
  const requestBody = value['requestBody']
  const responseBody = value['responseBody']
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    throw new Error('AI decision response debug duration is invalid')
  }
  if (
    !isRecord(requestBody) ||
    !isJsonValue(requestBody) ||
    !isJsonValue(responseBody)
  ) {
    throw new Error('AI decision response debug payload is invalid')
  }
  return {
    url: requireString(value, 'url', 'AI decision response debug'),
    durationMs,
    requestBody,
    responseBody
  }
}

export function parseAiDecisionResponse(value: unknown): AiDecisionResponse {
  if (!isRecord(value)) throw new Error('AI decision response must be an object')
  const debug = parseDebugTrace(value['debug'])
  return {
    actionId: requireString(value, 'actionId', 'AI decision response'),
    rationale: requireString(value, 'rationale', 'AI decision response'),
    strategicIntent: requireString(value, 'strategicIntent', 'AI decision response'),
    strategySummary: requireString(value, 'strategySummary', 'AI decision response'),
    modelId: requireString(value, 'modelId', 'AI decision response'),
    ...(debug ? { debug } : {})
  }
}
