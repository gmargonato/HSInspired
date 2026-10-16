import type { VfxAoeZone } from '../../desktop/contracts/ipc/vfx-templates'
import type { VfxTemplate } from '../../desktop/contracts/ipc/vfx-templates'
import {
  DEFAULT_FIRE_AOE_TUNING,
  DEFAULT_FIRE_AOE_DYNAMICS
} from '../../desktop/contracts/ipc/vfx-templates'

export type VfxEffectId = 'missile' | 'aoe'

export const AOE_ZONES = [
  { key: 'enemyBoard', label: 'Enemy board' },
  { key: 'friendlyBoard', label: 'Friendly board' },
  { key: 'enemyHero', label: 'Enemy hero' },
  { key: 'friendlyHero', label: 'Friendly hero' }
] as const
export type AoeZoneId = VfxAoeZone

export interface VfxLabSettings {
  flameColor: string
  coreColor: string
  intensity: number
  noiseScale: number
  flowSpeed: number
  turbulence: number
  durationMs: number
  headSurfaceColor: string
  edgeColor: string
  foldColor: string
  glowColor: string
  sootColor: string
  missileGlow: number
  missileOriginalColors: boolean
  missileOriginalColorsAuthored: boolean
  headStartSize: number
  headEndSize: number
  headGrowthMs: number
  missileLength: number
  missileWidth: number
  aoeImpactMs?: number
  fireDensity: number
  fireParticleScale: number
  fireMotion: number
  fireRampIntensity: number
  fireGlow: number
  fireTimingScale: number
  fireMinionImpacts: boolean
  fireMinionImpactsAuthored: boolean
  firePalette: 'original' | 'custom'
  fireEdgeColor: string
  fireFlameColor: string
  fireCoreColor: string
  fireGlowOverride: boolean
  fireGlowColor: string
  fireEmberOverride: boolean
  fireEmberColor: string
  fireImpactOverride: boolean
  fireImpactColor: string
  fireSmokeOverride: boolean
  fireSmokeColor: string
  fireSmokeOpacity: number
  fireAppearanceAuthored: boolean
  fireSmokeOpacityAuthored: boolean
  fireDynamicsAuthored: boolean
  fireTurbulence: number
  fireSmokeAmount: number
  fireSmokePersistence: number
  fireEmberAmount: number
  fireEmberPersistence: number
  previewMinions: number
  opponentCaster: boolean
  enemyBoard: boolean
  friendlyBoard: boolean
  enemyHero: boolean
  friendlyHero: boolean
  showTargetGuides: boolean
}

export type VfxLabSettingKey = keyof VfxLabSettings
export type VfxLabSettingValue = string | number | boolean

const VFX_DEFAULT_MISSILE_LENGTH = 550

export const DEFAULT_VFX_LAB_SETTINGS: VfxLabSettings = {
  flameColor: '#ff4b08',
  coreColor: '#ffd13b',
  intensity: 1,
  noiseScale: 1,
  flowSpeed: 1,
  turbulence: 0,
  durationMs: 400,
  headSurfaceColor: '#d90c00',
  edgeColor: '#ff6500',
  foldColor: '#d84a08',
  glowColor: '#ffb02e',
  sootColor: '#1f130b',
  missileGlow: 1,
  missileOriginalColors: true,
  missileOriginalColorsAuthored: false,
  headStartSize: 62,
  headEndSize: 62,
  headGrowthMs: 0,
  missileLength: VFX_DEFAULT_MISSILE_LENGTH,
  missileWidth: 0.32,
  aoeImpactMs: 500,
  fireDensity: DEFAULT_FIRE_AOE_TUNING.density,
  fireParticleScale: DEFAULT_FIRE_AOE_TUNING.particleScale,
  fireMotion: DEFAULT_FIRE_AOE_TUNING.motion,
  fireRampIntensity: DEFAULT_FIRE_AOE_TUNING.rampIntensity,
  fireGlow: DEFAULT_FIRE_AOE_TUNING.glow,
  fireTimingScale: DEFAULT_FIRE_AOE_TUNING.timingScale,
  fireMinionImpacts: false,
  fireMinionImpactsAuthored: false,
  firePalette: 'original',
  fireEdgeColor: '#a51b08',
  fireFlameColor: '#ff790f',
  fireCoreColor: '#fff4c2',
  fireGlowOverride: false,
  fireGlowColor: '#ff790f',
  fireEmberOverride: false,
  fireEmberColor: '#ff790f',
  fireImpactOverride: false,
  fireImpactColor: '#ff790f',
  fireSmokeOverride: false,
  fireSmokeColor: '#0b0b0b',
  fireSmokeOpacity: 1,
  fireAppearanceAuthored: false,
  fireSmokeOpacityAuthored: false,
  fireDynamicsAuthored: false,
  fireTurbulence: DEFAULT_FIRE_AOE_DYNAMICS.turbulence,
  fireSmokeAmount: DEFAULT_FIRE_AOE_DYNAMICS.smokeAmount,
  fireSmokePersistence: DEFAULT_FIRE_AOE_DYNAMICS.smokePersistence,
  fireEmberAmount: DEFAULT_FIRE_AOE_DYNAMICS.emberAmount,
  fireEmberPersistence: DEFAULT_FIRE_AOE_DYNAMICS.emberPersistence,
  previewMinions: 3,
  opponentCaster: false,
  enemyBoard: true,
  friendlyBoard: false,
  enemyHero: false,
  friendlyHero: false,
  showTargetGuides: false
}

