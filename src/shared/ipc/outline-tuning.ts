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

export const OUTLINE_PALETTE_NAMES = [
  'blue',
  'green',
  'orange',
  'purple',
  'red',
  'white'
] as const

export type OutlinePresetName = (typeof OUTLINE_PRESET_NAMES)[number]
export type OutlinePaletteName = (typeof OUTLINE_PALETTE_NAMES)[number]

export interface OutlinePalette {
  readonly baseColor: number
  readonly outerColor: number
  readonly glowColor: number
  readonly highlightColor: number
}

export interface OutlineTuning {
  readonly ribbonWidth: number
  readonly edgeSoftness: number
  /** Color intensity without changing outline coverage; 1 is unchanged. */
  readonly saturation: number
  readonly rimWidth: number
  readonly glowWidth: number
  readonly glowStrength: number
  readonly highlightStrength: number
  readonly hotspotScale: number
  readonly hotspotDensity: number
  readonly edgeWobble: number
  readonly motionSpeed: number
  readonly innerEdgeWidth: number
  readonly pulseRate: number
  /** Organic thick/thin asymmetry along the contour, 0 (uniform) to 10. */
  readonly contourVariation: number
}

export interface OutlineTuningConfig {
  readonly version: 3
  readonly presets: Readonly<Record<OutlinePresetName, OutlineTuning>>
  readonly palettes: Readonly<Record<OutlinePaletteName, OutlinePalette>>
}

export interface OutlineTuningApi {
  save(config: OutlineTuningConfig): Promise<void>
}

const TUNING_RANGES = {
  ribbonWidth: [0, 20],
  edgeSoftness: [0, 10],
  saturation: [0, 2],
  rimWidth: [0, 15],
  glowWidth: [0, 30],
  glowStrength: [0, 4],
  highlightStrength: [0, 5],
  hotspotScale: [1, 120],
  hotspotDensity: [0, 4],
  edgeWobble: [0, 16],
  motionSpeed: [0, 3],
  innerEdgeWidth: [0, 8],
  pulseRate: [0, 3],
  contourVariation: [0, 10]
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

const PALETTE_COLOR_KEYS = [
  'baseColor',
  'outerColor',
  'glowColor',
  'highlightColor'
] as const satisfies readonly (keyof OutlinePalette)[]

function parsePalette(value: unknown, name: OutlinePaletteName): OutlinePalette {
  if (!isRecord(value) || !hasExactKeys(value, PALETTE_COLOR_KEYS)) {
    throw new Error(`Invalid outline palette for ${name}`)
  }
  const entries = PALETTE_COLOR_KEYS.map((key) => {
    const color = value[key]
    if (
      typeof color !== 'number' ||
      !Number.isInteger(color) ||
      color < 0 ||
      color > 0xffffff
    ) {
      throw new Error(`Invalid outline color for ${name}.${key}`)
    }
    return [key, color]
  })
  return Object.fromEntries(entries) as unknown as OutlinePalette
}

export function parseOutlineTuningConfig(value: unknown): OutlineTuningConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['version', 'presets', 'palettes']) ||
    value.version !== 3 ||
    !isRecord(value.presets) ||
    !hasExactKeys(value.presets, OUTLINE_PRESET_NAMES) ||
    !isRecord(value.palettes) ||
    !hasExactKeys(value.palettes, OUTLINE_PALETTE_NAMES)
  ) {
    throw new Error('Invalid outline tuning configuration')
  }

  const presetValues = value.presets
  const paletteValues = value.palettes
  const presets = Object.fromEntries(
    OUTLINE_PRESET_NAMES.map((preset) => [
      preset,
      parseTuning(presetValues[preset], preset)
    ])
  ) as unknown as OutlineTuningConfig['presets']

  const palettes = Object.fromEntries(
    OUTLINE_PALETTE_NAMES.map((name) => [name, parsePalette(paletteValues[name], name)])
  ) as unknown as OutlineTuningConfig['palettes']
  return { version: 3, presets, palettes }
}
