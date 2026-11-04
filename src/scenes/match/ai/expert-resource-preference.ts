import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game-rules/content'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
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

function scalesWithWeapon(cardId: string): boolean {
  return (
    CARD_CATALOG.get(cardId)?.effects.some(
      (effect) =>
        effect.trigger === 'battlecry' &&
        effect.actions?.some(
          (action) =>
            action.action === 'modify' &&
            record(action.target).selection === 'source' &&
            record(action.attack).reference === 'source.weapon.attack'
        )
    ) ?? false
  )
}

function handGrowth(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(handGrowth)
  const entry = record(value)
  return (
    (typeof entry.action === 'string' && /draw|hand|discover/.test(entry.action)) ||
    entry.destination === 'hand' ||
    (record(entry.destination).zone === 'hand' &&
      record(entry.destination).controller !== 'opponent') ||
    Object.values(entry).some(
      (nested) => typeof nested === 'object' && handGrowth(nested)
    )
  )
}

/**
 * Seed a public summon/attack dependency before spending a ready attack. This is
 * search advice, not a cached continuation or a proof about Discover's outcome.
 * Only the already-visible source's immediate Attack gain is valued; generated
 * cards and the sampled choice pool never contribute to this preference.
 */
export function expertAttackSetupPreference(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand,
  shouldStop: () => boolean = () => false
): number {
  if (command.type !== 'play-card' || shouldStop()) return 0
  const state = root.getState()
  const self = state.players.find((player) => player.participantId === actorId)
  const card = self?.hand.find((entry) => entry.instanceId === command.cardInstanceId)
  const definition = card && CARD_CATALOG.get(card.cardId)
  if (
    !self ||
    definition?.type !== 'Minion' ||
    state.players.some((player) => player.secrets?.length) ||
    // Information-only battlecries are allowed, but a random board effect must
    // not manufacture the visible attack gain used by this ordering hint.
    definition.effects.some(
      (effect) =>
        effect.trigger !== 'battlecry' ||
        !effect.actions?.every((action) => action.action === 'discover')
    )
  )
    return 0
  const potentialSources = self.board.filter(
    (minion) =>
      !minion.silenced &&
      !minion.dormant &&
      CARD_CATALOG.get(minion.cardId)?.effects.some(
        (effect) =>
          effect.trigger === 'on-summon' &&
          effect.actions?.some(
            (action) =>
              action.action === 'modify' &&
              record(action.target).selection === 'source' &&
              typeof action.attack === 'number' &&
              action.attack > 0
          )
      )
  )
  if (!potentialSources.length || shouldStop()) return 0
  // Discover itself advances RNG. Rather than attribute a sampled board buff
  // to the dependency, abstain when another live trigger could alter it.
  const sourceIds = new Set(potentialSources.map((minion) => minion.instanceId))
  if (
    state.players.some((player) =>
      player.board.some(
        (minion) =>
          !minion.silenced &&
          (minion.grantedTriggers?.length ||
            minion.attachedEffects?.length ||
            CARD_CATALOG.get(minion.cardId)?.effects.some(
              (effect) =>
                !['battlecry', 'deathrattle', 'aura'].includes(effect.trigger) &&
                !(
                  sourceIds.has(minion.instanceId) &&
                  effect.trigger === 'on-summon' &&
                  effect.actions?.every(
                    (action) =>
                      action.action === 'modify' &&
                      record(action.target).selection === 'source' &&
                      typeof action.attack === 'number'
                  )
                )
            ))
      )
    )
  )
    return 0
  const ready = new Set(
    enumerateLegalCommands(root, actorId)
      .filter(
        (action) =>
          action.type === 'attack-character' &&
          action.attacker.kind === 'minion' &&
          action.defender.kind === 'hero'
      )
      .map((action) =>
        action.type === 'attack-character' && action.attacker.kind === 'minion'
          ? action.attacker.instanceId
          : ''
      )
  )
  const sources = potentialSources.filter((minion) => ready.has(minion.instanceId))
  if (!sources.length || shouldStop()) return 0
  return root.analyze((fork) => {
    const result = fork.dispatch(command)
    if (
      !result.accepted ||
      shouldStop() ||
      result.state.phase !== 'turns' ||
      result.state.activePlayerId !== actorId
    )
      return 0
    const after = result.state.players.find(
      (player) => player.participantId === actorId
    )!
    const gain = sources.reduce((total, source) => {
      const next = after.board.find((minion) => minion.instanceId === source.instanceId)
      return total + (next ? Math.max(0, next.attack - source.attack) : 0)
    }, 0)
    return Math.min(2, gain) * 0.04
  })
}

