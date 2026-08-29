import type { OpeningMatchEvent } from '../../../game/match'

export type EventPresentationPolicy =
  'animation' | 'state-refresh' | 'log-only' | 'invisible'

type EventType = OpeningMatchEvent['type']

/**
 * Explicit presentation contract for every public match event. Adding an event to the
 * domain requires a corresponding renderer decision before the web typecheck can pass.
 */
export const EVENT_PRESENTATION_POLICY: Readonly<
  Record<EventType, EventPresentationPolicy>
> = {
  'mulligan-resolved': 'animation',
  'coin-granted': 'animation',
  'opening-card-drawn': 'animation',
  'card-drawn': 'animation',
  'card-generated': 'animation',
  'card-burned': 'state-refresh',
  'opening-turn-started': 'animation',
  'turn-started': 'animation',
  'hero-power-used': 'animation',
  'character-damaged': 'animation',
  'character-healed': 'state-refresh',
  'armor-gained': 'state-refresh',
  'hero-replaced': 'animation',
  fatigue: 'animation',
  'hero-power-minion-summoned': 'animation',
  'minion-played': 'animation',
  'weapon-equipped': 'animation',
  'combat-started': 'animation',
  'minion-combat-resolved': 'animation',
  'character-combat-resolved': 'animation',
  'effect-resolved': 'state-refresh',
  'match-ended': 'animation',
  'dev-card-added': 'animation',
  'dev-mana-set': 'state-refresh',
  'dev-deck-modified': 'state-refresh',
  'dev-minion-summoned': 'animation',
  'dev-state-changed': 'state-refresh',
  'history-action-resolved': 'log-only',
  'trigger-activated': 'animation',
  'death-batch-started': 'animation',
  'death-batch-completed': 'state-refresh',
  'minion-summoned': 'animation'
}

export function eventPresentationPolicy(type: EventType): EventPresentationPolicy {
  return EVENT_PRESENTATION_POLICY[type]
}
