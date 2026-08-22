import druidImage from '@assets/images/heroes/hero-power/hero-power-druid.png'
import hunterImage from '@assets/images/heroes/hero-power/hero-power-hunter.png'
import mageImage from '@assets/images/heroes/hero-power/hero-power-mage.png'
import paladinImage from '@assets/images/heroes/hero-power/hero-power-paladin.png'
import priestImage from '@assets/images/heroes/hero-power/hero-power-priest.png'
import rogueImage from '@assets/images/heroes/hero-power/hero-power-rogue.png'
import shamanImage from '@assets/images/heroes/hero-power/hero-power-shaman.png'
import warlockImage from '@assets/images/heroes/hero-power/hero-power-warlock.png'
import warriorImage from '@assets/images/heroes/hero-power/hero-power-warrior.png'

/**
 * Renderer-side texture keys for the hero power "up" faces. Each key matches
 * the `presentationAssetKey` of the matching `HeroPowerDefinition`, so the
 * game content catalog drives the lookup without renderer-side logic.
 */
export type HeroPowerAssetKey =
  | 'hero-power-druid'
  | 'hero-power-hunter'
  | 'hero-power-mage'
  | 'hero-power-paladin'
  | 'hero-power-priest'
  | 'hero-power-rogue'
  | 'hero-power-shaman'
  | 'hero-power-warlock'
  | 'hero-power-warrior'

export const HERO_POWER_ASSET_SOURCES: Record<HeroPowerAssetKey, string> = {
  'hero-power-druid': druidImage,
  'hero-power-hunter': hunterImage,
  'hero-power-mage': mageImage,
  'hero-power-paladin': paladinImage,
  'hero-power-priest': priestImage,
  'hero-power-rogue': rogueImage,
  'hero-power-shaman': shamanImage,
  'hero-power-warlock': warlockImage,
  'hero-power-warrior': warriorImage
}
