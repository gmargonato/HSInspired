import anduinFrameImage from '@assets/images/portraits/PRIEST_ANDUIN_FRAME.png'
import garroshFrameImage from '@assets/images/portraits/WARRIOR_GARROSH_FRAME.png'
import guldanFrameImage from '@assets/images/portraits/WARLOCK_GULDAN_FRAME.png'
import jainaFrameImage from '@assets/images/portraits/MAGE_JAINA_FRAME.png'
import malfurionFrameImage from '@assets/images/portraits/DRUID_MALFURION_FRAME.png'
import rexxarFrameImage from '@assets/images/portraits/HUNTER_REXXAR_FRAME.png'
import thrallFrameImage from '@assets/images/portraits/SHAMAN_THRALL_FRAME.png'
import utherFrameImage from '@assets/images/portraits/PALADIN_UTHER_FRAME.png'
import valeeraFrameImage from '@assets/images/portraits/ROGUE_VALEERA_FRAME.png'
import type { DeckClass } from '../../../shared/decks'

export interface HeroDefinition {
  readonly id: string
  readonly name: string
  readonly heroClass: DeckClass
  readonly assetKey: string
  readonly image: string
}

/**
 * The complete hero roster. Add a hero here with its class and portrait asset;
 * the class-selection screen will use the same definition automatically.
 */
export const HERO_DEFINITIONS = [
  {
    id: 'guldan',
    name: "Gul'dan",
    heroClass: 'Warlock',
    assetKey: 'hero-guldan',
    image: guldanFrameImage
  },
  {
    id: 'rexxar',
    name: 'Rexxar',
    heroClass: 'Hunter',
    assetKey: 'hero-rexxar',
    image: rexxarFrameImage
  },
  {
    id: 'valeera',
    name: 'Valeera Sanguinar',
    heroClass: 'Rogue',
    assetKey: 'hero-valeera',
    image: valeeraFrameImage
  },
  {
    id: 'garrosh',
    name: 'Garrosh Hellscream',
    heroClass: 'Warrior',
    assetKey: 'hero-garrosh',
    image: garroshFrameImage
  },
  {
    id: 'malfurion',
    name: 'Malfurion Stormrage',
    heroClass: 'Druid',
    assetKey: 'hero-malfurion',
    image: malfurionFrameImage
  },
  {
    id: 'uther',
    name: 'Uther Lightbringer',
    heroClass: 'Paladin',
    assetKey: 'hero-uther',
    image: utherFrameImage
  },
  {
    id: 'anduin',
    name: 'Anduin Wrynn',
    heroClass: 'Priest',
    assetKey: 'hero-anduin',
    image: anduinFrameImage
  },
  {
    id: 'jaina',
    name: 'Jaina Proudmoore',
    heroClass: 'Mage',
    assetKey: 'hero-jaina',
    image: jainaFrameImage
  },
  {
    id: 'thrall',
    name: 'Thrall',
    heroClass: 'Shaman',
    assetKey: 'hero-thrall',
    image: thrallFrameImage
  }
] as const satisfies readonly HeroDefinition[]

export type HeroAssetKey = (typeof HERO_DEFINITIONS)[number]['assetKey']

export const HERO_ASSET_SOURCES = Object.fromEntries(
  HERO_DEFINITIONS.map((hero) => [hero.assetKey, hero.image])
) as Record<HeroAssetKey, string>

export function getHeroesForClass(heroClass: DeckClass): readonly HeroDefinition[] {
  return HERO_DEFINITIONS.filter((hero) => hero.heroClass === heroClass)
}

export function getPrimaryHeroForClass(
  heroClass: DeckClass
): HeroDefinition | undefined {
  return HERO_DEFINITIONS.find((hero) => hero.heroClass === heroClass)
}