export function settingsFromTemplate(
  template: VfxTemplate,
  showTargetGuides = false
): VfxLabSettings {
  const settings: VfxLabSettings = {
    ...DEFAULT_VFX_LAB_SETTINGS,
    ...template.tuning,
    showTargetGuides
  }
  if (template.family === 'missile') {
    settings.missileOriginalColors = template.tuning.useOriginalColors ?? true
    settings.missileOriginalColorsAuthored =
      template.tuning.useOriginalColors !== undefined
    settings.edgeColor = template.tuning.edgeColor ?? template.tuning.flameColor
    settings.headSurfaceColor = template.tuning.headSurfaceColor ?? settings.edgeColor
    settings.foldColor = template.tuning.foldColor ?? settings.edgeColor
    settings.glowColor = template.tuning.glowColor ?? template.tuning.flameColor
    settings.sootColor = template.tuning.sootColor ?? DEFAULT_VFX_LAB_SETTINGS.sootColor
  }
  if (template.family === 'aoe') {
    const fire = template.tuning.fire
    settings.fireDensity = fire.density
    settings.fireParticleScale = fire.particleScale
    settings.fireMotion = fire.motion
    settings.fireRampIntensity = fire.rampIntensity
    settings.fireGlow = fire.glow
    settings.fireTimingScale = fire.timingScale
    settings.fireMinionImpacts = fire.minionImpacts ?? false
    settings.fireMinionImpactsAuthored = fire.minionImpacts !== undefined
    const appearance = fire.appearance
    settings.fireAppearanceAuthored = appearance !== undefined
    settings.firePalette = appearance?.palette ? 'custom' : 'original'
    if (appearance?.palette) {
      settings.fireEdgeColor = appearance.palette.edge
      settings.fireFlameColor = appearance.palette.flame
      settings.fireCoreColor = appearance.palette.core
    }
    settings.fireGlowOverride = appearance?.glowColor !== undefined
    settings.fireGlowColor =
      appearance?.glowColor ??
      appearance?.palette?.flame ??
      DEFAULT_VFX_LAB_SETTINGS.fireGlowColor
    settings.fireEmberOverride = appearance?.emberColor !== undefined
    settings.fireEmberColor =
      appearance?.emberColor ??
      appearance?.palette?.flame ??
      DEFAULT_VFX_LAB_SETTINGS.fireEmberColor
    settings.fireImpactOverride = appearance?.impactColor !== undefined
    settings.fireImpactColor =
      appearance?.impactColor ??
      appearance?.palette?.flame ??
      DEFAULT_VFX_LAB_SETTINGS.fireImpactColor
    settings.fireSmokeOverride = appearance?.smokeColor !== undefined
    settings.fireSmokeColor =
      appearance?.smokeColor ?? DEFAULT_VFX_LAB_SETTINGS.fireSmokeColor
    settings.fireSmokeOpacity = appearance?.smokeOpacity ?? 1
    settings.fireSmokeOpacityAuthored = appearance?.smokeOpacity !== undefined
    const dynamics = fire.dynamics ?? DEFAULT_FIRE_AOE_DYNAMICS
    settings.fireDynamicsAuthored = fire.dynamics !== undefined
    settings.fireTurbulence = dynamics.turbulence
    settings.fireSmokeAmount = dynamics.smokeAmount
    settings.fireSmokePersistence = dynamics.smokePersistence
    settings.fireEmberAmount = dynamics.emberAmount
    settings.fireEmberPersistence = dynamics.emberPersistence
    settings.aoeImpactMs = template.tuning.impactMs
    for (const zone of AOE_ZONES) settings[zone.key] = template.zones.includes(zone.key)
  }
  return settings
}

