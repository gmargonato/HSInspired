export const VFX_TEMPLATES_IPC_CHANNELS = {
  save: 'debug:vfx-templates:save'
} as const

export const VFX_AOE_ZONES = [
  'enemyBoard',
  'friendlyBoard',
  'enemyHero',
  'friendlyHero'
] as const
/** Zones are relative to the effect controller, independent of screen side. */
export type VfxAoeZone = (typeof VFX_AOE_ZONES)[number]

/** Particle fire uses the extracted color ramp. */
export interface FireAoePalette {
  readonly edge: string
  readonly flame: string
  readonly core: string
}
export interface FireAoeAppearance {
  /** Omit to use the original extracted ramp. */
  readonly palette?: FireAoePalette
  readonly glowColor?: string
  readonly emberColor?: string
  readonly impactColor?: string
  readonly smokeColor?: string
  readonly smokeOpacity?: number
}
export interface FireAoeDynamics {
  readonly turbulence: number
  readonly smokeAmount: number
  readonly smokePersistence: number
  readonly emberAmount: number
  readonly emberPersistence: number
}
export const DEFAULT_FIRE_AOE_DYNAMICS: FireAoeDynamics = {
  turbulence: 0,
  smokeAmount: 1,
  smokePersistence: 1,
  emberAmount: 1,
  emberPersistence: 1
}
export interface FireAoeTuning {
  readonly density: number
  readonly particleScale: number
  readonly motion: number
  readonly rampIntensity: number
  readonly glow: number
  readonly timingScale: number
  /** Off when omitted. Hero target impacts always remain enabled. */
  readonly minionImpacts?: boolean
  readonly appearance?: FireAoeAppearance
  readonly dynamics?: FireAoeDynamics
}

export const DEFAULT_FIRE_AOE_TUNING: FireAoeTuning = {
  density: 1,
  particleScale: 1,
  motion: 1,
  rampIntensity: 1.1,
  glow: 0.75,
  timingScale: 1
}

export interface VfxImpactShake {
  readonly enabled: boolean
  readonly intensity: number
}

export const DEFAULT_VFX_IMPACT_SHAKE: VfxImpactShake = {
  enabled: true,
  intensity: 1
}

interface VfxCommonTuning {
  readonly impactShake?: VfxImpactShake
  readonly flameColor: string
  readonly coreColor: string
  readonly intensity: number
  readonly noiseScale: number
  readonly flowSpeed: number
  readonly turbulence: number
  readonly durationMs: number
}

export interface HealingTuning {
  readonly trailDensity: number
  readonly trailSize: number
  readonly bloomStrength: number
  readonly impactShake?: never
  readonly originalColors: boolean
  readonly tint: string
  readonly intensity: number
  readonly timingScale: number
  readonly density: number
  readonly bloomScale: number
  readonly waveScale: number
  readonly ribbonWidth: number
  readonly pathCurvature: number
  readonly bloomOnly: boolean
}

export const DEFAULT_HEALING_TUNING: HealingTuning = {
  originalColors: true,
  tint: '#ffe3a0',
  intensity: 1,
  timingScale: 1,
  density: 1,
  trailDensity: 1,
  trailSize: 1,
  bloomStrength: 1,
  bloomScale: 1,
  waveScale: 1,
  ribbonWidth: 1,
  pathCurvature: 0.15,
  bloomOnly: false
}

export type HealingTemplate =
  | {
      readonly id: string
      readonly name: string
      readonly family: 'heal-aoe'
      readonly zones: readonly VfxAoeZone[]
      readonly tuning: HealingTuning
    }
  | {
      readonly id: string
      readonly name: string
      readonly family: 'heal-target'
      readonly tuning: HealingTuning
    }

