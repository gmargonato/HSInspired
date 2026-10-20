import { CARD_CATALOG } from '../../../game-rules/content'
import {
  sameAiIntent,
  type AiActionIntent
} from '../../../desktop/contracts/ipc/ai-deliberation'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import {
  createOpeningMatchFromCheckpoint,
  MAX_HAND_SIZE
} from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchEvent,
  OpeningMatchState,
  OpeningCard,
  CardPlayTargetRef,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import { aiActionIntent } from './ai-action-intent'

function usesPersistentCastHistory(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.reference === 'friendly-spells-cast-this-game' ||
    entry.reference === 'cards-played-this-game' ||
    entry.reference === 'hand-size-difference' ||
    entry.reference === 'other-cards-in-hand' ||
    entry.type === 'player-has-hand-count' ||
    entry.type === 'player-has-card-in-hand' ||
    entry.source === 'hand' ||
    entry.zone === 'hand' ||
    Object.values(entry).some(usesPersistentCastHistory)
  )
}

function hasStartOfTurnEffect(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.trigger === 'start-of-turn' || Object.values(entry).some(hasStartOfTurnEffect)
  )
}

function plainTargetedDamage(card: OpeningCard): boolean {
  const definition = CARD_CATALOG.get(card.cardId)
  if (
    !definition ||
    definition.type !== 'Spell' ||
    definition.keywords.length ||
    definition.effects.length !== 1 ||
    card.enchantments?.length ||
    card.costAdjustments?.length
  )
    return false
  const effect = definition.effects[0]!
  if (
    effect.trigger !== 'cast' ||
    effect.actions?.length !== 1 ||
    Object.keys(effect).some((key) => key !== 'trigger' && key !== 'actions')
  )
    return false
  const action = effect.actions![0] as Record<string, unknown>
  const target = action.target as Record<string, unknown> | undefined
  return (
    action.action === 'damage' &&
    typeof action.amount === 'number' &&
    action.amount > 0 &&
    Object.keys(action).every((key) =>
      ['action', 'amount', 'target', 'vfx'].includes(key)
    ) &&
    target?.selection === 'chosen' &&
    ['character', 'minion', 'hero'].includes(String(target.type))
  )
}

/** Cheap eligibility only; neither a score nor a proof of redundant damage. */
export function isRedundantSpellPrefixCandidate(
  state: OpeningMatchState,
  actorId: PlayerId,
  intents: readonly AiActionIntent[]
): boolean {
  const self = state.players.find((player) => player.participantId === actorId)
  const first = intents[0]
  const cards = self?.hand.filter((card) => card.instanceId === first?.source) ?? []
  return (
    !!self &&
    state.phase === 'turns' &&
    state.activePlayerId === actorId &&
    !!state.history &&
    !state.pendingDiscover &&
    !state.pendingCardChoice &&
    !state.pendingResolution &&
    !state.scheduledEffects?.length &&
    !state.players.some((player) => player.quest || player.secrets?.length) &&
    intents.length >= 2 &&
    intents.length <= 6 &&
    intents.at(-1)?.type === 'end-turn' &&
    first?.type === 'play-card' &&
    first.targets.length === 1 &&
    first.position === null &&
    first.option === null &&
    intents
      .slice(1, -1)
      .every((intent) =>
        ['play-card', 'use-hero-power', 'attack-character'].includes(intent.type)
      ) &&
    cards.length === 1 &&
    plainTargetedDamage(cards[0]!) &&
    !self.nextCardCostsOpponentHealth &&
    !self.nextSpellCostsHealth &&
    !self.pendingCostModifiers?.length
  )
}

type CharacterTarget = Extract<CardPlayTargetRef, { kind: 'hero' | 'minion' }>

function character(
  reference: string,
  state: OpeningMatchState
): CharacterTarget | undefined {
  const matches: CharacterTarget[] = []
  for (const player of state.players) {
    if (reference === `${player.participantId}:hero`)
      matches.push({ kind: 'hero', participantId: player.participantId })
    for (const minion of player.board)
      if (reference === minion.instanceId)
        matches.push({
          kind: 'minion',
          participantId: player.participantId,
          instanceId: minion.instanceId
        })
  }
  return matches.length === 1 ? matches[0] : undefined
}

