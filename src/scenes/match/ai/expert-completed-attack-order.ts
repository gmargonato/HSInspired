import { CARD_CATALOG } from '../../../game-rules/content/cards'
import {
  canonicalCommandKey,
  enumerateLegalCommands
} from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import { moreFaceDamageWithSameResources } from './expert-committed-order'

export const EXPERT_COMPLETED_ORDER_MAX_MS = 50

type SampledLine = {
  visits: number
  valueSum: number
  commands: readonly TurnMatchCommand[]
}

/** A prefix-subset with equal counts contains exactly the same sampled rollouts. */
export function identicalSupportedContinuation(
  line: SampledLine,
  lines: readonly SampledLine[]
): SampledLine {
  if (line.visits < 2) return line
  return (
    lines
      .filter(
        (other) =>
          other.visits === line.visits &&
          other.valueSum === line.valueSum &&
          other.commands.length <= 6 &&
          other.commands.length >= line.commands.length &&
          line.commands.every(
            (command, index) =>
              canonicalCommandKey(command) ===
              canonicalCommandKey(other.commands[index]!)
          )
      )
      .sort((a, b) => b.commands.length - a.commands.length)[0] ?? line
  )
}

/** Keep every committed card and target; recover one otherwise unavailable attack. */
export function reviewCompletedAttackOrder(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  commands: readonly TurnMatchCommand[],
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now()
) {
  const stats = { dispatches: 0, abstained: false, durationMs: 0 }
  const started = now()
  const stop = () => shouldStop() || now() - started >= EXPERT_COMPLETED_ORDER_MAX_MS
  const unchanged = () => ({ commands: null, stats })
  const state = checkpoint.state
  const self = state.players.find((player) => player.participantId === actorId)
  const first = commands[0]
  if (
    !self ||
    self.weapon?.durability !== 1 ||
    first?.type !== 'attack-character' ||
    first.attacker.kind !== 'hero' ||
    first.defender.kind !== 'hero' ||
    commands.length < 2 ||
    commands.length > 4 ||
    !commands.slice(1).every((command) => command.type === 'play-card') ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    state.players.some((player) => player.secrets?.length)
  )
    return unchanged()
  const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  // Diagnostic traces are excluded from the proof, so do not build/copy them
  // during its simulations. Public events and all rule state are still retained.
  const simulation = { ...fair, setup: { ...fair.setup, recordEffectTrace: false } }
  const originalIds = new Set(self.board.map((minion) => minion.instanceId))
  const make = () => createOpeningMatchFromCheckpoint(simulation)
  const rng = JSON.stringify(fair.rngState)
  const legalCommands = (match: ReturnType<typeof make>) =>
    enumerateLegalCommands(
      {
        getState: match.getState,
        getPlayInput: match.getPlayInput!,
        getLegality: match.getLegality!
      },
      actorId
    )

  const dispatch = (match: ReturnType<typeof make>, command: TurnMatchCommand) => {
    if (stop()) {
      stats.abstained = true
      return false
    }
    if (
      !legalCommands(match).some(
        (legal) => canonicalCommandKey(legal) === canonicalCommandKey(command)
      )
    )
      return false
    stats.dispatches++
    const result = match.dispatch(command)
    return (
      result.accepted &&
      result.state.phase === 'turns' &&
      result.state.activePlayerId === actorId &&
      !result.state.pendingDiscover &&
      !result.state.pendingCardChoice &&
      !result.state.pendingResolution &&
      !revealsTacticalInformation(result.events) &&
      !result.events.some((event) => event.type === 'trigger-activated') &&
      JSON.stringify(match.getCheckpoint().rngState) === rng
    )
  }
  const onlyPass = (match: ReturnType<typeof make>) => {
    const legal = legalCommands(match)
    return legal.length === 1 && legal[0]!.type === 'end-turn'
  }
  try {
    const selected = make()
    for (const command of commands) if (!dispatch(selected, command)) return unchanged()
    if (!onlyPass(selected)) return unchanged()
    const reordered = make()
    for (const command of commands.slice(1))
      if (!dispatch(reordered, command)) return unchanged()
    const attacks = legalCommands(reordered).filter(
      (command) =>
        command.type === 'attack-character' &&
        command.attacker.kind === 'minion' &&
        command.defender.kind === 'hero' &&
        !originalIds.has(command.attacker.instanceId)
    )
    // Multiple new attackers or targets require a strategic allocation, not this proof.
    if (attacks.length !== 1) return unchanged()
    const extra = attacks[0]!
    if (extra.type !== 'attack-character' || extra.attacker.kind !== 'minion')
      return unchanged()
    if (
      !dispatch(reordered, extra) ||
      !dispatch(reordered, first) ||
      !onlyPass(reordered)
    )
      return unchanged()
    const before = selected.getCheckpoint(),
      after = reordered.getCheckpoint()
    if (
      before.state.scheduledEffects?.length ||
      after.state.scheduledEffects?.length ||
      before.state.players.some((player) =>
        player.board.some(
          (minion) =>
            minion.grantedTriggers?.length ||
            minion.attachedEffects?.length ||
            (!minion.silenced &&
              CARD_CATALOG.get(minion.cardId)?.effects.some(
                (effect) => effect.trigger === 'end-of-turn'
              ))
        )
      )
    )
      return unchanged()
    const minionId = extra.attacker.instanceId
    const beforeMinion = before.state.players
      .find((player) => player.participantId === actorId)!
      .board.find((minion) => minion.instanceId === minionId)
    const afterMinion = after.state.players
      .find((player) => player.participantId === actorId)!
      .board.find((minion) => minion.instanceId === minionId)
    if (
      !beforeMinion ||
      !afterMinion ||
      beforeMinion.summonedOnTurn !== state.turnNumber ||
      beforeMinion.lastAttackedOnTurn === state.turnNumber ||
      (beforeMinion.attacksUsedThisTurn ?? 0) !== 0 ||
      afterMinion.attacksUsedThisTurn !== 1 ||
      afterMinion.lastAttackedOnTurn !== state.turnNumber ||
      after.state.revision !== before.state.revision + 1 ||
      beforeMinion.grantedTriggers?.length ||
      beforeMinion.attachedEffects?.length ||
      // No readiness-sensitive delayed payoff is treated as equivalent.
      CARD_CATALOG.get(beforeMinion.cardId)?.effects.some(
        (effect) => effect.trigger !== 'aura'
      )
    )
      return unchanged()
    const players = after.state.players.map((player) =>
      player.participantId === actorId
        ? {
            ...player,
            board: player.board.map((minion) =>
              minion.instanceId === minionId
                ? {
                    ...minion,
                    lastAttackedOnTurn: beforeMinion.lastAttackedOnTurn,
                    attacksUsedThisTurn: beforeMinion.attacksUsedThisTurn
                  }
                : minion
            )
          }
        : player
    )
    const comparable: OpeningMatchCheckpoint = {
      ...after,
      state: {
        ...after.state,
        revision: before.state.revision,
        players: [players[0]!, players[1]!]
      }
    }
    if (stop()) {
      stats.abstained = true
      return unchanged()
    }
    return moreFaceDamageWithSameResources(before, comparable, actorId)
      ? { commands: [...commands.slice(1), extra, first], stats }
      : unchanged()
  } finally {
    stats.durationMs = Math.max(0, now() - started)
  }
}
