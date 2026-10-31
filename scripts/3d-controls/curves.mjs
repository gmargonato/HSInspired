// Unity's unweighted cubic curves, including step keys and quaternion tangents.
export function evaluate(keys, time) {
  if (time <= keys[0].time) return keys[0].value
  if (time >= keys.at(-1).time) return keys.at(-1).value
  const index = keys.findIndex((key) => key.time > time)
  const a = keys[index - 1]
  const b = keys[index]
  const dt = b.time - a.time
  const t = (time - a.time) / dt
  const interpolate = (av, bv, outSlope, inSlope) => {
    if (outSlope === 'step' || inSlope === 'step') return av
    return (
      (2 * t ** 3 - 3 * t ** 2 + 1) * av +
      (t ** 3 - 2 * t ** 2 + t) * dt * outSlope +
      (-2 * t ** 3 + 3 * t ** 2) * bv +
      (t ** 3 - t ** 2) * dt * inSlope
    )
  }
  return Array.isArray(a.value)
    ? a.value.map((v, i) => interpolate(v, b.value[i], a.outSlope[i], b.inSlope[i]))
    : interpolate(a.value, b.value, a.outSlope, b.inSlope)
}
