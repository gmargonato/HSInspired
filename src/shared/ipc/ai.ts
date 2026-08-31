export const AI_IPC_CHANNELS = {
  decide: 'ai:decide',
  planDeck: 'ai:plan-deck'
} as const

/** Shared limits keep provider schemas and runtime validation in lockstep. */
export const AI_DECK_PLAN_LIMITS = {
  strategyTextLength: 500,
  rationaleLength: 500,
  cardIdLength: 120,
  cardRoles: 30,
  rolesPerCard: 5,
  combos: 12,
  cardIdsPerCombo: 8,
  comboPurposeLength: 240,
  resourceRules: 12,
  cardIdsPerResourceRule: 8,
  resourceRuleTextLength: 240,
  mulliganPriorityCards: 15
} as const

export type AiDecisionPhase = 'mulligan' | 'turn'
export type AiDecisionClass = 'deck-plan' | 'mulligan' | 'discover' | 'turn'
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
  /** Deterministic, non-mutating simulation data supplied to the ranking model. */
  readonly analysis?: AiActionAnalysis
}

export interface AiActionAnalysis {
  readonly accepted: boolean
  readonly terminal: 'win' | 'loss' | 'none'
  readonly selfEffectiveHealth: number
  readonly opponentEffectiveHealth: number
  readonly selfBoardAttack: number
  readonly opponentBoardAttack: number
  readonly score: number
  /** Strategic cost of spending a card reserved by the match-scoped deck plan. */
  readonly planResourceCost?: number
  /** True when a private or random outcome prevents an authoritative exact preview. */
  readonly uncertain?: boolean
}

export type AiDeckArchetype =
  'aggro' | 'tempo' | 'midrange' | 'control' | 'combo' | 'fatigue' | 'hybrid'

export type AiCardRole =
  | 'win-condition'
  | 'combo-piece'
  | 'enabler'
  | 'draw'
  | 'removal'
  | 'survival'
  | 'tempo'
  | 'finisher'
  | 'flex'

export interface AiDeckPlanCardRole {
  readonly cardId: string
  readonly roles: readonly AiCardRole[]
}

export interface AiDeckPlanCombo {
  readonly cardIds: readonly string[]
  readonly purpose: string
}

export interface AiDeckPlanResourceRule {
  readonly cardIds: readonly string[]
  readonly preserveUntil: string
  readonly releaseWhen: string
}

/** Compact strategic memory generated once per match from the AI's own deck. */
export interface AiDeckPlan {
  readonly planVersion: 1
  readonly archetype: AiDeckArchetype
  readonly primaryWinCondition: string
  readonly secondaryWinCondition: string
  readonly earlyGamePriority: string
  readonly midGamePriority: string
  readonly lateGamePriority: string
  readonly cardRoles: readonly AiDeckPlanCardRole[]
  readonly combos: readonly AiDeckPlanCombo[]
  readonly resourceRules: readonly AiDeckPlanResourceRule[]
  readonly mulliganPriorityCardIds: readonly string[]
}

export interface AiDeckPlanRequest {
  readonly planId: string
  readonly decisionClass: 'deck-plan'
  readonly promptVersion: string
  readonly schemaVersion: number
  readonly deadlineAtMs: number
  readonly mode: JsonObject
  readonly deck: JsonObject
}

export interface AiDecisionRequest {
  readonly decisionId: string
  readonly phase: AiDecisionPhase
  readonly decisionClass: AiDecisionClass
  readonly matchRevision: number
  readonly promptVersion: string
  readonly contextVersion: number
  readonly schemaVersion: number
  /** Epoch milliseconds at which this response is no longer useful. */
  readonly deadlineAtMs: number
  readonly gameState: JsonObject
  readonly legalActions: readonly AiLegalAction[]
}

export interface AiProviderDebugTrace {
  readonly url: string
  readonly durationMs: number
  readonly actualModelId?: string
  readonly finishReason?: string
  readonly usage?: JsonObject
  readonly requestBody: JsonObject
  readonly responseBody: JsonValue
}

export interface AiDecisionResponse {
  readonly actionId: string
  readonly decisionClass: AiDecisionClass
  readonly rationale: string
  readonly modelId: string
  readonly debug?: AiProviderDebugTrace
}

export interface AiDeckPlanResponse {
  readonly plan: AiDeckPlan
  readonly rationale: string
  readonly modelId: string
  readonly debug?: AiProviderDebugTrace
}

