import type { CardKeyword } from '../../content/cards'
import type { BoardMinion } from '../opening-match-types'

/** Keywords currently affecting a board minion after runtime enchantments. */
export function effectiveBoardMinionKeywords(
  minion: Pick<BoardMinion, 'keywords' | 'enchantments' | 'silenced'> &
    Partial<Pick<BoardMinion, 'health' | 'maxHealth'>>,
  currentTurn?: number
): readonly CardKeyword[] {
  const keywords = new Set<CardKeyword>(minion.silenced ? [] : (minion.keywords ?? []))
  for (const enchantment of minion.enchantments ?? []) {
    if (
      (enchantment.startsOnTurn !== undefined &&
        currentTurn !== undefined &&
        currentTurn < enchantment.startsOnTurn) ||
      (enchantment.expiresOnTurn !== undefined &&
        currentTurn !== undefined &&
        currentTurn > enchantment.expiresOnTurn) ||
      (enchantment.duration === 'while-damaged' &&
        minion.health !== undefined &&
        minion.maxHealth !== undefined &&
        minion.health >= minion.maxHealth)
    )
      continue
    for (const keyword of enchantment.keywords ?? []) keywords.add(keyword)
    for (const keyword of enchantment.removedKeywords ?? []) keywords.delete(keyword)
  }
  return [...keywords]
}

/** Number of attacks made during this global turn, ignoring stale cached counts. */
export function boardMinionAttacksUsed(
  minion: Pick<BoardMinion, 'attacksUsedThisTurn' | 'lastAttackedOnTurn'>,
  currentTurn: number
): number {
  if (minion.lastAttackedOnTurn !== currentTurn) return 0
  return minion.attacksUsedThisTurn ?? 1
}

/** Entry and control changes both exhaust a minion until its controller's next turn. */
export function hasBoardMinionEntryExhaustion(
  minion: Pick<BoardMinion, 'summonedOnTurn' | 'controllerChangedOnTurn'>,
  currentTurn: number
): boolean {
  return (
    minion.summonedOnTurn >= currentTurn ||
    (minion.controllerChangedOnTurn ?? -1) >= currentTurn
  )
}

/** Whether the minion should display the sleeping state for entry/control exhaustion. */
export function isBoardMinionSleeping(
  minion: Pick<
    BoardMinion,
    | 'summonedOnTurn'
    | 'controllerChangedOnTurn'
    | 'keywords'
    | 'enchantments'
    | 'silenced'
    | 'health'
    | 'maxHealth'
  >,
  currentTurn: number
): boolean {
  return (
    hasBoardMinionEntryExhaustion(minion, currentTurn) &&
    !effectiveBoardMinionKeywords(minion, currentTurn).some(
      (keyword) => keyword === 'charge' || keyword === 'rush'
    )
  )
}
