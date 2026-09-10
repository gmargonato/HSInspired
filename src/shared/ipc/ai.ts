export const AI_IPC_CHANNELS = {
  planDeck: 'ai:plan-deck',
  decide: 'ai:decide'
} as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface AiDeckCard {
  readonly cardId: string
  readonly count: number
  readonly name: string
  readonly type: string
  readonly cost: number
  readonly rulesText: string
  readonly keywords: readonly string[]
  readonly effects: JsonValue
}

export interface AiDeckPlan {
  readonly strategy: string
  readonly winConditions: readonly string[]
  readonly priorities: readonly string[]
  readonly preserve: readonly Readonly<{
    readonly cardId: string
    readonly reason: string
    readonly releaseWhen: string
  }>[]
  readonly mulligan: readonly string[]
}

export interface AiDeckPlanRequest {
  readonly logMatchId?: string
  readonly requestId: string
  readonly deadlineAtMs: number
  readonly deck: Readonly<{
    readonly heroId: string
    readonly cards: readonly AiDeckCard[]
  }>
}

export interface AiDeckPlanResponse {
  readonly requestId: string
  readonly plan: AiDeckPlan
  readonly rationale: string
  readonly modelId: string
  readonly debug?: AiProviderDebug
}

export const AI_POLICY_RISK_FLAGS = [
  'no-effect',
  'ineffective-hero-freeze',
  'immediate-loss',
  'draws-from-empty-deck',
  'hand-overflow',
  'burns-card',
  'fatigue-lethal'
] as const

export type AiPolicyRiskFlag = (typeof AI_POLICY_RISK_FLAGS)[number]
export type AiPolicyCertainty = 'proven' | 'bounded' | 'unknown'

export interface AiPolicyEffectSummary {
  readonly manaSpent: number
  readonly damageDealt: number
  readonly damageToSelf: number
  readonly damageToOpponent: number
  readonly healthRestored: number
  readonly armorGained: number
  readonly cardsDrawn: number
  readonly cardsGenerated: number
  readonly cardsBurned: number
  readonly fatigueDamage: number
  readonly triggeredEffects: number
}

export interface AiPolicyActionEvidence {
  readonly index: number
  readonly action: string
  readonly manaSpent: number
  readonly damageDealt: number
  readonly healthRestored: number
  readonly cardsDrawn: number
  readonly cardsGenerated: number
  readonly cardsBurned: number
  readonly fatigueDamage: number
  readonly riskFlags: readonly AiPolicyRiskFlag[]
  readonly hasBeneficialEffect: boolean
  readonly beneficialTrigger: boolean
}

export interface AiPolicyDeferredEffects {
  readonly trigger: 'next-own-turn-draw'
  readonly cardsDrawn: number
  readonly cardsBurned: number
  readonly fatigueDamage: number
  readonly riskFlags: readonly AiPolicyRiskFlag[]
}

export interface AiPolicyEvidence {
  readonly certainty: AiPolicyCertainty
  readonly riskFlags: readonly AiPolicyRiskFlag[]
  readonly effectSummary: AiPolicyEffectSummary
  readonly actions: readonly AiPolicyActionEvidence[]
  readonly deferredEffects?: AiPolicyDeferredEffects
  readonly guaranteedLethal: boolean
  readonly immediateLoss: boolean
  readonly hasBeneficialEffect: boolean
  readonly rejectable: boolean
}

export interface AiPolicyOption {
  readonly id: string
  readonly actions: readonly string[]
  readonly completeTurn: boolean
  readonly stopsAtNewInformation: boolean
  readonly result?: JsonObject
  readonly evidence?: AiPolicyEvidence
}

export interface AiDecisionRequest {
  readonly logMatchId?: string
  readonly requestId: string
  readonly phase: 'mulligan' | 'turn'
  readonly deadlineAtMs: number
  readonly plan: AiDeckPlan
  readonly state: JsonObject
  readonly policies: readonly AiPolicyOption[]
}

export interface AiDecisionResponse {
  readonly requestId: string
  readonly policyId: string
  readonly rationale: string
  readonly modelId: string
  readonly debug?: AiProviderDebug
}

export interface AiProviderDebug {
  readonly durationMs: number
  readonly url: string
  readonly requestBody: JsonObject
  readonly responseBody: JsonValue
  readonly usage?: JsonObject
}

export interface AiDecisionApi {
  planDeck(request: AiDeckPlanRequest): Promise<AiDeckPlanResponse>
  decide(request: AiDecisionRequest): Promise<AiDecisionResponse>
}