/** Strict inverse of supported typed intents; authoritative dispatch checks legality. */
function selectedCommand(
  intent: AiActionIntent,
  state: OpeningMatchState,
  actorId: PlayerId,
  opponentId: PlayerId
): TurnMatchCommand | undefined {
  const targets: CharacterTarget[] = []
  for (const reference of intent.targets) {
    const target = character(reference, state)
    if (!target) return undefined
    targets.push(target)
  }
  let command: TurnMatchCommand
  if (
    intent.type === 'play-card' &&
    intent.source !== null &&
    state.players
      .find((player) => player.participantId === actorId)!
      .hand.filter((card) => card.instanceId === intent.source).length === 1
  ) {
    command = {
      type: 'play-card',
      participantId: actorId,
      cardInstanceId: intent.source,
      ...(targets.length ? { targets } : {}),
      ...(intent.position === null ? {} : { position: intent.position }),
      ...(intent.option === null ? {} : { choice: intent.option })
    }
  } else if (intent.type === 'use-hero-power' && targets.length <= 1) {
    command = {
      type: 'use-hero-power',
      participantId: actorId,
      ...(targets[0] ? { target: targets[0] } : {})
    }
  } else if (
    intent.type === 'attack-character' &&
    intent.source !== null &&
    targets.length === 1
  ) {
    const attacker = character(intent.source, state)
    const defender = targets[0]!
    if (
      !attacker ||
      attacker.participantId !== actorId ||
      defender.participantId !== opponentId
    )
      return undefined
    command = {
      type: 'attack-character',
      participantId: actorId,
      attacker:
        attacker.kind === 'hero'
          ? { kind: 'hero' }
          : { kind: 'minion', instanceId: attacker.instanceId },
      defender:
        defender.kind === 'hero'
          ? { kind: 'hero' }
          : { kind: 'minion', instanceId: defender.instanceId }
    }
  } else if (intent.type === 'end-turn') {
    command = { type: 'end-turn', participantId: actorId }
  } else return undefined
  return sameAiIntent(intent, aiActionIntent(command, opponentId)) ? command : undefined
}

/**
 * Retain a damage spell only when a complete selected turn erases its effects.
 * This is a local resource preference, not equivalence against arbitrary future
 * play, including later draws and opponent hand-capacity effects. Only the
 * verified play/discard/cast increments may differ.
 */
