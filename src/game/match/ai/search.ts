import { CARD_CATALOG, isCardEffectObject } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type {
  AiCandidateDossier,
  AiSearchLimits,
  AiStrategicPlanView,
  AiTacticalProofKind
} from './ai-types'
import { evaluatePosition } from './evaluator'
import {
  activeParticipant,
  canonicalCommandKey,
  enumerateLegalCommands
} from './legal-commands'
import { hashAiState, AiTranspositionCache } from './state-hash'
import {
  classifyTacticalLine,
  proveGuaranteedLethal,
  type AiTacticalSolveLimits
} from './tactics'

export interface AiSearchRootAction {
  readonly actionId: string
  readonly command: TurnMatchCommand
}

export interface AiCompetitiveSearchOptions {
  /**
   * When false, skip the fair-coverage baseline pass. The caller must already
   * hold baseline dossiers for these roots from an earlier pass (used by the
   * controller's round-robin deepening rounds).
   */
  readonly baselinePass?: boolean
  /** Return after guaranteed root baselines without expanding continuations. */
  readonly baselineOnly?: boolean
}

export interface AiCompetitiveSearchResult {
  readonly dossiers: readonly AiCandidateDossier[]
  readonly exploredNodes: number
  readonly cacheHits: number
  readonly partial: boolean
  readonly elapsedMs: number
}

interface SearchLine {
  readonly commands: readonly TurnMatchCommand[]
  readonly state: OpeningMatchState
  readonly score: number
  readonly completeTurn: boolean
  readonly usesUncertainty: boolean
}

interface TurnExpansion {
  readonly complete: readonly SearchLine[]
  readonly partial: readonly SearchLine[]
}

/**
 * Tactical proofs that can justify direct damage to the AI hero or friendly
 * minions. A self-harm line carrying one of these is a real tactical outcome
 * (lethal, survival, or a board swing), not destructive waste.
 */
const COMPENSATING_PROOF_KINDS: ReadonlySet<AiTacticalProofKind> = new Set([
  'guaranteed-lethal',
  'forced-survival',
  'board-clear',
  'efficient-trade',
  'required-combo-sequence'
])

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

function legalAfter(
  match: OpeningMatchInstance,
  commands: readonly TurnMatchCommand[],
  participantId: PlayerId
): readonly TurnMatchCommand[] {
  return match.analyze((fork) => {
    for (const command of commands) {
      if (!fork.dispatch(command).accepted) return []
    }
    return enumerateLegalCommands(fork, participantId)
  })
}

function commandUsesUncertainty(
  command: TurnMatchCommand,
  state: OpeningMatchState
): boolean {
  const opponent = state.players.find(
    (player) => player.participantId !== command.participantId
  )
  if ((opponent?.secrets ?? []).some((secret) => !secret.revealed)) return true
  if (command.type !== 'play-card') return false
  const card = state.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  const effects = JSON.stringify(
    card ? (CARD_CATALOG.get(card.cardId)?.effects ?? []) : []
  ).toLowerCase()
  return /random|discover|shuffle|generate|draw/.test(effects)
}

function effectiveHealth(state: OpeningMatchState, playerId: PlayerId): number {
  const player = state.players.find((candidate) => candidate.participantId === playerId)
  return player ? player.hero.health + player.hero.armor : 0
}

function boardAttack(state: OpeningMatchState, playerId: PlayerId): number {
  return (
    state.players
      .find((candidate) => candidate.participantId === playerId)
      ?.board.reduce((total, minion) => total + minion.attack, 0) ?? 0
  )
}

function resourceUsage(
  before: OpeningMatchState,
  after: OpeningMatchState,
  playerId: PlayerId,
  plan?: AiStrategicPlanView
): AiCandidateDossier['resourceUsage'] {
  const first = before.players.find((player) => player.participantId === playerId)!
  const last = after.players.find((player) => player.participantId === playerId)!
  const reserved = new Set(plan?.reservedCardIds ?? [])
  const reservedBefore = first.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  const reservedAfter = last.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  return {
    manaSpent: Math.max(0, first.mana.available - last.mana.available),
    cardsSpent: Math.max(0, first.hand.length - last.hand.length),
    reservedResourceCost: Math.max(0, reservedBefore - reservedAfter)
  }
}

function lineKey(commands: readonly TurnMatchCommand[]): string {
  return commands.map(canonicalCommandKey).join('|')
}