export type VfxTemplate =
  | HealingTemplate
  | {
      readonly id: string
      readonly name: string
      readonly family: 'missile'
      readonly tuning: VfxCommonTuning & {
        /** Optional for compatibility with existing saved templates. */
        readonly headSurfaceColor?: string
        readonly edgeColor?: string
        readonly foldColor?: string
        readonly glowColor?: string
        readonly sootColor?: string
        readonly missileGlow?: number
        /** Omit for the extracted material colors; false enables palette overrides. */
        readonly useOriginalColors?: boolean
        /** Fireball head diameters, in design pixels. */
        readonly headStartSize?: number
        readonly headEndSize?: number
        /** Milliseconds to reach the final head diameter; zero grows immediately. */
        readonly headGrowthMs?: number
        /** Birth delay before flight; omit for the original 1000 ms cast. */
        readonly launchDelayMs?: number
        readonly missileLength: number
        readonly missileWidth: number
        /** Signed bend relative to travel; omitted means straight. */
        readonly pathCurvature?: number
        /** Tail irregularity: 0 smooth, 1 authored fire, 2 exaggerated billows.
         * Retains its original saved key for existing Lab presets. */
        readonly tailMotion?: number
      }
    }
  | {
      readonly id: string
      readonly name: string
      readonly family: 'aoe'
      readonly zones: readonly VfxAoeZone[]
      readonly tuning: {
        readonly impactShake?: VfxImpactShake
        readonly intensity: number
        readonly fire: FireAoeTuning
        /** Optional visual impact cue, independent of the residual tail. */
        readonly impactMs?: number
      }
    }

export interface VfxTemplateLibrary {
  readonly version: 1
  readonly templates: readonly VfxTemplate[]
}

export interface VfxTemplatesApi {
  save(library: VfxTemplateLibrary): Promise<void>
}

