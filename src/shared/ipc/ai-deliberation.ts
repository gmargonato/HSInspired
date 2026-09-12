/** Conversation contracts contain no game implementation or provider-specific state. */
export const AI_DELIBERATION_LIMITS = {
  checksPerBatch: 3,
  extraExchangesPerTurn: 2,
  candidates: 2,
  steps: 6,
  textCharacters: 600,
  responseCharacters: 8000
} as const

export const AI_FACT_TOPICS = [
  'entity',
  'mechanics',
  'condition',
  'action',
  'resources',
  'history'
] as const
export interface AiFactCheck {
  readonly topic: (typeof AI_FACT_TOPICS)[number]
  readonly ref: string
  readonly question: string
  readonly decisionImpact: string
}
export interface AiPlanNote {
  readonly objective: string
  readonly continuation: string
  readonly reconsiderIf: string
}
export interface AiTurnPlan {
  readonly objective: string
  readonly winCheck: string
  readonly lossRisk: string
  readonly candidates: readonly {
    readonly sequence: readonly string[]
    readonly budget: string
    readonly endPosition: string
    readonly opponentReply: string
  }[]
  readonly preferred: number
  readonly firstActionId: string
  readonly checks: readonly AiFactCheck[]
}
export interface AiActionIntent {
  readonly type: string
  readonly source: string | null
  readonly targets: readonly string[]
  readonly position: number | null
  readonly option: number | null
}
export type AiDecisionChoice =
  | { readonly plan: AiTurnPlan }
  | { readonly inspect: readonly AiFactCheck[] }
  | {
      readonly actionId: string
      readonly intent: AiActionIntent
      readonly expectedResult: string
      readonly planUpdate: AiPlanNote | null
    }

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('Expected exactly these fields: ' + keys.join(', '))
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > AI_DELIBERATION_LIMITS.textCharacters
  )
    throw new Error('AI text must contain 1–600 characters.')
  return value
}
function array<T>(
  value: unknown,
  min: number,
  max: number,
  parse: (v: unknown) => T
): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`Expected an array with ${min}–${max} items.`)
  return value.map(parse)
}
function ordinal(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100)
    throw new Error('Expected a nonnegative integer no larger than 100.')
  return Number(value)
}
function checks(value: unknown, min: number): AiFactCheck[] {
  return array(value, min, AI_DELIBERATION_LIMITS.checksPerBatch, (v) => {
    const d = record(v, ['topic', 'ref', 'question', 'decisionImpact'])
    if (!AI_FACT_TOPICS.includes(d.topic as AiFactCheck['topic']))
      throw new Error('Unsupported fact topic.')
    return {
      topic: d.topic as AiFactCheck['topic'],
      ref: text(d.ref),
      question: text(d.question),
      decisionImpact: text(d.decisionImpact)
    }
  })
}
function note(value: unknown): AiPlanNote {
  const d = record(value, ['objective', 'continuation', 'reconsiderIf'])
  return {
    objective: text(d.objective),
    continuation: text(d.continuation),
    reconsiderIf: text(d.reconsiderIf)
  }
}
export function parseAiIntent(value: unknown): AiActionIntent {
  const d = record(value, ['type', 'source', 'targets', 'position', 'option'])
  return {
    type: text(d.type),
    source: d.source === null ? null : text(d.source),
    targets: array(d.targets, 0, 10, text),
    position: d.position === null ? null : ordinal(d.position),
    option: d.option === null ? null : ordinal(d.option)
  }
}
export function sameAiIntent(a: AiActionIntent, b: AiActionIntent): boolean {
  return (
    a.type === b.type &&
    a.source === b.source &&
    a.position === b.position &&
    a.option === b.option &&
    a.targets.length === b.targets.length &&
    a.targets.every((target, index) => target === b.targets[index])
  )
}
export function parseAiDecisionChoice(value: unknown): AiDecisionChoice {
  if (JSON.stringify(value)?.length > AI_DELIBERATION_LIMITS.responseCharacters)
    throw new Error('AI choice exceeds 8000 characters.')
  if (value && typeof value === 'object' && 'plan' in value) {
    const { plan } = record(value, ['plan'])
    const d = record(plan, [
      'objective',
      'winCheck',
      'lossRisk',
      'candidates',
      'preferred',
      'firstActionId',
      'checks'
    ])
    const candidates = array(
      d.candidates,
      1,
      AI_DELIBERATION_LIMITS.candidates,
      (v) => {
        const c = record(v, ['sequence', 'budget', 'endPosition', 'opponentReply'])
        return {
          sequence: array(c.sequence, 1, AI_DELIBERATION_LIMITS.steps, text),
          budget: text(c.budget),
          endPosition: text(c.endPosition),
          opponentReply: text(c.opponentReply)
        }
      }
    )
    const preferred = ordinal(d.preferred)
    if (preferred >= candidates.length)
      throw new Error('Preferred candidate index is out of range.')
    return {
      plan: {
        objective: text(d.objective),
        winCheck: text(d.winCheck),
        lossRisk: text(d.lossRisk),
        candidates,
        preferred,
        firstActionId: text(d.firstActionId),
        checks: checks(d.checks, 0)
      }
    }
  }
  if (value && typeof value === 'object' && 'inspect' in value)
    return { inspect: checks(record(value, ['inspect']).inspect, 1) }
  const d = record(value, ['actionId', 'intent', 'expectedResult', 'planUpdate'])
  return {
    actionId: text(d.actionId),
    intent: parseAiIntent(d.intent),
    expectedResult: text(d.expectedResult),
    planUpdate: d.planUpdate === null ? null : note(d.planUpdate)
  }
}

