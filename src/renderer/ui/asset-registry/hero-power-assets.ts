import druidImage from '@assets/images/heroes/original-art-heropower/shapeshift.png'
import druidUpgradedImage from '@assets/images/heroes/original-art-heropower/dire-shapeshift.png'
import hunterImage from '@assets/images/heroes/original-art-heropower/steady-shot.png'
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
import buildABeastImage from '@assets/images/heroes/original-art-heropower/build-a-beast.jpg'
import bladestormImage from '@assets/images/heroes/original-art-heropower/bladestorm.jpg'
import icyTouchImage from '@assets/images/heroes/original-art-heropower/icy-touch.png'
import fourHorsemenImage from '@assets/images/heroes/original-art-heropower/the-four-horsemen.png'
import voidformImage from '@assets/images/heroes/original-art-heropower/voidform.png'
import transmuteSpiritImage from '@assets/images/heroes/original-art-heropower/transmute-spirit.png'
import siphonLifeImage from '@assets/images/heroes/original-art-heropower/siphon-life.png'
import ossirianTearImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_ossirian_tear.jpg'
import pharaohsWarmaskImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_pharaohs_warmask.jpg'
import ascendantScrollImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_ascendant_scroll.jpg'
import emperorWrapsImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_emperor_wraps.jpg'
import obelisksEyeImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_obelisks_eye.jpg'
import ancientBladesImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_ancient_blades.jpg'
import heartOfVirnaalImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_heart_of_virnaal.jpg'
import tomeOfOriginationImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_tome_of_origination.jpg'
import anraphetsCoreImage from '@assets/images/heroes/original-art-heropower/journey_to_ungoro_anraphets_core.jpg'
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
  'hero-power-paladin-tidal-hand': paladinTidalHandImage,
  'hero-power-priest': priestImage,
  'hero-power-mind-spike': mindSpikeImage,
  'hero-power-mind-shatter': mindShatterImage,
  'hero-power-rogue': rogueImage,
  'hero-power-shaman': shamanImage,
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
