import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game-rules/content'
import { isCardEffectObject } from '../../../game-rules/content/cards/card-effects'
import type {
  OpeningMatchAnalysis,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'

function usesHandSelector(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return entry.zone === 'hand' || Object.values(entry).some(usesHandSelector)
}

/** Known future uses of the resources/history excluded by the comparison below. */
function usesCastOrHandResources(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (
    entry.type === 'combo-active' ||
    entry.source === 'hand' ||
    entry.zone === 'hand' ||
    entry.type === 'player-has-hand-count' ||
    entry.type === 'player-has-card-in-hand' ||
    entry.selection === 'other-player-hand' ||
    (entry.reference === 'matching-entity-count' && usesHandSelector(entry.selector)) ||
    entry.action === 'cast-random-spells' ||
    entry.action === 'return-recorded-spells' ||
    (typeof entry.reference === 'string' &&
      [
        'friendly-spells-cast-this-game',
        'cards-played-earlier-this-turn',
        'hand-size-difference',
        'other-cards-in-hand',
        'manaSpent'
      ].includes(entry.reference))
  )
    return true
  return Object.values(entry).some(usesCastOrHandResources)
}

/** Retain an empty cast when a visible follow-up might need its hand slot. */
function usesHandCapacity(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.destination === 'hand' ||
    (typeof entry.action === 'string' &&
      (entry.action === 'draw' ||
        entry.action.includes('hand') ||
        entry.action.includes('discover'))) ||
    Object.values(entry).some(usesHandCapacity)
  )
}

/**
 * A single quiet, reversible probe. This is an observed no-payoff judgment,
 * not equivalence under arbitrary future generated cards or hidden effects.
 */
