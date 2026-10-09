import { CARD_CATALOG } from '../../../game-rules/content'
import type {
  OpeningMatchAnalysis,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Small information-value preference, independent of the sampled card's identity. */
export function expertDrawPreference(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand
): number {
  if (command.type !== 'play-card' && command.type !== 'use-hero-power') return 0
  const before = root.getState().players.find((p) => p.participantId === actorId)!
  if (!before.deck.length) return 0
  return root.analyze((fork) => {
    const result = fork.dispatch(command)
    if (!result.accepted || result.state.phase === 'ended') return 0
    const ownEvents = result.events.filter(
      (e) => 'participantId' in e && e.participantId === actorId
    )
    if (
      !ownEvents.some((e) => e.type === 'card-drawn' && e.origin === 'deck') ||
      ownEvents.some((e) => e.type === 'card-burned')
    )
      return 0
    const after = result.state.players.find((p) => p.participantId === actorId)!
    // Multi-draw fatigue can occur even when the first draw succeeds.
    if (after.fatigueDamage > before.fatigueDamage || after.mana.available <= 0)
      return 0
    const health = after.hero.health + after.hero.armor
    if (health < before.hero.health + before.hero.armor) {
      const enemy = result.state.players.find((p) => p.participantId !== actorId)!
      const visibleAttack =
        enemy.board.reduce(
          (sum, m) => sum + Math.max(0, m.attack) * (m.maxAttacksPerTurn ?? 1),
          0
        ) + Math.max(0, enemy.hero.attack)
      // Conservative for self-damaging draws; search still may choose them.
      if (health <= Math.max(10, visibleAttack)) return 0
    }
    if (command.type === 'use-hero-power' && before.board.length < 7) {
      const powerCost = ownEvents.find((e) => e.type === 'hero-power-used')?.cost ?? 0
      const setup = before.hand.some((card) => {
        const definition = CARD_CATALOG.get(card.cardId)
        if (definition?.type !== 'Minion') return false
        const cost = card.currentCost ?? definition.cost
        return definition.effects.some(
          (effect) =>
            (effect.trigger === 'inspire' &&
              cost + powerCost <= before.mana.available) ||
            (effect.trigger === 'aura' &&
              effect.actions?.some((action) => {
                const target = record(action.target)
                const amount = record(action.amount)
                const discounted =
                  typeof action.amount === 'number'
                    ? Math.max(0, powerCost + action.amount)
                    : amount.operation === 'set' && typeof amount.value === 'number'
                      ? amount.value
                      : powerCost
                return (
                  action.action === 'change-cost' &&
                  target.type === 'hero-power' &&
                  target.controller === 'self' &&
                  discounted < powerCost &&
                  cost + discounted <= before.mana.available
                )
              }))
        )
      })
      if (setup) return 0
    }
    return Math.min(6, after.mana.available) * 0.01
  })
}
