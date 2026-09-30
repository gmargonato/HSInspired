export interface GodRaysTuning {
  /** Angle in radians. */
  readonly angle: number
  readonly position: number
  readonly spread: number
  readonly cutoff: number
  readonly falloff: number
  readonly edgeFade: number
  readonly speed: number
  readonly ray1Density: number
  readonly ray2Density: number
  readonly ray2Intensity: number
  /** Normalized RGBA components. */
  readonly color: readonly [number, number, number, number]
  readonly hdr: boolean
  readonly seed: number
}

export const GOD_RAYS_DEFAULTS: GodRaysTuning = {
  angle: 0.5,
  position: 0.2,
  spread: 1,
  cutoff: 0.03,
  falloff: 1,
  edgeFade: 0.96,
  speed: 5,
  ray1Density: 8,
  ray2Density: 30,
  ray2Intensity: 0,
  color: [1, 0.9, 0.65, 0.8],
  hdr: false,
  seed: 1
}

export const GOD_RAYS_TUNING_RANGES = {
  angle: [-3.14, 3.14],
  position: [-2, 2],
  spread: [0, 1],
  cutoff: [-1, 1],
  falloff: [0, 1],
  edgeFade: [0, 1],
  speed: [0, 20],
  ray1Density: [0, 100],
  ray2Density: [0, 100],
  ray2Intensity: [0, 1],
  seed: [0, 9999]
} as const

export function parseGodRaysTuning(value: unknown): GodRaysTuning {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid god rays tuning')
  const source = value as Record<string, unknown>
  const keys = [...Object.keys(GOD_RAYS_TUNING_RANGES), 'color', 'hdr']
  if (
    Object.keys(source).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(source, key))
  )
    throw new Error('Invalid god rays tuning fields')
  const number = (value: unknown, min: number, max: number): number => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error('Invalid god rays tuning value')
    return value
  }
  if (
    typeof source.hdr !== 'boolean' ||
    !Array.isArray(source.color) ||
    source.color.length !== 4
  )
    throw new Error('Invalid god rays color or HDR toggle')
  return {
    ...Object.fromEntries(
      Object.entries(GOD_RAYS_TUNING_RANGES).map(([key, [min, max]]) => [
        key,
        number(source[key], min, max)
      ])
    ),
    hdr: source.hdr,
    color: Array.from(source.color, (channel) => number(channel, 0, 1))
  } as unknown as GodRaysTuning
}
