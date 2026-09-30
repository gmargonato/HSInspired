export const WINDOW_SETTINGS_IPC_CHANNELS = {
  get: 'window-settings:get',
  setResolution: 'window-settings:set-resolution'
} as const

export const WINDOW_RESOLUTION_PRESETS = [
  { width: 960, height: 540 },
  { width: 1280, height: 720 },
  { width: 1440, height: 810 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 }
] as const

export interface WindowResolution {
  readonly width: number
  readonly height: number
}

export interface WindowResolutionSettings {
  readonly selectedResolution: WindowResolution
  readonly availableResolutions: readonly WindowResolution[]
}

export interface WindowSettingsApi {
  get(): Promise<WindowResolutionSettings>
  setResolution(resolution: WindowResolution): Promise<WindowResolutionSettings>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWindowResolution(value: unknown): value is WindowResolution {
  return (
    isRecord(value) &&
    typeof value.width === 'number' &&
    Number.isInteger(value.width) &&
    typeof value.height === 'number' &&
    Number.isInteger(value.height) &&
    value.width > 0 &&
    value.height > 0
  )
}

export function isWindowResolutionPreset(value: unknown): value is WindowResolution {
  return (
    isWindowResolution(value) &&
    WINDOW_RESOLUTION_PRESETS.some(
      (preset) => preset.width === value.width && preset.height === value.height
    )
  )
}

export function parseWindowResolution(value: unknown): WindowResolution {
  if (!isWindowResolutionPreset(value)) {
    throw new Error('Window resolution must be one of the supported presets')
  }
  return { width: value.width, height: value.height }
}

export function parseWindowResolutionSettings(
  value: unknown
): WindowResolutionSettings {
  if (!isRecord(value) || !Array.isArray(value.availableResolutions)) {
    throw new Error('Invalid window resolution settings response')
  }

  return {
    selectedResolution: parseWindowResolution(value.selectedResolution),
    availableResolutions: value.availableResolutions.map(parseWindowResolution)
  }
}
