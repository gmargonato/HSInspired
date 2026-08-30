import { describe, expect, it } from 'vitest'
import { parseAzureOpenAiConfig } from './ai-config'

const validConfig = {
  enabled: true,
  provider: 'azure-openai',
  modelId: 'gpt-5.4-nano',
  deploymentName: 'game-ai',
  endpoint: 'https://example.openai.azure.com/',
  apiVersion: '2024-12-01-preview',
  requestTimeoutMs: 8000,
  reasoningEffort: 'low',
  maxCompletionTokens: 2048,
  prompts: {
    system: 'System instructions.',
    mulligan: 'Mulligan instructions.',
    turn: 'Turn instructions.'
  },
  debug: true
}

describe('AI configuration', () => {
  it('parses editable prompts and reasoning controls', () => {
    const config = parseAzureOpenAiConfig(validConfig, 'secret-key')

    expect(config.reasoningEffort).toBe('low')
    expect(config.maxCompletionTokens).toBe(2048)
    expect(config.prompts).toEqual(validConfig.prompts)
    expect(config.apiKey).toBe('secret-key')
  })

  it('rejects a blank configured prompt', () => {
    expect(() =>
      parseAzureOpenAiConfig(
        {
          ...validConfig,
          prompts: { ...validConfig.prompts, turn: '   ' }
        },
        ''
      )
    ).toThrow('turn must be a non-empty string')
  })

  it('rejects unsupported reasoning effort', () => {
    expect(() =>
      parseAzureOpenAiConfig({ ...validConfig, reasoningEffort: 'maximum-ish' }, '')
    ).toThrow('reasoningEffort')
  })
})
