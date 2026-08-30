import { readFile } from 'node:fs/promises'

export type AiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

export interface AiPrompts {
  readonly system: string
  readonly mulligan: string
  readonly turn: string
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
  return {
    system: requiredString(value, 'system'),
    mulligan: requiredString(value, 'mulligan'),
    turn: requiredString(value, 'turn')
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
  return {
    enabled: value['enabled'],
    provider: 'azure-openai',
    modelId: requiredString(value, 'modelId'),
    deploymentName: requiredString(value, 'deploymentName'),
    endpoint: endpointUrl.toString(),
    apiVersion: requiredString(value, 'apiVersion'),
    requestTimeoutMs: requestTimeoutMs as number,
    reasoningEffort: parseReasoningEffort(value['reasoningEffort']),
    maxCompletionTokens: maxCompletionTokens as number,
    prompts: parsePrompts(value['prompts']),
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
