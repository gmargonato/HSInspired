import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  OpeningMatchAnalysis,
  OpeningMatchState,
  PlayCardInput,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

function targetKey(target: CardPlayTargetRef): string {
  return target.kind === 'hero'
    ? `hero:${target.participantId}`
    : `${target.kind}:${target.participantId}:${target.instanceId}`
}

function assignments(input: PlayCardInput): readonly (readonly CardPlayTargetRef[])[] {
  if (input.targetSelectors.length === 0) return [[]]
  const result: CardPlayTargetRef[][] = []
  const visit = (
    index: number,
    chosen: CardPlayTargetRef[],
    used: Set<string>
  ): void => {
    if (index === input.legalTargetOptions.length) {
      result.push([...chosen])
      return
    }
    for (const target of input.legalTargetOptions[index] ?? []) {
      const key = targetKey(target)
      if (used.has(key)) continue
      used.add(key)
      chosen.push(target)
      visit(index + 1, chosen, used)
      chosen.pop()
      used.delete(key)
    }
  }
  visit(0, [], new Set())
  return result
}

export function canonicalCommandKey(command: TurnMatchCommand): string {
  return JSON.stringify(command, Object.keys(command).sort())
}

/** The single domain-owned enumerator used by tactical and strategic search. */
export function enumerateLegalCommands(
  match: OpeningMatchAnalysis,
  participantId: PlayerId
): readonly TurnMatchCommand[] {
  const state = match.getState()
  if (state.pendingDiscover?.participantId === participantId) {
    const pendingDiscover = state.pendingDiscover
    return pendingDiscover.candidates.map((card) => ({
      type: 'choose-discover-card' as const,
      participantId,
      cardInstanceId: card.instanceId
    }))
  }
  if (state.pendingCardChoice?.participantId === participantId) {
    const pendingCardChoice = state.pendingCardChoice
    return pendingCardChoice.options.map((option) => ({
      type: 'choose-card-option' as const,
      participantId,
      sourceCardInstanceId: pendingCardChoice.sourceCardInstanceId,
      choice: option.choice
    }))
  }
  const legality = match.getLegality(participantId)
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  if (!player) return []
  const commands: TurnMatchCommand[] = []
  for (const cardInstanceId of legality.playableCardInstanceIds) {
    const base = match.getPlayInput(participantId, cardInstanceId)
    if (!base) continue
    const choices = base.choiceCount > 0 ? base.legalChoices : [undefined]
    for (const choice of choices) {
      const input =
        choice === undefined
          ? base
          : match.getPlayInput(participantId, cardInstanceId, choice)
      if (!input) continue
      const positions = input.requiresPosition ? input.legalPositions : [undefined]
      for (const position of positions) {
        for (const targets of assignments(input)) {
          commands.push({
            type: 'play-card',
            participantId,
            cardInstanceId,
            ...(choice === undefined ? {} : { choice }),
            ...(position === undefined ? {} : { position }),
            ...(targets.length === 0 ? {} : { targets })
          })
        }
      }
    }
  }
  const opponent = state.players.find(
    (candidate) => candidate.participantId !== participantId
  )
  if (opponent) {
    for (const [attackerId, targets] of Object.entries(legality.legalAttackTargets)) {
      const attacker: AttackCharacterRef =
        attackerId === `${participantId}:hero`
          ? { kind: 'hero' }
          : { kind: 'minion', instanceId: attackerId }
      for (const defender of targets) {
        commands.push({ type: 'attack-character', participantId, attacker, defender })
      }
    }
  }
  if (legality.legalHeroPower) {
    const targets =
      legality.legalHeroPowerTargets.length === 0
        ? [undefined]
        : legality.legalHeroPowerTargets
    for (const target of targets) {
      commands.push({
        type: 'use-hero-power',
        participantId,
        ...(target ? { target } : {})
      })
    }
  }
  if (legality.canEndTurn) commands.push({ type: 'end-turn', participantId })
  return commands.sort((left, right) =>
    canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
  )
}

export function activeParticipant(state: OpeningMatchState): PlayerId | null {
  if (state.phase !== 'turns') return null
  return (
    state.pendingDiscover?.participantId ??
    state.pendingCardChoice?.participantId ??
    state.activePlayerId
  )
}