/**
 * Over-estimate of the damage the participant could deal to the opposing hero
 * this turn. Used only to skip the guaranteed-lethal proof when lethal is
 * impossible; any over-count merely keeps the proof running, which is safe.
 */
function maximumReachableDamage(
  state: OpeningMatchState,
  participantId: PlayerId
): number {
  const self = state.players.find((player) => player.participantId === participantId)
  if (!self) return 0
  const boardPotential = self.board.reduce(
    (total, minion) =>
      total + Math.max(0, minion.attack) * Math.max(1, minion.maxAttacksPerTurn ?? 1),
    0
  )
  const weaponPotential = self.weapon
    ? Math.max(0, self.weapon.attack) * Math.max(1, self.weapon.durability)
    : 0
  const heroPotential = Math.max(0, self.hero.attack)
  const spellDamage =
    self.board.reduce((total, minion) => total + (minion.spellDamage ?? 0), 0) +
    (self.hero.spellDamage ?? 0)
  const power = HERO_POWER_CATALOG.get(self.heroPower.id)
  let powerPotential = 0
  if (self.heroPower.available && self.heroPower.cost <= self.mana.available) {
    const overrideDamage = self.heroPower.effectOverride?.damage ?? 0
    if (
      power?.effect.kind === 'damage-enemy-hero' ||
      power?.effect.kind === 'damage-character'
    )
      powerPotential = Math.max(overrideDamage, power.effect.amount)
  }
  let handPotential = 0
  for (const card of self.hand) {
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition) continue
    const cost = card.currentCost ?? definition.cost
    if (cost > self.mana.available) continue
    for (const trigger of definition.effects ?? []) {
      for (const action of trigger.actions ?? []) {
        const target = isCardEffectObject(action.target) ? action.target : null
        if (action.action === 'damage' && typeof action.amount === 'number')
          handPotential += action.amount + spellDamage
        // An attack buff converts into extra face damage from a ready body or
        // the hero, so it counts toward the lethal plausibility bound.
        if (
          action.action === 'modify' &&
          typeof action.attack === 'number' &&
          action.attack > 0 &&
          target &&
          (target['controller'] === 'self' || target['controller'] === 'any')
        )
          handPotential += action.attack
      }
    }
    if (definition.type === 'Minion' && (definition.keywords ?? []).includes('charge'))
      handPotential += definition.attack ?? 0
  }
  return (
    boardPotential + weaponPotential + heroPotential + powerPotential + handPotential
  )
}

interface SelfDamageClassification {
  readonly isSelfDamage: boolean
  /** Groups equivalent target variants of the same source (card instance or hero power). */
  readonly siblingKey: string | null
}

function targetedDamageEffects(
  command: TurnMatchCommand,
  state: OpeningMatchState
): readonly unknown[] {
  if (command.type !== 'play-card') return []
  const card = state.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
  return (definition?.effects ?? []).flatMap((trigger) =>
    (trigger.actions ?? []).filter((action) => {
      const target = isCardEffectObject(action.target) ? action.target : null
      return (
        action.action === 'damage' &&
        target?.['controller'] === 'any' &&
        target['selection'] === 'chosen'
      )
    })
  )
}

/**
 * Outcome-based self-harm classifier (AI plan phase 3): direct damage whose
 * chosen targets are all on the AI's own side. Buff-style friendly targeting
 * (Power Overwhelming and similar) is not classified as self-harm.
 */
function classifySelfDamage(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId
): SelfDamageClassification {
  if (command.type === 'play-card' && (command.targets ?? []).length > 0) {
    if (targetedDamageEffects(command, state).length === 0)
      return { isSelfDamage: false, siblingKey: null }
    const ownSide = (command.targets ?? []).every(
      (target) => target.participantId === perspectivePlayerId
    )
    return {
      isSelfDamage: ownSide,
      siblingKey: ownSide ? `card:${command.cardInstanceId}` : null
    }
  }
  if (command.type === 'use-hero-power' && command.target) {
    const player = state.players.find(
      (candidate) => candidate.participantId === perspectivePlayerId
    )
    const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
    const damaging =
      power?.effect.kind === 'damage-character' ||
      power?.effect.kind === 'damage-enemy-hero'
    if (!damaging) return { isSelfDamage: false, siblingKey: null }
    const ownSide = command.target.participantId === perspectivePlayerId
    return { isSelfDamage: ownSide, siblingKey: ownSide ? 'hero-power' : null }
  }
  return { isSelfDamage: false, siblingKey: null }
}

