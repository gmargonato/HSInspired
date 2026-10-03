export interface WindfuryTuning {
  readonly speed: number
  readonly thickness: number
  readonly ribbons: number
  readonly trailLength: number
  readonly width: number
  readonly orbitDepth: number
  readonly spacing: number
  readonly opacity: number
  readonly softness: number
  readonly color: number
}

/** Multipliers preserve the original approved wind appearance at 1. */
export const WINDFURY_DEFAULTS: WindfuryTuning = {
  speed: 1,
  thickness: 1,
  ribbons: 3,
  trailLength: 1.15,
  width: 1,
  orbitDepth: 0.13,
  spacing: 0.2,
  opacity: 1,
  softness: 1,
  color: 0xe9f7ff
}

export const WINDFURY_RANGES = {
  speed: [0, 5],
  thickness: [0.1, 5],
  ribbons: [1, 8],
  trailLength: [0.1, 1.95],
  width: [0.5, 2],
  orbitDepth: [0.02, 0.5],
  spacing: [0, 0.4],
  opacity: [0, 2],
  softness: [0, 3]
} as const

export function parseWindfuryTuning(value: unknown): WindfuryTuning {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Windfury tuning')
  const source = value as Record<string, unknown>
  const ranges = { ...WINDFURY_RANGES, color: [0, 0xffffff] }
  if (Object.keys(source).length !== Object.keys(ranges).length)
    throw new Error('Invalid Windfury tuning fields')
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const number = source[key]
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < min ||
      number > max ||
      ((key === 'ribbons' || key === 'color') && !Number.isInteger(number))
    )
      throw new Error(`Invalid Windfury ${key}`)
  }
  return { ...source } as unknown as WindfuryTuning
}
