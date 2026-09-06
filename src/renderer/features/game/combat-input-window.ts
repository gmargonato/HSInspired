/**
 * Combat visuals serialize independently from the engine, so another legal
 * attacker may be selected while an earlier combat presentation is queued.
 */
export function canSelectCombatAttacker(
  _combatInProgress: boolean,
  _attackerSelectionUnlocked: boolean
): boolean {
  return true
}

/** A legal engine attack can join the presentation FIFO immediately. */
export function canCommitCombatAttack(_combatInProgress: boolean): boolean {
  return true
}
