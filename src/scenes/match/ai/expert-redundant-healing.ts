import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../../game-rules/content'
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
  CardPlayTargetRef,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import { aiActionIntent } from './ai-action-intent'

function usesPowerHistory(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.reference === 'hero-powers-used-this-game' ||
    Object.values(entry).some(usesPowerHistory)
  )
}

/** Invert only typed character-targeted intents; dispatch remains the legality check. */
function selectedCommand(
  intent: AiActionIntent,
  state: OpeningMatchState,
  actorId: PlayerId,
  opponentId: PlayerId
): TurnMatchCommand | undefined {
  const targets: CardPlayTargetRef[] = []
  for (const reference of intent.targets) {
    const matches: CardPlayTargetRef[] = []
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
    if (matches.length !== 1) return undefined
    targets.push(matches[0]!)
  }
  let command: TurnMatchCommand
  if (intent.type === 'use-hero-power') {
    // This helper admits only the already-checked self-targeted power prefix.
    if (targets.length !== 1 || targets[0]!.kind !== 'hero') return undefined
    command = { type: 'use-hero-power', participantId: actorId, target: targets[0]! }
  } else if (
    intent.type === 'play-card' &&
    intent.source !== null &&
    state.players
      .find((player) => player.participantId === actorId)!
      .hand.some((card) => card.instanceId === intent.source)
  ) {
    command = {
      type: 'play-card',
      participantId: actorId,
      cardInstanceId: intent.source,
      ...(targets.length ? { targets } : {}),
      ...(intent.position === null ? {} : { position: intent.position }),
      ...(intent.option === null ? {} : { choice: intent.option })
    }
  } else return undefined
  return sameAiIntent(intent, aiActionIntent(command, opponentId)) ? command : undefined
}

/**
 * Omit a paid self-heal only when the selected card plays erase all its healing.
 * This is a local resource preference, not equivalence against arbitrary future
 * generated cards. Retain every history field except the verified power-use
 * increment, and abstain if a known card can consume that increment.
 */
