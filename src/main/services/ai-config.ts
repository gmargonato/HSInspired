import { readFile } from 'node:fs/promises'

export type AiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

export interface AzureOpenAiConfig {
  readonly enabled: boolean
  readonly provider: 'azure-openai'
  readonly modelId: 'gpt-5.4-nano'
  readonly deploymentName: string
  readonly endpoint: string
  readonly apiVersion: string
  readonly planTimeoutMs: number
  readonly decisionTimeoutMs: number
  readonly reasoningEffort: AiReasoningEffort
  readonly planMaxCompletionTokens: number
  readonly decisionMaxCompletionTokens: number
  readonly prompts: Readonly<{
    readonly system: string
    readonly deckPlan: string
    readonly decision: string
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

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AI configuration ${key} must be a non-empty string.`)
  }
  return value.trim()
}

function boundedInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number {
  const value = record[key]
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(
      `AI configuration ${key} must be between ${minimum} and ${maximum}.`
    )
  }
  return value as number
}

function reasoningEffort(value: unknown): AiReasoningEffort {
  if (!['none', 'low', 'medium', 'high', 'xhigh'].includes(String(value))) {
    throw new Error('AI configuration reasoningEffort is invalid.')
  }
  return value as AiReasoningEffort
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
  if (!deploymentName.toLowerCase().includes('gpt-5.4-nano')) {
    throw new Error('AI deploymentName must identify GPT-5.4-nano.')
  }
  if (typeof value['enabled'] !== 'boolean' || typeof value['debug'] !== 'boolean') {
    throw new Error('AI configuration enabled and debug must be booleans.')
  }
  const prompts = value['prompts']
  if (!isRecord(prompts)) throw new Error('AI configuration prompts must be an object.')
  const endpoint = new URL(requiredString(value, 'endpoint'))
  if (endpoint.protocol !== 'https:') {
    throw new Error('AI configuration endpoint must use HTTPS.')
  }
  return {
    enabled: value['enabled'],
    provider: 'azure-openai',
    modelId: 'gpt-5.4-nano',
    deploymentName,
    endpoint: endpoint.toString(),
    apiVersion: requiredString(value, 'apiVersion'),
    planTimeoutMs: boundedInteger(value, 'planTimeoutMs', 1_000, 120_000),
    decisionTimeoutMs: boundedInteger(value, 'decisionTimeoutMs', 1_000, 120_000),
    reasoningEffort: reasoningEffort(value['reasoningEffort']),
    planMaxCompletionTokens: boundedInteger(
      value,
      'planMaxCompletionTokens',
      256,
      16_384
    ),
    decisionMaxCompletionTokens: boundedInteger(
      value,
      'decisionMaxCompletionTokens',
      256,
      16_384
    ),
    prompts: {
      system: requiredString(prompts, 'system'),
      deckPlan: requiredString(prompts, 'deckPlan'),
      decision: requiredString(prompts, 'decision')
    },
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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
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
    throw new Error(`Unable to read AI configuration: ${String(error)}`, {
      cause: error
    })
  }
  return parseAzureOpenAiConfig(parsed, await readFirstKey(paths.keyPaths))
}
