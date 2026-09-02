import druidImage from '@assets/images/heroes/original-art-heropower/shapeshift.png'
import druidUpgradedImage from '@assets/images/heroes/original-art-heropower/dire-shapeshift.png'
import hunterImage from '@assets/images/heroes/original-art-heropower/steady-shot.png'
import hunterUpgradedImage from '@assets/images/heroes/original-art-heropower/ballista-shot.png'
import jaraxxusImage from '@assets/images/heroes/original-art-heropower/inferno.png'
import ragnarosImage from '@assets/images/heroes/original-art-heropower/die-insect.png'
import mageImage from '@assets/images/heroes/original-art-heropower/fireblast.png'
import mageUpgradedImage from '@assets/images/heroes/original-art-heropower/fireblast-rank-2.png'
import paladinImage from '@assets/images/heroes/original-art-heropower/recruit.png'
import paladinUpgradedImage from '@assets/images/heroes/original-art-heropower/the-silver-hand.png'
import priestImage from '@assets/images/heroes/original-art-heropower/lesser_heal.png'
import priestUpgradedImage from '@assets/images/heroes/original-art-heropower/heall.png'
import rogueImage from '@assets/images/heroes/original-art-heropower/dagger-mastery.png'
import rogueUpgradedImage from '@assets/images/heroes/original-art-heropower/poisoned-daggers.png'
import shamanImage from '@assets/images/heroes/original-art-heropower/totemic-call.png'
import shamanUpgradedImage from '@assets/images/heroes/original-art-heropower/totemic-slam.png'
import warlockImage from '@assets/images/heroes/original-art-heropower/life-tap.png'
import warlockUpgradedImage from '@assets/images/heroes/original-art-heropower/soul-tap.png'
import warriorImage from '@assets/images/heroes/original-art-heropower/armor-up.png'
import warriorUpgradedImage from '@assets/images/heroes/original-art-heropower/tank-up.png'
import type { HeroPowerAssetKey } from './hero-power-asset-keys'

export { HERO_POWER_ASSET_KEYS, type HeroPowerAssetKey } from './hero-power-asset-keys'

/**
 * Renderer-side texture keys for raw hero-power artwork. Each key matches
 * the `presentationAssetKey` of the matching `HeroPowerDefinition`, so the
 * game content catalog drives the lookup without renderer-side logic.
 */
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
  'hero-power-druid-upgraded': druidUpgradedImage,
  'hero-power-hunter-upgraded': hunterUpgradedImage,
  'hero-power-mage-upgraded': mageUpgradedImage,
  'hero-power-paladin-upgraded': paladinUpgradedImage,
  'hero-power-priest-upgraded': priestUpgradedImage,
  'hero-power-rogue-upgraded': rogueUpgradedImage,
  'hero-power-shaman-upgraded': shamanUpgradedImage,
  'hero-power-warlock-upgraded': warlockUpgradedImage,
  'hero-power-warrior-upgraded': warriorUpgradedImage,
  'hero-power-jaraxxus': jaraxxusImage,
  'hero-power-ragnaros': ragnarosImage
}
