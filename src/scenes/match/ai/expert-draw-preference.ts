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
  const state = root.getState()
  const before = state.players.find((p) => p.participantId === actorId)!
  const played =
    command.type === 'play-card'
      ? before.hand.find((card) => card.instanceId === command.cardInstanceId)
      : undefined
  const definition = played && CARD_CATALOG.get(played.cardId)
  const cost = played?.currentCost ?? definition?.cost ?? Infinity
  // Only authored random-card additions qualify here. Fixed cards, copies,
  // stolen/moved cards and random summons are outside this narrow preference.
  const generatesUnknownCard =
    cost <= 2 &&
    definition?.effects.some(
      (effect) =>
        (effect.trigger === 'battlecry' || effect.trigger === 'cast') &&
        effect.actions?.some(
          (action) =>
            action.action === 'add-to-hand' &&
            action.source === 'random-card' &&
            action.player === 'self' &&
            action.cardId === undefined &&
            (!Array.isArray(action.pool) || action.pool.length > 1)
        )
    ) === true
  if (!before.deck.length && !generatesUnknownCard) return 0
  return root.analyze((fork) => {
    const result = fork.dispatch(command)
    if (!result.accepted || result.state.phase === 'ended') return 0
    const ownEvents = result.events.filter(
      (e) => 'participantId' in e && e.participantId === actorId
    )
    const draws = ownEvents.some((e) => e.type === 'card-drawn' && e.origin === 'deck')
    const generates =
      generatesUnknownCard && ownEvents.some((e) => e.type === 'card-generated')
    if ((!draws && !generates) || ownEvents.some((e) => e.type === 'card-burned'))
      return 0
    const after = result.state.players.find((p) => p.participantId === actorId)!
    // Multi-draw fatigue can occur even when the first draw succeeds.
    if (after.fatigueDamage > before.fatigueDamage || after.mana.available <= 0)
      return 0
    if (!draws) {
      // A small exploration preference, not a forced ordering rule. Leave tight
      // space, secret interactions and competing full-mana plays to the search.
      if (
        before.hand.length >= 10 ||
        after.hand.length >= 10 ||
        after.board.length >= 7 ||
        result.state.pendingDiscover ||
        result.state.pendingCardChoice ||
        result.state.pendingResolution ||
        state.players.some((player) => (player.secrets?.length ?? 0) > 0) ||
        before.hand.some((card) => {
          if (card.instanceId === played?.instanceId) return false
          const held = CARD_CATALOG.get(card.cardId)
          if (!held) return false
          const heldCost = card.currentCost ?? held.cost
          if (
            heldCost >= 4 &&
            heldCost <= before.mana.available &&
            heldCost > after.mana.available
          )
            return true
          if (held.type !== 'Minion' || before.board.length >= 7) return false
          return held.effects.some((effect) => {
            if (
              ['on-cast', 'on-card-played', 'on-summon'].includes(effect.trigger) &&
              heldCost + cost <= before.mana.available
            )
              return true
            return (
              effect.trigger === 'aura' &&
              effect.actions?.some((action) => {
                const target = record(action.target)
                if (
                  action.action === 'multiply-trigger' &&
                  action.trigger === 'battlecry' &&
                  definition?.type === 'Minion' &&
                  target.controller === 'self' &&
                  typeof action.multiplier === 'number' &&
                  action.multiplier > 1 &&
                  heldCost + cost <= before.mana.available
                )
                  return true
                if (action.action !== 'change-cost') return false
                const filter = record(target.filter)
                return (
                  target.controller === 'self' &&
                  target.type === 'card' &&
                  filter.cardType === 'Spell' &&
                  typeof action.amount === 'number' &&
                  action.amount < 0 &&
                  heldCost +
                    Math.max(
                      0,
                      cost + (definition?.type === 'Spell' ? action.amount : 0)
                    ) <=
                    before.mana.available
                )
              })
            )
          })
        })
      )
        return 0
    }
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
