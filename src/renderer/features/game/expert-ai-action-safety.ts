import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game/content'
import type { TurnMatchCommand, TurnMatchState } from '../../../game/match'
import { effectiveBoardMinionKeywords } from '../../../game/match/rules/minion-attack-state'

/** A soft value penalty in the normalized Expert position-score range. */
export const EXPERT_UNPAID_FRIENDLY_DAMAGE_PENALTY = 0.35

/**
 * Discourages direct hero-power damage to a friendly character when it has no
 * observable payoff. The engine still explores these actions, and damage or
 * death triggers plus Icy Touch's actual summon remain valid reasons to use it.
 */
export function unpaidFriendlyDamageHeroPowerPenalty(
  command: TurnMatchCommand,
  state: TurnMatchState,
  actorId: string
): number {
  if (command.type !== 'use-hero-power' || !command.target) return 0
  const targetRef = command.target
  if (targetRef.participantId !== actorId) return 0

  const player = state.players.find((entry) => entry.participantId === actorId)
  const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
  if (!player || !power) return 0

  const effect = power.effect
  const damage =
    effect.kind === 'damage-character' || effect.kind === 'damage-and-summon-on-kill'
      ? effect.amount
      : 0
  if (damage <= 0) return 0

  if (targetRef.kind === 'hero') return EXPERT_UNPAID_FRIENDLY_DAMAGE_PENALTY
  if (targetRef.kind !== 'minion') return 0

  const target = player.board.find(
    (minion) => minion.instanceId === targetRef.instanceId
  )
  if (!target) return 0
  const keywords = effectiveBoardMinionKeywords(target, state.turnNumber)
  if (keywords.includes('divine-shield') || keywords.includes('immune'))
    return EXPERT_UNPAID_FRIENDLY_DAMAGE_PENALTY

  const killed = damage >= target.health
  if (effect.kind === 'damage-and-summon-on-kill' && killed) return 0

  const definition = CARD_CATALOG.get(target.cardId)
  const hasRelevantTrigger = definition?.effects.some((entry) =>
    killed
      ? entry.trigger === 'deathrattle' || entry.trigger === 'on-death'
      : entry.trigger === 'on-damage'
  )
  return hasRelevantTrigger ? 0 : EXPERT_UNPAID_FRIENDLY_DAMAGE_PENALTY
}
