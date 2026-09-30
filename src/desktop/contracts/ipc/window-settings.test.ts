import { describe, expect, it } from 'vitest'
import {
  WINDOW_RESOLUTION_PRESETS,
  isWindowResolutionPreset,
  parseWindowResolution,
  parseWindowResolutionSettings
} from './window-settings'

describe('window settings IPC contract', () => {
  it('accepts every declared 16:9 window preset', () => {
    for (const preset of WINDOW_RESOLUTION_PRESETS) {
      expect(isWindowResolutionPreset(preset)).toBe(true)
      expect(parseWindowResolution(preset)).toEqual(preset)
    }
  })

  it('rejects arbitrary and malformed resolution requests', () => {
    expect(isWindowResolutionPreset({ width: 1366, height: 768 })).toBe(false)
    expect(isWindowResolutionPreset({ width: 1920, height: '1080' })).toBe(false)
    expect(() => parseWindowResolution({ width: 1920, height: 1200 })).toThrow()
  })

  it('validates both the current value and available selector entries', () => {
    const settings = parseWindowResolutionSettings({
      selectedResolution: { width: 1280, height: 720 },
      availableResolutions: [
        { width: 960, height: 540 },
        { width: 1280, height: 720 }
      ]
    })

    expect(settings.selectedResolution).toEqual({ width: 1280, height: 720 })
    expect(settings.availableResolutions).toHaveLength(2)
    expect(() =>
      parseWindowResolutionSettings({
        selectedResolution: { width: 1280, height: 720 },
        availableResolutions: [{ width: 1920, height: 1200 }]
      })
    ).toThrow()
  })
})
