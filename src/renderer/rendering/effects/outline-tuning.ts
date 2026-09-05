import rawConfig from '../../../../config/outline-tunings.json'
import {
  OUTLINE_PRESET_NAMES,
  parseOutlineTuningConfig,
  type OutlinePresetName,
  type OutlineTuning,
  type OutlineTuningConfig
} from '../../../shared/ipc/outline-tuning'

export type {
  OutlinePresetName,
  OutlineTuning,
  OutlineTuningConfig
} from '../../../shared/ipc/outline-tuning'

const initialConfig = parseOutlineTuningConfig(rawConfig)

/** Current production tuning registry, initialized from the checked-in JSON config. */
export const OUTLINE_TUNINGS: Record<OutlinePresetName, OutlineTuning> =
  Object.fromEntries(
    OUTLINE_PRESET_NAMES.map((preset) => [preset, initialConfig.presets[preset]])
  ) as Record<OutlinePresetName, OutlineTuning>

export function getOutlineTuning(preset: OutlinePresetName): OutlineTuning {
  return OUTLINE_TUNINGS[preset]
}

export function getOutlineTuningConfig(): OutlineTuningConfig {
  return parseOutlineTuningConfig({ version: 1, presets: OUTLINE_TUNINGS })
}

export function updateOutlineTuningConfig(config: OutlineTuningConfig): void {
  const parsed = parseOutlineTuningConfig(config)
  for (const preset of OUTLINE_PRESET_NAMES) {
    OUTLINE_TUNINGS[preset] = parsed.presets[preset]
  }
}