export interface AiDecisionApi {
  decide(request: AiDecisionRequest): Promise<AiDecisionResponse>
  planDeck?(request: AiDeckPlanRequest): Promise<AiDeckPlanResponse>
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

function requireBoundedString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = 500
): string {
  const value = requireString(record, key, label).trim()
  if (value.length > maximumLength) {
    throw new Error(`${label}.${key} must be at most ${maximumLength} characters`)
  }
  return value
}

function requireTruncatedString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength: number
): string {
  return requireString(record, key, label).trim().slice(0, maximumLength)
}

function requireStringArray(
  value: unknown,
  label: string,
  maximumLength: number
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new Error(`${label} must be an array with at most ${maximumLength} entries`)
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`${label}[${index}] must be a non-empty string`)
    }
    return entry.trim()
  })
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates`)
  }
  return result
}

const AI_CARD_ROLES = new Set<AiCardRole>([
  'win-condition',
  'combo-piece',
  'enabler',
  'draw',
  'removal',
  'survival',
  'tempo',
  'finisher',
  'flex'
])

export function parseAiDeckPlan(value: unknown): AiDeckPlan {
  if (!isRecord(value)) throw new Error('AI deck plan must be an object')
  if (value['planVersion'] !== 1) throw new Error('AI deck plan version is invalid')
  const archetype = value['archetype']
  if (
    archetype !== 'aggro' &&
    archetype !== 'tempo' &&
    archetype !== 'midrange' &&
    archetype !== 'control' &&
    archetype !== 'combo' &&
    archetype !== 'fatigue' &&
    archetype !== 'hybrid'
  ) {
    throw new Error('AI deck plan archetype is invalid')
  }
  const cardRoleValues = value['cardRoles']
  if (
    !Array.isArray(cardRoleValues) ||
    cardRoleValues.length > AI_DECK_PLAN_LIMITS.cardRoles
  ) {
    throw new Error(
      `AI deck plan cardRoles must contain at most ${AI_DECK_PLAN_LIMITS.cardRoles} entries`
    )
  }
  const cardRoles = cardRoleValues.map((entry, index): AiDeckPlanCardRole => {
    if (!isRecord(entry)) throw new Error(`AI deck plan cardRoles[${index}] is invalid`)
    const roles = requireStringArray(
      entry['roles'],
      `AI deck plan cardRoles[${index}].roles`,
      AI_DECK_PLAN_LIMITS.rolesPerCard
    )
    if (!roles.every((role) => AI_CARD_ROLES.has(role as AiCardRole))) {
      throw new Error(`AI deck plan cardRoles[${index}].roles is invalid`)
    }
    return {
      cardId: requireBoundedString(
        entry,
        'cardId',
        `AI deck plan cardRoles[${index}]`,
        AI_DECK_PLAN_LIMITS.cardIdLength
      ),
      roles: roles as readonly AiCardRole[]
    }
  })
  const comboValues = value['combos']
  if (!Array.isArray(comboValues) || comboValues.length > AI_DECK_PLAN_LIMITS.combos) {
    throw new Error(
      `AI deck plan combos must contain at most ${AI_DECK_PLAN_LIMITS.combos} entries`
    )
  }
  const combos = comboValues.map((entry, index): AiDeckPlanCombo => {
    if (!isRecord(entry)) throw new Error(`AI deck plan combos[${index}] is invalid`)
    return {
      cardIds: requireStringArray(
        entry['cardIds'],
        `AI deck plan combos[${index}].cardIds`,
        AI_DECK_PLAN_LIMITS.cardIdsPerCombo
      ),
      purpose: requireTruncatedString(
        entry,
        'purpose',
        `AI deck plan combos[${index}]`,
        AI_DECK_PLAN_LIMITS.comboPurposeLength
      )
    }
  })
  const resourceValues = value['resourceRules']
  if (
    !Array.isArray(resourceValues) ||
    resourceValues.length > AI_DECK_PLAN_LIMITS.resourceRules
  ) {
    throw new Error(
      `AI deck plan resourceRules must contain at most ${AI_DECK_PLAN_LIMITS.resourceRules} entries`
    )
  }
  const resourceRules = resourceValues.map((entry, index): AiDeckPlanResourceRule => {
    if (!isRecord(entry)) {
      throw new Error(`AI deck plan resourceRules[${index}] is invalid`)
    }
    return {
      cardIds: requireStringArray(
        entry['cardIds'],
        `AI deck plan resourceRules[${index}].cardIds`,
        AI_DECK_PLAN_LIMITS.cardIdsPerResourceRule
      ),
      preserveUntil: requireTruncatedString(
        entry,
        'preserveUntil',
        `AI deck plan resourceRules[${index}]`,
        AI_DECK_PLAN_LIMITS.resourceRuleTextLength
      ),
      releaseWhen: requireTruncatedString(
        entry,
        'releaseWhen',
        `AI deck plan resourceRules[${index}]`,
        AI_DECK_PLAN_LIMITS.resourceRuleTextLength
      )
    }
  })
  return {
    planVersion: 1,
    archetype,
    primaryWinCondition: requireTruncatedString(
      value,
      'primaryWinCondition',
      'AI deck plan',
      AI_DECK_PLAN_LIMITS.strategyTextLength
    ),
    secondaryWinCondition: requireTruncatedString(
      value,
      'secondaryWinCondition',
      'AI deck plan',
      AI_DECK_PLAN_LIMITS.strategyTextLength
    ),
    earlyGamePriority: requireTruncatedString(
      value,
      'earlyGamePriority',
      'AI deck plan',
      AI_DECK_PLAN_LIMITS.strategyTextLength
    ),
    midGamePriority: requireTruncatedString(
      value,
      'midGamePriority',
      'AI deck plan',
      AI_DECK_PLAN_LIMITS.strategyTextLength
    ),
    lateGamePriority: requireTruncatedString(
      value,
      'lateGamePriority',
      'AI deck plan',
      AI_DECK_PLAN_LIMITS.strategyTextLength
    ),
    cardRoles,
    combos,
    resourceRules,
    mulliganPriorityCardIds: requireStringArray(
      value['mulliganPriorityCardIds'],
      'AI deck plan mulliganPriorityCardIds',
      AI_DECK_PLAN_LIMITS.mulliganPriorityCards
    )
  }
}

export function parseAiDeckPlanRequest(value: unknown): AiDeckPlanRequest {
  if (!isRecord(value)) throw new Error('AI deck plan request must be an object')
  if (value['decisionClass'] !== 'deck-plan') {
    throw new Error('AI deck plan request decisionClass is invalid')
  }
  const schemaVersion = value['schemaVersion']
  const deadlineAtMs = value['deadlineAtMs']
  const mode = value['mode']
  const deck = value['deck']
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new Error('AI deck plan request schemaVersion must be a positive integer')
  }
  if (!Number.isSafeInteger(deadlineAtMs) || (deadlineAtMs as number) <= 0) {
    throw new Error('AI deck plan request deadlineAtMs must be a positive integer')
  }
  if (!isRecord(mode) || !isJsonValue(mode) || !isRecord(deck) || !isJsonValue(deck)) {
    throw new Error('AI deck plan request mode and deck must be JSON objects')
  }
  return {
    planId: requireString(value, 'planId', 'AI deck plan request'),
    decisionClass: 'deck-plan',
    promptVersion: requireString(value, 'promptVersion', 'AI deck plan request'),
    schemaVersion: schemaVersion as number,
    deadlineAtMs: deadlineAtMs as number,
    mode,
    deck
  }
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
  const analysis = value['analysis']
  if (analysis !== undefined && !isRecord(analysis)) {
    throw new Error(`AI request legalActions[${index}].analysis is invalid`)
  }
  const parsedAnalysis =
    analysis === undefined
      ? undefined
      : {
          accepted: analysis['accepted'],
          terminal: analysis['terminal'],
          selfEffectiveHealth: analysis['selfEffectiveHealth'],
          opponentEffectiveHealth: analysis['opponentEffectiveHealth'],
          selfBoardAttack: analysis['selfBoardAttack'],
          opponentBoardAttack: analysis['opponentBoardAttack'],
          score: analysis['score'],
          planResourceCost: analysis['planResourceCost'],
          uncertain: analysis['uncertain']
        }
  if (
    parsedAnalysis &&
    (typeof parsedAnalysis.accepted !== 'boolean' ||
      (parsedAnalysis.terminal !== 'win' &&
        parsedAnalysis.terminal !== 'loss' &&
        parsedAnalysis.terminal !== 'none') ||
      ![
        parsedAnalysis.selfEffectiveHealth,
        parsedAnalysis.opponentEffectiveHealth,
        parsedAnalysis.selfBoardAttack,
        parsedAnalysis.opponentBoardAttack,
        parsedAnalysis.score
      ].every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ||
      (parsedAnalysis.planResourceCost !== undefined &&
        (typeof parsedAnalysis.planResourceCost !== 'number' ||
          !Number.isFinite(parsedAnalysis.planResourceCost))) ||
      (parsedAnalysis.uncertain !== undefined &&
        typeof parsedAnalysis.uncertain !== 'boolean'))
  ) {
    throw new Error(`AI request legalActions[${index}].analysis is invalid`)
  }
  return {
    id: requireString(value, 'id', `AI request legalActions[${index}]`),
    kind,
    description: requireString(
      value,
      'description',
      `AI request legalActions[${index}]`
    ),
    details,
    ...(parsedAnalysis ? { analysis: parsedAnalysis as AiActionAnalysis } : {})
  }
}

function parseDecisionClass(value: unknown, label: string): AiDecisionClass {
  if (
    value === 'deck-plan' ||
    value === 'mulligan' ||
    value === 'discover' ||
    value === 'turn'
  )
    return value
  throw new Error(`${label} decisionClass is invalid`)
}

export function parseAiDecisionRequest(value: unknown): AiDecisionRequest {
  if (!isRecord(value)) throw new Error('AI decision request must be an object')
  const phase = requireString(value, 'phase', 'AI decision request')
  if (phase !== 'mulligan' && phase !== 'turn') {
    throw new Error('AI decision request phase is invalid')
  }
  const decisionClass = parseDecisionClass(
    value['decisionClass'],
    'AI decision request'
  )
  if ((phase === 'mulligan') !== (decisionClass === 'mulligan')) {
    throw new Error('AI decision request phase and decisionClass are inconsistent')
  }
  const matchRevision = value['matchRevision']
  if (!Number.isSafeInteger(matchRevision) || (matchRevision as number) < 0) {
    throw new Error('AI decision request matchRevision must be a non-negative integer')
  }
  const deadlineAtMs = value['deadlineAtMs']
  if (!Number.isSafeInteger(deadlineAtMs) || (deadlineAtMs as number) <= 0) {
    throw new Error('AI decision request deadlineAtMs must be a positive integer')
  }
  const contextVersion = value['contextVersion']
  const schemaVersion = value['schemaVersion']
  if (!Number.isSafeInteger(contextVersion) || (contextVersion as number) < 1) {
    throw new Error('AI decision request contextVersion must be a positive integer')
  }
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new Error('AI decision request schemaVersion must be a positive integer')
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
    decisionClass,
    matchRevision: matchRevision as number,
    promptVersion: requireString(value, 'promptVersion', 'AI decision request'),
    contextVersion: contextVersion as number,
    schemaVersion: schemaVersion as number,
    deadlineAtMs: deadlineAtMs as number,
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
  const actualModelId = value['actualModelId']
  const finishReason = value['finishReason']
  const usage = value['usage']
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
  if (actualModelId !== undefined && typeof actualModelId !== 'string') {
    throw new Error('AI decision response debug model id is invalid')
  }
  if (finishReason !== undefined && typeof finishReason !== 'string') {
    throw new Error('AI decision response debug finish reason is invalid')
  }
  if (usage !== undefined && (!isRecord(usage) || !isJsonValue(usage))) {
    throw new Error('AI decision response debug usage is invalid')
  }
  return {
    url: requireString(value, 'url', 'AI decision response debug'),
    durationMs,
    requestBody,
    responseBody,
    ...(actualModelId ? { actualModelId } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {})
  }
}

export function parseAiDecisionResponse(value: unknown): AiDecisionResponse {
  if (!isRecord(value)) throw new Error('AI decision response must be an object')
  const debug = parseDebugTrace(value['debug'])
  return {
    actionId: requireString(value, 'actionId', 'AI decision response'),
    decisionClass: parseDecisionClass(value['decisionClass'], 'AI decision response'),
    rationale: requireString(value, 'rationale', 'AI decision response'),
    modelId: requireString(value, 'modelId', 'AI decision response'),
    ...(debug ? { debug } : {})
  }
}

export function parseAiDeckPlanResponse(value: unknown): AiDeckPlanResponse {
  if (!isRecord(value)) throw new Error('AI deck plan response must be an object')
  const debug = parseDebugTrace(value['debug'])
  return {
    plan: parseAiDeckPlan(value['plan']),
    rationale: requireTruncatedString(
      value,
      'rationale',
      'AI deck plan response',
      AI_DECK_PLAN_LIMITS.rationaleLength
    ),
    modelId: requireString(value, 'modelId', 'AI deck plan response'),
    ...(debug ? { debug } : {})
  }
}
