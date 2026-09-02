import druidImage from '@assets/images/heroes/original-art-heropower/shapeshift.png'
import hunterImage from '@assets/images/heroes/original-art-heropower/steady-shot.png'
import jaraxxusImage from '@assets/images/heroes/original-art-heropower/inferno.png'
import ragnarosImage from '@assets/images/heroes/original-art-heropower/die-insect.png'
import mageImage from '@assets/images/heroes/original-art-heropower/fireblast.png'
import paladinImage from '@assets/images/heroes/original-art-heropower/recruit.png'
import priestImage from '@assets/images/heroes/original-art-heropower/lesser_heal.png'
import rogueImage from '@assets/images/heroes/original-art-heropower/dagger-mastery.png'
import shamanImage from '@assets/images/heroes/original-art-heropower/totemic-call.png'
import warlockImage from '@assets/images/heroes/original-art-heropower/life-tap.png'
import warriorImage from '@assets/images/heroes/original-art-heropower/armor-up.png'

/**
 * Renderer-side texture keys for raw hero-power artwork. Each key matches
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
  | 'hero-power-jaraxxus'
  | 'hero-power-ragnaros'

export const HERO_POWER_ASSET_SOURCES: Record<HeroPowerAssetKey, string> = {
  'hero-power-druid': druidImage,
  'hero-power-hunter': hunterImage,
  'hero-power-mage': mageImage,
  'hero-power-paladin': paladinImage,
  'hero-power-priest': priestImage,
  'hero-power-rogue': rogueImage,
  'hero-power-shaman': shamanImage,
  'hero-power-warlock': warlockImage,
  'hero-power-warrior': warriorImage,
  'hero-power-jaraxxus': jaraxxusImage,
  'hero-power-ragnaros': ragnarosImage
}
