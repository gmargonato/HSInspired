import type { ConstructedRankSnapshot } from '../../../shared/ipc/player-stats'
import { RANK_MEDAL_ASSET_KEYS, type DeckSelectionAssets } from './index'

export type RankMedalAssetKey = (typeof RANK_MEDAL_ASSET_KEYS)[number]

const MEDAL_KEYS_BY_RANK: Readonly<Record<number, RankMedalAssetKey>> =
  Object.fromEntries(
    RANK_MEDAL_ASSET_KEYS.filter(
      (key): key is Exclude<RankMedalAssetKey, 'rankLegend'> => key !== 'rankLegend'
    ).map((key, index) => [index + 1, key])
  )

/**
 * Vertical nudge (design pixels) applied to the Legend medal. The hexagonal
 * socket seats both medal shapes centered, so this stays at 0 unless tuning
 * proves otherwise.
 */
export const LEGEND_MEDAL_Y_OFFSET = 0

/** Resolves the deck-selection medal texture key for the player's ladder state. */
export function getRankMedalAssetKey(rank: ConstructedRankSnapshot): RankMedalAssetKey {
  return rank.tier === 'legend'
    ? 'rankLegend'
    : (MEDAL_KEYS_BY_RANK[rank.rank] ?? 'rankMedal25')
}

export function getRankMedalTexture(
  assets: DeckSelectionAssets,
  rank: ConstructedRankSnapshot
): DeckSelectionAssets[RankMedalAssetKey] {
  return assets[getRankMedalAssetKey(rank)]
}
