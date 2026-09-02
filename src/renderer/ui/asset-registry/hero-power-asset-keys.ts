export const HERO_POWER_ASSET_KEYS = [
  'hero-power-druid',
  'hero-power-hunter',
  'hero-power-mage',
  'hero-power-paladin',
  'hero-power-priest',
  'hero-power-rogue',
  'hero-power-shaman',
  'hero-power-warlock',
  'hero-power-warrior',
  'hero-power-druid-upgraded',
  'hero-power-hunter-upgraded',
  'hero-power-mage-upgraded',
  'hero-power-paladin-upgraded',
  'hero-power-priest-upgraded',
  'hero-power-rogue-upgraded',
  'hero-power-shaman-upgraded',
  'hero-power-warlock-upgraded',
  'hero-power-warrior-upgraded',
  'hero-power-jaraxxus',
  'hero-power-ragnaros'
] as const

export type HeroPowerAssetKey = (typeof HERO_POWER_ASSET_KEYS)[number]
