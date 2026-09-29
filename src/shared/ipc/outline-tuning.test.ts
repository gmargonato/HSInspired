import { describe, expect, it } from 'vitest'
import rawConfig from '../../../config/outline-tunings.json'
import {
  GHOST_MIST_DEFAULTS,
  SHATTER_DEFAULTS,
  OUTLINE_PALETTE_NAMES,
  OUTLINE_PRESET_NAMES,
  parseOutlineTuningConfig
} from './outline-tuning'
function legacyAura() {
  return {
    presets: {
      card: structuredClone(rawConfig.aura.presets.card),
      'bonus-card': structuredClone(rawConfig.aura.presets['bonus-card']),
      board: structuredClone(rawConfig.aura.presets.minion),
      button: structuredClone(rawConfig.aura.presets['deck-frame'])
    },
    palettes: structuredClone(rawConfig.aura.palettes)
  }
}
function legacyConfig(version: number) {
  const t = rawConfig.ghost.tuning,
    p = rawConfig.ghost.palette
  return {
    aura: legacyAura(),
    version,
    ghost: {
      tuning: {
        windDirection: version === 8 ? t.windDirection : 322,
        windStrength: t.particleWindStrength,
        particleCount: t.particleCount,
        spotSize: t.particleSize,
        textureScale: t.mistTextureScale,
        expansion: t.mistWidth,
        intensity: t.mistIntensity,
        softness: t.mistSoftness,
        ...(version >= 7 ? { particleTravelDistance: t.particleTravelDistance } : {})
      },
      palette: {
        primaryColor: p.mistPrimaryColor,
        secondaryColor: p.mistHighlightColor
      }
    }
  }
}
describe('shader tuning IPC', () => {
  it('clones both shaders without sharing mutable nested values', () => {
    const parsed = parseOutlineTuningConfig(rawConfig)
    expect(parsed).toEqual(rawConfig)
    expect(Object.keys(parsed.aura.presets)).toEqual([...OUTLINE_PRESET_NAMES])
    expect(Object.keys(parsed.aura.palettes)).toEqual([...OUTLINE_PALETTE_NAMES])
    expect(parsed.aura.presets.card).not.toBe(rawConfig.aura.presets.card)
    expect(parsed.ghost.tuning).not.toBe(rawConfig.ghost.tuning)
    expect(parsed.ghost.palette).not.toBe(rawConfig.ghost.palette)
  })
  it('migrates version 4 without changing Aura settings', () => {
    const legacy = {
      aura: legacyAura(),
      version: 4,
      ghost: { tuning: { ribbonWidth: 5 }, palette: { baseColor: 0 } }
    }
    const parsed = parseOutlineTuningConfig(legacy)
    expect(parsed.version).toBe(11)
    expect(parsed.aura).toEqual(rawConfig.aura)
    expect(parsed.ghost).toEqual(GHOST_MIST_DEFAULTS)
    expect(legacy.version).toBe(4)
  })
  it('converts version 5 spot multipliers into pixel averages without mutating input', () => {
    const legacy = legacyConfig(5)
    legacy.ghost.tuning.spotSize = 1.09
    const parsed = parseOutlineTuningConfig(legacy)
    expect(parsed.version).toBe(11)
    expect(parsed.ghost.tuning.particleSize).toBeCloseTo(8.175)
    expect(legacy.ghost.tuning.spotSize).toBe(1.09)
    expect(parsed.aura).toEqual(rawConfig.aura)
    expect(parsed.ghost.palette).toEqual({
      mistPrimaryColor: legacy.ghost.palette.primaryColor,
      mistHighlightColor: legacy.ghost.palette.secondaryColor,
      particleColor: legacy.ghost.palette.secondaryColor
    })
  })
  it('adds travel distance to version 6 while preserving saved settings', () => {
    const legacy = legacyConfig(6)
    const parsed = parseOutlineTuningConfig(legacy)
    expect(parsed.version).toBe(11)
    expect(parsed.ghost.tuning).toMatchObject({
      particleTravelDistance: 60,
      windDirection: 2,
      particleSize: legacy.ghost.tuning.spotSize,
      mistWidth: legacy.ghost.tuning.expansion
    })
    expect(parsed.aura).toEqual(rawConfig.aura)
    expect(legacy.ghost.tuning).not.toHaveProperty('particleTravelDistance')
  })
  it.each([
    [0, 3],
    [45, 4],
    [90, 5],
    [135, 6],
    [180, 7],
    [225, 8],
    [270, 1],
    [315, 2],
    [322, 2],
    [360, 3]
  ])('migrates legacy angle %s to compass option %s', (degrees, expected) => {
    const legacy = legacyConfig(7)
    legacy.ghost.tuning.windDirection = degrees
    const parsed = parseOutlineTuningConfig(legacy)
    expect(parsed.ghost.tuning.windDirection).toBe(expected)
    expect(legacy.ghost.tuning.windDirection).toBe(degrees)
  })
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('accepts wind option %s', (value) => {
    const config = structuredClone(rawConfig)
    config.ghost.tuning.windDirection = value
    expect(parseOutlineTuningConfig(config).ghost.tuning.windDirection).toBe(value)
  })
  it.each([-1, 9, 1.5, 360, NaN])('rejects invalid wind option %s', (value) => {
    const config = structuredClone(rawConfig)
    config.ghost.tuning.windDirection = value
    expect(() => parseOutlineTuningConfig(config)).toThrow()
  })
  it.each([0, -1, 301, NaN])('rejects invalid travel distance %s', (value) => {
    const config = structuredClone(rawConfig)
    config.ghost.tuning.particleTravelDistance = value
    expect(() => parseOutlineTuningConfig(config)).toThrow()
  })
  it('separates version 8 controls without changing saved appearance', () => {
    const legacy = legacyConfig(8)
    const before = structuredClone(legacy)
    const parsed = parseOutlineTuningConfig(legacy)
    expect(parsed.ghost.tuning).toMatchObject({
      mistEnabled: true,
      particlesEnabled: true,
      mistAnimationSpeed: 1,
      mistIntensity: legacy.ghost.tuning.intensity,
      particleIntensity: legacy.ghost.tuning.intensity,
      mistWidth: legacy.ghost.tuning.expansion,
      particleWindStrength: legacy.ghost.tuning.windStrength
    })
    expect(parsed.ghost.palette.mistHighlightColor).toBe(
      legacy.ghost.palette.secondaryColor
    )
    expect(parsed.ghost.palette.particleColor).toBe(legacy.ghost.palette.secondaryColor)
    expect(legacy).toEqual(before)
  })
  it.each(['mistEnabled', 'particlesEnabled'])('requires a boolean for %s', (key) => {
    const config = structuredClone(rawConfig)
    Object.assign(config.ghost.tuning, { [key]: 1 })
    expect(() => parseOutlineTuningConfig(config)).toThrow()
  })
  it('round-trips independent toggles, colors and frozen mist speed', () => {
    const config = structuredClone(rawConfig)
    config.ghost.tuning.mistEnabled = false
    config.ghost.tuning.particlesEnabled = true
    config.ghost.tuning.mistAnimationSpeed = 0
    config.ghost.tuning.mistIntensity = 0.3
    config.ghost.tuning.particleIntensity = 2
    config.ghost.palette.particleColor = 0xff0000
    expect(parseOutlineTuningConfig(config)).toEqual(config)
  })
  it('rejects fractional particle counts', () => {
    const config = structuredClone(rawConfig)
    config.ghost.tuning.particleCount = 10.5
    expect(() => parseOutlineTuningConfig(config)).toThrow()
  })
  it('rejects incompatible shapes and versions', () => {
    for (const version of [3, 12])
      expect(() => parseOutlineTuningConfig({ ...rawConfig, version })).toThrow()
    const missing = structuredClone(rawConfig) as unknown as {
      aura: { presets: Record<string, unknown> }
    }
    delete missing.aura.presets.minion
    expect(() => parseOutlineTuningConfig(missing)).toThrow()
    expect(() => parseOutlineTuningConfig({ ...rawConfig, ghost: undefined })).toThrow()
    expect(() => parseOutlineTuningConfig({ ...rawConfig, extra: true })).toThrow()
  })
  it('validates fractional controls, integer blob counts and boolean toggles', () => {
    for (const [key, value] of [
      ['speed', NaN],
      ['speed', 1.01],
      ['speed', -0.01],
      ['hotCount', 3.5],
      ['hotCount', 17],
      ['smoothOutline', 1],
      ['unexpected', true]
    ]) {
      const config = structuredClone(rawConfig)
      Object.assign(config.aura.presets.card, { [key as string]: value })
      expect(() => parseOutlineTuningConfig(config)).toThrow()
    }
    const config = structuredClone(rawConfig)
    Object.assign(config.aura.presets.card, {
      speed: 0.37,
      smoothOutline: false,
      hotCount: 0
    })
    expect(parseOutlineTuningConfig(config).aura.presets.card).toMatchObject({
      speed: 0.37,
      smoothOutline: false,
      hotCount: 0
    })
  })
  it('validates Aura and Ghost color channels independently', () => {
    for (const palette of ['aura', 'ghost'] as const)
      for (const value of [-1, 0x1000000, 1.5, NaN, 'red']) {
        const config = structuredClone(rawConfig)
        const target =
          palette === 'aura' ? config.aura.palettes.green : config.ghost.palette
        Object.assign(target, {
          [palette === 'aura' ? 'baseColor' : 'mistPrimaryColor']: value
        })
        expect(() => parseOutlineTuningConfig(config)).toThrow()
      }
  })
  it('keeps Ghost tuning isolated and validates its mist ranges', () => {
    const config = structuredClone(rawConfig)
    config.aura.presets.card.wobble = 20
    config.aura.palettes.purple.baseColor = 123
    expect(parseOutlineTuningConfig(config).ghost).toEqual(rawConfig.ghost)
    config.ghost.tuning.particleWindStrength = 4
    expect(() => parseOutlineTuningConfig(config)).toThrow()
  })
})

