import { readFile } from 'node:fs/promises'

export type AiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

export interface AiPrompts {
  readonly system: string
  readonly deckPlan: string
  readonly mulligan: string
  readonly turn: string
  readonly competitiveSystem?: string
  readonly matchupPlan?: string
  readonly competitiveMulligan?: string
  readonly competitiveTurn?: string
  readonly critic?: string
}

export interface AiDecisionPolicy {
  readonly requestTimeoutMs: number
  readonly reasoningEffort: AiReasoningEffort
  readonly maxCompletionTokens: number
}

export interface AzureOpenAiConfig {
  readonly enabled: boolean
  readonly provider: 'azure-openai'
  readonly modelId: string
  readonly deploymentName: string
  readonly endpoint: string
  readonly apiVersion: string
  readonly requestTimeoutMs: number
  readonly reasoningEffort: AiReasoningEffort
  readonly maxCompletionTokens: number
  readonly prompts: AiPrompts
  readonly decisionPolicies: Readonly<{
    readonly deckPlan: AiDecisionPolicy
    readonly matchupPlan: AiDecisionPolicy
    readonly mulligan: AiDecisionPolicy
    readonly discover: AiDecisionPolicy
    readonly turn: AiDecisionPolicy
    readonly rank: AiDecisionPolicy
    readonly critic: AiDecisionPolicy
  }>
  readonly debug: boolean
  readonly apiKey: string
}