/**
 * Small root-search preference for resource setup with an executable payoff.
 * This is neither an ordering certificate nor a reason to reject a searched line:
 * the engine preserves all histories, triggers and placement-dependent effects.
 */
export function expertResourceSetupPreference(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand,
  shouldStop: () => boolean = () => false
): number {
  if (command.type !== 'play-card' || shouldStop() || !root.getRandomState) return 0
  const state = root.getState()
  const before = state.players.find((player) => player.participantId === actorId)
  const played = before?.hand.find((card) => card.instanceId === command.cardInstanceId)
  const definition = played && CARD_CATALOG.get(played.cardId)
  if (!before || !definition) return 0
  // Avoid treating every held card as free under a one-use payment modifier.
  if (before.nextCardCostsOpponentHealth) return 0
  // A sampled secret resolution is not a reliable setup opportunity.
  if (state.players.some((player) => (player.secrets?.length ?? 0) > 0)) return 0
  const handSizeBuff =
    definition.type === 'Minion' &&
    definition.effects.length === 1 &&
    definition.effects.some(
      (effect) =>
        effect.trigger === 'battlecry' &&
        !effect.condition &&
        effect.actions?.length === 1 &&
        effect.actions?.some((action) => {
          const health = record(action.health),
            selector = record(health.selector)
          return (
            action.action === 'modify' &&
            record(action.target).selection === 'source' &&
            health.reference === 'matching-entity-count' &&
            Object.keys(health).length === 2 &&
            selector.controller === 'self' &&
            selector.type === 'card' &&
            selector.selection === 'all' &&
            selector.zone === 'hand' &&
            Object.keys(selector).length === 4
          )
        })
    )
  if (handSizeBuff) {
    const remaining = before.mana.available - (played?.currentCost ?? definition.cost)
    const power = HERO_POWER_CATALOG.get(before.heroPower.id)?.effect.kind ?? ''
    if (
      (before.heroPower.cost <= remaining &&
        root.getLegality(actorId).legalHeroPower &&
        /draw|discover|build-a-beast|copy-last-card/.test(power)) ||
      before.hand.some(
        (card) =>
          card.instanceId !== played?.instanceId &&
          (card.currentCost ?? CARD_CATALOG.get(card.cardId)?.cost ?? Infinity) <=
            remaining &&
          handGrowth(CARD_CATALOG.get(card.cardId)?.effects)
      )
    )
      return 0
  }
  const discounts =
    definition.type === 'Minion' &&
    definition.effects.some(
      (effect) =>
        effect.trigger === 'aura' &&
        effect.actions?.some((action) => action.action === 'change-cost')
    )
  const improvesWeapon =
    before.hand.some(
      (card) => card.instanceId !== played?.instanceId && scalesWithWeapon(card.cardId)
    ) &&
    (definition.type === 'Weapon' ||
      definition.effects.some(
        (effect) =>
          (effect.trigger === 'cast' || effect.trigger === 'battlecry') &&
          effect.actions?.some(
            (action) =>
              action.action === 'equip' ||
              (action.action === 'modify' && record(action.target).type === 'weapon')
          )
      ))
  if (!discounts && !improvesWeapon && !handSizeBuff) return 0
  return root.analyze((fork) => {
    if (shouldStop() || !fork.getRandomState) return 0
    const randomState = JSON.stringify(fork.getRandomState())
    const result = fork.dispatch(command)
    if (
      !result.accepted ||
      shouldStop() ||
      randomState !== JSON.stringify(fork.getRandomState()) ||
      revealsTacticalInformation(result.events) ||
      (handSizeBuff &&
        result.events.some(
          (event) =>
            event.type === 'trigger-activated' &&
            event.source.instanceId !== command.cardInstanceId
        )) ||
      result.state.phase !== 'turns' ||
      result.state.activePlayerId !== actorId ||
      result.state.pendingDiscover ||
      result.state.pendingCardChoice ||
      result.state.pendingResolution
    )
      return 0
    const after = result.state.players.find(
      (player) => player.participantId === actorId
    )!
    const body = after.board.find(
      (minion) => minion.instanceId === command.cardInstanceId
    )
    if (after.hero.health + after.hero.armor < before.hero.health + before.hero.armor)
      return 0
    const weaponGain =
      (after.weapon && after.weapon.durability > 0 ? after.weapon.attack : 0) -
      (before.weapon && before.weapon.durability > 0 ? before.weapon.attack : 0)
    const payoffs = new Map<string, number>()
    for (const card of after.hand) {
      const original = before.hand.find((entry) => entry.instanceId === card.instanceId)
      const payoff = CARD_CATALOG.get(card.cardId)
      if (!original || !payoff) continue
      const cost = card.currentCost ?? payoff.cost
      if (cost > after.mana.available) continue
      const saving = (original.currentCost ?? payoff.cost) - cost
      if (discounts && payoff.type === 'Spell' && saving > 0)
        payoffs.set(card.instanceId, Math.min(3, saving) * 0.02)
      if (improvesWeapon && weaponGain > 0 && scalesWithWeapon(card.cardId))
        payoffs.set(card.instanceId, Math.min(3, weaponGain) * 0.02)
      if (
        handSizeBuff &&
        body &&
        definition.type === 'Minion' &&
        body.maxHealth > definition.health &&
        payoff.type === 'Minion' &&
        cost === (original.currentCost ?? payoff.cost)
      )
        payoffs.set(card.instanceId, 0.02)
    }
    if (!payoffs.size || shouldStop()) return 0
    // Legality includes targeting, board space and actual post-setup costs.
    // Check only a bounded set of real continuations; do not select a target or
    // invent visits here. Search receives the setup command as its seed.
    let checked = 0
    let preference = 0
    for (const payoff of enumerateLegalCommands(fork, actorId)) {
      if (shouldStop()) break
      if (payoff.type !== 'play-card') continue
      const value = payoffs.get(payoff.cardInstanceId)
      if (!value || value <= preference) continue
      if (checked++ >= 8) break
      if (
        fork.analyze((line) => {
          if (shouldStop()) return false
          const rng = JSON.stringify(line.getRandomState?.())
          const next = line.dispatch(payoff)
          if (!next.accepted) return false
          if (!handSizeBuff) return true
          if (
            next.state.phase !== 'turns' ||
            next.state.activePlayerId !== actorId ||
            next.state.pendingResolution ||
            next.state.pendingDiscover ||
            next.state.pendingCardChoice
          )
            return false
          const player = next.state.players.find(
            (entry) => entry.participantId === actorId
          )!
          const kept = player.board.find(
            (minion) => minion.instanceId === body?.instanceId
          )
          return (
            !revealsTacticalInformation(next.events) &&
            rng === JSON.stringify(line.getRandomState?.()) &&
            !next.events.some(
              (event) =>
                event.type === 'trigger-activated' &&
                event.source.instanceId !== payoff.cardInstanceId
            ) &&
            player.hand.length === after.hand.length - 1 &&
            player.board.length === after.board.length + 1 &&
            kept?.cardId === body?.cardId &&
            kept?.attack === body?.attack &&
            kept?.health === body?.health &&
            kept?.maxHealth === body?.maxHealth
          )
        })
      )
        preference = value
    }
    return preference
  })
}
