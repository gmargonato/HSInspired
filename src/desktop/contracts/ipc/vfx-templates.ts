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

interface VfxCommonTuning {
  readonly flameColor: string
  readonly coreColor: string
  readonly intensity: number
  readonly noiseScale: number
  readonly flowSpeed: number
  readonly turbulence: number
  readonly durationMs: number
}

export type VfxTemplate =
  | {
      readonly id: string
      readonly name: string
      readonly family: 'missile'
      readonly tuning: VfxCommonTuning & {
        readonly missileLength: number
        readonly missileWidth: number
      }
    }
  | {
      readonly id: string
      readonly name: string
      readonly family: 'aoe'
      readonly zones: readonly VfxAoeZone[]
      readonly tuning: VfxCommonTuning & {
        readonly aoeRadius: number
        readonly aoeEdgeSoftness: number
        readonly aoeShape: 'radial' | 'wide'
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

function tuning(value: unknown): VfxCommonTuning {
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
      ...commonRanges.durationMs,
      'durationMs'
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
    const common = tuning(item.tuning)
    const values = record(item.tuning, 'tuning')
    if (item.family === 'missile')
      return {
        id: item.id,
        name: item.name.trim(),
        family: 'missile',
        tuning: {
          ...common,
          missileLength: numberInRange(values.missileLength, 150, 750, 'missileLength'),
          missileWidth: numberInRange(values.missileWidth, 0.12, 0.48, 'missileWidth')
        }
      }
    if (item.family === 'aoe') {
      if (
        !Array.isArray(item.zones) ||
        item.zones.some((zone) => !VFX_AOE_ZONES.includes(zone)) ||
        new Set(item.zones).size !== item.zones.length
      )
        throw new Error(`Invalid AoE zones: ${item.id}`)
      if (values.aoeShape !== 'radial' && values.aoeShape !== 'wide')
        throw new Error(`Invalid AoE shape: ${item.id}`)
      return {
        id: item.id,
        name: item.name.trim(),
        family: 'aoe',
        zones: [...item.zones] as VfxAoeZone[],
        tuning: {
          ...common,
          aoeRadius: numberInRange(values.aoeRadius, 0.35, 1.15, 'aoeRadius'),
          aoeEdgeSoftness: numberInRange(
            values.aoeEdgeSoftness,
            0.01,
            0.2,
            'aoeEdgeSoftness'
          ),
          aoeShape: values.aoeShape
        }
      }
    }
    throw new Error(`Invalid VFX family: ${item.id}`)
  })
  return { version: 1, templates }
}
