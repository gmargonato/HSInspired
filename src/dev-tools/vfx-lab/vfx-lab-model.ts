import type { VfxAoeZone } from '../../desktop/contracts/ipc/vfx-templates'
import type { VfxTemplate } from '../../desktop/contracts/ipc/vfx-templates'

export type VfxEffectId = 'missile' | 'aoe'
export type AoeShape = 'radial' | 'wide'

export const AOE_ZONES = [
  { key: 'enemyBoard', label: 'Enemy board' },
  { key: 'friendlyBoard', label: 'Friendly board' },
  { key: 'enemyHero', label: 'Enemy hero' },
  { key: 'friendlyHero', label: 'Friendly hero' }
] as const
export type AoeZoneId = VfxAoeZone
export type AoePreviewAreaId = AoeZoneId | 'bothBoards'

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
  headStartSize: number
  headEndSize: number
  headGrowthMs: number
  missileLength: number
  missileWidth: number
  aoeRedColorAuthored?: boolean
  aoeSootColorAuthored?: boolean
  aoeImpactMs?: number
  aoeRadius: number
  aoeEdgeSoftness: number
  aoeShape: AoeShape
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
  intensity: 1.7,
  noiseScale: 2.8,
  flowSpeed: 1.2,
  turbulence: 0.85,
  durationMs: 1800,
  headSurfaceColor: '#d90c00',
  edgeColor: '#ff6500',
  foldColor: '#d84a08',
  glowColor: '#ffb02e',
  sootColor: '#1f130b',
  missileGlow: 0.8,
  headStartSize: 28,
  headEndSize: 116,
  headGrowthMs: 350,
  missileLength: VFX_DEFAULT_MISSILE_LENGTH,
  missileWidth: 0.32,
  aoeRadius: 0.92,
  aoeEdgeSoftness: 0.055,
  aoeShape: 'wide',
  enemyBoard: true,
  friendlyBoard: false,
  enemyHero: false,
  friendlyHero: false,
  showTargetGuides: false
}

/** Adjacent board rows share one blast; heroes remain separately targetable. */
export function getAoePreviewAreas(
  settings: VfxLabSettings
): readonly AoePreviewAreaId[] {
  const areas: AoePreviewAreaId[] = []
  if (settings.enemyBoard && settings.friendlyBoard) areas.push('bothBoards')
  else if (settings.enemyBoard) areas.push('enemyBoard')
  else if (settings.friendlyBoard) areas.push('friendlyBoard')
  if (settings.enemyHero) areas.push('enemyHero')
  if (settings.friendlyHero) areas.push('friendlyHero')
  return areas
}

export function settingsFromTemplate(
  template: VfxTemplate,
  showTargetGuides = false
): VfxLabSettings {
  const settings = {
    ...DEFAULT_VFX_LAB_SETTINGS,
    ...template.tuning,
    showTargetGuides
  }
  if (template.family === 'missile') {
    settings.edgeColor = template.tuning.edgeColor ?? template.tuning.flameColor
    settings.headSurfaceColor = template.tuning.headSurfaceColor ?? settings.edgeColor
    settings.foldColor = template.tuning.foldColor ?? settings.edgeColor
    settings.glowColor = template.tuning.glowColor ?? template.tuning.flameColor
    settings.sootColor = template.tuning.sootColor ?? DEFAULT_VFX_LAB_SETTINGS.sootColor
  }
  if (template.family === 'aoe') {
    settings.aoeImpactMs = template.tuning.impactMs
    settings.edgeColor = template.tuning.redColor ?? template.tuning.flameColor
    settings.aoeRedColorAuthored = template.tuning.redColor !== undefined
    settings.aoeSootColorAuthored = template.tuning.sootColor !== undefined
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
        headStartSize: settings.headStartSize,
        headEndSize: settings.headEndSize,
        headGrowthMs: settings.headGrowthMs,
        missileLength: settings.missileLength,
        missileWidth: settings.missileWidth
      }
    }
  return {
    id,
    name,
    family,
    zones: AOE_ZONES.filter(({ key }) => settings[key]).map(({ key }) => key),
    tuning: {
      ...common,
      ...(settings.aoeSootColorAuthored ||
      settings.sootColor !== DEFAULT_VFX_LAB_SETTINGS.sootColor
        ? { sootColor: settings.sootColor }
        : {}),
      ...(settings.aoeImpactMs !== undefined
        ? { impactMs: Math.min(settings.aoeImpactMs, settings.durationMs) }
        : {}),
      ...(settings.aoeRedColorAuthored || settings.edgeColor !== settings.flameColor
        ? { redColor: settings.edgeColor }
        : {}),
      aoeRadius: settings.aoeRadius,
      aoeEdgeSoftness: settings.aoeEdgeSoftness,
      aoeShape: settings.aoeShape
    }
  }
}
