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
export const GHOST_AURA_CONFIG = { ...initialConfig.ghost }

/** Current production tuning registry, initialized from the checked-in JSON config. */
export const OUTLINE_TUNINGS: Record<OutlinePresetName, OutlineTuning> =
  Object.fromEntries(
    OUTLINE_PRESET_NAMES.map((preset) => [preset, initialConfig.aura.presets[preset]])
  ) as Record<OutlinePresetName, OutlineTuning>

export const OUTLINE_PALETTES: Record<OutlinePaletteName, OutlinePalette> =
  Object.fromEntries(
    OUTLINE_PALETTE_NAMES.map((name) => [name, initialConfig.aura.palettes[name]])
  ) as Record<OutlinePaletteName, OutlinePalette>

export function getOutlineTuning(preset: OutlinePresetName): OutlineTuning {
  return OUTLINE_TUNINGS[preset]
}

export function getOutlineTuningConfig(): OutlineTuningConfig {
  return parseOutlineTuningConfig({
    version: 4,
    aura: { presets: OUTLINE_TUNINGS, palettes: OUTLINE_PALETTES },
    ghost: GHOST_AURA_CONFIG
  })
}

export function updateOutlineTuningConfig(config: OutlineTuningConfig): void {
  const parsed = parseOutlineTuningConfig(config)
  GHOST_AURA_CONFIG.tuning = parsed.ghost.tuning
  GHOST_AURA_CONFIG.palette = parsed.ghost.palette
  for (const preset of OUTLINE_PRESET_NAMES) {
    OUTLINE_TUNINGS[preset] = parsed.aura.presets[preset]
  }
  for (const name of OUTLINE_PALETTE_NAMES) {
    OUTLINE_PALETTES[name] = parsed.aura.palettes[name]
  }
}
