export type VfxEffectId = 'missile' | 'aoe'
export type AoeShape = 'radial' | 'wide'

export const AOE_ZONES = [
  { key: 'enemyBoard', label: 'Enemy board' },
  { key: 'friendlyBoard', label: 'Friendly board' },
  { key: 'enemyHero', label: 'Enemy hero' },
  { key: 'friendlyHero', label: 'Friendly hero' }
] as const
export type AoeZoneId = (typeof AOE_ZONES)[number]['key']
export type AoePreviewAreaId = AoeZoneId | 'bothBoards'

/** Saturated orange body and yellow heat from the supplied explosion references. */
export const AOE_REFERENCE_SETTINGS = {
  flameColor: '#ff5900',
  coreColor: '#ffe600',
  intensity: 1.65,
  noiseScale: 2.6,
  flowSpeed: 0.85,
  turbulence: 0.85,
  durationMs: 1250,
  aoeRadius: 0.98,
  aoeEdgeSoftness: 0.1,
  aoeShape: 'wide'
} as const

export const AOE_TARGET_PRESETS = {
  flamestrike: {
    label: 'Flamestrike — enemy board',
    zones: ['enemyBoard'],
    reference: true
  },
  doomsayer: {
    label: 'Doomsayer — both boards',
    zones: ['enemyBoard', 'friendlyBoard'],
    reference: true
  },
  'baron-geddon': {
    label: 'Baron Geddon — boards + heroes',
    zones: ['enemyBoard', 'friendlyBoard', 'enemyHero', 'friendlyHero'],
    reference: true
  },
  'enemy-board': { label: 'Enemy board only', zones: ['enemyBoard'] },
  'friendly-board': { label: 'Friendly board only', zones: ['friendlyBoard'] },
  'both-boards': { label: 'Both boards', zones: ['enemyBoard', 'friendlyBoard'] },
  'enemy-side': { label: 'Enemy board + hero', zones: ['enemyBoard', 'enemyHero'] },
  'friendly-side': {
    label: 'Friendly board + hero',
    zones: ['friendlyBoard', 'friendlyHero']
  },
  'all-zones': {
    label: 'All zones',
    zones: ['enemyBoard', 'friendlyBoard', 'enemyHero', 'friendlyHero']
  }
} as const satisfies Record<
  string,
  { label: string; zones: readonly AoeZoneId[]; reference?: boolean }
>
export type AoeTargetPreset = keyof typeof AOE_TARGET_PRESETS | 'custom'

export interface VfxLabSettings {
  flameColor: string
  coreColor: string
  intensity: number
  noiseScale: number
  flowSpeed: number
  turbulence: number
  durationMs: number
  missileLength: number
  missileWidth: number
  aoeRadius: number
  aoeEdgeSoftness: number
  aoeShape: AoeShape
  aoeTarget: AoeTargetPreset
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
  missileLength: VFX_DEFAULT_MISSILE_LENGTH,
  missileWidth: 0.32,
  aoeRadius: 0.92,
  aoeEdgeSoftness: 0.055,
  aoeShape: 'wide',
  aoeTarget: 'enemy-board',
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
