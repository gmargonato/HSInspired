import anduinFrameImage from '@assets/images/heroes/frames/priest-anduin-frame.png'
import garroshFrameImage from '@assets/images/heroes/frames/warrior-garrosh-frame.png'
import guldanFrameImage from '@assets/images/heroes/frames/warlock-guldan-frame.png'
import jainaFrameImage from '@assets/images/heroes/frames/mage-jaina-frame.png'
import jaraxxusFrameImage from '@assets/images/heroes/frames/warlock-jaraxxus-frame.png'
import ragnarosFrameImage from '@assets/images/heroes/frames/warrior-ragnaros-frame.png'
import malfurionFrameImage from '@assets/images/heroes/frames/druid-malfurion-frame.png'
import rexxarFrameImage from '@assets/images/heroes/frames/hunter-rexxar-frame.png'
import thrallFrameImage from '@assets/images/heroes/frames/shaman-thrall-frame.png'
import utherFrameImage from '@assets/images/heroes/frames/paladin-uther-frame.png'
import valeeraFrameImage from '@assets/images/heroes/frames/rogue-valeera-frame.png'
import malfurionPestilentFrameImage from '@assets/images/heroes/frames/druid-malfurion-pestilent-frame.png'
import rexxarDeathstalkerFrameImage from '@assets/images/heroes/frames/hunter-rexxar-deathstalker-frame.png'
import jainaFrostLichFrameImage from '@assets/images/heroes/frames/mage-jaina-frost-lich-frame.png'
import utherEbonBladeFrameImage from '@assets/images/heroes/frames/paladin-uther-ebon-blade-frame.png'
import anduinShadowreaperFrameImage from '@assets/images/heroes/frames/priest-anduin-shadowreaper-frame.png'
import valeeraHollowFrameImage from '@assets/images/heroes/frames/rogue-valeera-hollow-frame.png'
import thrallDeathseerFrameImage from '@assets/images/heroes/frames/shaman-thrall-deathseer-frame.png'
import guldanBloodreaverFrameImage from '@assets/images/heroes/frames/warlock-guldan-bloodreaver-frame.png'
import garroshScourgelordFrameImage from '@assets/images/heroes/frames/warrior-garrosh-scourgelord-frame.png'
import type { HeroPresentationAssetKey } from '../../game-rules/content/heroes'

export const HERO_ASSET_SOURCES: Record<HeroPresentationAssetKey, string> = {
  'hero-guldan': guldanFrameImage,
  'hero-rexxar': rexxarFrameImage,
  'hero-valeera': valeeraFrameImage,
  'hero-garrosh': garroshFrameImage,
  'hero-malfurion': malfurionFrameImage,
  'hero-uther': utherFrameImage,
  'hero-anduin': anduinFrameImage,
  'hero-jaina': jainaFrameImage,
  'hero-thrall': thrallFrameImage,
  'hero-jaraxxus': jaraxxusFrameImage,
  'hero-ragnaros': ragnarosFrameImage,
  'hero-malfurion-pestilent': malfurionPestilentFrameImage,
  'hero-rexxar-deathstalker': rexxarDeathstalkerFrameImage,
  'hero-jaina-frost-lich': jainaFrostLichFrameImage,
  'hero-uther-ebon-blade': utherEbonBladeFrameImage,
  'hero-anduin-shadowreaper': anduinShadowreaperFrameImage,
  'hero-valeera-hollow': valeeraHollowFrameImage,
  'hero-thrall-deathseer': thrallDeathseerFrameImage,
  'hero-guldan-bloodreaver': guldanBloodreaverFrameImage,
  'hero-garrosh-scourgelord': garroshScourgelordFrameImage
}

export type HeroAssetKey = HeroPresentationAssetKey
