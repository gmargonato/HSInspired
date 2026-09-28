/** Shader Lab's process-safe tuning contract. V5 controls retain their source units. */
export const OUTLINE_TUNING_IPC_CHANNELS = {
  save: 'debug:outline-tuning:save'
} as const
export const OUTLINE_PRESET_NAMES = ['card', 'bonus-card', 'board', 'button'] as const
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
export interface AuraTuning {
  readonly smoothOutline: boolean
  readonly speed: number
  readonly shimmer: number
  readonly wobble: number
  readonly baseWidth: number
  readonly baseEdgeSoftness: number
  readonly baseOpacity: number
  readonly coreWidth: number
  readonly coreIntensity: number
  readonly glowWidth: number
  readonly glowSoftness: number
  readonly glowIntensity: number
  readonly additive: number
  readonly hotCount: number
  readonly blobLength: number
  readonly blobThickness: number
  readonly blobOffset: number
  readonly hotTravel: number
  readonly hotLife: number
  readonly hotBulge: number
  readonly haloLength: number
  readonly hotIntensity: number
  readonly hotThreshold: number
  readonly coreBrightness: number
  readonly coreThreshold: number
  readonly taperAmount: number
  readonly taperStart: number
  readonly bottomFade: number
  readonly bottomFadeStart: number
}
export interface AuraPalette {
  readonly baseColor: number
  readonly coreColor: number
  readonly glowColor: number
  readonly hotColor: number
  readonly blobCoreColor: number
}
export type OutlineTuning = AuraTuning
export type OutlinePalette = AuraPalette
/** Numeric storage; the editor displays compass labels. Screen Y points down. */
export const GHOST_WIND_DIRECTIONS = [
  { value: 0, label: 'All directions', x: 0, y: 0 },
  { value: 1, label: 'N', x: 0, y: -1 },
  { value: 2, label: 'NE', x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { value: 3, label: 'E', x: 1, y: 0 },
  { value: 4, label: 'SE', x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { value: 5, label: 'S', x: 0, y: 1 },
  { value: 6, label: 'SW', x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { value: 7, label: 'W', x: -1, y: 0 },
  { value: 8, label: 'NW', x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
] as const
export interface GhostAuraTuning {
  readonly windDirection: number
  readonly mistEnabled: boolean
  readonly mistIntensity: number
  readonly mistWidth: number
  readonly mistSoftness: number
  readonly mistTextureScale: number
  readonly mistAnimationSpeed: number
  readonly particlesEnabled: boolean
  readonly particleIntensity: number
  readonly particleWindStrength: number
  readonly particleCount: number
  /** Average screen-pixel diameter, with built-in +/-60% variation. */
  readonly particleSize: number
  readonly particleTravelDistance: number
}
export interface GhostAuraPalette {
  readonly mistPrimaryColor: number
  readonly mistHighlightColor: number
  readonly particleColor: number
}
export const GHOST_MIST_DEFAULTS = {
  tuning: {
    windDirection: 2,
    mistEnabled: true,
    mistIntensity: 0.8,
    mistWidth: 15,
    mistSoftness: 1.5,
    mistTextureScale: 1.5,
    mistAnimationSpeed: 1,
    particlesEnabled: true,
    particleIntensity: 0.8,
    particleWindStrength: 2,
    particleCount: 120,
    particleSize: 15,
    particleTravelDistance: 60
  },
  palette: {
    mistPrimaryColor: 994493,
    mistHighlightColor: 37375,
    particleColor: 37375
  }
} as const
export const AURA_CONTROLS = [
  {
    key: 'smoothOutline',
    section: 'Outline',
    label: 'Smooth outline',
    type: 'checkbox'
  },
  {
    key: 'speed',
    section: 'Motion',
    label: 'Movement speed',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'shimmer',
    section: 'Motion',
    label: 'Perimeter shimmer',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'wobble',
    section: 'Motion',
    label: 'Edge wobble',
    type: 'range',
    min: 0,
    max: 20,
    step: 1
  },
  {
    key: 'baseWidth',
    section: 'Base',
    label: 'Solid width',
    type: 'range',
    min: 2,
    max: 96,
    step: 1
  },
  {
    key: 'baseEdgeSoftness',
    section: 'Base',
    label: 'Outer edge feather',
    type: 'range',
    min: 0.5,
    max: 32,
    step: 0.5
  },
  {
    key: 'baseOpacity',
    section: 'Base',
    label: 'Opacity',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'baseColor',
    section: 'Base',
    label: 'Base color',
    type: 'color'
  },
  {
    key: 'coreWidth',
    section: 'Core',
    label: 'Core width',
    type: 'range',
    min: 0.5,
    max: 24,
    step: 0.5
  },
  {
    key: 'coreIntensity',
    section: 'Core',
    label: 'Core intensity',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'coreColor',
    section: 'Core',
    label: 'Core color',
    type: 'color'
  },
  {
    key: 'glowWidth',
    section: 'Glow',
    label: 'Outer reach',
    type: 'range',
    min: 8,
    max: 180,
    step: 1
  },
  {
    key: 'glowSoftness',
    section: 'Glow',
    label: 'Falloff softness',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'glowIntensity',
    section: 'Glow',
    label: 'Intensity',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'glowColor',
    section: 'Glow',
    label: 'Glow color',
    type: 'color'
  },
  {
    key: 'additive',
    section: 'Glow',
    label: 'Light blending',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'hotCount',
    section: 'Hot spots',
    label: 'Blob count',
    type: 'range',
    min: 0,
    max: 16,
    step: 1
  },
  {
    key: 'blobLength',
    section: 'Hot spots',
    label: 'Blob length',
    type: 'range',
    min: 8,
    max: 240,
    step: 1,
    description: 'Size along the card edge.'
  },
  {
    key: 'blobThickness',
    section: 'Hot spots',
    label: 'Blob thickness',
    type: 'range',
    min: 2,
    max: 60,
    step: 1,
    description: 'Size across the glow band.'
  },
  {
    key: 'blobOffset',
    section: 'Hot spots',
    label: 'Blob offset',
    type: 'range',
    min: 0,
    max: 80,
    step: 1,
    description: 'Distance of the blob centres from the card edge.'
  },
  {
    key: 'hotTravel',
    section: 'Hot spots',
    label: 'Travel speed',
    type: 'range',
    min: 0,
    max: 3,
    step: 0.01
  },
  {
    key: 'hotLife',
    section: 'Hot spots',
    label: 'Fade in and out',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'hotBulge',
    section: 'Hot spots',
    label: 'Glow bulge',
    type: 'range',
    min: 0,
    max: 40,
    step: 0.5,
    description: 'How far the glow swells around a blob.'
  },
  {
    key: 'haloLength',
    section: 'Hot spots',
    label: 'Pale halo length',
    type: 'range',
    min: 1,
    max: 6,
    step: 0.05,
    description: 'How far the pale lime reaches along the edge, in blob lengths.'
  },
  {
    key: 'hotIntensity',
    section: 'Hot spots',
    label: 'Pale strength',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'hotThreshold',
    section: 'Hot spots',
    label: 'Pale threshold',
    type: 'range',
    min: 0.02,
    max: 1.5,
    step: 0.01,
    description: 'Lower values spread the pale lime further around each blob.'
  },
  {
    key: 'hotColor',
    section: 'Hot spots',
    label: 'Pale color',
    type: 'color'
  },
  {
    key: 'coreBrightness',
    section: 'Hot spots',
    label: 'Core brightness',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'coreThreshold',
    section: 'Hot spots',
    label: 'Core threshold',
    type: 'range',
    min: 0.1,
    max: 2,
    step: 0.01,
    description: 'Higher values give smaller white cores.'
  },
  {
    key: 'blobCoreColor',
    section: 'Hot spots',
    label: 'Core color (blobs)',
    type: 'color'
  },
  {
    key: 'taperAmount',
    section: 'Taper',
    label: 'Taper amount',
    type: 'range',
    min: 0,
    max: 0.9,
    step: 0.01,
    description: 'How much narrower the glow is at the card bottom.'
  },
  {
    key: 'taperStart',
    section: 'Taper',
    label: 'Taper start',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Card height (0 top, 1 bottom) where narrowing begins.'
  },
  {
    key: 'bottomFade',
    section: 'Taper',
    label: 'Bottom fade',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: 'bottomFadeStart',
    section: 'Taper',
    label: 'Bottom fade start',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Card height where the fade begins; the frame ends near 0.97.'
  }
] as const
export const GHOST_TUNING_RANGES = {
  windDirection: [0, 8],
  mistIntensity: [0, 12],
  mistWidth: [4, 80],
  mistSoftness: [0.2, 1.5],
  mistTextureScale: [0.25, 8],
  mistAnimationSpeed: [0, 3],
  particleIntensity: [0, 12],
  particleWindStrength: [0, 3],
  particleCount: [0, 120],
  particleSize: [1, 60],
  particleTravelDistance: [1, 300]
} as const satisfies Record<
  Exclude<keyof GhostAuraTuning, 'mistEnabled' | 'particlesEnabled'>,
  readonly [number, number]
>
export const SHATTER_DEFAULTS = {
  shardCount: 40,
  spread: 0.75,
  spin: 180,
  duration: 1.8,
  seed: 1
}
export type ShatterTuning = typeof SHATTER_DEFAULTS
export const SHATTER_TUNING_RANGES = {
  shardCount: [8, 120],
  spread: [0, 2],
  spin: [0, 720],
  duration: [0.3, 5],
  seed: [1, 9999]
} as const

export interface OutlineTuningConfig {
  readonly shatter: ShatterTuning
  readonly version: 10
  readonly aura: {
    readonly presets: Readonly<Record<OutlinePresetName, AuraTuning>>
    readonly palettes: Readonly<Record<OutlinePaletteName, AuraPalette>>
  }
  readonly ghost: {
    readonly tuning: GhostAuraTuning
    readonly palette: GhostAuraPalette
  }
}
export interface OutlineTuningApi {
  save(config: OutlineTuningConfig): Promise<void>
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error('Invalid shader tuning configuration')
  }
  return value as Record<string, unknown>
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error('Invalid shader tuning value')
  }
  return value
}
function colors<T>(value: unknown, keys: readonly string[]): T {
  const source = record(value, keys)
  return Object.fromEntries(
    keys.map((key) => [key, number(source[key], 0, 0xffffff, true)])
  ) as T
}
export function parseOutlineTuningConfig(value: unknown): OutlineTuningConfig {
  const version =
    value && typeof value === 'object' && 'version' in value ? value.version : undefined
  const config = record(
    value,
    version === 10
      ? ['version', 'aura', 'ghost', 'shatter']
      : ['version', 'aura', 'ghost']
  )
  if (
    config.version !== 4 &&
    config.version !== 5 &&
    config.version !== 6 &&
    config.version !== 7 &&
    config.version !== 8 &&
    config.version !== 9 &&
    config.version !== 10
  )
    throw new Error('Invalid shader tuning version')
  const aura = record(config.aura, ['presets', 'palettes'])
  const presets = record(aura.presets, OUTLINE_PRESET_NAMES)
  const palettes = record(aura.palettes, OUTLINE_PALETTE_NAMES)
  const controls = AURA_CONTROLS.filter((control) => control.type !== 'color')
  const parsedPresets = Object.fromEntries(
    OUTLINE_PRESET_NAMES.map((name) => {
      const preset = record(
        presets[name],
        controls.map((control) => control.key)
      )
      return [
        name,
        Object.fromEntries(
          controls.map((control) => {
            const candidate = preset[control.key]
            if (control.type === 'checkbox') {
              if (typeof candidate !== 'boolean')
                throw new Error('Invalid smooth outline toggle')
              return [control.key, candidate]
            }
            return [
              control.key,
              number(candidate, control.min, control.max, control.key === 'hotCount')
            ]
          })
        )
      ]
    })
  ) as unknown as OutlineTuningConfig['aura']['presets']
  const colorKeys = AURA_CONTROLS.filter((control) => control.type === 'color').map(
    (control) => control.key
  )
  const parsedPalettes = Object.fromEntries(
    OUTLINE_PALETTE_NAMES.map((name) => [
      name,
      colors<AuraPalette>(palettes[name], colorKeys)
    ])
  ) as unknown as OutlineTuningConfig['aura']['palettes']
  let ghost = record(config.version === 4 ? GHOST_MIST_DEFAULTS : config.ghost, [
    'tuning',
    'palette'
  ])
  if (config.version !== 4 && config.version !== 9 && config.version !== 10) {
    const old = record(ghost.tuning, [
      'windDirection',
      'windStrength',
      'particleCount',
      'spotSize',
      'textureScale',
      'expansion',
      'intensity',
      'softness',
      ...(config.version === 5 || config.version === 6
        ? []
        : ['particleTravelDistance'])
    ])
    const palette = colors<{ primaryColor: number; secondaryColor: number }>(
      ghost.palette,
      ['primaryColor', 'secondaryColor']
    )
    const degrees = config.version === 8 ? null : number(old.windDirection, 0, 360)
    ghost = {
      tuning: {
        windDirection:
          degrees === null
            ? old.windDirection
            : ((Math.round(degrees / 45) + 2) % 8) + 1,
        mistEnabled: true,
        particlesEnabled: true,
        mistAnimationSpeed: 1,
        mistIntensity: old.intensity,
        particleIntensity: old.intensity,
        mistWidth: old.expansion,
        mistSoftness: old.softness,
        mistTextureScale: old.textureScale,
        particleWindStrength: old.windStrength,
        particleCount: old.particleCount,
        particleSize:
          config.version === 5 ? number(old.spotSize, 0.25, 8) * 7.5 : old.spotSize,
        particleTravelDistance:
          config.version === 5 || config.version === 6 ? 60 : old.particleTravelDistance
      },
      palette: {
        mistPrimaryColor: palette.primaryColor,
        mistHighlightColor: palette.secondaryColor,
        particleColor: palette.secondaryColor
      }
    }
  }
  const ghostTuning = record(ghost.tuning, [
    ...Object.keys(GHOST_TUNING_RANGES),
    'mistEnabled',
    'particlesEnabled'
  ])
  for (const key of ['mistEnabled', 'particlesEnabled'])
    if (typeof ghostTuning[key] !== 'boolean')
      throw new Error('Invalid Ghost enabled toggle')
  const shatter = record(
    config.version === 10 ? config.shatter : SHATTER_DEFAULTS,
    Object.keys(SHATTER_DEFAULTS)
  )
  return {
    version: 10,
    shatter: Object.fromEntries(
      Object.entries(SHATTER_TUNING_RANGES).map(([key, [min, max]]) => [
        key,
        number(shatter[key], min, max, key === 'shardCount' || key === 'seed')
      ])
    ) as ShatterTuning,
    aura: { presets: parsedPresets, palettes: parsedPalettes },
    ghost: {
      tuning: {
        ...Object.fromEntries(
          Object.entries(GHOST_TUNING_RANGES).map(([key, range]) => [
            key,
            number(
              ghostTuning[key],
              range[0],
              range[1],
              key === 'particleCount' || key === 'windDirection'
            )
          ])
        ),
        mistEnabled: ghostTuning.mistEnabled,
        particlesEnabled: ghostTuning.particlesEnabled
      } as unknown as GhostAuraTuning,
      palette: colors<GhostAuraPalette>(ghost.palette, [
        'mistPrimaryColor',
        'mistHighlightColor',
        'particleColor'
      ])
    }
  }
}