export function reviewRedundantHealingPrefix(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  intents: readonly AiActionIntent[],
  shouldStop?: () => boolean
) {
  const started = performance.now()
  const stats = { dispatches: 0, abstained: false, durationMs: 0, manaSaved: 0 }
  const unchanged = () => ({ commands: null, stats })
  const stop = () => performance.now() - started >= 25 || shouldStop?.() === true
  const state = checkpoint.state
  const self = state.players.find((player) => player.participantId === actorId)
  const opponent = state.players.find((player) => player.participantId !== actorId)
  const first = intents[0]
  const plays = intents.at(-1)?.type === 'end-turn' ? intents.slice(0, -1) : intents
  if (
    !self ||
    !opponent ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    state.players.some((player) => player.quest || player.secrets?.length) ||
    !state.history ||
    first?.type !== 'use-hero-power' ||
    first.source !== `${actorId}:hero-power` ||
    first.targets.length !== 1 ||
    first.targets[0] !== `${actorId}:hero` ||
    intents.length > 6 ||
    plays.length < 2 ||
    !plays.slice(1).every((intent) => intent.type === 'play-card') ||
    !self.heroPower.available ||
    self.heroPower.cost <= 0 ||
    self.heroPower.effectOverride ||
    self.heroPower.enchantments?.length ||
    !self.originalDeckCardIds ||
    self.deck.some((card) => !card.startedInDeck && !card.knownTo?.includes(actorId)) ||
    HERO_POWER_CATALOG.get(self.heroPower.id)?.effect.kind !== 'restore-character'
  )
    return unchanged()

  if (stop()) {
    stats.abstained = true
    return unchanged()
  }

  const known = new Set([
    ...(self.originalDeckCardIds ?? []),
    ...self.hand.map((card) => card.cardId),
    ...self.board.map((minion) => minion.cardId),
    ...(self.graveyard?.map((entry) => entry.minion.cardId) ?? []),
    ...(self.revealedCards?.map((card) => card.cardId) ?? []),
    ...(self.discardedCards?.map((card) => card.cardId) ?? []),
    ...self.deck
      .filter((card) => card.knownTo?.includes(actorId))
      .map((card) => card.cardId)
  ])
  if (
    known.size > 80 ||
    [...known].some((id) => {
      const card = CARD_CATALOG.get(id)
      return !card || usesPowerHistory(card.effects)
    }) ||
    usesPowerHistory([self.hero, self.heroPower, self.board, self.weapon])
  )
    return unchanged()

  if (stop()) {
    stats.abstained = true
    stats.durationMs = performance.now() - started
    return unchanged()
  }
  const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  if (stop()) {
    stats.abstained = true
    stats.durationMs = performance.now() - started
    return unchanged()
  }
  const simulation = { ...fair, setup: { ...fair.setup, recordEffectTrace: false } }
  const match = createOpeningMatchFromCheckpoint(simulation)
  const rng = JSON.stringify(fair.rngState)
  const replay = (
    line: readonly AiActionIntent[],
    resolvedCommands?: readonly TurnMatchCommand[]
  ) =>
    match.analyze((fork) => {
      const commands: TurnMatchCommand[] = []
      let current = fair.state
      for (const [index, intent] of line.entries()) {
        if (stop()) {
          stats.abstained = true
          return undefined
        }
        // Reuse the original accepted command in the shorter line. Dispatch still
        // validates it against the new state; do not enumerate every other play.
        const command = resolvedCommands
          ? resolvedCommands[index]
          : selectedCommand(intent, current, actorId, opponent.participantId)
        if (!command) return undefined
        stats.dispatches++
        const result = fork.dispatch(command)
        if (
          !result.accepted ||
          result.state.phase !== 'turns' ||
          result.state.activePlayerId !== actorId ||
          result.state.pendingDiscover ||
          result.state.pendingCardChoice ||
          result.state.pendingResolution ||
          revealsTacticalInformation(result.events) ||
          result.events.some((event) => event.type === 'trigger-activated') ||
          JSON.stringify(fork.getRandomState?.()) !== rng
        )
          return undefined
        current = result.state
        commands.push(command)
      }
      // The instance and reversible analysis fork share the same current state.
      // Capture all engine counters before analyze restores the root snapshot.
      return { checkpoint: match.getCheckpoint(), commands }
    })
  try {
    const selected = replay(plays)
    const shortened = selected && replay(plays.slice(1), selected.commands.slice(1))
    if (!selected || !shortened) return unchanged()
    if (stop()) {
      stats.abstained = true
      return unchanged()
    }
    const after = shortened.checkpoint.state
    const kept = after.players.find((player) => player.participantId === actorId)!
    if (
      !after.history ||
      kept.heroPower.id !== self.heroPower.id ||
      kept.heroPower.available !== self.heroPower.available ||
      (kept.heroPower.usesThisTurn ?? 0) !== (self.heroPower.usesThisTurn ?? 0)
    )
      return unchanged()
    // No broad history/zone normalization: this is the complete expected delta.
    const expected = {
      ...shortened.checkpoint,
      state: {
        ...after,
        revision: after.revision + 1,
        history: {
          ...after.history,
          heroPowersUsedByPlayer: {
            ...after.history.heroPowersUsedByPlayer,
            [actorId]: (after.history.heroPowersUsedByPlayer[actorId] ?? 0) + 1
          }
        },
        players: after.players.map((player) =>
          player.participantId !== actorId
            ? player
            : {
                ...player,
                mana: {
                  ...player.mana,
                  available: player.mana.available - self.heroPower.cost
                },
                heroPower: {
                  ...player.heroPower,
                  available: false,
                  usesThisTurn: (self.heroPower.usesThisTurn ?? 0) + 1
                }
              }
        )
      }
    }
    const equivalent = JSON.stringify(selected.checkpoint) === JSON.stringify(expected)
    if (stop()) {
      stats.abstained = true
      return unchanged()
    }
    if (!equivalent) return unchanged()
    stats.manaSaved = self.heroPower.cost
    const commands = [...shortened.commands]
    if (intents.at(-1)?.type === 'end-turn')
      commands.push({ type: 'end-turn', participantId: actorId })
    return { commands, stats }
  } finally {
    stats.durationMs = Math.max(0, performance.now() - started)
  }
}
