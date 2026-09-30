export interface GodRaysDustTuning {
  readonly enabled: boolean
  readonly count: number
  readonly speed: number
  /** Probability at birth, from 0 to 1, of fading before leaving the screen. */
  readonly decayChance: number
  readonly size: number
  readonly brightness: number
  readonly blendMode: 'screen' | 'add'
}

export const GOD_RAYS_DUST_DEFAULTS: GodRaysDustTuning = {
  enabled: true,
  count: 80,
  speed: 1,
  decayChance: 0.35,
  size: 1,
  brightness: 1,
  blendMode: 'screen'
}

export const GOD_RAYS_DUST_RANGES = {
  count: [0, 500],
  speed: [0, 5],
  decayChance: [0, 1],
  size: [0.25, 4],
  brightness: [0, 5]
} as const

export function parseGodRaysDustTuning(value: unknown): GodRaysDustTuning {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid god rays dust tuning')
  const source = value as Record<string, unknown>
  const keys = [...Object.keys(GOD_RAYS_DUST_RANGES), 'enabled', 'blendMode']
  if (
    Object.keys(source).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(source, key))
  )
    throw new Error('Invalid god rays dust fields')
  if (
    typeof source.enabled !== 'boolean' ||
    (source.blendMode !== 'screen' && source.blendMode !== 'add')
  )
    throw new Error('Invalid god rays dust toggle or blend mode')
  for (const [key, [min, max]] of Object.entries(GOD_RAYS_DUST_RANGES)) {
    const number = source[key]
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < min ||
      number > max ||
      (key === 'count' && !Number.isInteger(number))
    )
      throw new Error('Invalid god rays dust value')
  }
  return { ...source } as unknown as GodRaysDustTuning
}