export function wastesEmptySelectorSpell(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand,
  shouldStop: () => boolean = () => false
): boolean {
  if (command.type !== 'play-card' || shouldStop()) return false
  // Fixed-work callers provide a deterministic stop; live callers own deadlines.
  const stopped = shouldStop
  const state = root.getState()
  const self = state.players.find((player) => player.participantId === actorId)
  const card = self?.hand.find((entry) => entry.instanceId === command.cardInstanceId)
  const definition = card && CARD_CATALOG.get(card.cardId)
  if (
    !self ||
    !card ||
    card.instanceId !== command.cardInstanceId ||
    definition?.type !== 'Spell' ||
    definition.effects.length !== 1 ||
    definition.keywords.length ||
    definition.quest ||
    card.costAdjustments?.length ||
    card.enchantments?.length ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    state.extraTurnQueue?.length ||
    !state.history ||
    !root.getAiObservation ||
    !root.getRandomState
  )
    return false
  const effect = definition.effects[0]!
  const action = effect.actions?.[0]
  const target = action?.target
  // An empty enemy transform leaves friendly bodies intact. Unlike a bounce,
  // it can be checked with other cards held, provided no visible setup consumes
  // the freed hand slot or cast history and the complete state stays unchanged.
  const emptyTransform =
    action?.action === 'transform-random' &&
    isCardEffectObject(target) &&
    target.controller === 'opponent' &&
    !state.players.some(
      (player) => player.participantId !== actorId && player.board.length
    ) &&
    Object.keys(action).every((key) =>
      ['action', 'target', 'filter', 'leaveUnchangedIfNoValidCost'].includes(key)
    )
  if (
    Object.keys(effect).some((key) => !['trigger', 'actions'].includes(key)) ||
    effect.trigger !== 'cast' ||
    effect.actions?.length !== 1 ||
    (!emptyTransform &&
      (action?.action !== 'return-to-hand' ||
        Object.keys(action).some((key) => !['action', 'target'].includes(key)) ||
        self.hand.length !== 1 ||
        self.heroPower.available)) ||
    (emptyTransform &&
      (self.hand.length >= 10 ||
        [...self.hand, ...self.board, ...(self.weapon ? [self.weapon] : [])].some(
          (entry) =>
            entry.instanceId !== card.instanceId &&
            usesHandCapacity(CARD_CATALOG.get(entry.cardId)?.effects)
        ))) ||
    !isCardEffectObject(target) ||
    target.type !== 'minion' ||
    target.selection !== 'all' ||
    !['self', 'opponent', 'any'].includes(String(target.controller)) ||
    Object.keys(target).some(
      (key) => !['type', 'selection', 'controller'].includes(key)
    )
  )
    return false
  // No active source may turn casting, emptying the hand or spending mana into
  // setup. Plain permanent base stats are compared exactly, never valued here.
  if (
    state.players.some((player) => {
      const power = HERO_POWER_CATALOG.get(player.heroPower.id)
      return (
        (!emptyTransform && player.board.length) ||
        (player.quest && (!emptyTransform || player.participantId === actorId)) ||
        player.secrets?.length ||
        player.hero.enchantments?.length ||
        player.heroPower.enchantments?.length ||
        player.heroPower.effectOverride ||
        !power ||
        ![
          'gain-attack-and-armor',
          'damage-enemy-hero',
          'damage-character',
          'restore-character',
          'equip-weapon',
          'gain-armor',
          ...(emptyTransform ? ['summon-random-totem'] : [])
        ].includes(power.effect.kind) ||
        (!emptyTransform &&
          player.weapon &&
          (CARD_CATALOG.get(player.weapon.cardId)?.effects.length !== 0 ||
            player.weapon.enchantments?.length)) ||
        player.pendingCostModifiers?.length ||
        player.nextCardCostsOpponentHealth ||
        player.nextSpellCostsHealth ||
        player.nextMurlocCostsHealth ||
        player.lockAndLoadCount ||
        player.cthun ||
        player.cthunDied ||
        (player.counters && Object.keys(player.counters).length) ||
        player.murlocSummonBonus ||
        player.ninjaCycle ||
        player.futureAdaptations?.length ||
        player.overload ||
        player.mana.temporary ||
        player.mana.overloadLocked ||
        player.mana.overloadNextTurn
      )
    })
  )
    return false
  const observation = root.getAiObservation(actorId, 'fair')
  if (observation.players.some((player) => player.secrets.length)) return false
  const known = new Set([
    ...observation.selfOriginalDeck.cards.map((entry) => entry.cardId),
    ...observation.players.flatMap((player) => [
      ...player.hand.map((entry) => entry.cardId),
      ...player.board.map((entry) => entry.cardId),
      ...(player.weapon ? [player.weapon.cardId] : []),
      ...(player.quest ? [player.quest.cardId] : [])
    ]),
    ...(self.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...self.deck
      .filter((entry) => entry.knownTo?.includes(actorId))
      .map((entry) => entry.cardId),
    ...(self.revealedCards?.map((entry) => entry.cardId) ?? []),
    ...(self.discardedCards?.map((entry) => entry.cardId) ?? [])
  ])
  if (
    usesCastOrHandResources(
      state.players.map((player) => [
        player.hero.enchantments,
        player.heroPower.enchantments,
        player.board.map((minion) => minion.enchantments),
        player.weapon?.enchantments
      ])
    ) ||
    known.size > 80 ||
    [...known].some((id) => {
      const knownCard = CARD_CATALOG.get(id)
      return !knownCard || usesCastOrHandResources(knownCard.effects)
    }) ||
    stopped()
  )
    return false
  const cost = card.currentCost ?? definition.cost
  if (!Number.isFinite(cost) || cost < 0 || cost > self.mana.available) return false
  return root.analyze((fork) => {
    if (!fork.getRandomState || stopped()) return false
    const rng = JSON.stringify(fork.getRandomState())
    const result = fork.dispatch(command)
    if (
      !result.accepted ||
      stopped() ||
      JSON.stringify(fork.getRandomState()) !== rng ||
      !result.events.length ||
      result.events.some(
        (event) => event.type !== 'history-action-resolved' || event.outcomes.length > 0
      )
    )
      return false
    const history = state.history!
    const expected = {
      ...state,
      revision: state.revision + 1,
      players: state.players.map((player) =>
        player.participantId !== actorId
          ? player
          : {
              ...player,
              hand: player.hand.filter((entry) => entry.instanceId !== card.instanceId),
              mana: { ...player.mana, available: player.mana.available - cost },
              discardedCards: [
                ...(player.discardedCards ?? []),
                { ...card, zone: 'discarded', revealed: false }
              ]
            }
      ),
      history: {
        ...history,
        cardsPlayedThisTurn: [...history.cardsPlayedThisTurn, card.cardId],
        cardsCastThisTurn: [...history.cardsCastThisTurn, card.cardId],
        cardsPlayedThisGame: [...history.cardsPlayedThisGame, card.cardId],
        spellsCastThisGameByPlayer: {
          ...history.spellsCastThisGameByPlayer,
          [actorId]: (history.spellsCastThisGameByPlayer[actorId] ?? 0) + 1
        }
      }
    }
    // Every unlisted field, including fatigue/decks, discount/overload/health
    // payment, persistent effects, scheduling and counters, must stay identical.
    return JSON.stringify(result.state) === JSON.stringify(expected)
  })
}
