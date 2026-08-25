import type { OutlinePresetName, OutlineTuning } from './outline-tuning'

/** Production alias: experimental direction data is stripped from builds. */
export function resolveExperimentalOutlineTuning(
  _direction: string | undefined,
  _preset: OutlinePresetName,
  tuning: OutlineTuning
): OutlineTuning {
  return tuning
}

export function getExperimentalOutlineDirectionId(): string | undefined {
  return undefined
}
