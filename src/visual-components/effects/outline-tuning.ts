import rawConfig from '../../../config/outline-tunings.json'
import {
  OUTLINE_PALETTE_NAMES,
  OUTLINE_PRESET_NAMES,
  parseOutlineTuningConfig,
  type OutlinePalette,
  type OutlinePaletteName,
  type OutlinePresetName,
  type OutlineTuning,
  type OutlineTuningConfig
} from '../../desktop/contracts/ipc/outline-tuning'

export type {
  OutlinePalette,
  OutlinePaletteName,
  OutlinePresetName,
  OutlineTuning,
  OutlineTuningConfig
} from '../../desktop/contracts/ipc/outline-tuning'

const initialConfig = parseOutlineTuningConfig(rawConfig)
export const WINDFURY_CONFIG = { ...initialConfig.windfury }
export const SHATTER_CONFIG = { ...initialConfig.shatter }
export const GOD_RAYS_CONFIG = { ...initialConfig.godRays }
export const GOD_RAYS_DUST_CONFIG = { ...initialConfig.godRaysDust }
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
    version: 14,
    windfury: WINDFURY_CONFIG,
    godRaysDust: GOD_RAYS_DUST_CONFIG,
    godRays: GOD_RAYS_CONFIG,
    shatter: SHATTER_CONFIG,
    aura: { presets: OUTLINE_TUNINGS, palettes: OUTLINE_PALETTES },
    ghost: GHOST_AURA_CONFIG
  })
}

export function updateOutlineTuningConfig(config: OutlineTuningConfig): void {
  const parsed = parseOutlineTuningConfig(config)
  Object.assign(WINDFURY_CONFIG, parsed.windfury)
  Object.assign(SHATTER_CONFIG, parsed.shatter)
  Object.assign(GOD_RAYS_CONFIG, parsed.godRays)
  Object.assign(GOD_RAYS_DUST_CONFIG, parsed.godRaysDust)
  GHOST_AURA_CONFIG.tuning = parsed.ghost.tuning
  GHOST_AURA_CONFIG.palette = parsed.ghost.palette
  for (const preset of OUTLINE_PRESET_NAMES) {
    OUTLINE_TUNINGS[preset] = parsed.aura.presets[preset]
  }
  for (const name of OUTLINE_PALETTE_NAMES) {
    OUTLINE_PALETTES[name] = parsed.aura.palettes[name]
  }
}
