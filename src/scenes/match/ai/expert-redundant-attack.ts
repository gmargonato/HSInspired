import { CARD_CATALOG } from '../../../game-rules/content'
import {
  sameAiIntent,
  type AiActionIntent
} from '../../../desktop/contracts/ipc/ai-deliberation'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchState,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import { aiActionIntent } from './ai-action-intent'

function consumesCombatOrHandHistory(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.zone === 'graveyard' ||
    // The retained card is a minion. Spell-only selectors and a specific prior
    // effect target cannot consume the extra hand entry (Preparation/Shadowstep).
    (entry.zone === 'hand' &&
      !(entry.type === 'card' && entry.selection === 'event-target') &&
      !(
        entry.type === 'card' &&
        entry.selection === 'all' &&
        (entry.filter as Record<string, unknown> | undefined)?.cardType === 'Spell'
      )) ||
    entry.source === 'hand' ||
    entry.type === 'player-has-hand-count' ||
    entry.type === 'player-has-card-in-hand' ||
    entry.type === 'card-died-this-game' ||
    (typeof entry.action === 'string' &&
      /resurrect|record.*death/.test(entry.action)) ||
    (typeof entry.source === 'string' && /died|destroyed/.test(entry.source)) ||
    (typeof entry.reference === 'string' &&
      /died|damage-dealt|last-damage|hand-size|other-cards-in-hand/.test(
        entry.reference
      )) ||
    Object.values(entry).some(consumesCombatOrHandHistory)
  )
}

/** Only a complete attack, all-board bounce, pass witness qualifies. */
export function isRedundantAttackPrefixCandidate(
  state: OpeningMatchState,
  actorId: PlayerId,
  intents: readonly AiActionIntent[]
): boolean {
  const [attack, bounce, pass] = intents
  const self = state.players.find((p) => p.participantId === actorId)
  const card = self?.hand.find((c) => c.instanceId === bounce?.source)
  const definition = card && CARD_CATALOG.get(card.cardId)
  const effect = definition?.effects[0],
    action = effect?.actions?.[0]
  const target = action?.target as Record<string, unknown> | undefined
  return (
    !!self &&
    intents.length === 3 &&
    attack?.type === 'attack-character' &&
    attack.source !== null &&
    attack.targets.length === 1 &&
    bounce?.type === 'play-card' &&
    bounce.targets.length === 0 &&
    bounce.option === null &&
    bounce.position === null &&
    pass?.type === 'end-turn' &&
    pass.source === null &&
    pass.targets.length === 0 &&
    pass.position === null &&
    pass.option === null &&
    attack.position === null &&
    attack.option === null &&
    definition?.type === 'Spell' &&
    definition.effects.length === 1 &&
    definition.keywords.length === 0 &&
    !card?.enchantments?.length &&
    !card?.costAdjustments?.length &&
    effect?.trigger === 'cast' &&
    Object.keys(effect).every((k) => ['trigger', 'actions'].includes(k)) &&
    effect.actions?.length === 1 &&
    action?.action === 'return-to-hand' &&
    Object.keys(action).every((k) => ['action', 'target'].includes(k)) &&
    target?.type === 'minion' &&
    target.controller === 'any' &&
    target.selection === 'all' &&
    Object.keys(target).every((k) => ['type', 'controller', 'selection'].includes(k))
  )
}

/**
 * Compare only the state before the witnessed pass, preserving one plain minion.
 * This bounded local preference is not equivalence against future hidden draws.
 */
