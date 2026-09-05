export const OUTLINE_TUNING_IPC_CHANNELS = {
  save: 'debug:outline-tuning:save'
} as const

export const OUTLINE_PRESET_NAMES = [
  'card',
  'bonus-card',
  'board',
  'button',
  'ghost'
] as const

export type OutlinePresetName = (typeof OUTLINE_PRESET_NAMES)[number]

export interface OutlineTuning {
  readonly ribbonWidth: number
  readonly edgeSoftness: number
  readonly rimWidth: number
  readonly glowWidth: number
  readonly glowStrength: number
  readonly highlightStrength: number
  readonly hotspotScale: number
  readonly hotspotDensity: number
  readonly edgeWobble: number
  readonly motionSpeed: number
}

export interface OutlineTuningConfig {
  readonly version: 1
  readonly presets: Readonly<Record<OutlinePresetName, OutlineTuning>>
}

export interface OutlineTuningApi {
  save(config: OutlineTuningConfig): Promise<void>
}

const TUNING_RANGES = {
  ribbonWidth: [0, 20],
  edgeSoftness: [0, 10],
  rimWidth: [0, 15],
  glowWidth: [0, 30],
  glowStrength: [0, 4],
  highlightStrength: [0, 5],
  hotspotScale: [1, 120],
  hotspotDensity: [0, 4],
  edgeWobble: [0, 16],
  motionSpeed: [0, 3]
} as const satisfies Record<keyof OutlineTuning, readonly [number, number]>

const TUNING_KEYS = Object.keys(TUNING_RANGES) as (keyof OutlineTuning)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function parseTuning(value: unknown, preset: OutlinePresetName): OutlineTuning {
  if (!isRecord(value) || !hasExactKeys(value, TUNING_KEYS)) {
    throw new Error(`Invalid outline tuning for ${preset}`)
  }

  const parsed = Object.fromEntries(
    TUNING_KEYS.map((key) => {
      const candidate = value[key]
      const [min, max] = TUNING_RANGES[key]
      if (
        typeof candidate !== 'number' ||
        !Number.isFinite(candidate) ||
        candidate < min ||
        candidate > max
      ) {
        throw new Error(`Invalid outline tuning value for ${preset}.${key}`)
      }
      return [key, candidate]
    })
  )
  return parsed as unknown as OutlineTuning
}

export function parseOutlineTuningConfig(value: unknown): OutlineTuningConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['version', 'presets']) ||
    value.version !== 1 ||
    !isRecord(value.presets) ||
    !hasExactKeys(value.presets, OUTLINE_PRESET_NAMES)
  ) {
    throw new Error('Invalid outline tuning configuration')
  }

  const presetValues = value.presets
  const presets = Object.fromEntries(
    OUTLINE_PRESET_NAMES.map((preset) => [
      preset,
      parseTuning(presetValues[preset], preset)
    ])
  ) as unknown as OutlineTuningConfig['presets']

  return { version: 1, presets }
}
