/** Whether a friendly attacker may be selected during the current combat presentation. */
export function canSelectCombatAttacker(
  combatInProgress: boolean,
  attackerSelectionUnlocked: boolean
): boolean {
  return !combatInProgress || attackerSelectionUnlocked
}

/** Combat commands remain serialized until the current presentation fully settles. */
export function canCommitCombatAttack(combatInProgress: boolean): boolean {
  return !combatInProgress
}