export type AiIpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function stringArray(value: unknown, label: string, maximum = 16): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} entries.`)
  }
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`))
}

function jsonValue(value: unknown, label: string): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`))
  }
  if (!isRecord(value)) throw new Error(`${label} must be JSON-compatible.`)
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      jsonValue(entry, `${label}.${key}`)
    ])
  )
}

function jsonObject(value: unknown, label: string): JsonObject {
  const parsed = jsonValue(value, label)
  if (!isRecord(parsed)) throw new Error(`${label} must be an object.`)
  return parsed as JsonObject
}

function policyCertainty(value: unknown, label: string): AiPolicyCertainty {
  if (value !== 'proven' && value !== 'bounded' && value !== 'unknown') {
    throw new Error(`${label} must be proven, bounded, or unknown.`)
  }
  return value
}

function policyRiskFlags(value: unknown, label: string): readonly AiPolicyRiskFlag[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error(`${label} must be an array with at most 8 entries.`)
  }
  return value.map((entry, index) => {
    const flag = requiredString(entry, `${label}[${index}]`)
    if (!(AI_POLICY_RISK_FLAGS as readonly string[]).includes(flag)) {
      throw new Error(`${label}[${index}] is not a recognized policy risk flag.`)
    }
    return flag as AiPolicyRiskFlag
  })
}

function policyNumber(
  value: Record<string, unknown>,
  key: string,
  label: string
): number {
  const result = requiredNumber(value[key], `${label}.${key}`)
  if (result < 0) throw new Error(`${label}.${key} must be non-negative.`)
  return result
}

function policyEffectSummary(value: unknown, label: string): AiPolicyEffectSummary {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return {
    manaSpent: policyNumber(value, 'manaSpent', label),
    damageDealt: policyNumber(value, 'damageDealt', label),
    damageToSelf: policyNumber(value, 'damageToSelf', label),
    damageToOpponent: policyNumber(value, 'damageToOpponent', label),
    healthRestored: policyNumber(value, 'healthRestored', label),
    armorGained: policyNumber(value, 'armorGained', label),
    cardsDrawn: policyNumber(value, 'cardsDrawn', label),
    cardsGenerated: policyNumber(value, 'cardsGenerated', label),
    cardsBurned: policyNumber(value, 'cardsBurned', label),
    fatigueDamage: policyNumber(value, 'fatigueDamage', label),
    triggeredEffects: policyNumber(value, 'triggeredEffects', label)
  }
}

function policyActionEvidence(value: unknown, label: string): AiPolicyActionEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const index = requiredNumber(value['index'], `${label}.index`)
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`${label}.index must be a non-negative integer.`)
  }
  for (const key of ['hasBeneficialEffect', 'beneficialTrigger']) {
    if (typeof value[key] !== 'boolean') {
      throw new Error(`${label}.${key} must be a boolean.`)
    }
  }
  return {
    index,
    action: requiredString(value['action'], `${label}.action`),
    manaSpent: policyNumber(value, 'manaSpent', label),
    damageDealt: policyNumber(value, 'damageDealt', label),
    healthRestored: policyNumber(value, 'healthRestored', label),
    cardsDrawn: policyNumber(value, 'cardsDrawn', label),
    cardsGenerated: policyNumber(value, 'cardsGenerated', label),
    cardsBurned: policyNumber(value, 'cardsBurned', label),
    fatigueDamage: policyNumber(value, 'fatigueDamage', label),
    riskFlags: policyRiskFlags(value['riskFlags'] ?? [], `${label}.riskFlags`),
    hasBeneficialEffect: value['hasBeneficialEffect'] as boolean,
    beneficialTrigger: value['beneficialTrigger'] as boolean
  }
}

function policyDeferredEffects(value: unknown, label: string): AiPolicyDeferredEffects {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const trigger = requiredString(value['trigger'], `${label}.trigger`)
  if (trigger !== 'next-own-turn-draw') {
    throw new Error(`${label}.trigger is not recognized.`)
  }
  return {
    trigger,
    cardsDrawn: policyNumber(value, 'cardsDrawn', label),
    cardsBurned: policyNumber(value, 'cardsBurned', label),
    fatigueDamage: policyNumber(value, 'fatigueDamage', label),
    riskFlags: policyRiskFlags(value['riskFlags'] ?? [], `${label}.riskFlags`)
  }
}

function policyEvidence(value: unknown, label: string): AiPolicyEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const actionValues = value['actions']
  if (!Array.isArray(actionValues) || actionValues.length > 12) {
    throw new Error(`${label}.actions must contain at most 12 entries.`)
  }
  for (const key of [
    'guaranteedLethal',
    'immediateLoss',
    'hasBeneficialEffect',
    'rejectable'
  ]) {
    if (typeof value[key] !== 'boolean') {
      throw new Error(`${label}.${key} must be a boolean.`)
    }
  }
  const deferredEffects =
    value['deferredEffects'] === undefined
      ? undefined
      : policyDeferredEffects(value['deferredEffects'], `${label}.deferredEffects`)
  return {
    certainty: policyCertainty(value['certainty'], `${label}.certainty`),
    riskFlags: policyRiskFlags(value['riskFlags'] ?? [], `${label}.riskFlags`),
    effectSummary: policyEffectSummary(
      value['effectSummary'],
      `${label}.effectSummary`
    ),
    actions: actionValues.map((entry, index) =>
      policyActionEvidence(entry, `${label}.actions[${index}]`)
    ),
    ...(deferredEffects ? { deferredEffects } : {}),
    guaranteedLethal: value['guaranteedLethal'] as boolean,
    immediateLoss: value['immediateLoss'] as boolean,
    hasBeneficialEffect: value['hasBeneficialEffect'] as boolean,
    rejectable: value['rejectable'] as boolean
  }
}

function parseDeckCard(value: unknown, label: string): AiDeckCard {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const count = requiredNumber(value['count'], `${label}.count`)
  const cost = requiredNumber(value['cost'], `${label}.cost`)
  if (!Number.isSafeInteger(count) || count < 1 || count > 2) {
    throw new Error(`${label}.count must be 1 or 2.`)
  }
  if (!Number.isSafeInteger(cost) || cost < 0) {
    throw new Error(`${label}.cost must be a non-negative integer.`)
  }
  return {
    cardId: requiredString(value['cardId'], `${label}.cardId`),
    count,
    name: requiredString(value['name'], `${label}.name`),
    type: requiredString(value['type'], `${label}.type`),
    cost,
    rulesText: typeof value['rulesText'] === 'string' ? value['rulesText'] : '',
    keywords: stringArray(value['keywords'] ?? [], `${label}.keywords`),
    effects: jsonValue(value['effects'] ?? [], `${label}.effects`)
  }
}

export function parseAiDeckPlan(value: unknown): AiDeckPlan {
  if (!isRecord(value)) throw new Error('AI deck plan must be an object.')
  const preserveValue = value['preserve']
  if (!Array.isArray(preserveValue) || preserveValue.length > 16) {
    throw new Error('AI deck plan preserve must have at most 16 entries.')
  }
  return {
    strategy: requiredString(value['strategy'], 'AI deck plan strategy'),
    winConditions: stringArray(value['winConditions'], 'AI deck plan winConditions', 8),
    priorities: stringArray(value['priorities'], 'AI deck plan priorities', 10),
    preserve: preserveValue.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`AI deck plan preserve[${index}] must be an object.`)
      }
      return {
        cardId: requiredString(
          entry['cardId'],
          `AI deck plan preserve[${index}].cardId`
        ),
        reason: requiredString(
          entry['reason'],
          `AI deck plan preserve[${index}].reason`
        ),
        releaseWhen: requiredString(
          entry['releaseWhen'],
          `AI deck plan preserve[${index}].releaseWhen`
        )
      }
    }),
    mulligan: stringArray(value['mulligan'], 'AI deck plan mulligan', 10)
  }
}

export function parseAiDeckPlanRequest(value: unknown): AiDeckPlanRequest {
  if (!isRecord(value) || !isRecord(value['deck'])) {
    throw new Error('AI deck-plan request must be an object with a deck.')
  }
  const cards = value['deck']['cards']
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > 30) {
    throw new Error('AI deck-plan request cards must contain 1 to 30 entries.')
  }
  return {
    requestId: requiredString(value['requestId'], 'AI deck-plan requestId'),
    ...(value['logMatchId'] === undefined
      ? {}
      : { logMatchId: requiredString(value['logMatchId'], 'AI log match ID') }),
    deadlineAtMs: requiredNumber(value['deadlineAtMs'], 'AI deck-plan deadlineAtMs'),
    deck: {
      heroId: requiredString(value['deck']['heroId'], 'AI deck-plan heroId'),
      cards: cards.map((entry, index) => parseDeckCard(entry, `AI deck card ${index}`))
    }
  }
}

export function parseAiDeckPlanResponse(value: unknown): AiDeckPlanResponse {
  if (!isRecord(value)) throw new Error('AI deck-plan response must be an object.')
  return {
    requestId: requiredString(value['requestId'], 'AI deck-plan response requestId'),
    plan: parseAiDeckPlan(value['plan']),
    rationale: requiredString(value['rationale'], 'AI deck-plan rationale'),
    modelId: requiredString(value['modelId'], 'AI deck-plan modelId'),
    ...(value['debug'] === undefined
      ? {}
      : { debug: parseProviderDebug(value['debug']) })
  }
}

function parsePolicy(value: unknown, label: string): AiPolicyOption {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  if (typeof value['completeTurn'] !== 'boolean') {
    throw new Error(`${label}.completeTurn must be a boolean.`)
  }
  if (typeof value['stopsAtNewInformation'] !== 'boolean') {
    throw new Error(`${label}.stopsAtNewInformation must be a boolean.`)
  }
  return {
    id: requiredString(value['id'], `${label}.id`),
    actions: stringArray(value['actions'], `${label}.actions`, 12),
    completeTurn: value['completeTurn'],
    stopsAtNewInformation: value['stopsAtNewInformation'],
    ...(value['result'] === undefined
      ? {}
      : { result: jsonObject(value['result'], `${label}.result`) }),
    ...(value['evidence'] === undefined
      ? {}
      : { evidence: policyEvidence(value['evidence'], `${label}.evidence`) })
  }
}

export function parseAiDecisionRequest(value: unknown): AiDecisionRequest {
  if (!isRecord(value)) throw new Error('AI decision request must be an object.')
  if (value['phase'] !== 'mulligan' && value['phase'] !== 'turn') {
    throw new Error('AI decision phase must be mulligan or turn.')
  }
  const policies = value['policies']
  if (!Array.isArray(policies) || policies.length === 0 || policies.length > 128) {
    throw new Error('AI decision policies must contain 1 to 128 entries.')
  }
  const parsedPolicies = policies.map((entry, index) =>
    parsePolicy(entry, `AI decision policy ${index}`)
  )
  if (
    new Set(parsedPolicies.map((policy) => policy.id)).size !== parsedPolicies.length
  ) {
    throw new Error('AI decision policy IDs must be unique.')
  }
  return {
    requestId: requiredString(value['requestId'], 'AI decision requestId'),
    ...(value['logMatchId'] === undefined
      ? {}
      : { logMatchId: requiredString(value['logMatchId'], 'AI log match ID') }),
    phase: value['phase'],
    deadlineAtMs: requiredNumber(value['deadlineAtMs'], 'AI decision deadlineAtMs'),
    plan: parseAiDeckPlan(value['plan']),
    state: jsonObject(value['state'], 'AI decision state'),
    policies: parsedPolicies
  }
}

export function parseAiDecisionResponse(value: unknown): AiDecisionResponse {
  if (!isRecord(value)) throw new Error('AI decision response must be an object.')
  return {
    requestId: requiredString(value['requestId'], 'AI decision response requestId'),
    policyId: requiredString(value['policyId'], 'AI decision policyId'),
    rationale: requiredString(value['rationale'], 'AI decision rationale'),
    modelId: requiredString(value['modelId'], 'AI decision modelId'),
    ...(value['debug'] === undefined
      ? {}
      : { debug: parseProviderDebug(value['debug']) })
  }
}

function parseProviderDebug(value: unknown): AiProviderDebug {
  if (!isRecord(value)) throw new Error('AI provider debug must be an object.')
  return {
    durationMs: requiredNumber(value['durationMs'], 'AI provider debug durationMs'),
    url: requiredString(value['url'], 'AI provider debug url'),
    requestBody: jsonObject(value['requestBody'], 'AI provider debug requestBody'),
    responseBody: jsonValue(value['responseBody'], 'AI provider debug responseBody'),
    ...(value['usage'] === undefined
      ? {}
      : { usage: jsonObject(value['usage'], 'AI provider debug usage') })
  }
}

export function aiIpcSuccess<T>(value: T): AiIpcResult<T> {
  return { ok: true, value }
}

export function aiIpcFailure(error: unknown): AiIpcResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

export function unwrapAiIpcResult<T>(
  value: unknown,
  parse: (candidate: unknown) => T
): T {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new Error('AI IPC returned an invalid envelope.')
  }
  if (!value['ok']) {
    throw new Error(requiredString(value['error'], 'AI IPC error'))
  }
  return parse(value['value'])
}