export function reviewRedundantSpellPrefix(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  intents: readonly AiActionIntent[],
  shouldStop?: () => boolean,
  preparedFairCheckpoint?: OpeningMatchCheckpoint
) {
  const started = performance.now()
  const stats = {
    dispatches: 0,
    abstained: false,
    durationMs: 0,
    manaSaved: 0,
    cardsSaved: 0,
    ordinaryBoundaryBurn: false
  }
  const unchanged = () => {
    stats.durationMs = Math.max(0, performance.now() - started)
    return { commands: null, stats }
  }
  const stop = () => performance.now() - started >= 25 || shouldStop?.() === true
  const expired = () => {
    stats.abstained = true
    return unchanged()
  }
  if (!isRedundantSpellPrefixCandidate(checkpoint.state, actorId, intents))
    return unchanged()
  if (stop()) return expired()
  const state = checkpoint.state
  const self = state.players.find((player) => player.participantId === actorId)!
  const opponent = state.players.find((player) => player.participantId !== actorId)
  if (
    !opponent ||
    !self.originalDeckCardIds ||
    self.deck.some((card) => !card.startedInDeck && !card.knownTo?.includes(actorId))
  )
    return unchanged()
  // A known draw hazard must not vanish when the fair checkpoint shuffles or
  // strips attached effects. Never inspect concealed opponent card identities.
  if (
    opponent.deck.some(
      (card) =>
        card.knownTo?.includes(actorId) &&
        (!CARD_CATALOG.get(card.cardId) ||
          card.enchantments?.length ||
          CARD_CATALOG.get(card.cardId)!.effects.some(
            (effect) => effect.trigger === 'on-draw'
          ))
    )
  )
    return unchanged()
  const known = new Set([
    ...self.originalDeckCardIds,
    ...self.hand.map((card) => card.cardId),
    ...self.board.map((card) => card.cardId),
    ...(self.weapon ? [self.weapon.cardId] : []),
    ...(self.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...(self.revealedCards?.map((card) => card.cardId) ?? []),
    ...(self.discardedCards?.map((card) => card.cardId) ?? []),
    ...self.deck
      .filter((card) => card.startedInDeck || card.knownTo?.includes(actorId))
      .map((card) => card.cardId),
    ...opponent.board.map((card) => card.cardId),
    ...(opponent.weapon ? [opponent.weapon.cardId] : []),
    ...opponent.deck
      .filter((card) => card.knownTo?.includes(actorId))
      .map((card) => card.cardId),
    ...(opponent.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...(opponent.revealedCards?.map((card) => card.cardId) ?? []),
    ...(opponent.discardedCards?.map((card) => card.cardId) ?? []),
    ...opponent.hand
      .filter((card) => card.knownTo?.includes(actorId))
      .map((card) => card.cardId)
  ])
  if (
    known.size > 100 ||
    [...known].some((id) => {
      const card = CARD_CATALOG.get(id)
      return !card || usesPersistentCastHistory(card)
    }) ||
    usesPersistentCastHistory([
      self.hero,
      self.heroPower,
      self.board,
      self.weapon,
      self.hand.map((card) => card.enchantments),
      opponent.hero,
      opponent.heroPower,
      opponent.board,
      opponent.weapon
    ])
  )
    return unchanged()
  if (stop()) return expired()
  // A caller may reuse the fair snapshot already prepared for this exact request.
  // Public/known-card guards above still inspect the original unsanitized state.
  if (
    preparedFairCheckpoint &&
    (preparedFairCheckpoint.state.phase !== state.phase ||
      preparedFairCheckpoint.state.revision !== state.revision ||
      preparedFairCheckpoint.state.activePlayerId !== actorId ||
      preparedFairCheckpoint.state.turnNumber !== state.turnNumber ||
      preparedFairCheckpoint.state.players.some(
        (player, index) => player.participantId !== state.players[index]!.participantId
      ))
  )
    return unchanged()
  const fair =
    preparedFairCheckpoint ??
    createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  if (stop()) return expired()
  const match = createOpeningMatchFromCheckpoint({
    ...fair,
    setup: { ...fair.setup, recordEffectTrace: false }
  })
  const prefix = self.hand.find((card) => card.instanceId === intents[0]!.source)!
  let firstDiscard: OpeningCard | undefined
  let manaPaid = 0
  const equal = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right)
  const replay = (
    line: readonly AiActionIntent[],
    resolved?: readonly TurnMatchCommand[]
  ) =>
    match.analyze((fork) => {
      const commands: TurnMatchCommand[] = []
      let boundaryBurn: unknown
      let current = fair.state
      for (const [index, intent] of line.entries()) {
        if (stop()) {
          stats.abstained = true
          return undefined
        }
        const command = resolved
          ? resolved[index]
          : selectedCommand(intent, current, actorId, opponent.participantId)
        if (!command || stats.dispatches >= 12) return undefined
        const final = index === line.length - 1
        stats.dispatches++
        const result = fork.dispatch(command)
        if (!result.accepted) return undefined
        const beforeOpponent = current.players.find(
          (player) => player.participantId === opponent.participantId
        )!
        const afterOpponent = result.state.players.find(
          (player) => player.participantId === opponent.participantId
        )!
        const burns = result.events.filter(
          (event): event is Extract<OpeningMatchEvent, { type: 'card-burned' }> =>
            event.type === 'card-burned'
        )
        const effects = result.events.filter(
          (event): event is Extract<OpeningMatchEvent, { type: 'effect-resolved' }> =>
            event.type === 'effect-resolved'
        )
        const bookkeeping = effects[0]
        const ordinaryBurn =
          final &&
          command.type === 'end-turn' &&
          beforeOpponent.hand.length >= MAX_HAND_SIZE &&
          burns.length === 1 &&
          burns[0]!.participantId === opponent.participantId &&
          burns[0]!.origin === 'deck' &&
          beforeOpponent.deck.length === afterOpponent.deck.length + 1 &&
          !result.events.some((event) => event.type === 'trigger-activated') &&
          effects.length === 1 &&
          bookkeeping?.action === 'burn' &&
          bookkeeping.actionPath === 'turn-start.draw' &&
          bookkeeping.controllerId === opponent.participantId &&
          bookkeeping.sourceInstanceId ===
            (beforeOpponent.hero.instanceId ?? `${opponent.participantId}:hero`) &&
          bookkeeping.sourceCardId === null &&
          bookkeeping.data?.participantId === opponent.participantId &&
          bookkeeping.data?.instanceId === burns[0]!.card.instanceId &&
          bookkeeping.data?.cardId === burns[0]!.card.cardId
        if (ordinaryBurn)
          boundaryBurn = {
            event: burns[0],
            // Only presentation revision/correlation differ after one fewer play.
            bookkeeping: {
              action: bookkeeping.action,
              actionPath: bookkeeping.actionPath,
              controllerId: bookkeeping.controllerId,
              sourceInstanceId: bookkeeping.sourceInstanceId,
              sourceCardId: bookkeeping.sourceCardId,
              data: bookkeeping.data
            }
          }
        if (
          result.state.phase !== 'turns' ||
          result.state.activePlayerId !== (final ? opponent.participantId : actorId) ||
          result.state.turnNumber !== state.turnNumber + (final ? 1 : 0) ||
          (final && command.type !== 'end-turn') ||
          result.state.pendingDiscover ||
          result.state.pendingCardChoice ||
          result.state.pendingResolution ||
          result.state.scheduledEffects?.length ||
          result.state.players.some(
            (player) => player.quest || player.secrets?.length
          ) ||
          revealsTacticalInformation(
            ordinaryBurn
              ? result.events.filter((event) => event !== burns[0])
              : result.events,
            final
          ) ||
          result.events.some((event) => event.type === 'trigger-activated') ||
          !equal(fork.getRandomState?.(), fair.rngState)
        )
          return undefined
        if (!resolved && index === 0) {
          const firstSelf = result.state.players.find(
            (player) => player.participantId === actorId
          )!
          const discarded = firstSelf.discardedCards ?? []
          firstDiscard = discarded.at(-1)
          manaPaid = self.mana.available - firstSelf.mana.available
          if (
            !firstDiscard ||
            firstDiscard.instanceId !== prefix.instanceId ||
            firstDiscard.cardId !== prefix.cardId ||
            discarded.length !== (self.discardedCards?.length ?? 0) + 1 ||
            !equal(discarded.slice(0, -1), self.discardedCards ?? []) ||
            manaPaid !== (prefix.currentCost ?? prefix.baseCost) ||
            manaPaid < 0 ||
            !equal(result.state.history?.cardsPlayedThisGame, [
              ...state.history!.cardsPlayedThisGame,
              prefix.cardId
            ]) ||
            !equal(result.state.history?.spellsCastThisGameByPlayer, {
              ...state.history!.spellsCastThisGameByPlayer,
              [actorId]: (state.history!.spellsCastThisGameByPlayer[actorId] ?? 0) + 1
            })
          )
            return undefined
        }
        current = result.state
        commands.push(command)
      }
      if (stop()) {
        stats.abstained = true
        return undefined
      }
      return { checkpoint: match.getCheckpoint(), commands, boundaryBurn }
    })
  try {
    const selected = replay(intents)
    const shortened = selected && replay(intents.slice(1), selected.commands.slice(1))
    if (
      !selected ||
      !shortened ||
      !firstDiscard ||
      !equal(selected.boundaryBurn, shortened.boundaryBurn)
    )
      return unchanged()
    if (stop()) return expired()
    const after = shortened.checkpoint.state
    const kept = after.players.find((player) => player.participantId === actorId)!
    const retained = kept.hand.filter((card) => card.instanceId === prefix.instanceId)
    if (
      retained.length !== 1 ||
      retained[0]!.cardId !== prefix.cardId ||
      !after.history ||
      typeof after.turnStartedAtRevision !== 'number' ||
      hasStartOfTurnEffect([kept.hero, kept.heroPower, kept.board, kept.weapon]) ||
      [...kept.board, ...(kept.weapon ? [kept.weapon] : [])].some(
        (entity) =>
          !CARD_CATALOG.get(entity.cardId) ||
          hasStartOfTurnEffect(CARD_CATALOG.get(entity.cardId)!.effects)
      ) ||
      (kept.hand.length >= MAX_HAND_SIZE && kept.deck.length > 0)
    )
      return unchanged()
    const expected = {
      ...shortened.checkpoint,
      state: {
        ...after,
        revision: after.revision + 1,
        turnStartedAtRevision: after.turnStartedAtRevision + 1,
        history: {
          ...after.history,
          cardsPlayedThisGame: [
            ...after.history.cardsPlayedThisGame.slice(
              0,
              state.history!.cardsPlayedThisGame.length
            ),
            prefix.cardId,
            ...after.history.cardsPlayedThisGame.slice(
              state.history!.cardsPlayedThisGame.length
            )
          ],
          spellsCastThisGameByPlayer: {
            ...after.history.spellsCastThisGameByPlayer,
            [actorId]: (after.history.spellsCastThisGameByPlayer[actorId] ?? 0) + 1
          }
        },
        players: after.players.map((player) =>
          player.participantId !== actorId
            ? player
            : {
                ...player,
                hand: player.hand.filter(
                  (card) => card.instanceId !== prefix.instanceId
                ),
                discardedCards: [
                  ...(player.discardedCards ?? []).slice(
                    0,
                    self.discardedCards?.length ?? 0
                  ),
                  firstDiscard,
                  ...(player.discardedCards ?? []).slice(
                    self.discardedCards?.length ?? 0
                  )
                ],
                mana: { ...player.mana, available: player.mana.available - manaPaid }
              }
        )
      }
    }
    const equivalent = equal(selected.checkpoint, expected)
    if (stop()) return expired()
    if (!equivalent) return unchanged()
    stats.manaSaved = manaPaid
    stats.cardsSaved = 1
    stats.ordinaryBoundaryBurn = selected.boundaryBurn !== undefined
    return { commands: shortened.commands, stats }
  } finally {
    stats.durationMs = Math.max(0, performance.now() - started)
  }
}
