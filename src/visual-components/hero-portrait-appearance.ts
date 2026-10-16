import type { PlayerStatsStore } from '../application/contracts/player-stats-store'
import { HERO_CATALOG } from '../game-rules/content/heroes'

/** A class unlocks on its 500th win. */
export function hasPremiumHeroPortrait(
  stats: Pick<PlayerStatsStore, 'getWins'> | undefined,
  heroId: string,
  isLocal: boolean = true
): boolean {
  if (!isLocal) return false
  const hero = HERO_CATALOG.get(heroId)
  return !!hero && (stats?.getWins(hero.classId) ?? 0) >= 500
}
