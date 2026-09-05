import { CARD_CATALOG, isCardEffectObject } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningPlayerState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { AiTacticalProof } from './ai-types'
import {
  STRATEGIC_AI_EVALUATOR_WEIGHTS,
  evaluatePosition,
  type AiEvaluatorWeights
} from './evaluator'
import {
  activeParticipant,
  canonicalCommandKey,
  enumerateLegalCommands
} from './legal-commands'
import { commandUsesUncertainty } from './uncertainty'

/**
 * Tactical profitability compares positions, not turn-phase bookkeeping:
 * merely spending mana or holding the initiative must not register as an
 * outcome (AI plan: mana expenditure or a generic synergy is never enough to
 * justify a cost).
 */
const TACTICAL_EVALUATION_WEIGHTS: AiEvaluatorWeights = {
  ...STRATEGIC_AI_EVALUATOR_WEIGHTS,
  components: {
    ...STRATEGIC_AI_EVALUATOR_WEIGHTS.components,
    manaEfficiency: 0,
    initiative: 0
  }
}

function tacticalEvaluation(
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId
): number {
  return evaluatePosition(
    state,
    perspectivePlayerId,
    undefined,
    TACTICAL_EVALUATION_WEIGHTS
  ).score
}

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
  return commandUsesUncertainty(command, state)
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

function spellDamageOf(player: OpeningPlayerState): number {
  return (
    player.board.reduce((total, minion) => total + (minion.spellDamage ?? 0), 0) +
    (player.hero.spellDamage ?? 0)
  )
}

/**
 * Enemy-hero damage this command can produce, plus enabling potential (attack
 * buffs, charge bodies, taunt removal that unblocks attackers). Commands with
 * no lethal relevance score zero and are excluded from the focused proof.
 */
function lethalCommandPotential(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId
): number {
  const self = state.players.find(
    (player) => player.participantId === perspectivePlayerId
  )
  if (!self) return 0
  const enemyId = state.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!.participantId
  const spellDamage = spellDamageOf(self)
  const attackerDamage = (
    ref: { kind: 'hero' } | { kind: 'minion'; instanceId: string }
  ): number => {
    if (ref.kind === 'hero') return self.hero.attack + (self.weapon?.attack ?? 0)
    const minion = self.board.find((entry) => entry.instanceId === ref.instanceId)
    return minion ? Math.max(0, minion.attack) : 0
  }
  if (command.type === 'attack-character') {
    return command.defender.kind === 'hero' ? attackerDamage(command.attacker) : 0
  }
  if (command.type === 'use-hero-power') {
    const power = HERO_POWER_CATALOG.get(self.heroPower.id)
    if (power?.effect.kind === 'damage-enemy-hero')
      return power.effect.amount + spellDamage
    if (!command.target) return 0
    const facesEnemyHero =
      command.target.kind === 'hero' && command.target.participantId === enemyId
    if (!facesEnemyHero) return 0
    if (power?.effect.kind === 'damage-character')
      return power.effect.amount + spellDamage
    return 0
  }
  if (command.type !== 'play-card') return 0
  const cardId = commandCardId(command, state)
  const definition = cardId ? CARD_CATALOG.get(cardId) : undefined
  if (!definition) return 0
  const cost = definition.cost
  if (cost > self.mana.available) return 0
  let potential = 0
  for (const trigger of definition.effects ?? []) {
    for (const action of trigger.actions ?? []) {
      const target = isCardEffectObject(action.target) ? action.target : null
      if (
        action.action === 'gain-mana' &&
        action.player === 'self' &&
        typeof action.amount === 'number' &&
        action.amount > 0
      )
        potential += action.amount
      if (action.action === 'damage' && typeof action.amount === 'number' && target) {
        const amount = action.amount + spellDamage
        if (target['selection'] === 'all') {
          if (
            (target['controller'] === 'opponent' || target['controller'] === 'any') &&
            (target['type'] === 'hero' || target['type'] === 'character')
          )
            potential += amount
        } else if (target['selection'] === 'chosen') {
          const hitsEnemyHero = (command.targets ?? []).some(
            (target) => target.kind === 'hero' && target.participantId === enemyId
          )
          if (hitsEnemyHero) potential += amount
        }
      }
      if (
        action.action === 'modify' &&
        typeof action.attack === 'number' &&
        action.attack > 0 &&
        target &&
        (target['controller'] === 'self' || target['controller'] === 'any')
      ) {
        // An attack buff converts directly into face damage from a ready body
        // or the hero; count it as enabling potential.
        potential += action.attack
      }
    }
  }
  if (definition.type === 'Minion' && (definition.keywords ?? []).includes('charge'))
    potential += definition.attack ?? 0
  if (definition.type === 'Weapon') potential += definition.attack ?? 0
  // Removal that unblocks attackers: damaging an enemy minion enables face
  // attacks when the perspective player holds ready attack damage.
  const readyAttack = self.board.reduce(
    (total, minion) => total + Math.max(0, minion.attack),
    0
  )
  if (potential === 0 && readyAttack > 0) {
    for (const trigger of definition.effects ?? []) {
      for (const action of trigger.actions ?? []) {
        const target = isCardEffectObject(action.target) ? action.target : null
        if (
          (action.action === 'damage' || action.action === 'destroy') &&
          target?.['type'] === 'minion'
        )
          return 1
      }
    }
  }
  return potential
}

