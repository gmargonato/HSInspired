import druidImage from '@assets/images/heroes/original-art-heropower/shapeshift.png'
import druidUpgradedImage from '@assets/images/heroes/original-art-heropower/dire-shapeshift.png'
import hunterImage from '@assets/images/heroes/original-art-heropower/steady-shot.png'
import dinomancyImage from '@assets/images/heroes/original-art-heropower/dinomancy.png'
import hunterUpgradedImage from '@assets/images/heroes/original-art-heropower/ballista-shot.png'
import jaraxxusImage from '@assets/images/heroes/original-art-heropower/inferno.png'
import ragnarosImage from '@assets/images/heroes/original-art-heropower/die-insect.png'
import mageImage from '@assets/images/heroes/original-art-heropower/fireblast.png'
import mageUpgradedImage from '@assets/images/heroes/original-art-heropower/fireblast-rank-2.png'
import paladinImage from '@assets/images/heroes/original-art-heropower/recruit.png'
import paladinTidalHandImage from '@assets/images/heroes/original-art-heropower/the_tidal_hand.png'
import paladinUpgradedImage from '@assets/images/heroes/original-art-heropower/the-silver-hand.png'
import priestImage from '@assets/images/heroes/original-art-heropower/lesser_heal.png'
import mindSpikeImage from '@assets/images/heroes/original-art-heropower/mind-spike.png'
import mindShatterImage from '@assets/images/heroes/original-art-heropower/mind-shatter.png'
import priestUpgradedImage from '@assets/images/heroes/original-art-heropower/heall.png'
import rogueImage from '@assets/images/heroes/original-art-heropower/dagger-mastery.png'
import rogueUpgradedImage from '@assets/images/heroes/original-art-heropower/poisoned-daggers.png'
import shamanImage from '@assets/images/heroes/original-art-heropower/totemic-call.png'
import shamanUpgradedImage from '@assets/images/heroes/original-art-heropower/totemic-slam.png'
import warlockImage from '@assets/images/heroes/original-art-heropower/life-tap.png'
import warlockUpgradedImage from '@assets/images/heroes/original-art-heropower/soul-tap.png'
import warriorImage from '@assets/images/heroes/original-art-heropower/armor-up.png'
import warriorUpgradedImage from '@assets/images/heroes/original-art-heropower/tank-up.png'
import deathsShadowImage from '@assets/images/heroes/original-art-heropower/deaths-shadow.png'
import plagueLordImage from '@assets/images/heroes/original-art-heropower/plague-lord.png'
import buildABeastImage from '@assets/images/heroes/original-art-heropower/build-a-beast.png'
import bladestormImage from '@assets/images/heroes/original-art-heropower/bladestorm.png'
import icyTouchImage from '@assets/images/heroes/original-art-heropower/icy-touch.png'
import fourHorsemenImage from '@assets/images/heroes/original-art-heropower/the-four-horsemen.png'
import voidformImage from '@assets/images/heroes/original-art-heropower/voidform.png'
import transmuteSpiritImage from '@assets/images/heroes/original-art-heropower/transmute-spirit.png'
import siphonLifeImage from '@assets/images/heroes/original-art-heropower/siphon-life.png'
import ossirianTearImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_ossirian_tear.png'
import pharaohsWarmaskImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_pharaohs_warmask.png'
import ascendantScrollImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_ascendant_scroll.png'
import emperorWrapsImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_emperor_wraps.png'
import obelisksEyeImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_obelisks_eye.png'
import ancientBladesImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_ancient_blades.png'
import heartOfVirnaalImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_heart_of_virnaal.png'
import tomeOfOriginationImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_tome_of_origination.png'
import anraphetsCoreImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_anraphets_core.png'
import wayOfTheShellImage from '@assets/images/heroes/original-art-heropower/way-of-the-shell.png'
import lightningJoltImage from '@assets/images/heroes/original-art-heropower/lightning-jolt.png'
import type { HeroPowerAssetKey } from './hero-power-asset-keys'

export { HERO_POWER_ASSET_KEYS, type HeroPowerAssetKey } from './hero-power-asset-keys'

/** Native square dimensions of the extracted standard portraits. */
export function heroPowerArtworkSize(key: HeroPowerAssetKey): number {
  switch (key) {
    case 'hero-power-placeholder':
      return 500
    case 'hero-power-deaths-shadow':
    case 'hero-power-build-a-beast':
    case 'hero-power-bladestorm':
    case 'hero-power-icy-touch':
    case 'hero-power-the-four-horsemen':
    case 'hero-power-voidform':
    case 'hero-power-transmute-spirit':
    case 'hero-power-siphon-life':
      return 256
    default:
      return 512
  }
}

/**
 * Renderer-side texture keys for raw hero-power artwork. Each key matches
 * the `presentationAssetKey` of the matching `HeroPowerDefinition`, so the
 * game content catalog drives the lookup without renderer-side logic.
 */
export const HERO_POWER_ASSET_SOURCES: Record<HeroPowerAssetKey, string> = {
  // The regular icon/card frames remain in place over the missing-art gray.
  'hero-power-placeholder': `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#535b65"/></svg>'
  )}`,
  'hero-power-druid': druidImage,
  'hero-power-hunter': hunterImage,
  'hero-power-dinomancy': dinomancyImage,
  'hero-power-mage': mageImage,
  'hero-power-paladin': paladinImage,
  'hero-power-paladin-tidal-hand': paladinTidalHandImage,
  'hero-power-priest': priestImage,
  'hero-power-mind-spike': mindSpikeImage,
  'hero-power-mind-shatter': mindShatterImage,
  'hero-power-rogue': rogueImage,
  'hero-power-shaman': shamanImage,
  'hero-power-lightning-jolt': lightningJoltImage,
  'hero-power-warlock': warlockImage,
  'hero-power-warrior': warriorImage,
  'hero-power-deaths-shadow': deathsShadowImage,
  'hero-power-plague-lord': plagueLordImage,
  'hero-power-build-a-beast': buildABeastImage,
  'hero-power-bladestorm': bladestormImage,
  'hero-power-icy-touch': icyTouchImage,
  'hero-power-the-four-horsemen': fourHorsemenImage,
  'hero-power-voidform': voidformImage,
  'hero-power-transmute-spirit': transmuteSpiritImage,
  'hero-power-siphon-life': siphonLifeImage,
  'hero-power-ossirian-tear': ossirianTearImage,
  'hero-power-pharaohs-warmask': pharaohsWarmaskImage,
  'hero-power-ascendant-scroll': ascendantScrollImage,
  'hero-power-emperor-wraps': emperorWrapsImage,
  'hero-power-obelisks-eye': obelisksEyeImage,
  'hero-power-ancient-blades': ancientBladesImage,
  'hero-power-heart-of-virnaal': heartOfVirnaalImage,
  'hero-power-tome-of-origination': tomeOfOriginationImage,
  'hero-power-anraphets-core': anraphetsCoreImage,
  'hero-power-way-of-the-shell': wayOfTheShellImage,
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
