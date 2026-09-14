import type { OpeningMatchPublicEvent } from '../../../game/match'
import type { JsonObject } from '../../../shared/ipc/ai'

/** A bounded record of observed outcomes, never a model-written rule or forecast. */
export function observedAiCorrections(
  events: readonly OpeningMatchPublicEvent[]
): Partial<Record<'zeroHealing' | 'divineShield', JsonObject>> {
  const result: Partial<Record<'zeroHealing' | 'divineShield', JsonObject>> = {}
  for (const event of events) {
    if (event.type === 'character-healed' && event.amount === 0) {
      result.zeroHealing = {
        rule: 'Healing restores missing health; it does not raise maximum health. Check missingHealth and current modifiers before expecting a benefit.',
        evidence: {
          target:
            event.character.kind === 'hero'
              ? `${event.participantId}:hero`
              : event.character.instanceId,
          healthBefore: event.healthBefore,
          healthAfter: event.healthAfter,
          restored: 0
        }
      }
    }
    if (event.type === 'history-action-resolved') {
      for (const outcome of event.outcomes) {
        if (outcome.kind === 'shield-lost') {
          result.divineShield = {
            rule: 'Divine Shield absorbs an entire damage event, not one damage point. Losing a shield does not mean the minion died; use the current board and actual death events.',
            evidence: { target: outcome.target.id, outcome: 'shield-lost' }
          }
        }
      }
    }
    if (
      event.type === 'character-combat-resolved' ||
      event.type === 'minion-combat-resolved'
    ) {
      if (event.attacker.divineShieldConsumed || event.defender.divineShieldConsumed) {
        result.divineShield = {
          rule: 'Divine Shield absorbs an entire damage event, not one damage point. Read the actual post-combat health before assuming a kill.',
          evidence: {
            combatId: event.combatId ?? null,
            outcome: 'shield-consumed-in-combat'
          }
        }
      }
    }
  }
  return result
}