/** Only schema/phase checks: legal strategy and hypothetical outcomes are not certified. */
export function validateAiChoicePhase(
  choice: AiDecisionChoice,
  request: {
    readonly phase?: 'plan' | 'action'
    readonly allowInspection?: boolean
    readonly actionIds: readonly string[]
  }
): void {
  if (request.phase === 'plan') {
    if (!('plan' in choice))
      throw new Error('Planning requires choice.plan, not an executable action.')
    if (!request.actionIds.includes(choice.plan.firstActionId))
      throw new Error('Unknown proposed first action ID.')
  } else if ('plan' in choice) throw new Error('Action selection cannot return a plan.')
  else if ('inspect' in choice) {
    if (!request.allowInspection)
      throw new Error('Inspection is unavailable. Commit one current action.')
  } else if (!request.actionIds.includes(choice.actionId))
    throw new Error('Unknown action ID.')
}

// Use the common structured-output subset; size limits are enforced locally.
type Schema = Record<string, unknown>
const string: Schema = { type: 'string' }
const nullableString: Schema = { type: ['string', 'null'] }
const nullableInteger: Schema = { type: ['integer', 'null'] }
const list = (items: Schema): Schema => ({ type: 'array', items })
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false
})
const checkSchema = object({
  topic: { type: 'string', enum: [...AI_FACT_TOPICS] },
  ref: string,
  question: string,
  decisionImpact: string
})
const noteSchema = object({
  objective: string,
  continuation: string,
  reconsiderIf: string
})
export function aiChoiceSchema(request: {
  readonly phase?: 'plan' | 'action'
  readonly allowInspection?: boolean
  readonly actionIds: readonly string[]
}): Schema {
  const actionId = { type: 'string', enum: [...request.actionIds] }
  if (request.phase === 'plan')
    return object({
      plan: object({
        objective: string,
        winCheck: string,
        lossRisk: string,
        candidates: list(
          object({
            sequence: list(string),
            budget: string,
            endPosition: string,
            opponentReply: string
          })
        ),
        preferred: { type: 'integer' },
        firstActionId: actionId,
        checks: list(checkSchema)
      })
    })
  const commit = object({
    actionId,
    intent: object({
      type: string,
      source: nullableString,
      targets: list(string),
      position: nullableInteger,
      option: nullableInteger
    }),
    expectedResult: string,
    planUpdate: { anyOf: [noteSchema, { type: 'null' }] }
  })
  return request.allowInspection
    ? { anyOf: [commit, object({ inspect: list(checkSchema) })] }
    : commit
}
