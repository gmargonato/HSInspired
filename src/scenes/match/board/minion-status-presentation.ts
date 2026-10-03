import type { RuntimeAttachedEffect } from '../../../game-rules/match/opening-match-types'

/** Only a direct, attached destruction of this host is a pending death marker. */
export function hasPendingMinionDestruction(minion: {
  readonly attachedEffects?: readonly RuntimeAttachedEffect[]
}): boolean {
  return (minion.attachedEffects ?? []).some((effect) =>
    effect.actions.some((action) => {
      if (action.action !== 'destroy' || action.condition !== undefined) return false
      const target = action.target
      if (!target || typeof target !== 'object') return false
      const selector = target as Record<string, unknown>
      // Attached effects execute with the host as both source and event target.
      return (
        selector.type === 'minion' &&
        (selector.selection === 'event-target' || selector.selection === 'source')
      )
    })
  )
}
