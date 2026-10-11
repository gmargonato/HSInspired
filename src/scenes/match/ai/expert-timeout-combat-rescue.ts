import { CARD_CATALOG } from '../../../game-rules/content/cards'
import type { AiObservation } from '../../../game-rules/match/ai'
import { canonicalCommandKey } from '../../../game-rules/match/ai/legal-commands'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchAnalysis,
  OpeningMatchCheckpoint,
  OpeningMatchState
} from '../../../game-rules/match/opening-match-types'
import type { TurnMatchCommand } from '../../../game-rules/match'
import { effectiveBoardMinionKeywords } from '../../../game-rules/match/rules/minion-attack-state'

type Attack = Extract<TurnMatchCommand, { type: 'attack-character' }>

export const EXPERT_TIMEOUT_COMBAT_RESCUE_MAX_DISPATCHES = 32
const MAX_ATTACKS = 8
const MAX_DEPTH = 2

export interface ExpertTimeoutCombatRescue {
  readonly status: 'rescued' | 'not-found' | 'unknown'
  readonly command?: Attack
  readonly simulations: number
}

/** No trigger interpreter: only plain public combat, including combat keywords. */
function plainCombat(observation: AiObservation, state: OpeningMatchState): boolean {
  return (
    state.phase === 'turns' &&
    !state.pendingResolution &&
    !state.pendingDiscover &&
    !state.pendingCardChoice &&
    !state.scheduledEffects?.length &&
    observation.players.every(
      (player) =>
        !player.weapon &&
        !player.quest &&
        !player.secrets.length &&
        !player.hero.enchantments?.length &&
        player.board.length <= 7 &&
        player.board.every((minion) => {
          const definition = CARD_CATALOG.get(minion.cardId)
          return (
            definition !== undefined &&
            (minion.silenced || definition.effects.length === 0) &&
            !minion.dormant &&
            !minion.enchantments?.length &&
            !minion.grantedTriggers?.length &&
            !minion.attachedEffects?.length &&
            !minion.deathrattles?.length
          )
        })
    )
  )
}

/**
 * Rescue only a would-be pass against one plain public minion attack. A complete
 * two-trade line must remove the opposing board BEFORE its sampled turn draw.
 * This is not a proof against hidden cards, future draws, powers or longer lines.
 * The dispatch cap bounds additional work, not wall time: cloning and bounded
 * attack-legality queries also cost time. No worker/search allowance is added.
 */
