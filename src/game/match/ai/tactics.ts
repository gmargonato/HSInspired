import { CARD_CATALOG } from '../../content/cards'
import type {
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { AiTacticalProof } from './ai-types'
import { evaluatePosition } from './evaluator'
import { activeParticipant, enumerateLegalCommands } from './legal-commands'

function commandCardId(
  command: TurnMatchCommand,
  state: OpeningMatchState
): string | null {
  if (command.type !== 'play-card') return null
  return (
    state.players
      .find((player) => player.participantId === command.participantId)
      ?.hand.find((card) => card.instanceId === command.cardInstanceId)?.cardId ?? null
  )
}

function mayBranch(command: TurnMatchCommand, state: OpeningMatchState): boolean {
  const opponent = state.players.find(
    (player) => player.participantId !== command.participantId
  )
  if ((opponent?.secrets ?? []).some((secret) => !secret.revealed)) return true
  const cardId = commandCardId(command, state)
  const definition = cardId ? CARD_CATALOG.get(cardId) : undefined
  const effects = JSON.stringify(definition?.effects ?? []).toLowerCase()
  return /random|discover|shuffle|generate|draw/.test(effects)
}

function simulate(
  match: OpeningMatchInstance,
  commands: readonly TurnMatchCommand[]
): Readonly<{ readonly accepted: boolean; readonly state: OpeningMatchState }> {
  return match.analyze((fork) => {
    let state = fork.getState()
    for (const command of commands) {
      const result = fork.dispatch(command)
      state = result.state
      if (!result.accepted) return { accepted: false, state }
    }
    return { accepted: true, state }
  })
}

export interface AiTacticalSolveLimits {
  readonly depth: number
  readonly nodeLimit: number
  readonly deadlineAtMs: number
}

export function proveGuaranteedLethal(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  limits: AiTacticalSolveLimits
): AiTacticalProof {
  const queue: TurnMatchCommand[][] = [[]]
  let verifiedBranches = 0
  let incomplete = false
  while (queue.length > 0) {
    if (verifiedBranches >= limits.nodeLimit || Date.now() >= limits.deadlineAtMs) {
      incomplete = true
      break
    }
    const line = queue.shift()!
    const simulated = simulate(match, line)
    verifiedBranches += 1
    if (!simulated.accepted) continue
    if (simulated.state.winnerId === perspectivePlayerId) {
      return {
        kind: 'guaranteed-lethal',
        proven: true,
        complete: true,
        commands: line,
        verifiedBranches,
        annotation:
          'Every action in the lethal line is deterministic and engine-accepted.'
      }
    }
    if (
      line.length >= limits.depth ||
      activeParticipant(simulated.state) !== perspectivePlayerId
    )
      continue
    const next = match.analyze((fork) => {
      for (const command of line) {
        if (!fork.dispatch(command).accepted) return []
      }
      return enumerateLegalCommands(fork, perspectivePlayerId)
    })
    for (const command of next) {
      if (command.type === 'end-turn' || mayBranch(command, simulated.state)) continue
      queue.push([...line, command])
    }
  }
  return {
    kind: 'guaranteed-lethal',
    proven: false,
    complete: !incomplete,
    commands: [],
    verifiedBranches,
    annotation: incomplete
      ? 'Lethal search was incomplete; this is not a proof of absence.'
      : 'No deterministic lethal was found within the complete bounded tree.'
  }
}

export function classifyTacticalLine(
  before: OpeningMatchState,
  after: OpeningMatchState,
  perspectivePlayerId: PlayerId,
  commands: readonly TurnMatchCommand[]
): readonly AiTacticalProof[] {
  const selfBefore = before.players.find(
    (player) => player.participantId === perspectivePlayerId
  )!
  const selfAfter = after.players.find(
    (player) => player.participantId === perspectivePlayerId
  )!
  const opponentBefore = before.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!
  const opponentAfter = after.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!
  const proofs: AiTacticalProof[] = []
  const add = (kind: AiTacticalProof['kind'], annotation: string): void => {
    proofs.push({
      kind,
      proven: true,
      complete: true,
      commands,
      verifiedBranches: 1,
      annotation
    })
  }
  if (after.winnerId === perspectivePlayerId)
    add('guaranteed-lethal', 'The resolved deterministic line ends the match in a win.')
  if (opponentBefore.board.length > 0 && opponentAfter.board.length === 0)
    add('board-clear', 'The line removes every opposing board minion.')
  const removedEnemyHealth =
    opponentBefore.board.reduce((sum, minion) => sum + minion.health, 0) -
    opponentAfter.board.reduce((sum, minion) => sum + minion.health, 0)
  const lostFriendlyHealth =
    selfBefore.board.reduce((sum, minion) => sum + minion.health, 0) -
    selfAfter.board.reduce((sum, minion) => sum + minion.health, 0)
  if (removedEnemyHealth > Math.max(0, lostFriendlyHealth))
    add(
      'efficient-trade',
      'The line removes more opposing board health than it sacrifices.'
    )
  if (
    commands.length > 0 &&
    after.winnerId !== opponentAfter.participantId &&
    evaluatePosition(after, perspectivePlayerId).score >
      evaluatePosition(before, perspectivePlayerId).score
  ) {
    add(
      'unconditionally-profitable',
      'The deterministic successor has a strictly higher evaluated position without immediate defeat.'
    )
  }
  return proofs
}

interface ProofSearchResult {
  readonly line: readonly TurnMatchCommand[] | null
  readonly verifiedBranches: number
  readonly complete: boolean
}

function findDeterministicLine(
  match: OpeningMatchInstance,
  participantId: PlayerId,
  limits: AiTacticalSolveLimits,
  predicate: (state: OpeningMatchState, line: readonly TurnMatchCommand[]) => boolean
): ProofSearchResult {
  const queue: TurnMatchCommand[][] = [[]]
  let verifiedBranches = 0
  let complete = true
  while (queue.length > 0) {
    if (verifiedBranches >= limits.nodeLimit || Date.now() >= limits.deadlineAtMs) {
      complete = false
      break
    }
    const line = queue.shift()!
    const result = simulate(match, line)
    verifiedBranches += 1
    if (!result.accepted) continue
    if (predicate(result.state, line)) {
      return { line, verifiedBranches, complete }
    }
    if (activeParticipant(result.state) !== participantId) continue
    if (line.length >= limits.depth) {
      complete = false
      continue
    }
    const next = match.analyze((fork) => {
      for (const command of line) {
        if (!fork.dispatch(command).accepted) return []
      }
      return enumerateLegalCommands(fork, participantId)
    })
    for (const command of next) {
      if (mayBranch(command, result.state)) {
        complete = false
        continue
      }
      queue.push([...line, command])
    }
  }
  return { line: null, verifiedBranches, complete }
}

function solvedProof(
  kind: AiTacticalProof['kind'],
  result: ProofSearchResult,
  success: string,
  failure: string
): AiTacticalProof {
  return {
    kind,
    proven: result.line !== null && result.complete,
    complete: result.complete,
    commands: result.line ?? [],
    verifiedBranches: result.verifiedBranches,
    annotation:
      result.line && result.complete
        ? success
        : result.line
          ? `${success} The wider tree was incomplete, so this remains an annotation.`
          : result.complete
            ? failure
            : `${failure} Search was incomplete; absence is not proven.`
  }
}

export function proveBoardClear(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  limits: AiTacticalSolveLimits
): AiTacticalProof {
  const initialEnemyCount = match
    .getState()
    .players.find((player) => player.participantId !== perspectivePlayerId)!.board
    .length
  const result = findDeterministicLine(
    match,
    perspectivePlayerId,
    limits,
    (state, line) =>
      line.length > 0 &&
      initialEnemyCount > 0 &&
      state.players.find((player) => player.participantId !== perspectivePlayerId)!
        .board.length === 0
  )
  return solvedProof(
    'board-clear',
    result,
    'A deterministic engine-accepted line clears the opposing board.',
    'No deterministic board clear was found.'
  )
}

export function proveEfficientCombatTrade(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  limits: AiTacticalSolveLimits
): AiTacticalProof {
  const initial = match.getState()
  const selfBefore = initial.players.find(
    (player) => player.participantId === perspectivePlayerId
  )!
  const enemyBefore = initial.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!
  const ownValue = selfBefore.board.reduce(
    (total, minion) => total + minion.attack + minion.health,
    0
  )
  const enemyValue = enemyBefore.board.reduce(
    (total, minion) => total + minion.attack + minion.health,
    0
  )
  const result = findDeterministicLine(
    match,
    perspectivePlayerId,
    limits,
    (state, line) => {
      if (!line.some((command) => command.type === 'attack-character')) return false
      const self = state.players.find(
        (player) => player.participantId === perspectivePlayerId
      )!
      const enemy = state.players.find(
        (player) => player.participantId !== perspectivePlayerId
      )!
      const ownLoss =
        ownValue -
        self.board.reduce((total, minion) => total + minion.attack + minion.health, 0)
      const enemyLoss =
        enemyValue -
        enemy.board.reduce((total, minion) => total + minion.attack + minion.health, 0)
      return enemyLoss > Math.max(0, ownLoss)
    }
  )
  return solvedProof(
    'efficient-trade',
    result,
    'A deterministic combat line removes more opposing board value than it loses.',
    'No strictly efficient deterministic combat trade was found.'
  )
}

export function proveUnconditionallyProfitableAction(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  limits: AiTacticalSolveLimits
): AiTacticalProof {
  const baseline = evaluatePosition(match.getState(), perspectivePlayerId).score
  const result = findDeterministicLine(
    match,
    perspectivePlayerId,
    { ...limits, depth: Math.min(1, limits.depth) },
    (state, line) =>
      line.length === 1 &&
      state.loserId !== perspectivePlayerId &&
      evaluatePosition(state, perspectivePlayerId).score > baseline
  )
  return solvedProof(
    'unconditionally-profitable',
    result,
    'The one-action deterministic tree produces a strictly better evaluated position.',
    'No unconditional one-action improvement was found.'
  )
}

export function proveRequiredComboSequence(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  orderedCardIds: readonly string[],
  limits: AiTacticalSolveLimits
): AiTacticalProof {
  const baseline = evaluatePosition(match.getState(), perspectivePlayerId).score
  const result = findDeterministicLine(
    match,
    perspectivePlayerId,
    limits,
    (state, line) => {
      const played = line
        .map((command) => commandCardId(command, match.getState()))
        .filter((cardId): cardId is string => cardId !== null)
      let cursor = 0
      for (const cardId of played) {
        if (cardId === orderedCardIds[cursor]) cursor += 1
      }
      return (
        cursor === orderedCardIds.length &&
        (state.winnerId === perspectivePlayerId ||
          evaluatePosition(state, perspectivePlayerId).score > baseline)
      )
    }
  )
  // Finding the authored order establishes viability, not necessity. Necessity
  // requires excluding every alternative ordering, so incomplete trees remain
  // annotations instead of false proofs.
  return solvedProof(
    'required-combo-sequence',
    result,
    'The ordered combo is legal and advances the position across the verified tree.',
    'The required ordered combo was not established.'
  )
}