interface AiConfigPaths {
  readonly configPath: string
  readonly keyPaths: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AI configuration ${key} must be a non-empty string.`)
  }
  return value.trim()
}

function parseReasoningEffort(value: unknown): AiReasoningEffort {
  if (
    value !== 'none' &&
    value !== 'low' &&
    value !== 'medium' &&
    value !== 'high' &&
    value !== 'xhigh'
  ) {
    throw new Error(
      'AI configuration reasoningEffort must be none, low, medium, high, or xhigh.'
    )
  }
  return value
}

function parsePrompts(value: unknown): AiPrompts {
  if (!isRecord(value)) {
    throw new Error('AI configuration prompts must be an object.')
  }
  const optionalPrompt = (key: string): string | undefined => {
    if (value[key] === undefined) return undefined
    return requiredString(value, key)
  }
  const competitiveSystem = optionalPrompt('competitiveSystem')
  const matchupPlan = optionalPrompt('matchupPlan')
  const competitiveMulligan = optionalPrompt('competitiveMulligan')
  const competitiveTurn = optionalPrompt('competitiveTurn')
  const critic = optionalPrompt('critic')
  return {
    system: requiredString(value, 'system'),
    deckPlan: requiredString(value, 'deckPlan'),
    mulligan: requiredString(value, 'mulligan'),
    turn: requiredString(value, 'turn'),
    ...(competitiveSystem ? { competitiveSystem } : {}),
    ...(matchupPlan ? { matchupPlan } : {}),
    ...(competitiveMulligan ? { competitiveMulligan } : {}),
    ...(competitiveTurn ? { competitiveTurn } : {}),
    ...(critic ? { critic } : {})
  }
}

function parseDecisionPolicy(
  value: unknown,
  fallback: AiDecisionPolicy,
  label: string
): AiDecisionPolicy {
  if (value === undefined) return fallback
  if (!isRecord(value)) throw new Error(`AI configuration ${label} must be an object.`)
  const requestTimeoutMs = value['requestTimeoutMs']
  const maxCompletionTokens = value['maxCompletionTokens']
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    (requestTimeoutMs as number) < 1000 ||
    (requestTimeoutMs as number) > 120000
  ) {
    throw new Error(
      `AI configuration ${label}.requestTimeoutMs must be between 1000 and 120000.`
    )
  }
  if (
    !Number.isSafeInteger(maxCompletionTokens) ||
    (maxCompletionTokens as number) < 256 ||
    (maxCompletionTokens as number) > 16384
  ) {
    throw new Error(
      `AI configuration ${label}.maxCompletionTokens must be between 256 and 16384.`
    )
  }
  return {
    requestTimeoutMs: requestTimeoutMs as number,
    reasoningEffort: parseReasoningEffort(value['reasoningEffort']),
    maxCompletionTokens: maxCompletionTokens as number
  }
}

function parseDecisionPolicies(
  value: unknown,
  fallback: AiDecisionPolicy
): AzureOpenAiConfig['decisionPolicies'] {
  if (value !== undefined && !isRecord(value)) {
    throw new Error('AI configuration decisionPolicies must be an object.')
  }
  return {
    deckPlan: parseDecisionPolicy(
      value?.['deckPlan'],
      fallback,
      'decisionPolicies.deckPlan'
    ),
    matchupPlan: parseDecisionPolicy(
      value?.['matchupPlan'],
      fallback,
      'decisionPolicies.matchupPlan'
    ),
    mulligan: parseDecisionPolicy(
      value?.['mulligan'],
      fallback,
      'decisionPolicies.mulligan'
    ),
    discover: parseDecisionPolicy(
      value?.['discover'],
      fallback,
      'decisionPolicies.discover'
    ),
    turn: parseDecisionPolicy(value?.['turn'], fallback, 'decisionPolicies.turn'),
    rank: parseDecisionPolicy(value?.['rank'], fallback, 'decisionPolicies.rank'),
    critic: parseDecisionPolicy(value?.['critic'], fallback, 'decisionPolicies.critic')
  }
}

export function parseAzureOpenAiConfig(
  value: unknown,
  apiKey: string
): AzureOpenAiConfig {
  if (!isRecord(value)) throw new Error('AI configuration must be a JSON object.')
  if (value['provider'] !== 'azure-openai') {
    throw new Error('AI configuration provider must be azure-openai.')
  }
  if (requiredString(value, 'modelId').toLowerCase() !== 'gpt-5.4-nano') {
    throw new Error('AI configuration modelId must be GPT-5.4-nano.')
  }
  const deploymentName = requiredString(value, 'deploymentName')
  if (
    deploymentName.toLowerCase().includes('gpt-') &&
    !deploymentName.toLowerCase().includes('gpt-5.4-nano')
  ) {
    throw new Error(
      'AI configuration deploymentName identifies a model other than GPT-5.4-nano.'
    )
  }
  if (typeof value['enabled'] !== 'boolean') {
    throw new Error('AI configuration enabled must be a boolean.')
  }
  if (typeof value['debug'] !== 'boolean') {
    throw new Error('AI configuration debug must be a boolean.')
  }
  const requestTimeoutMs = value['requestTimeoutMs']
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    (requestTimeoutMs as number) < 1000 ||
    (requestTimeoutMs as number) > 120000
  ) {
    throw new Error(
      'AI configuration requestTimeoutMs must be between 1000 and 120000.'
    )
  }
  const maxCompletionTokens = value['maxCompletionTokens']
  if (
    !Number.isSafeInteger(maxCompletionTokens) ||
    (maxCompletionTokens as number) < 256 ||
    (maxCompletionTokens as number) > 16384
  ) {
    throw new Error(
      'AI configuration maxCompletionTokens must be between 256 and 16384.'
    )
  }
  const endpoint = requiredString(value, 'endpoint')
  let endpointUrl: URL
  try {
    endpointUrl = new URL(endpoint)
  } catch {
    throw new Error('AI configuration endpoint must be a valid URL.')
  }
  if (endpointUrl.protocol !== 'https:') {
    throw new Error('AI configuration endpoint must use HTTPS.')
  }
  const policyFallback = {
    requestTimeoutMs: requestTimeoutMs as number,
    reasoningEffort: parseReasoningEffort(value['reasoningEffort']),
    maxCompletionTokens: maxCompletionTokens as number
  }
  return {
    enabled: value['enabled'],
    provider: 'azure-openai',
    modelId: 'gpt-5.4-nano',
    deploymentName,
    endpoint: endpointUrl.toString(),
    apiVersion: requiredString(value, 'apiVersion'),
    requestTimeoutMs: requestTimeoutMs as number,
    reasoningEffort: policyFallback.reasoningEffort,
    maxCompletionTokens: maxCompletionTokens as number,
    prompts: parsePrompts(value['prompts']),
    decisionPolicies: parseDecisionPolicies(value['decisionPolicies'], policyFallback),
    debug: value['debug'],
    apiKey: apiKey.trim()
  }
}

async function readFirstKey(paths: readonly string[]): Promise<string> {
  const environmentKey = process.env['HSINSPIRED_AI_API_KEY']?.trim()
  if (environmentKey) return environmentKey
  for (const path of paths) {
    try {
      const key = (await readFile(path, 'utf8')).trim()
      if (key) return key
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
  return ''
}

export async function loadAzureOpenAiConfig(
  paths: AiConfigPaths
): Promise<AzureOpenAiConfig> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(paths.configPath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read AI configuration: ${message}`, { cause: error })
  }
  return parseAzureOpenAiConfig(parsed, await readFirstKey(paths.keyPaths))
}