it('migrates version 9 with default shatter tuning and preserves other shaders', () => {
  const legacy = { version: 9, aura: legacyAura(), ghost: rawConfig.ghost }
  const parsed = parseOutlineTuningConfig(legacy)
  expect(parsed.shatter).toEqual(SHATTER_DEFAULTS)
  expect(parsed.aura).toEqual(rawConfig.aura)
  expect(parsed.ghost).toEqual(legacy.ghost)
})
it.each([{ duration: 0 }, { shardCount: 10.5 }, { seed: Infinity }, { spread: 3 }])(
  'rejects invalid shatter values: %j',
  (invalid) => {
    expect(() =>
      parseOutlineTuningConfig({
        ...rawConfig,
        shatter: { ...rawConfig.shatter, ...invalid }
      })
    ).toThrow()
  }
)

it('migrates version 10 into independent element settings without changing other shaders', () => {
  const legacy = { ...structuredClone(rawConfig), version: 10, aura: legacyAura() }
  legacy.aura.presets.button.glowWidth = 77
  legacy.aura.presets.board.glowWidth = 91
  const before = structuredClone(legacy)
  const migrated = parseOutlineTuningConfig(legacy)
  for (const name of [
    'deck-frame',
    'play-button',
    'end-turn',
    'expansion-toggle'
  ] as const)
    expect(migrated.aura.presets[name]).toEqual(legacy.aura.presets.button)
  for (const name of [
    'minion',
    'hero',
    'hero-power',
    'weapon',
    'secret',
    'quest'
  ] as const)
    expect(migrated.aura.presets[name]).toEqual(legacy.aura.presets.board)
  expect(migrated.aura.presets.card).toEqual(legacy.aura.presets.card)
  expect(migrated.aura.presets['bonus-card']).toEqual(legacy.aura.presets['bonus-card'])
  expect(migrated.aura.palettes).toEqual(legacy.aura.palettes)
  expect(migrated.ghost).toEqual(legacy.ghost)
  expect(migrated.shatter).toEqual(legacy.shatter)
  Object.assign(migrated.aura.presets['deck-frame'], { glowWidth: 123 })
  Object.assign(migrated.aura.presets.minion, { glowWidth: 124 })
  expect(migrated.aura.presets['play-button'].glowWidth).toBe(77)
  expect(migrated.aura.presets['end-turn'].glowWidth).toBe(77)
  expect(migrated.aura.presets.hero.glowWidth).toBe(91)
  expect(legacy).toEqual(before)
  expect(parseOutlineTuningConfig(JSON.parse(JSON.stringify(migrated)))).toEqual(
    migrated
  )
})
