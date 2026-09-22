import { afterEach, describe, expect, it } from 'vitest'
import rawConfig from '../../../../config/outline-tunings.json'
import { parseOutlineTuningConfig } from '../../../shared/ipc/outline-tuning'
import {
  getOutlineTuning,
  getOutlineTuningConfig,
  OUTLINE_PALETTES,
  OUTLINE_TUNINGS,
  updateOutlineTuningConfig
} from './outline-tuning'

const initialConfig = parseOutlineTuningConfig(rawConfig)

describe('outline tuning registry', () => {
  afterEach(() => updateOutlineTuningConfig(initialConfig))

  it('updates preset lookups and existing registry references together', () => {
    const updated = parseOutlineTuningConfig({
      ...initialConfig,
      presets: {
        ...initialConfig.presets,
        card: {
          ...initialConfig.presets.card,
          motionSpeed: 1.25,
          saturation: 1.25
        }
      }
    })

    updateOutlineTuningConfig(updated)

    expect(getOutlineTuning('card').motionSpeed).toBe(1.25)
    expect(getOutlineTuning('card').saturation).toBe(1.25)
    expect(OUTLINE_TUNINGS.card.motionSpeed).toBe(1.25)
    expect(getOutlineTuningConfig()).toEqual(updated)
  })

  it('updates shared palette lookups with a saved configuration', () => {
    const updated = parseOutlineTuningConfig({
      ...initialConfig,
      palettes: {
        ...initialConfig.palettes,
        blue: { ...initialConfig.palettes.blue, glowColor: 0x123456 }
      }
    })

    updateOutlineTuningConfig(updated)

    expect(OUTLINE_PALETTES.blue.glowColor).toBe(0x123456)
    expect(getOutlineTuningConfig()).toEqual(updated)
  })
})
