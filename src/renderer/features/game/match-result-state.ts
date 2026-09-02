export interface MatchResultCombatView {
  setCanAttack(enabled: boolean): void
  setTargetable(enabled: boolean): void
  setTargetingOutline(enabled: boolean): void
}

/** Removes every stale combat affordance before the frozen result is shown. */
export function clearMatchResultCombatViews(
  views: Iterable<MatchResultCombatView>
): void {
  for (const view of views) {
    view.setCanAttack(false)
    view.setTargetable(false)
    view.setTargetingOutline(false)
  }
}
