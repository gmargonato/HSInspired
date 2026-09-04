import type { HeroId } from '../../../game/content/cards'

export type DeckPortraitAssetKey =
  | 'anduinDeckPortrait'
  | 'garroshDeckPortrait'
  | 'guldanDeckPortrait'
  | 'jainaDeckPortrait'
  | 'malfurionDeckPortrait'
  | 'rexxarDeckPortrait'
  | 'thrallDeckPortrait'
  | 'utherDeckPortrait'
  | 'valeeraDeckPortrait'

const DECK_PORTRAIT_ASSET_KEYS: Readonly<Record<string, DeckPortraitAssetKey>> = {
  anduin: 'anduinDeckPortrait',
  garrosh: 'garroshDeckPortrait',
  guldan: 'guldanDeckPortrait',
  jaina: 'jainaDeckPortrait',
  malfurion: 'malfurionDeckPortrait',
  rexxar: 'rexxarDeckPortrait',
  thrall: 'thrallDeckPortrait',
  uther: 'utherDeckPortrait',
  valeera: 'valeeraDeckPortrait'
}

const DECK_PORTRAIT_Y_OFFSETS: Readonly<Record<string, number>> = {
  anduin: 30,
  garrosh: 30,
  jaina: 40,
  rexxar: 40,
  uther: 40,
  thrall: 35,
  malfurion: 20
}

/** Resolves the original-art portrait available for a selectable deck hero. */
export function getDeckPortraitAssetKey(
  heroId: HeroId
): DeckPortraitAssetKey | undefined {
  return DECK_PORTRAIT_ASSET_KEYS[heroId]
}

/** Optional portrait adjustment for art that needs a lower crop. */
export function getDeckPortraitYOffset(heroId: HeroId): number | undefined {
  return DECK_PORTRAIT_Y_OFFSETS[heroId]
}
