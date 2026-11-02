import type { Texture } from 'pixi.js'
import { asset } from './asset-definition'
import { ASSET_BUNDLE_IDS } from './asset-bundle-ids'
import texture0 from '@assets/images/effects/heal-rays.png'
import texture1 from '@assets/images/effects/heal-mass-wave.png'
import texture2 from '@assets/images/effects/heal-glow.png'
import texture3 from '@assets/images/effects/heal-star.png'
import texture4 from '@assets/images/effects/heal-beam.png'
import texture5 from '@assets/images/effects/heal-missile-head.png'
import texture6 from '@assets/images/effects/heal-mote.png'
import texture7 from '@assets/images/effects/heal-ribbon.png'
import texture8 from '@assets/images/effects/heal-ribbon-clouds.png'
import texture9 from '@assets/images/effects/heal-ribbon-wisp.png'
import texture10 from '@assets/images/effects/heal-sparkle.png'
import texture11 from '@assets/images/effects/heal-bloom-clouds.png'
import texture12 from '@assets/images/effects/heal-bloom-wave.png'
import texture13 from '@assets/images/effects/heal-runes.png'
import texture14 from '@assets/images/effects/heal-rings.png'
import texture15 from '@assets/images/effects/heal-star-glow.png'
export const HEALING_ASSETS = [
  asset('effects.heal-rays', ASSET_BUNDLE_IDS.healingVfx, 'heal-rays', texture0, 256, 256, 'healing-vfx'),
  asset('effects.heal-mass-wave', ASSET_BUNDLE_IDS.healingVfx, 'heal-mass-wave', texture1, 256, 256, 'healing-vfx'),
  asset('effects.heal-glow', ASSET_BUNDLE_IDS.healingVfx, 'heal-glow', texture2, 128, 128, 'healing-vfx'),
  asset('effects.heal-star', ASSET_BUNDLE_IDS.healingVfx, 'heal-star', texture3, 512, 512, 'healing-vfx'),
  asset('effects.heal-beam', ASSET_BUNDLE_IDS.healingVfx, 'heal-beam', texture4, 256, 256, 'healing-vfx'),
  asset('effects.heal-missile-head', ASSET_BUNDLE_IDS.healingVfx, 'heal-missile-head', texture5, 512, 512, 'healing-vfx'),
  asset('effects.heal-mote', ASSET_BUNDLE_IDS.healingVfx, 'heal-mote', texture6, 256, 256, 'healing-vfx'),
  asset('effects.heal-ribbon', ASSET_BUNDLE_IDS.healingVfx, 'heal-ribbon', texture7, 128, 128, 'healing-vfx'),
  asset('effects.heal-ribbon-clouds', ASSET_BUNDLE_IDS.healingVfx, 'heal-ribbon-clouds', texture8, 256, 256, 'healing-vfx'),
  asset('effects.heal-ribbon-wisp', ASSET_BUNDLE_IDS.healingVfx, 'heal-ribbon-wisp', texture9, 256, 256, 'healing-vfx'),
  asset('effects.heal-sparkle', ASSET_BUNDLE_IDS.healingVfx, 'heal-sparkle', texture10, 256, 256, 'healing-vfx'),
  asset('effects.heal-bloom-clouds', ASSET_BUNDLE_IDS.healingVfx, 'heal-bloom-clouds', texture11, 512, 512, 'healing-vfx'),
  asset('effects.heal-bloom-wave', ASSET_BUNDLE_IDS.healingVfx, 'heal-bloom-wave', texture12, 256, 256, 'healing-vfx'),
  asset('effects.heal-runes', ASSET_BUNDLE_IDS.healingVfx, 'heal-runes', texture13, 256, 256, 'healing-vfx'),
  asset('effects.heal-rings', ASSET_BUNDLE_IDS.healingVfx, 'heal-rings', texture14, 256, 256, 'healing-vfx'),
  asset('effects.heal-star-glow', ASSET_BUNDLE_IDS.healingVfx, 'heal-star-glow', texture15, 128, 128, 'healing-vfx'),
] as const
export type HealingAssets = Record<(typeof HEALING_ASSETS)[number]["alias"], Texture>