export function reviewRedundantAttackPrefix(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  intents: readonly AiActionIntent[],
  shouldStop: () => boolean = () => false,
  preparedFairCheckpoint?: OpeningMatchCheckpoint
) {
  const started = performance.now()
  const stats = {
    dispatches: 0,
    abstained: false,
    durationMs: 0,
    cardsSaved: 0,
    manaSaved: 0
  }
  const unchanged = () => {
    stats.durationMs = performance.now() - started
    return { commands: null as readonly TurnMatchCommand[] | null, stats }
  }
  const stop = () => {
    if (performance.now() - started < 25 && !shouldStop()) return false
    stats.abstained = true
    return true
  }
  const state = checkpoint.state,
    self = state.players.find((p) => p.participantId === actorId),
    enemy = state.players.find((p) => p.participantId !== actorId)
  if (
    !self ||
    !enemy ||
    !isRedundantAttackPrefixCandidate(state, actorId, intents) ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    !state.history ||
    !self.originalDeckCardIds ||
    self.deck.some((card) => !card.startedInDeck && !card.knownTo?.includes(actorId)) ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    state.extraTurnQueue?.length ||
    state.players.some(
      (p) =>
        p.secrets?.length ||
        p.hero.enchantments?.length ||
        p.heroPower.enchantments?.length ||
        p.heroPower.effectOverride ||
        p.weapon ||
        (p.quest && p.quest.goal !== 'play-same-name')
    ) ||
    stop()
  )
    return unchanged()
  const attacker = self.board.find((m) => m.instanceId === intents[0]!.source),
    defender = enemy.board.find((m) => m.instanceId === intents[0]!.targets[0])
  if (
    !attacker ||
    !defender ||
    self.hand.length + self.board.length - 1 >= 10 ||
    enemy.hand.length + enemy.board.length >= 10 ||
    CARD_CATALOG.get(attacker.cardId)?.effects.length ||
    attacker.enchantments?.length ||
    attacker.grantedTriggers?.length ||
    attacker.attachedEffects?.length ||
    attacker.ownerId !== actorId ||
    attacker.controllerId !== actorId
  )
    return unchanged()
  if (
    preparedFairCheckpoint &&
    (preparedFairCheckpoint.state.phase !== state.phase ||
      preparedFairCheckpoint.state.revision !== state.revision ||
      preparedFairCheckpoint.state.activePlayerId !== actorId ||
      preparedFairCheckpoint.state.turnNumber !== state.turnNumber ||
      preparedFairCheckpoint.state.players.some(
        (p, i) => p.participantId !== state.players[i]!.participantId
      ))
  )
    return unchanged()
  // Check only public and actor-known identities before sanitizing the replay.
  const known = new Set([
    ...self.originalDeckCardIds,
    ...self.hand.map((card) => card.cardId),
    ...self.board.map((card) => card.cardId),
    ...self.deck
      .filter((card) => card.startedInDeck || card.knownTo?.includes(actorId))
      .map((card) => card.cardId),
    ...(self.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...(self.revealedCards?.map((card) => card.cardId) ?? []),
    ...(self.discardedCards?.map((card) => card.cardId) ?? []),
    ...enemy.board.map((card) => card.cardId),
    ...enemy.deck
      .filter((card) => card.knownTo?.includes(actorId))
      .map((card) => card.cardId),
    ...(enemy.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...(enemy.revealedCards?.map((card) => card.cardId) ?? []),
    ...(enemy.discardedCards?.map((card) => card.cardId) ?? []),
    ...enemy.hand
      .filter((card) => card.knownTo?.includes(actorId))
      .map((card) => card.cardId)
  ])
  if (
    known.size > 100 ||
    [...known].some((id) => {
      const card = CARD_CATALOG.get(id)
      return !card || consumesCombatOrHandHistory(card)
    }) ||
    consumesCombatOrHandHistory(
      state.players.map((p) => [
        p.hero,
        p.heroPower,
        p.board.map((m) => [m.enchantments, m.grantedTriggers, m.attachedEffects]),
        p.hand
          .filter(
            (card) => p.participantId === actorId || card.knownTo?.includes(actorId)
          )
          .map((card) => [card.enchantments, card.costAdjustments])
      ])
    ) ||
    stop()
  )
    return unchanged()
  const fair =
    preparedFairCheckpoint ??
    createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  if (stop()) return unchanged()
  const match = createOpeningMatchFromCheckpoint({
    ...fair,
    setup: { ...fair.setup, recordEffectTrace: false }
  })
  const attack: TurnMatchCommand = {
    type: 'attack-character',
    participantId: actorId,
    attacker: { kind: 'minion', instanceId: attacker.instanceId },
    defender: { kind: 'minion', instanceId: defender.instanceId }
  }
  const bounce: TurnMatchCommand = {
    type: 'play-card',
    participantId: actorId,
    cardInstanceId: intents[1]!.source!
  }
  if (
    !sameAiIntent(intents[0]!, aiActionIntent(attack, enemy.participantId)) ||
    !sameAiIntent(intents[1]!, aiActionIntent(bounce, enemy.participantId))
  )
    return unchanged()
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  let afterAttack: OpeningMatchCheckpoint | undefined
  const replay = (commands: readonly TurnMatchCommand[]) =>
    match.analyze((fork) => {
      for (const command of commands) {
        if (stop() || stats.dispatches >= 3) {
          stats.abstained = true
          return undefined
        }
        stats.dispatches++
        const result = fork.dispatch(command)
        if (
          !result.accepted ||
          result.state.phase !== 'turns' ||
          result.state.activePlayerId !== actorId ||
          result.state.pendingDiscover ||
          result.state.pendingCardChoice ||
          result.state.pendingResolution ||
          result.events.some(
            (e) => e.type === 'trigger-activated' || e.type === 'card-burned'
          ) ||
          revealsTacticalInformation(result.events) ||
          !equal(fork.getRandomState?.(), fair.rngState)
        )
          return undefined
        if (command.type === 'attack-character') afterAttack = match.getCheckpoint()
      }
      return match.getCheckpoint()
    })
  try {
    const selected = replay([attack, bounce]),
      direct = selected && replay([bounce])
    if (!selected || !direct || !afterAttack || stop()) return unchanged()
    const attacked = afterAttack.state,
      after = direct.state,
      played = after.players.find((p) => p.participantId === actorId)!,
      attackedSelf = attacked.players.find((p) => p.participantId === actorId)!
    const death = attackedSelf.graveyard?.at(-1)
    const retained = played.hand.filter((c) => c.instanceId === attacker.instanceId)
    if (
      !death ||
      death.minion.instanceId !== attacker.instanceId ||
      retained.length !== 1 ||
      retained[0]!.cardId !== attacker.cardId ||
      attackedSelf.graveyard!.length !== (self.graveyard?.length ?? 0) + 1 ||
      !equal(attackedSelf.graveyard!.slice(0, -1), self.graveyard ?? []) ||
      !attacked.players
        .find((p) => p.participantId === enemy.participantId)!
        .board.some((m) => m.instanceId === defender.instanceId) ||
      !after.history ||
      !attacked.history ||
      after.players.some((p) => p.board.length) ||
      played.hand.length >= 10 ||
      afterAttack.nextEntityOrdinal !== fair.nextEntityOrdinal + 1 ||
      attacked.nextEntityOrdinal !== fair.state.nextEntityOrdinal! + 1 ||
      !equal(attacked.history.minionsDiedThisTurn, [
        ...state.history.minionsDiedThisTurn,
        attacker.cardId
      ]) ||
      !equal(attacked.history.cardsDiedThisGame, [
        ...state.history.cardsDiedThisGame,
        attacker.cardId
      ])
    )
      return unchanged()
    const expected = {
      ...direct,
      nextEntityOrdinal: direct.nextEntityOrdinal + 1,
      state: {
        ...after,
        revision: after.revision + 1,
        nextEntityOrdinal: after.nextEntityOrdinal! + 1,
        history: {
          ...after.history,
          minionsDiedThisTurn: [...after.history.minionsDiedThisTurn, attacker.cardId],
          cardsDiedThisGame: [...after.history.cardsDiedThisGame, attacker.cardId],
          damageDealtThisTurn:
            after.history.damageDealtThisTurn +
            attacked.history.damageDealtThisTurn -
            state.history.damageDealtThisTurn,
          damageTakenThisTurn:
            after.history.damageTakenThisTurn +
            attacked.history.damageTakenThisTurn -
            state.history.damageTakenThisTurn
        },
        players: after.players.map((p) =>
          p.participantId !== actorId
            ? p
            : {
                ...p,
                hand: p.hand.filter((c) => c.instanceId !== attacker.instanceId),
                graveyard: [...(p.graveyard ?? []), death]
              }
        )
      }
    }
    if (!equal(selected, expected) || stop()) return unchanged()
    stats.cardsSaved = 1
    stats.durationMs = performance.now() - started
    return {
      commands: [
        bounce,
        { type: 'end-turn', participantId: actorId }
      ] as readonly TurnMatchCommand[],
      stats
    }
  } catch {
    return unchanged()
  }
}