export function findExpertTimeoutCombatRescue(
  checkpoint: OpeningMatchCheckpoint,
  observation: AiObservation,
  legalCommands: readonly TurnMatchCommand[]
): ExpertTimeoutCombatRescue {
  let simulations = 0
  let unknown = false
  const result = (command?: Attack): ExpertTimeoutCombatRescue => ({
    status: command ? 'rescued' : unknown ? 'unknown' : 'not-found',
    ...(command ? { command } : {}),
    simulations
  })
  const actorId = observation.perspectivePlayerId
  const enemy = observation.players.find((player) => player.role === 'opponent')
  const target = enemy?.board[0]
  if (
    !plainCombat(observation, checkpoint.state) ||
    observation.activePlayerId !== actorId ||
    !enemy ||
    enemy.board.length !== 1 ||
    enemy.hero.attack !== 0 ||
    !target ||
    (target.maxAttacksPerTurn ?? 1) > 1 ||
    (target.extraAttacksThisTurn ?? 0) > 0 ||
    effectiveBoardMinionKeywords(target, observation.turnNumber + 1).includes(
      'windfury'
    )
  ) {
    unknown = true
    return result()
  }
  const endTurn: TurnMatchCommand = { type: 'end-turn', participantId: actorId }
  const ownAttacks = (commands: readonly TurnMatchCommand[]) => {
    const attacks = commands.filter(
      (command): command is Attack =>
        command.type === 'attack-character' &&
        command.participantId === actorId &&
        command.attacker.kind === 'minion' &&
        command.defender.kind === 'minion'
    )
    if (attacks.length > MAX_ATTACKS) {
      unknown = true
      return undefined
    }
    return attacks.sort((left, right) =>
      canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
    )
  }
  const initial = ownAttacks(legalCommands)
  if (!initial?.length) return result()
  const match = createOpeningMatchFromCheckpoint(
    createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  )
  const dispatch = (fork: OpeningMatchAnalysis, command: TurnMatchCommand) => {
    if (
      simulations >= EXPERT_TIMEOUT_COMBAT_RESCUE_MAX_DISPATCHES ||
      !fork.getRandomState
    ) {
      unknown = true
      return false
    }
    const rng = JSON.stringify(fork.getRandomState())
    simulations++
    const outcome = fork.dispatch(command)
    if (
      !outcome.accepted ||
      rng !== JSON.stringify(fork.getRandomState()) ||
      revealsTacticalInformation(outcome.events, command.type === 'end-turn') ||
      outcome.events.some(
        (event) =>
          event.type === 'trigger-activated' ||
          (event.type === 'effect-resolved' &&
            !(
              (command.type === 'end-turn' &&
                event.action === 'draw' &&
                event.actionPath === 'turn-start.draw' &&
                event.sourceCardId === null) ||
              (command.type === 'attack-character' &&
                event.action === 'damage' &&
                (event.actionPath === 'combat.attacker' ||
                  event.actionPath === 'combat.defender'))
            ))
      ) ||
      outcome.state.pendingResolution ||
      outcome.state.pendingDiscover ||
      outcome.state.pendingCardChoice
    ) {
      unknown = true
      return false
    }
    return true
  }
  const attacks = (fork: OpeningMatchAnalysis, participantId: typeof actorId) => {
    if (!fork.getAttackLegality) {
      unknown = true
      return undefined
    }
    const commands: Attack[] = []
    for (const [attackerId, targets] of Object.entries(
      fork.getAttackLegality(participantId).legalAttackTargets
    )) {
      for (const defender of targets) {
        if (commands.length >= MAX_ATTACKS) {
          unknown = true
          return undefined
        }
        commands.push({
          type: 'attack-character',
          participantId,
          attacker:
            attackerId === `${participantId}:hero`
              ? { kind: 'hero' }
              : { kind: 'minion', instanceId: attackerId },
          defender
        })
      }
    }
    return commands
  }
  const publicLethal = match.analyze((fork) => {
    if (!dispatch(fork, endTurn) || fork.getState().phase !== 'turns') return false
    const reply = attacks(fork, enemy.participantId)?.find(
      (command) =>
        command.attacker.kind === 'minion' &&
        command.attacker.instanceId === target.instanceId &&
        command.defender.kind === 'hero'
    )
    return (
      reply !== undefined &&
      dispatch(fork, reply) &&
      fork.getState().phase === 'ended' &&
      fork.getState().winnerId === enemy.participantId
    )
  })
  if (!publicLethal) return result()

  const visit = (
    fork: OpeningMatchAnalysis,
    candidates: readonly Attack[],
    depth: number
  ): Attack | undefined => {
    for (const command of candidates) {
      if (simulations >= EXPERT_TIMEOUT_COMBAT_RESCUE_MAX_DISPATCHES) {
        unknown = true
        break
      }
      const defended = fork.analyze((child) => {
        if (!dispatch(child, command)) return false
        const state = child.getState()
        if (state.phase !== 'turns' || state.activePlayerId !== actorId) return false
        const opponent = state.players.find(
          (p) => p.participantId === enemy.participantId
        )!
        // Never credit a sampled draw/boundary for removing the public threat.
        if (opponent.board.length === 0 && opponent.hero.attack === 0) {
          return (
            dispatch(child, endTurn) &&
            child.getState().phase === 'turns' &&
            child.getState().activePlayerId === enemy.participantId
          )
        }
        if (depth >= MAX_DEPTH) return false
        const next = attacks(child, actorId)
        return (
          next !== undefined &&
          visit(child, ownAttacks(next) ?? [], depth + 1) !== undefined
        )
      })
      if (defended) return command
    }
    return undefined
  }
  return result(match.analyze((fork) => visit(fork, initial, 1)))
}
