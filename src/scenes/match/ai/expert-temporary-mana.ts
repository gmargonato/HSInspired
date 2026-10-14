import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game-rules/content'
import {
  enumerateLegalCommands,
  type OpeningMatchAnalysis,
  type PlayerId,
  type TurnMatchCommand
} from '../../../game-rules/match'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'

function hasDeferredHistoryPayoff(value: unknown): boolean {
  if (typeof value === 'string')
    return /combo|spells?-cast|cards?-played|last-card|last-spell|cast-random-spells/.test(
      value
    )
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(hasDeferredHistoryPayoff)
}

/**
 * One reversible dispatch, not a turn search. In this deliberately quiet state,
 * free combat cannot reveal cards, change costs, refresh powers or reward casting.
 */
export function wastesImmediateTemporaryMana(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand,
  shouldStop: () => boolean = () => false
): boolean {
  if (command.type !== 'play-card' || shouldStop()) return false
  const state = root.getState()
  const self = state.players.find((player) => player.participantId === actorId)
  const card = self?.hand.find((entry) => entry.instanceId === command.cardInstanceId)
  const definition = card && CARD_CATALOG.get(card.cardId)
  if (
    !self ||
    !card ||
    definition?.type !== 'Spell' ||
    definition.effects.length !== 1 ||
    self.hand.length >= 10 ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    !root.getAiObservation ||
    !root.getRandomState
  )
    return false
  const effect = definition.effects[0]!
  const action = effect.actions?.[0]
  // Reject optional/nested instructions and conditional or non-mana payoffs.
  if (
    Object.keys(effect).some((key) => key !== 'trigger' && key !== 'actions') ||
    effect.trigger !== 'cast' ||
    effect.actions?.length !== 1 ||
    action?.action !== 'gain-mana' ||
    action.player !== 'self' ||
    action.duration !== 'this-turn' ||
    typeof action.amount !== 'number' ||
    action.amount <= 0 ||
    Object.keys(action).some(
      (key) => !['action', 'player', 'amount', 'duration'].includes(key)
    )
  )
    return false
  if (
    self.pendingCostModifiers?.length ||
    self.nextSpellCostsHealth ||
    self.nextMurlocCostsHealth ||
    state.players.some(
      (player) =>
        player.quest ||
        player.secrets?.length ||
        (player.lockAndLoadCount ?? 0) > 0 ||
        player.board.some(
          (minion) =>
            CARD_CATALOG.get(minion.cardId)?.effects.length !== 0 ||
            minion.enchantments?.length ||
            minion.grantedTriggers?.length ||
            minion.attachedEffects?.length ||
            minion.deathrattles?.length
        ) ||
        (player.weapon &&
          (CARD_CATALOG.get(player.weapon.cardId)?.effects.length !== 0 ||
            player.weapon.enchantments?.length)) ||
        player.hero.enchantments?.some((enchantment) =>
          Object.keys(enchantment).some(
            (key) =>
              ![
                'id',
                'sourceInstanceId',
                'sourceCardId',
                'attackDelta',
                'duration',
                'expiresOnTurn'
              ].includes(key)
          )
        )
    ) ||
    self.hand.some(
      (entry) =>
        entry.costAdjustments?.length ||
        entry.enchantments?.length ||
        CARD_CATALOG.get(entry.cardId)?.effects.some(
          (block) => block.trigger === 'while-in-hand'
        )
    )
  )
    return false
  const power = HERO_POWER_CATALOG.get(self.heroPower.id)
  if (!power || /refresh|copy-last-card/.test(power.effect.kind)) return false
  const observation = root.getAiObservation(actorId, 'fair')
  const known = new Set([
    ...observation.selfOriginalDeck.cards.map((entry) => entry.cardId),
    ...self.deck
      .filter((entry) => entry.startedInDeck || entry.knownTo?.includes(actorId))
      .map((entry) => entry.cardId),
    ...self.hand.map((entry) => entry.cardId),
    ...(self.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...(self.revealedCards?.map((entry) => entry.cardId) ?? []),
    ...(self.discardedCards?.map((entry) => entry.cardId) ?? [])
  ])
  if (
    known.size > 80 ||
    [...known].some((id) => {
      const knownCard = CARD_CATALOG.get(id)
      return !knownCard || hasDeferredHistoryPayoff(knownCard.effects)
    }) ||
    shouldStop()
  )
    return false
  return root.analyze((fork) => {
    if (!fork.getRandomState || shouldStop()) return false
    const rng = JSON.stringify(fork.getRandomState())
    const result = fork.dispatch(command)
    const after = result.state.players.find(
      (player) => player.participantId === actorId
    )
    if (
      !result.accepted ||
      result.state.phase !== 'turns' ||
      result.state.activePlayerId !== actorId ||
      result.state.pendingDiscover ||
      result.state.pendingCardChoice ||
      result.state.pendingResolution ||
      !after ||
      after.mana.available <= self.mana.available ||
      after.mana.maximum !== self.mana.maximum ||
      JSON.stringify(fork.getRandomState()) !== rng ||
      revealsTacticalInformation(result.events) ||
      result.events.some((event) => event.type === 'trigger-activated') ||
      shouldStop()
    )
      return false
    // Even a currently unplayable cheap minion may become playable after a trade
    // frees a slot. Likewise retain all free setup, not just immediate mana uses.
    if (
      after.hand.some((entry) => {
        const cost = entry.currentCost ?? CARD_CATALOG.get(entry.cardId)?.cost
        return cost === undefined || cost <= after.mana.available
      })
    )
      return false
    return enumerateLegalCommands(fork, actorId).every(
      (legal) => legal.type === 'attack-character' || legal.type === 'end-turn'
    )
  })
}
