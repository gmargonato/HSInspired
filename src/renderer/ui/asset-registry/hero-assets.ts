import anduinFrameImage from '@assets/images/heroes/frames/priest-anduin-frame.png'
import garroshFrameImage from '@assets/images/heroes/frames/warrior-garrosh-frame.png'
import guldanFrameImage from '@assets/images/heroes/frames/warlock-guldan-frame.png'
import jainaFrameImage from '@assets/images/heroes/frames/mage-jaina-frame.png'
import malfurionFrameImage from '@assets/images/heroes/frames/druid-malfurion-frame.png'
import rexxarFrameImage from '@assets/images/heroes/frames/hunter-rexxar-frame.png'
import thrallFrameImage from '@assets/images/heroes/frames/shaman-thrall-frame.png'
import utherFrameImage from '@assets/images/heroes/frames/paladin-uther-frame.png'
import valeeraFrameImage from '@assets/images/heroes/frames/rogue-valeera-frame.png'
import type { HeroPresentationAssetKey } from '../../../game/content/heroes'

export const HERO_ASSET_SOURCES: Record<HeroPresentationAssetKey, string> = {
  'hero-guldan': guldanFrameImage,
  'hero-rexxar': rexxarFrameImage,
  'hero-valeera': valeeraFrameImage,
  'hero-garrosh': garroshFrameImage,
  'hero-malfurion': malfurionFrameImage,
  'hero-uther': utherFrameImage,
  'hero-anduin': anduinFrameImage,
  'hero-jaina': jainaFrameImage,
  'hero-thrall': thrallFrameImage
}

export type HeroAssetKey = HeroPresentationAssetKey
