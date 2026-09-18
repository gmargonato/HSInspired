import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  OpeningMatchAnalysis,
  OpeningMatchCommand,
  PlayCardInput
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  })
}

export function canonicalCommandKey(command: OpeningMatchCommand): string {
  return stable(command)
}

function targetKey(target: CardPlayTargetRef): string {
  return stable(target)
}

function targetAssignments(input: PlayCardInput): readonly CardPlayTargetRef[][] {
  if (input.legalTargetOptions.length === 0) return [[]]
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

/** Produces every command the engine currently accepts for this player. */
export function enumerateLegalCommands(
  match: Pick<OpeningMatchAnalysis, 'getState' | 'getPlayInput' | 'getLegality'>,
  participantId: PlayerId
): readonly OpeningMatchCommand[] {
  const state = match.getState()
  if (state.phase === 'ended' || state.pendingResolution) return []
  if (state.phase === 'mulligan') {
    const player = state.players.find((entry) => entry.participantId === participantId)
    if (!player || player.mulliganConfirmed) return []
    return Array.from({ length: 2 ** player.hand.length }, (_, mask) => ({
      type: 'confirm-mulligan' as const,
      participantId,
      replaceInstanceIds: player.hand
        .filter((_card, index) => (mask & (1 << index)) !== 0)
        .map((card) => card.instanceId)
    }))
  }
  if (state.pendingDiscover?.participantId === participantId) {
    return state.pendingDiscover.candidates.map((card) => ({
      type: 'choose-discover-card',
      participantId,
      cardInstanceId: card.instanceId
    }))
  }
  if (state.pendingCardChoice?.participantId === participantId) {
    return state.pendingCardChoice.options.map((option) => ({
      type: 'choose-card-option',
      participantId,
      sourceCardInstanceId: state.pendingCardChoice!.sourceCardInstanceId,
      choice: option.choice
    }))
  }

  if (
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.activePlayerId !== participantId
  )
    return []
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  if (!player) return []
  const legality = match.getLegality(participantId)
  const commands: OpeningMatchCommand[] = []

  for (const cardInstanceId of legality.playableCardInstanceIds) {
    const base = match.getPlayInput(participantId, cardInstanceId)
    if (!base) continue
    for (const choice of base.choiceCount > 0 ? base.legalChoices : [undefined]) {
      const input =
        choice === undefined
          ? base
          : match.getPlayInput(participantId, cardInstanceId, choice)
      if (!input) continue
      for (const position of input.requiresPosition
        ? input.legalPositions
        : [undefined]) {
        for (const targets of targetAssignments(input)) {
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

  for (const [attackerId, targets] of Object.entries(legality.legalAttackTargets)) {
    const attacker: AttackCharacterRef =
      attackerId === `${participantId}:hero`
        ? { kind: 'hero' }
        : { kind: 'minion', instanceId: attackerId }
    for (const defender of targets) {
      commands.push({ type: 'attack-character', participantId, attacker, defender })
    }
  }

  if (legality.legalHeroPower) {
    const targets =
      legality.legalHeroPowerTargets.length > 0
        ? legality.legalHeroPowerTargets
        : [undefined]
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