export function templateFromSettings(
  template: VfxTemplate,
  settings: VfxLabSettings
): VfxTemplate {
  return createTemplateFromSettings(
    template.id,
    template.name,
    template.family,
    settings
  )
}

export function createTemplateFromSettings(
  id: string,
  name: string,
  family: VfxEffectId,
  settings: VfxLabSettings
): VfxTemplate {
  const common = {
    flameColor: settings.flameColor,
    coreColor: settings.coreColor,
    intensity: settings.intensity,
    noiseScale: settings.noiseScale,
    flowSpeed: settings.flowSpeed,
    turbulence: settings.turbulence,
    durationMs: settings.durationMs
  }
  if (family === 'missile')
    return {
      id,
      name,
      family,
      tuning: {
        ...common,
        headSurfaceColor: settings.headSurfaceColor,
        edgeColor: settings.edgeColor,
        foldColor: settings.foldColor,
        glowColor: settings.glowColor,
        sootColor: settings.sootColor,
        missileGlow: settings.missileGlow,
        ...(settings.missileOriginalColorsAuthored || !settings.missileOriginalColors
          ? { useOriginalColors: settings.missileOriginalColors }
          : {}),
        headStartSize: settings.headStartSize,
        headEndSize: settings.headEndSize,
        headGrowthMs: settings.headGrowthMs,
        missileLength: settings.missileLength,
        missileWidth: settings.missileWidth
      }
    }
  const appearance = {
    ...(settings.firePalette === 'custom'
      ? {
          palette: {
            edge: settings.fireEdgeColor,
            flame: settings.fireFlameColor,
            core: settings.fireCoreColor
          }
        }
      : {}),
    ...(settings.fireGlowOverride ? { glowColor: settings.fireGlowColor } : {}),
    ...(settings.fireEmberOverride ? { emberColor: settings.fireEmberColor } : {}),
    ...(settings.fireImpactOverride ? { impactColor: settings.fireImpactColor } : {}),
    ...(settings.fireSmokeOverride ? { smokeColor: settings.fireSmokeColor } : {}),
    ...(settings.fireSmokeOpacityAuthored || settings.fireSmokeOpacity !== 1
      ? { smokeOpacity: settings.fireSmokeOpacity }
      : {})
  }
  const dynamics = {
    turbulence: settings.fireTurbulence,
    smokeAmount: settings.fireSmokeAmount,
    smokePersistence: settings.fireSmokePersistence,
    emberAmount: settings.fireEmberAmount,
    emberPersistence: settings.fireEmberPersistence
  }
  const hasDynamics =
    settings.fireDynamicsAuthored ||
    Object.entries(dynamics).some(
      ([key, value]) =>
        value !== DEFAULT_FIRE_AOE_DYNAMICS[key as keyof typeof dynamics]
    )
  return {
    id,
    name,
    family,
    zones: AOE_ZONES.filter(({ key }) => settings[key]).map(({ key }) => key),
    tuning: {
      intensity: settings.intensity,
      fire: {
        density: settings.fireDensity,
        particleScale: settings.fireParticleScale,
        motion: settings.fireMotion,
        rampIntensity: settings.fireRampIntensity,
        glow: settings.fireGlow,
        timingScale: settings.fireTimingScale,
        ...(settings.fireMinionImpactsAuthored || settings.fireMinionImpacts
          ? { minionImpacts: settings.fireMinionImpacts }
          : {}),
        ...(settings.fireAppearanceAuthored || Object.keys(appearance).length
          ? { appearance }
          : {}),
        ...(hasDynamics ? { dynamics } : {})
      },
      ...(settings.aoeImpactMs !== undefined ? { impactMs: settings.aoeImpactMs } : {})
    }
  }
}
