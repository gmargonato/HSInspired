import rawConfig from '../../../../config/outline-tunings.json'
import {
  OUTLINE_PALETTE_NAMES,
  OUTLINE_PRESET_NAMES,
  parseOutlineTuningConfig,
  type OutlinePalette,
  type OutlinePaletteName,
  type OutlinePresetName,
  type OutlineTuning,
  type OutlineTuningConfig
} from '../../../shared/ipc/outline-tuning'

export type {
  OutlinePalette,
  OutlinePaletteName,
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

export const OUTLINE_PALETTES: Record<OutlinePaletteName, OutlinePalette> =
  Object.fromEntries(
    OUTLINE_PALETTE_NAMES.map((name) => [name, initialConfig.palettes[name]])
  ) as Record<OutlinePaletteName, OutlinePalette>

export function getOutlineTuning(preset: OutlinePresetName): OutlineTuning {
  return OUTLINE_TUNINGS[preset]
}

export function getOutlineTuningConfig(): OutlineTuningConfig {
  return parseOutlineTuningConfig({
    version: 3,
    presets: OUTLINE_TUNINGS,
    palettes: OUTLINE_PALETTES
  })
}

export function updateOutlineTuningConfig(config: OutlineTuningConfig): void {
  const parsed = parseOutlineTuningConfig(config)
  for (const preset of OUTLINE_PRESET_NAMES) {
    OUTLINE_TUNINGS[preset] = parsed.presets[preset]
  }
  for (const name of OUTLINE_PALETTE_NAMES) {
    OUTLINE_PALETTES[name] = parsed.palettes[name]
  }
}
