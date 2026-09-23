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
export interface GhostAuraTuning {
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
export interface GhostAuraPalette {
  readonly baseColor: number
  readonly outerColor: number
  readonly glowColor: number
  readonly highlightColor: number
}
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
} as const satisfies Record<keyof GhostAuraTuning, readonly [number, number]>
export interface OutlineTuningConfig {
  readonly version: 4
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
  const config = record(value, ['version', 'aura', 'ghost'])
  if (config.version !== 4) throw new Error('Invalid shader tuning version')
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
  const ghost = record(config.ghost, ['tuning', 'palette'])
  const ghostTuning = record(ghost.tuning, Object.keys(GHOST_TUNING_RANGES))
  return {
    version: 4,
    aura: { presets: parsedPresets, palettes: parsedPalettes },
    ghost: {
      tuning: Object.fromEntries(
        Object.entries(GHOST_TUNING_RANGES).map(([key, range]) => [
          key,
          number(ghostTuning[key], range[0], range[1])
        ])
      ) as unknown as GhostAuraTuning,
      palette: colors<GhostAuraPalette>(ghost.palette, [
        'baseColor',
        'outerColor',
        'glowColor',
        'highlightColor'
      ])
    }
  }
}