/**
 * Focused deterministic lethal proof. The search only enqueues commands that
 * can reduce the enemy hero's health this turn (direct damage, face attacks,
 * attack buffs, charge bodies, or taunt removal that unblocks attackers), and
 * each node performs exactly one engine fork that both resolves the line and
 * enumerates its continuations. This keeps the proof fast enough to finish
 * inside short renderer search slices.
 */
export function proveGuaranteedLethal(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  limits: AiTacticalSolveLimits
): AiTacticalProof {
  // Follow the highest-potential line first. Proving one legal lethal line is
  // existential, so depth-first ordering reaches compact combo lethals without
  // spending a short tactical slice on every shallower permutation first.
  const stack: TurnMatchCommand[][] = [[]]
  let verifiedBranches = 0
  let incomplete = false
  while (stack.length > 0) {
    if (verifiedBranches >= limits.nodeLimit || Date.now() >= limits.deadlineAtMs) {
      incomplete = true
      break
    }
    const line = stack.pop()!
    const visited = match.analyze((fork) => {
      let state = fork.getState()
      for (const command of line) {
        const result = fork.dispatch(command)
        state = result.state
        if (!result.accepted) return { accepted: false as const, state, next: [] }
      }
      if (
        line.length >= limits.depth ||
        activeParticipant(state) !== perspectivePlayerId
      )
        return { accepted: true as const, state, next: [] }
      return {
        accepted: true as const,
        state,
        next: enumerateLegalCommands(fork, perspectivePlayerId)
      }
    })
    verifiedBranches += 1
    if (!visited.accepted) continue
    if (visited.state.winnerId === perspectivePlayerId) {
      return {
        kind: 'guaranteed-lethal',
        proven: true,
        complete: true,
        commands: line,
        verifiedBranches,
        annotation:
          'Every action in the focused enemy-hero damage line is deterministic and engine-accepted.'
      }
    }
    const prioritized = visited.next
      .map((command) => ({
        command,
        potential: lethalCommandPotential(command, visited.state, perspectivePlayerId)
      }))
      .filter((entry) => entry.potential > 0)
      .sort(
        (left, right) =>
          right.potential - left.potential ||
          canonicalCommandKey(left.command).localeCompare(
            canonicalCommandKey(right.command)
          )
      )
    for (const entry of [...prioritized].reverse()) {
      if (entry.command.type === 'end-turn' || mayBranch(entry.command, visited.state))
        continue
      stack.push([...line, entry.command])
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
      : 'No deterministic lethal was found within the complete focused damage tree.'
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
    tacticalEvaluation(after, perspectivePlayerId) >
      tacticalEvaluation(before, perspectivePlayerId)
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
  const baseline = tacticalEvaluation(match.getState(), perspectivePlayerId)
  const result = findDeterministicLine(
    match,
    perspectivePlayerId,
    { ...limits, depth: Math.min(1, limits.depth) },
    (state, line) =>
      line.length === 1 &&
      state.loserId !== perspectivePlayerId &&
      tacticalEvaluation(state, perspectivePlayerId) > baseline
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
  const baseline = tacticalEvaluation(match.getState(), perspectivePlayerId)
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
          tacticalEvaluation(state, perspectivePlayerId) > baseline)
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
