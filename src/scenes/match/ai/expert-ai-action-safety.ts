import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game-rules/content'
import type { TurnMatchCommand, TurnMatchState } from '../../../game-rules/match'
import {
  effectiveBoardMinionKeywords,
  hasBoardMinionEntryExhaustion,
  boardMinionAttacksUsed
} from '../../../game-rules/match/rules/minion-attack-state'

/** A soft value penalty in the normalized Expert position-score range. */
export const EXPERT_UNPAID_FRIENDLY_DAMAGE_PENALTY = 0.35

/** Soft advice; simulated payoffs may justify these setup actions. */
export function unpaidActionPenalty(
  command: TurnMatchCommand,
  state: TurnMatchState,
  actorId: string
): number {
  const player = state.players.find((entry) => entry.participantId === actorId)
  if (!player) return 0
  if (command.type === 'use-hero-power') {
    const power = HERO_POWER_CATALOG.get(player.heroPower.id)
    if (
      power?.effect.kind === 'equip-weapon' &&
      player.weapon &&
      player.weapon.durability === player.weapon.maxDurability &&
      player.weapon.cardId === power.effect.cardId
    )
      return 0.12
    return unpaidFriendlyDamageHeroPowerPenalty(command, state, actorId)
  }
  if (command.type !== 'play-card') return 0
  const card = player.hand.find((entry) => entry.instanceId === command.cardInstanceId)
  const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
  if (
    definition?.effects.some((effect) =>
      effect.actions?.some(
        (action) =>
          action.action === 'modify' &&
          action.duration === 'this-turn' &&
          typeof action.attack === 'number' &&
          action.attack > 0
      )
    )
  ) {
    const canAttack = (minion: (typeof player.board)[number]) => {
      const keywords = effectiveBoardMinionKeywords(minion, state.turnNumber)
      return (
        !minion.dormant &&
        (!hasBoardMinionEntryExhaustion(minion, state.turnNumber) ||
          keywords.includes('charge') ||
          keywords.includes('rush')) &&
        (minion.frozenUntilTurn ?? -1) < state.turnNumber &&
        boardMinionAttacksUsed(minion, state.turnNumber) <
          (minion.maxAttacksPerTurn ?? 1)
      )
    }
    const target = player.board.find((m) =>
      command.targets?.some((t) => t.kind === 'minion' && t.instanceId === m.instanceId)
    )
    if (target && !canAttack(target) && player.board.some(canAttack)) return 0.08
  }
  if (
    definition?.type === 'Spell' &&
    player.board.length < 7 &&
    player.hand.some((entry) => {
      const setup = CARD_CATALOG.get(entry.cardId)
      return (
        setup?.type === 'Minion' &&
        (setup.effects.some((effect) => effect.trigger === 'on-cast') ||
          (setup.keywords.includes('spell-damage') &&
            definition.effects.some((effect) =>
              effect.actions?.some((action) => action.action === 'damage')
            ))) &&
        (entry.currentCost ?? setup.cost) + (card?.currentCost ?? definition.cost) <=
          player.mana.available
      )
    })
  )
    return 0.08
  if (
    definition?.type !== 'Spell' ||
    !definition.effects.length ||
    !definition.effects.every(
      (effect) =>
        effect.trigger === 'cast' &&
        effect.actions?.every((action) => action.action === 'damage')
    )
  )
    return 0
  if (!command.targets?.some((entry) => entry.participantId === actorId)) return 0
  if (
    state.players.some((entry) =>
      entry.board.some((minion) =>
        CARD_CATALOG.get(minion.cardId)?.effects.some((effect) =>
          ['on-damage', 'on-death', 'deathrattle', 'on-cast'].includes(effect.trigger)
        )
      )
    )
  )
    return 0
  return EXPERT_UNPAID_FRIENDLY_DAMAGE_PENALTY
}

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