const commonRanges = {
  intensity: [0.25, 2.5],
  noiseScale: [1, 10],
  flowSpeed: [0, 3.5],
  turbulence: [0, 1.2],
  durationMs: [400, 2200]
} as const

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function numberInRange(
  value: unknown,
  min: number,
  max: number,
  label: string
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be between ${min} and ${max}`)
  return value
}

function color(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new Error(`${label} must be a six-digit hex color`)
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function headSize(value: unknown, label: string): number {
  const size = numberInRange(value, 0, 1000, label)
  if (size === 0) throw new Error(`${label} must be greater than zero`)
  return size
}

function impactShake(value: unknown): { impactShake?: VfxImpactShake } {
  if (value === undefined) return {}
  const source = record(value, 'impactShake')
  return {
    impactShake: {
      enabled: boolean(source.enabled, 'impactShake.enabled'),
      intensity: numberInRange(source.intensity, 0, 3, 'impactShake.intensity')
    }
  }
}

function tuning(value: unknown, maxDuration = 2200): VfxCommonTuning {
  const source = record(value, 'tuning')
  return {
    flameColor: color(source.flameColor, 'flameColor'),
    coreColor: color(source.coreColor, 'coreColor'),
    intensity: numberInRange(source.intensity, ...commonRanges.intensity, 'intensity'),
    noiseScale: numberInRange(
      source.noiseScale,
      ...commonRanges.noiseScale,
      'noiseScale'
    ),
    flowSpeed: numberInRange(source.flowSpeed, ...commonRanges.flowSpeed, 'flowSpeed'),
    turbulence: numberInRange(
      source.turbulence,
      ...commonRanges.turbulence,
      'turbulence'
    ),
    durationMs: numberInRange(
      source.durationMs,
      commonRanges.durationMs[0],
      maxDuration,
      'durationMs'
    )
  }
}

function fireTuning(value: unknown): FireAoeTuning {
  const source = record(value, 'fire')
  if (source.minionImpacts !== undefined && typeof source.minionImpacts !== 'boolean')
    throw new Error('fire.minionImpacts must be a boolean')
  return {
    density: numberInRange(source.density, 0.25, 2, 'fire.density'),
    particleScale: numberInRange(source.particleScale, 0.5, 2, 'fire.particleScale'),
    motion: numberInRange(source.motion, 0, 2, 'fire.motion'),
    rampIntensity: numberInRange(source.rampIntensity, 0.25, 2, 'fire.rampIntensity'),
    glow: numberInRange(source.glow, 0, 2, 'fire.glow'),
    timingScale: numberInRange(source.timingScale, 0.5, 2, 'fire.timingScale'),
    ...(source.minionImpacts !== undefined
      ? { minionImpacts: source.minionImpacts }
      : {}),
    ...(source.appearance !== undefined
      ? { appearance: fireAppearance(source.appearance) }
      : {}),
    ...(source.dynamics !== undefined
      ? { dynamics: fireDynamics(source.dynamics) }
      : {})
  }
}

function fireAppearance(value: unknown): FireAoeAppearance {
  const source = record(value, 'fire.appearance')
  const result: Record<string, unknown> = {}
  if (source.palette !== undefined) {
    const palette = record(source.palette, 'fire.appearance.palette')
    result.palette = Object.fromEntries(
      ['edge', 'flame', 'core'].map((key) => [
        key,
        color(palette[key], `fire.palette.${key}`)
      ])
    )
  }
  for (const key of ['glowColor', 'emberColor', 'impactColor', 'smokeColor'])
    if (source[key] !== undefined)
      result[key] = color(source[key], `fire.appearance.${key}`)
  if (source.smokeOpacity !== undefined)
    result.smokeOpacity = numberInRange(
      source.smokeOpacity,
      0,
      1,
      'fire.appearance.smokeOpacity'
    )
  return result as FireAoeAppearance
}

function fireDynamics(value: unknown): FireAoeDynamics {
  const source = record(value, 'fire.dynamics')
  return {
    turbulence: numberInRange(source.turbulence, 0, 2, 'fire.dynamics.turbulence'),
    smokeAmount: numberInRange(source.smokeAmount, 0, 2, 'fire.dynamics.smokeAmount'),
    smokePersistence: numberInRange(
      source.smokePersistence,
      0.25,
      2,
      'fire.dynamics.smokePersistence'
    ),
    emberAmount: numberInRange(source.emberAmount, 0, 2, 'fire.dynamics.emberAmount'),
    emberPersistence: numberInRange(
      source.emberPersistence,
      0.25,
      2,
      'fire.dynamics.emberPersistence'
    )
  }
}

export function parseVfxTemplateLibrary(value: unknown): VfxTemplateLibrary {
  const source = record(value, 'VFX template library')
  if (source.version !== 1 || !Array.isArray(source.templates))
    throw new Error('Unsupported VFX template library')
  const ids = new Set<string>()
  const templates: VfxTemplate[] = source.templates.map((entry: unknown) => {
    const item = record(entry, 'VFX template')
    if (typeof item.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id))
      throw new Error('VFX template ID must be a lowercase kebab-case key')
    if (ids.has(item.id)) throw new Error(`Duplicate VFX template ID: ${item.id}`)
    ids.add(item.id)
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80)
      throw new Error(`Invalid VFX template name: ${item.id}`)
    const values = record(item.tuning, 'tuning')
    if (item.family === 'heal-aoe' || item.family === 'heal-target') {
      const tuning = Object.fromEntries(
        Object.entries(DEFAULT_HEALING_TUNING).map(([key, fallback]) => [
          key,
          values[key] ?? fallback
        ])
      ) as unknown as HealingTuning
      for (const key of ['originalColors', 'bloomOnly'] as const)
        if (typeof tuning[key] !== 'boolean') throw new Error('Invalid healing ' + key)
      if (!/^#[0-9a-f]{6}$/i.test(tuning.tint)) throw new Error('Invalid healing tint')
      for (const key of [
        'intensity',
        'timingScale',
        'bloomScale',
        'trailSize',
        'bloomStrength',
        'waveScale',
        'ribbonWidth'
      ] as const)
        numberInRange(tuning[key], 0.25, 3, 'healing.' + key)
      numberInRange(tuning.density, 0, 2, 'healing.density')
      numberInRange(tuning.trailDensity, 0, 3, 'healing.trailDensity')
      numberInRange(tuning.pathCurvature, -1, 1, 'healing.pathCurvature')
      if (item.family === 'heal-target')
        return { id: item.id, name: item.name.trim(), family: item.family, tuning }
      if (
        !Array.isArray(item.zones) ||
        item.zones.some((z) => !VFX_AOE_ZONES.includes(z as VfxAoeZone))
      )
        throw new Error('Invalid healing zones')
      return {
        id: item.id,
        name: item.name.trim(),
        family: item.family,
        tuning,
        zones: [...new Set(item.zones)] as VfxAoeZone[]
      }
    }
    if (item.family === 'missile')
      return {
        id: item.id,
        name: item.name.trim(),
        family: 'missile',
        tuning: {
          ...tuning(item.tuning),
          ...impactShake(values.impactShake),
          ...(values.headSurfaceColor !== undefined
            ? { headSurfaceColor: color(values.headSurfaceColor, 'headSurfaceColor') }
            : {}),
          ...(values.edgeColor !== undefined
            ? { edgeColor: color(values.edgeColor, 'edgeColor') }
            : {}),
          ...(values.foldColor !== undefined
            ? { foldColor: color(values.foldColor, 'foldColor') }
            : {}),
          ...(values.glowColor !== undefined
            ? { glowColor: color(values.glowColor, 'glowColor') }
            : {}),
          ...(values.sootColor !== undefined
            ? { sootColor: color(values.sootColor, 'sootColor') }
            : {}),
          ...(values.missileGlow !== undefined
            ? { missileGlow: numberInRange(values.missileGlow, 0, 2, 'missileGlow') }
            : {}),
          ...(values.useOriginalColors !== undefined
            ? {
                useOriginalColors: boolean(
                  values.useOriginalColors,
                  'useOriginalColors'
                )
              }
            : {}),
          ...(values.headStartSize !== undefined
            ? { headStartSize: headSize(values.headStartSize, 'headStartSize') }
            : {}),
          ...(values.headEndSize !== undefined
            ? { headEndSize: headSize(values.headEndSize, 'headEndSize') }
            : {}),
          ...(values.headGrowthMs !== undefined
            ? {
                headGrowthMs: numberInRange(
                  values.headGrowthMs,
                  0,
                  5000,
                  'headGrowthMs'
                )
              }
            : {}),
          ...(values.launchDelayMs !== undefined
            ? {
                launchDelayMs: numberInRange(
                  values.launchDelayMs,
                  0,
                  2000,
                  'launchDelayMs'
                )
              }
            : {}),
          missileLength: numberInRange(values.missileLength, 150, 750, 'missileLength'),
          missileWidth: numberInRange(values.missileWidth, 0.12, 0.48, 'missileWidth'),
          ...(values.pathCurvature !== undefined
            ? {
                pathCurvature: numberInRange(
                  values.pathCurvature,
                  -1,
                  1,
                  'pathCurvature'
                )
              }
            : {}),
          ...(values.tailMotion !== undefined
            ? { tailMotion: numberInRange(values.tailMotion, 0, 2, 'tailMotion') }
            : {})
        }
      }
    if (item.family === 'aoe') {
      if (
        !Array.isArray(item.zones) ||
        item.zones.some((zone) => !VFX_AOE_ZONES.includes(zone)) ||
        new Set(item.zones).size !== item.zones.length
      )
        throw new Error(`Invalid AoE zones: ${item.id}`)
      return {
        id: item.id,
        name: item.name.trim(),
        family: 'aoe',
        zones: [...item.zones] as VfxAoeZone[],
        tuning: {
          ...impactShake(values.impactShake),
          intensity: numberInRange(
            values.intensity,
            ...commonRanges.intensity,
            'intensity'
          ),
          fire: fireTuning(values.fire),
          ...(values.impactMs !== undefined
            ? {
                impactMs: numberInRange(values.impactMs, 0, 5000, 'impactMs')
              }
            : {})
        }
      }
    }
    throw new Error(`Invalid VFX family: ${item.id}`)
  })
  return { version: 1, templates }
}