/**
 * Iterative, deterministic complete-turn search. Every simulation is executed
 * on the engine's restoring analysis fork; the authoritative match is never
 * advanced and no private order is serialized to the worker/provider.
 *
 * Coverage policy: every root first receives a cheap baseline dossier (the
 * root command followed by passing), then roots are deep-expanded in order
 * until the budget ends. A root is never left unevaluated, and deep analysis
 * replaces the baseline only with complete-turn lines, so partial results
 * cannot masquerade as fully searched actions.
 */
export function searchCompetitiveTurn(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  roots: readonly AiSearchRootAction[],
  limits: AiSearchLimits,
  plan?: AiStrategicPlanView,
  cache = new AiTranspositionCache<Readonly<{ readonly score: number }>>(
    limits.transpositionCapacity
  ),
  options: AiCompetitiveSearchOptions = {}
): AiCompetitiveSearchResult {
  const startedAt = Date.now()
  const deadlineAtMs = startedAt + limits.timeBudgetMs
  const initial = match.getState()
  const opponentId = initial.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!.participantId
  let exploredNodes = 0
  let partial = false

  const scoreState = (state: OpeningMatchState): number => {
    const key = `${perspectivePlayerId}:${hashAiState(state)}`
    const cached = cache.get(key)
    if (cached) return cached.score
    const score = evaluatePosition(state, perspectivePlayerId, plan).score
    cache.set(key, { score })
    return score
  }

  const expandTurn = (
    prefix: readonly TurnMatchCommand[],
    participantId: PlayerId,
    beamWidth: number,
    prefixUsesUncertainty: boolean,
    rootAction?: AiSearchRootAction
  ): TurnExpansion => {
    const initialSimulation = simulate(match, prefix)
    if (!initialSimulation.accepted) return { complete: [], partial: [] }
    let frontier: SearchLine[] = [
      {
        commands: prefix,
        state: initialSimulation.state,
        score: scoreState(initialSimulation.state),
        completeTurn: activeParticipant(initialSimulation.state) !== participantId,
        usesUncertainty: prefixUsesUncertainty
      }
    ]
    const completed: SearchLine[] = []
    for (
      let depth = prefix.length;
      depth < limits.atomicDepth && frontier.length > 0;
      depth += 1
    ) {
      if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
        partial = true
        break
      }
      const next: SearchLine[] = []
      for (const line of frontier) {
        if (line.completeTurn || line.state.phase === 'ended') {
          completed.push(line)
          continue
        }
        const commands = legalAfter(match, line.commands, participantId)
        for (const command of commands) {
          if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
            partial = true
            break
          }
          exploredNodes += 1
          const sequence = [...line.commands, command]
          const result = simulate(match, sequence)
          if (!result.accepted) continue
          const completeTurn =
            result.state.phase === 'ended' ||
            activeParticipant(result.state) !== participantId
          next.push({
            commands: sequence,
            state: result.state,
            score: scoreState(result.state),
            completeTurn,
            usesUncertainty:
              line.usesUncertainty || commandUsesUncertainty(command, line.state)
          })
        }
      }
      const collapsed = new Map<string, SearchLine>()
      for (const line of next) {
        const firstKey = rootAction
          ? rootAction.actionId
          : canonicalCommandKey(line.commands[prefix.length] ?? line.commands[0]!)
        const key = `${firstKey}:${hashAiState(line.state)}`
        const current = collapsed.get(key)
        const preferable =
          participantId === perspectivePlayerId
            ? !current || line.score > current.score
            : !current || line.score < current.score
        if (preferable) collapsed.set(key, line)
      }
      frontier = [...collapsed.values()]
        .sort((left, right) =>
          participantId === perspectivePlayerId
            ? right.score - left.score ||
              lineKey(left.commands).localeCompare(lineKey(right.commands))
            : left.score - right.score ||
              lineKey(left.commands).localeCompare(lineKey(right.commands))
        )
        .slice(0, beamWidth)
    }
    const complete = [...completed, ...frontier.filter((line) => line.completeTurn)]
    const stillPartial = frontier.filter((line) => !line.completeTurn)
    return { complete, partial: stillPartial }
  }

  const dossierFor = (
    root: AiSearchRootAction,
    ownLine: SearchLine,
    strongestResponse: SearchLine,
    opponentCommands: readonly TurnMatchCommand[],
    responseIsPartial: boolean,
    evaluation: Readonly<{
      readonly score: number
      readonly components: AiCandidateDossier['evaluation']
    }>,
    lethalProofCommands: readonly TurnMatchCommand[] | null
  ): AiCandidateDossier => {
    const tacticalProofs = [
      ...classifyTacticalLine(
        initial,
        ownLine.state,
        perspectivePlayerId,
        ownLine.commands
      ),
      ...(lethalProofCommands
        ? [
            {
              kind: 'guaranteed-lethal' as const,
              proven: true,
              complete: true,
              commands: lethalProofCommands,
              verifiedBranches: 1,
              annotation: 'The global guaranteed-lethal proof begins with this action.'
            }
          ]
        : [])
    ]
    const matchupPlanProgress =
      evaluation.components.matchupProgress + evaluation.components.comboProgress
    return {
      actionId: root.actionId,
      firstCommand: root.command,
      recommendedContinuation: ownLine.commands.slice(1),
      projectedSuccessor: {
        revision: strongestResponse.state.revision,
        winnerId: strongestResponse.state.winnerId,
        selfEffectiveHealth: effectiveHealth(
          strongestResponse.state,
          perspectivePlayerId
        ),
        opponentEffectiveHealth: effectiveHealth(strongestResponse.state, opponentId),
        selfBoardAttack: boardAttack(strongestResponse.state, perspectivePlayerId),
        opponentBoardAttack: boardAttack(strongestResponse.state, opponentId)
      },
      opponentStrongestResponse: opponentCommands,
      tacticalProofs,
      evaluation: evaluation.components,
      score: evaluation.score,
      meanScenarioValue: evaluation.score,
      downsideScenarioValue: evaluation.score,
      worstCaseScenarioValue: evaluation.score,
      resourceUsage: resourceUsage(initial, ownLine.state, perspectivePlayerId, plan),
      uncertainty: {
        determinizations: strongestResponse.usesUncertainty
          ? limits.determinizations
          : 1,
        randomOutcomeSamples: strongestResponse.usesUncertainty
          ? limits.randomOutcomeSamples
          : 1,
        incomplete:
          strongestResponse.usesUncertainty ||
          partial ||
          responseIsPartial ||
          !ownLine.completeTurn
      },
      matchupPlanProgress
    }
  }

  // The guaranteed-lethal proof only runs when reachable damage makes lethal
  // plausible, never consumes more than half the search budget, and is fast
  // enough (focused enemy-hero damage lines) to finish inside short slices.
  // An impossible or slow proof must not starve root coverage.
  const opponentEffectiveHealth = effectiveHealth(initial, opponentId)
  const lethalPlausible =
    maximumReachableDamage(initial, perspectivePlayerId) >= opponentEffectiveHealth
  let lethalProof: ReturnType<typeof proveGuaranteedLethal> = {
    kind: 'guaranteed-lethal',
    proven: false,
    complete: true,
    commands: [],
    verifiedBranches: 0,
    annotation:
      'Skipped: the maximum reachable damage this turn cannot reduce the opposing hero.'
  }
  if (lethalPlausible && options.baselinePass !== false) {
    const proofLimits: AiTacticalSolveLimits = {
      depth: Math.min(limits.atomicDepth, 12),
      nodeLimit: Math.min(limits.nodeLimit, 12_000),
      deadlineAtMs: Math.min(
        deadlineAtMs,
        Date.now() + Math.max(1, Math.floor(limits.timeBudgetMs * 0.5))
      )
    }
    lethalProof = proveGuaranteedLethal(match, perspectivePlayerId, proofLimits)
  }
  const lethalFirstKey =
    lethalProof.proven && lethalProof.commands.length > 0
      ? canonicalCommandKey(lethalProof.commands[0]!)
      : null

  const dossiersByAction = new Map<string, AiCandidateDossier>()

  // Fair minimum coverage: every root gets a cheap one-action baseline
  // dossier before any root is deep-expanded. The baseline evaluates the
  // resolved successor of the root command alone and is always marked
  // incomplete so ranking treats it as a floor, not a searched action.
  if (options.baselinePass !== false) {
    for (const root of roots) {
      // Root coverage is a small, bounded prerequisite rather than optional
      // deep-search work. Do not let wall-clock scheduling leave a legal root
      // completely unrepresented.
      const baseline = simulate(match, [root.command])
      if (!baseline.accepted) continue
      const evaluation = evaluatePosition(baseline.state, perspectivePlayerId, plan)
      const usesUncertainty = commandUsesUncertainty(root.command, initial)
      const dossier = dossierFor(
        root,
        {
          commands: [root.command],
          state: baseline.state,
          score: evaluation.score,
          completeTurn: true,
          usesUncertainty
        },
        {
          commands: [root.command],
          state: baseline.state,
          score: evaluation.score,
          completeTurn: true,
          usesUncertainty
        },
        [],
        true,
        evaluation,
        lethalFirstKey === canonicalCommandKey(root.command)
          ? lethalProof.commands
          : null
      )
      dossiersByAction.set(root.actionId, dossier)
    }
  }

  if (!options.baselineOnly)
    for (const root of roots) {
      if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
        partial = true
        break
      }
      const expansion = expandTurn(
        [root.command],
        perspectivePlayerId,
        limits.ownTurnBeam,
        commandUsesUncertainty(root.command, initial),
        root
      )
      if (expansion.complete.length === 0) continue
      let bestDossier: AiCandidateDossier | null = null
      for (const ownLine of expansion.complete) {
        let strongestResponse: SearchLine = ownLine
        let opponentCommands: readonly TurnMatchCommand[] = []
        let responseIsPartial = false
        if (ownLine.state.phase !== 'ended') {
          const response = expandTurn(
            ownLine.commands,
            opponentId,
            limits.opponentTurnBeam,
            ownLine.usesUncertainty
          )
          const pool =
            response.complete.length > 0 ? response.complete : response.partial
          if (pool.length > 0) {
            const sorted = [...pool].sort(
              (left, right) =>
                left.score - right.score ||
                lineKey(left.commands).localeCompare(lineKey(right.commands))
            )
            strongestResponse = sorted[0]!
            opponentCommands = strongestResponse.commands.slice(ownLine.commands.length)
            responseIsPartial = response.complete.length === 0
          }
        }
        const evaluation = evaluatePosition(
          strongestResponse.state,
          perspectivePlayerId,
          plan
        )
        const dossier = dossierFor(
          root,
          ownLine,
          strongestResponse,
          opponentCommands,
          responseIsPartial,
          evaluation,
          lethalFirstKey === canonicalCommandKey(root.command)
            ? lethalProof.commands
            : null
        )
        if (!bestDossier || dossier.score > bestDossier.score) bestDossier = dossier
      }
      if (bestDossier) dossiersByAction.set(root.actionId, bestDossier)
    }

  // Phase-3 self-harm dominance: drop a self-damage target variant when an
  // equivalent enemy-target variant or the pass baseline produces an outcome
  // at least as good and no compensating tactical proof justifies the cost.
  for (const root of roots) {
    const dossier = dossiersByAction.get(root.actionId)
    if (!dossier) continue
    const classification = classifySelfDamage(
      root.command,
      initial,
      perspectivePlayerId
    )
    if (!classification.isSelfDamage || !classification.siblingKey) continue
    if (
      dossier.tacticalProofs.some(
        (proof) =>
          proof.proven && proof.complete && COMPENSATING_PROOF_KINDS.has(proof.kind)
      )
    )
      continue
    let dominated = false
    for (const other of dossiersByAction.values()) {
      if (other.actionId === dossier.actionId) continue
      const otherCommand = other.firstCommand
      let isSibling = false
      if (otherCommand.type === 'play-card' && root.command.type === 'play-card')
        isSibling =
          `card:${otherCommand.cardInstanceId}` === classification.siblingKey &&
          !classifySelfDamage(otherCommand, initial, perspectivePlayerId).isSelfDamage
      if (
        otherCommand.type === 'use-hero-power' &&
        root.command.type === 'use-hero-power'
      )
        isSibling =
          classification.siblingKey === 'hero-power' &&
          !classifySelfDamage(otherCommand, initial, perspectivePlayerId).isSelfDamage
      const isBaseline = otherCommand.type === 'end-turn'
      if ((isSibling || isBaseline) && other.score >= dossier.score) {
        dominated = true
        break
      }
    }
    if (dominated) dossiersByAction.delete(root.actionId)
  }

  const dossiers = [...dossiersByAction.values()].sort(
    (left, right) =>
      right.score - left.score || left.actionId.localeCompare(right.actionId)
  )
  return {
    dossiers,
    exploredNodes,
    cacheHits: cache.hitCount,
    partial,
    elapsedMs: Date.now() - startedAt
  }
}
