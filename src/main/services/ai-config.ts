import { readFile } from 'node:fs/promises'
import {
  AI_REQUEST_LIMITS,
  isAiReasoningEffort,
  type AiReasoningEffort
} from '../../shared/ipc/ai'

interface AiProviderConfigBase {
  readonly enabled: boolean
  readonly modelId: string
  readonly reasoningEffort: AiReasoningEffort
  readonly maxCompletionTokens: number
  readonly apiKey: string
  readonly requestTimeoutMs?: number
  readonly maxContextBytes?: number
}

export interface AzureOpenAiConfig extends AiProviderConfigBase {
  readonly provider: 'azure-openai'
  readonly deploymentName: string
  readonly endpoint: string
  readonly apiVersion: string
}

export interface OpenRouterConfig extends AiProviderConfigBase {
  readonly provider: 'openrouter'
}

export type AiProviderConfig = AzureOpenAiConfig | OpenRouterConfig

interface AiConfigPaths {
  readonly configPath: string
  readonly azureKeyPaths: readonly string[]
  readonly openRouterKeyPaths: readonly string[]
}

export interface AiConfigCredentials {
  readonly azureOpenAi: string
  readonly openRouter: string
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

function parseProvider(
  value: unknown,
  credentials: AiConfigCredentials,
  index: number
): AiProviderConfig {
  if (!isRecord(value)) {
    throw new Error(`AI configuration providers[${index}] must be an object.`)
  }
  if (typeof value['enabled'] !== 'boolean') {
    throw new Error(`AI configuration providers[${index}].enabled must be a boolean.`)
  }
  if (!isAiReasoningEffort(value['reasoningEffort'])) {
    throw new Error(
      `AI configuration providers[${index}].reasoningEffort must be none, low, medium, high, or xhigh.`
    )
  }
  const common = {
    enabled: value['enabled'],
    modelId: requiredString(value, 'modelId'),
    reasoningEffort: value['reasoningEffort'],
    maxCompletionTokens: boundedInteger(value, 'maxCompletionTokens', 1, 128_000),
    requestTimeoutMs:
      value.requestTimeoutMs === undefined
        ? AI_REQUEST_LIMITS.timeoutMs
        : boundedInteger(value, 'requestTimeoutMs', 1000, 600_000),
    maxContextBytes:
      value.maxContextBytes === undefined
        ? AI_REQUEST_LIMITS.maxContextBytes
        : boundedInteger(value, 'maxContextBytes', 1000, 200_000)
  }
  if (value['provider'] === 'azure-openai') {
    const endpoint = new URL(requiredString(value, 'endpoint'))
    if (endpoint.protocol !== 'https:') {
      throw new Error('AI configuration endpoint must use HTTPS.')
    }
    return {
      ...common,
      provider: 'azure-openai',
      deploymentName: requiredString(value, 'deploymentName'),
      endpoint: endpoint.toString(),
      apiVersion: requiredString(value, 'apiVersion'),
      apiKey: credentials.azureOpenAi.trim()
    }
  }
  if (value['provider'] === 'openrouter') {
    return {
      ...common,
      provider: 'openrouter',
      apiKey: credentials.openRouter.trim()
    }
  }
  throw new Error(
    `AI configuration providers[${index}].provider must be azure-openai or openrouter.`
  )
}

/** Validates every profile and returns the first enabled one. */
export function parseAiConfig(
  value: unknown,
  credentials: AiConfigCredentials
): AiProviderConfig | null {
  if (!isRecord(value) || !Array.isArray(value['providers'])) {
    throw new Error('AI configuration must contain a providers array.')
  }
  const providers = value['providers'].map((provider, index) =>
    parseProvider(provider, credentials, index)
  )
  return providers.find((provider) => provider.enabled) ?? null
}

async function readFirstKey(
  paths: readonly string[],
  providerEnvironmentName: string
): Promise<string> {
  const providerKey = process.env[providerEnvironmentName]?.trim()
  if (providerKey) return providerKey
  for (const path of paths) {
    try {
      const key = (await readFile(path, 'utf8')).trim()
      if (key) return key
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return process.env['HSINSPIRED_AI_API_KEY']?.trim() ?? ''
}

export async function loadAiConfig(
  paths: AiConfigPaths
): Promise<AiProviderConfig | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(paths.configPath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read AI configuration: ${String(error)}`, {
      cause: error
    })
  }
  const selected = parseAiConfig(parsed, { azureOpenAi: '', openRouter: '' })
  if (!selected) return null
  const apiKey =
    selected.provider === 'azure-openai'
      ? await readFirstKey(paths.azureKeyPaths, 'HSINSPIRED_AZURE_OPENAI_API_KEY')
      : await readFirstKey(paths.openRouterKeyPaths, 'HSINSPIRED_OPENROUTER_API_KEY')
  return { ...selected, apiKey }
}
