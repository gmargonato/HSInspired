import { CARD_CATALOG, type CardKeyword } from '../../content/cards'
import type {
  BoardWeapon,
  OpeningMatchState,
  OpeningPlayerState
} from '../opening-match-types'

/** Shared with combat recalculation; hero keywords already include active hero effects. */
export function effectiveHeroCombatKeywords(
  heroKeywords: Iterable<CardKeyword>,
  weapon: BoardWeapon | null | undefined,
  turnNumber: number,
  sourceIsInPlay: (instanceId: string) => boolean
): Set<CardKeyword> {
  const keywords = new Set(heroKeywords)
  if (!weapon) return keywords
  const definition = CARD_CATALOG.get(weapon.cardId)
  if (definition?.type === 'Weapon') {
    for (const keyword of definition.keywords) keywords.add(keyword)
  }
  for (const enchantment of weapon.enchantments ?? []) {
    if (
      (enchantment.expiresOnTurn !== undefined &&
        enchantment.expiresOnTurn < turnNumber) ||
      (enchantment.startsOnTurn !== undefined &&
        enchantment.startsOnTurn > turnNumber) ||
      enchantment.continuous ||
      (enchantment.duration === 'while-source-in-play' &&
        !sourceIsInPlay(enchantment.sourceInstanceId))
    )
      continue
    for (const keyword of enchantment.keywords ?? []) keywords.add(keyword)
    for (const keyword of enchantment.removedKeywords ?? []) keywords.delete(keyword)
  }
  return keywords
}

export function heroHasWindfury(
  state: OpeningMatchState,
  player: OpeningPlayerState
): boolean {
  const keywords = effectiveHeroCombatKeywords(
    player.hero.keywords ?? [],
    player.weapon,
    state.turnNumber,
    (id) =>
      state.players.some(
        (owner) =>
          id === `${owner.participantId}:hero` ||
          id === `${owner.participantId}:hero-power` ||
          owner.weapon?.instanceId === id ||
          owner.board.some((minion) => minion.instanceId === id) ||
          (owner.secrets ?? []).some((secret) => secret.instanceId === id)
      )
  )
  return keywords.has('windfury') || keywords.has('mega-windfury')
}
