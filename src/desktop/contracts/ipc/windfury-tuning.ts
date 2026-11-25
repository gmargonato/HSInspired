export interface WindfuryTuning {
  readonly speed: number
  readonly scale: number
  readonly intensity: number
  readonly fresnelWidth: number
  readonly fresnelIntensity: number
  readonly fresnelAlpha: number
  readonly color: number
}
/** Multipliers over the recovered per-material values. White preserves native tint curves. */
export const WINDFURY_DEFAULTS: WindfuryTuning = {
  speed: 1,
  scale: 1,
  intensity: 1,
  fresnelWidth: 1,
  fresnelIntensity: 1,
  fresnelAlpha: 1,
  color: 0xffffff
}
export const WINDFURY_RANGES = {
  speed: [0, 5],
  scale: [0.5, 2],
  intensity: [0, 4],
  fresnelWidth: [0.1, 10],
  fresnelIntensity: [0, 3],
  fresnelAlpha: [0, 2]
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
      (key === 'color' && !Number.isInteger(number))
    )
      throw new Error(`Invalid Windfury ${key}`)
  }
  return { ...source } as unknown as WindfuryTuning
}
