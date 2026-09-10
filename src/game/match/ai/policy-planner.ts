import { CARD_CATALOG } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  OpeningMatchCommand,
  OpeningMatchInstance,
  OpeningMatchState
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import {
  activeParticipant,
  canonicalCommandKey,
  canonicalizeEquivalentRootActions,
  enumerateLegalCommands
} from './legal-commands'
import {
  assessPolicySteps,
  type AiPolicyAssessment,
  type AiPolicyAssessmentStep
} from './policy-assessment'

export {
  AI_POLICY_RISK_FLAGS,
  assessPolicyCommand,
  assessPolicySteps
} from './policy-assessment'
export type {
  AiPolicyActionAssessment,
  AiPolicyAssessment,
  AiPolicyAssessmentStep,
  AiPolicyCertainty,
  AiPolicyDeferredEffects,
  AiPolicyEffectSummary,
  AiPolicyRiskFlag
} from './policy-assessment'

export interface AiPolicyOutcome {
  readonly turnNumber: number
  readonly winner: 'self' | 'opponent' | null
  readonly self: AiPolicyPlayerOutcome
  readonly opponent: AiPolicyPlayerOutcome
}

export interface AiPolicyPlayerOutcome {
  readonly health: number
  readonly armor: number
  readonly heroAttack: number
  readonly heroFrozenUntilTurn: number | null
  readonly hand: readonly string[] | number
  readonly deckSize: number
  readonly manaAvailable: number
  readonly manaMaximum: number
  readonly weapon: Readonly<{
    readonly name: string
    readonly attack: number
    readonly durability: number
  }> | null
  readonly board: readonly Readonly<{
    readonly cardId: string
    readonly name: string
    readonly attack: number
    readonly health: number
    readonly frozenUntilTurn: number | null
    readonly keywords: readonly string[]
    readonly rulesText: string
  }>[]
}

export interface EngineVerifiedPolicy {
  readonly id: string
  readonly commands: readonly OpeningMatchCommand[]
  readonly actions: readonly string[]
  readonly completeTurn: boolean
  readonly stopsAtNewInformation: boolean
  readonly assessment: AiPolicyAssessment
  readonly outcome?: AiPolicyOutcome
}

interface InspectedLine {
  readonly commands: readonly OpeningMatchCommand[]
  readonly actions: readonly string[]
  readonly state: OpeningMatchState
  readonly next: readonly OpeningMatchCommand[]
  readonly completeTurn: boolean
  readonly stopsAtNewInformation: boolean
  readonly assessment: AiPolicyAssessment
  readonly outcome?: AiPolicyOutcome
}

const MAX_ROOTS = 32
const MAX_POLICIES = 128
const MAX_NODES = 416
const MAX_CHILDREN = 12
const TIME_BUDGET_MS = 500
const MAX_LETHAL_NODES = 2_000
const LETHAL_TIME_BUDGET_MS = 250
const MAX_LETHAL_DEPTH = 12

export const AI_POLICY_LIMITS = {
  maxRoots: MAX_ROOTS,
  maxPolicies: MAX_POLICIES,
  maxNodes: MAX_NODES,
  maxChildren: MAX_CHILDREN,
  timeBudgetMs: TIME_BUDGET_MS
} as const

export const AI_LETHAL_SEARCH_LIMITS = {
  maxNodes: MAX_LETHAL_NODES,
  timeBudgetMs: LETHAL_TIME_BUDGET_MS,
  maxDepth: MAX_LETHAL_DEPTH
} as const

function cardName(cardId: string): string {
  return CARD_CATALOG.get(cardId)?.name ?? cardId
}

function playerLabel(participantId: PlayerId, perspective: PlayerId): string {
  return participantId === perspective ? 'self' : 'opponent'
}

function minionDescription(
  state: OpeningMatchState,
  participantId: PlayerId,
  instanceId: string
): string {
  const owner = state.players.find((player) => player.participantId === participantId)
  const index =
    owner?.board.findIndex((candidate) => candidate.instanceId === instanceId) ?? -1
  const minion = index >= 0 ? owner?.board[index] : undefined
  return minion
    ? `${cardName(minion.cardId)} [slot ${index + 1}, ${minion.attack}/${minion.health}, id ${instanceId}]`
    : 'unknown minion'
}

function relativeMinionDescription(
  state: OpeningMatchState,
  perspective: PlayerId,
  owner: 'self' | 'opponent',
  instanceId: string
): string {
  const player = state.players.find((candidate) =>
    owner === 'self'
      ? candidate.participantId === perspective
      : candidate.participantId !== perspective
  )
  return player
    ? minionDescription(state, player.participantId, instanceId)
    : 'unknown minion'
}

function targetDescription(
  state: OpeningMatchState,
  target: CardPlayTargetRef,
  perspective: PlayerId
): string {
  const owner = playerLabel(target.participantId, perspective)
  if (target.kind === 'hero') return `${owner} hero`
  if (target.kind === 'minion') {
    return `${owner} ${minionDescription(state, target.participantId, target.instanceId)}`
  }
  if (target.kind === 'weapon') return `${owner} weapon`
  if (target.kind === 'secret') return `${owner} Secret`
  return `${owner} ${target.cardId ? cardName(target.cardId) : 'card'}`
}

function attackDescription(
  state: OpeningMatchState,
  participantId: PlayerId,
  ref: AttackCharacterRef,
  owner: 'self' | 'opponent'
): string {
  if (ref.kind === 'hero') return `${owner} hero`
  return `${owner} ${relativeMinionDescription(state, participantId, owner, ref.instanceId)}`
}

function describeCommand(
  state: OpeningMatchState,
  command: OpeningMatchCommand,
  perspective: PlayerId
): string {
  switch (command.type) {
    case 'play-card': {
      const card = state.players
        .find((player) => player.participantId === command.participantId)
        ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
      const targets = (command.targets ?? []).map((target) =>
        targetDescription(state, target, perspective)
      )
      const targetText = targets.length > 0 ? ` targeting ${targets.join(' and ')}` : ''
      const choiceText =
        command.choice === undefined ? '' : ` using option ${command.choice}`
      return `Play ${card ? cardName(card.cardId) : 'card'}${targetText}${choiceText}.`
    }
    case 'attack-character':
      return `Attack ${attackDescription(
        state,
        perspective,
        command.defender,
        'opponent'
      )} with ${attackDescription(state, perspective, command.attacker, 'self')}.`
    case 'use-hero-power': {
      const player = state.players.find(
        (candidate) => candidate.participantId === command.participantId
      )
      const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
      const target = command.target
        ? ` targeting ${targetDescription(state, command.target, perspective)}`
        : ''
      return `Use ${power?.displayName ?? 'Hero Power'}${target}.`
    }
    case 'choose-discover-card': {
      const card = state.pendingDiscover?.candidates.find(
        (candidate) => candidate.instanceId === command.cardInstanceId
      )
      return `Choose ${card ? cardName(card.cardId) : 'the selected discovered card'}.`
    }
    case 'choose-card-option': {
      const option = state.pendingCardChoice?.options.find(
        (candidate) => candidate.choice === command.choice
      )
      return `Choose ${option?.label ?? `option ${command.choice}`}.`
    }
    case 'end-turn':
      return 'End the turn.'
    default:
      return command.type
  }
}

function hasFacedownOpponentSecret(
  state: OpeningMatchState,
  perspective: PlayerId
): boolean {
  return (
    state.players
      .find((player) => player.participantId !== perspective)
      ?.secrets?.some((secret) => !secret.revealed) === true
  )
}

function cardCreatesNewInformation(cardId: string): boolean {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return true
  return effectsCreateNewInformation(definition.effects)
}

function boardCardCreatesNewInformation(cardId: string): boolean {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return true
  const inactiveOnBoard = new Set([
    'battlecry',
    'cast',
    'on-draw',
    'on-equip',
    'on-play',
    'while-in-hand'
  ])
  return definition.effects.some(
    (block) => !inactiveOnBoard.has(block.trigger) && effectsCreateNewInformation(block)
  )
}

function effectsCreateNewInformation(effectsValue: unknown): boolean {
  const effects = JSON.stringify(effectsValue).toLowerCase()
  return (
    effects.includes('"random') ||
    effects.includes('"action":"draw') ||
    effects.includes('"action":"discover') ||
    effects.includes('"action":"add-to-hand')
  )
}

function commandCreatesNewInformation(
  state: OpeningMatchState,
  command: OpeningMatchCommand,
  perspective: PlayerId
): boolean {
  if (command.type === 'end-turn') return true
  if (hasFacedownOpponentSecret(state, perspective)) return true
  if (
    state.players.some((player) =>
      player.board.some((minion) => boardCardCreatesNewInformation(minion.cardId))
    )
  ) {
    return true
  }
  if (
    command.type === 'choose-discover-card' ||
    command.type === 'choose-card-option'
  ) {
    return true
  }
  if (command.type === 'play-card') {
    const card = state.players
      .find((player) => player.participantId === command.participantId)
      ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
    return !card || cardCreatesNewInformation(card.cardId)
  }
  if (command.type === 'use-hero-power') {
    const player = state.players.find(
      (candidate) => candidate.participantId === command.participantId
    )
    const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
    return (
      power?.effect.kind.includes('random') === true ||
      power?.effect.kind === 'draw-and-self-damage'
    )
  }
  if (command.type === 'attack-character') {
    const cards = state.players.flatMap((player) => player.board)
    return [command.attacker, command.defender].some(
      (ref) =>
        ref.kind === 'minion' &&
        effectsCreateNewInformation(
          cards.find((minion) => minion.instanceId === ref.instanceId)?.deathrattles ??
            []
        )
    )
  }
  return false
}

function outcome(state: OpeningMatchState, perspective: PlayerId): AiPolicyOutcome {
  const playerOutcome = (
    participantId: PlayerId,
    revealHand: boolean
  ): AiPolicyPlayerOutcome => {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )!
    return {
      health: player.hero.health,
      armor: player.hero.armor,
      heroAttack: player.hero.attack + (player.weapon?.attack ?? 0),
      heroFrozenUntilTurn: player.hero.frozenUntilTurn ?? null,
      hand: revealHand
        ? player.hand.map((card) => `${cardName(card.cardId)} (${card.cardId})`)
        : player.hand.length,
      deckSize: player.deck.length,
      manaAvailable: player.mana.available,
      manaMaximum: player.mana.maximum,
      weapon: player.weapon
        ? {
            name: cardName(player.weapon.cardId),
            attack: player.weapon.attack,
            durability: player.weapon.durability
          }
        : null,
      board: player.board.map((minion) => {
        const definition = CARD_CATALOG.get(minion.cardId)
        return {
          cardId: minion.cardId,
          name: definition?.name ?? minion.cardId,
          attack: minion.attack,
          health: minion.health,
          frozenUntilTurn: minion.frozenUntilTurn ?? null,
          keywords: minion.keywords ?? [],
          rulesText: definition?.rulesText ?? ''
        }
      })
    }
  }
  const opponent = state.players.find(
    (player) => player.participantId !== perspective
  )!.participantId
  return {
    turnNumber: state.turnNumber,
    winner:
      state.winnerId === perspective
        ? 'self'
        : state.winnerId === opponent
          ? 'opponent'
          : null,
    self: playerOutcome(perspective, true),
    opponent: playerOutcome(opponent, false)
  }
}

function inspect(
  match: OpeningMatchInstance,
  perspective: PlayerId,
  commands: readonly OpeningMatchCommand[]
): InspectedLine | null {
  return match.analyze((fork) => {
    const executed: OpeningMatchCommand[] = []
    const actions: string[] = []
    const steps: AiPolicyAssessmentStep[] = []
    let boundary = false
    for (const command of commands) {
      const before = fork.getState()
      const action = describeCommand(before, command, perspective)
      actions.push(action)
      boundary = commandCreatesNewInformation(before, command, perspective)
      const result = fork.dispatch(command)
      if (!result.accepted) return null
      executed.push(command)
      steps.push({
        command,
        action,
        before,
        after: result.state,
        events: result.events
      })
      if (boundary) break
    }
    const state = fork.getState()
    const visibleOutcome = boundary ? undefined : outcome(state, perspective)
    const completeTurn =
      state.phase === 'ended' || activeParticipant(state) !== perspective
    return {
      commands: executed,
      actions,
      state,
      next:
        boundary || completeTurn
          ? []
          : canonicalizeEquivalentRootActions(
              state,
              enumerateLegalCommands(fork, perspective).map((command) => ({
                actionId: canonicalCommandKey(command),
                command
              }))
            ).map((root) => root.command),
      completeTurn,
      stopsAtNewInformation: boundary,
      assessment: assessPolicySteps(perspective, steps, state, boundary),
      ...(visibleOutcome ? { outcome: visibleOutcome } : {})
    }
  })
}

function rootGroup(state: OpeningMatchState, command: OpeningMatchCommand): string {
  if (command.type !== 'play-card') return command.type
  const card = state.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  return `play:${card?.cardId ?? command.cardInstanceId}`
}

function diverseRoots(
  state: OpeningMatchState,
  commands: readonly OpeningMatchCommand[]
): readonly OpeningMatchCommand[] {
  const groups = new Map<string, OpeningMatchCommand[]>()
  for (const command of commands) {
    const key = rootGroup(state, command)
    const group = groups.get(key) ?? []
    group.push(command)
    groups.set(key, group)
  }
  const orderedGroups = [...groups.values()]
  const result: OpeningMatchCommand[] = []
  for (let index = 0; result.length < MAX_ROOTS; index += 1) {
    let added = false
    for (const group of orderedGroups) {
      const command = group[index]
      if (!command) continue
      result.push(command)
      added = true
      if (result.length === MAX_ROOTS) break
    }
    if (!added) break
  }
  return result
}

/**
 * Enumerates short, legal turn policies without assigning strategic scores.
 * Short policies leave the turn open for replanning; ending it is an explicit choice.
 * Every root gets representation before deeper continuations, and the renderer
 * is yielded regularly. The model--not a local weight table--judges the options.
 */
export async function buildEngineVerifiedPolicies(
  match: OpeningMatchInstance,
  perspective: PlayerId
): Promise<readonly EngineVerifiedPolicy[]> {
  const startedAt = performance.now()
  const initial = match.getState()
  const roots = match.analyze((fork) =>
    diverseRoots(
      initial,
      canonicalizeEquivalentRootActions(
        initial,
        enumerateLegalCommands(fork, perspective).map((command) => ({
          actionId: canonicalCommandKey(command),
          command
        }))
      ).map((root) => root.command)
    )
  )
  const linesByRoot = new Map<string, InspectedLine[]>()
  const queue: OpeningMatchCommand[][] = []
  let nodes = 0

  for (const root of roots) {
    if (nodes >= MAX_NODES) break
    const rootKey = canonicalCommandKey(root)
    const initialLine = inspect(match, perspective, [root])
    nodes += 1
    if (!initialLine) continue
    const lines = [initialLine]
    if (!initialLine.completeTurn && !initialLine.stopsAtNewInformation) {
      for (const next of diverseRoots(initialLine.state, initialLine.next).slice(
        0,
        MAX_CHILDREN
      )) {
        if (next.type !== 'end-turn') queue.push([root, next])
      }
    }
    linesByRoot.set(rootKey, lines)
    if (nodes % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  while (
    queue.length > 0 &&
    nodes < MAX_NODES &&
    performance.now() - startedAt < TIME_BUDGET_MS
  ) {
    const commands = queue.shift()!
    const inspected = inspect(match, perspective, commands)
    nodes += 1
    if (!inspected) continue
    const rootKey = canonicalCommandKey(commands[0]!)
    const collected = linesByRoot.get(rootKey) ?? []
    collected.push(inspected)
    linesByRoot.set(rootKey, collected)
    if (nodes % 8 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  const selected: InspectedLine[] = []
  const perRoot = roots.map((root) => {
    const key = canonicalCommandKey(root)
    return linesByRoot.get(key) ?? []
  })
  for (let index = 0; selected.length < MAX_POLICIES; index += 1) {
    let added = false
    for (const lines of perRoot) {
      const line = lines[index]
      if (!line) continue
      selected.push(line)
      added = true
      if (selected.length === MAX_POLICIES) break
    }
    if (!added) break
  }

  return selected.map((line, index) => ({
    id: `policy-${index}`,
    commands: line.commands,
    actions: line.actions,
    completeTurn: line.completeTurn,
    stopsAtNewInformation: line.stopsAtNewInformation,
    assessment: line.assessment,
    ...(line.outcome ? { outcome: line.outcome } : {})
  }))
}

export interface AiLethalSearchResult {
  readonly policy: EngineVerifiedPolicy | null
  readonly expandedNodes: number
  readonly elapsedMs: number
  readonly exhausted: boolean
}

function commandLethalPriority(
  state: OpeningMatchState,
  command: OpeningMatchCommand
): number {
  if (command.type === 'attack-character') return 0
  if (command.type === 'use-hero-power') {
    const owner = state.players.find(
      (player) => player.participantId === command.participantId
    )
    const effect = owner
      ? HERO_POWER_CATALOG.get(owner.heroPower.id)?.effect
      : undefined
    return effect?.kind.includes('damage') ? 1 : 4
  }
  if (command.type === 'play-card') {
    const card = state.players
      .find((player) => player.participantId === command.participantId)
      ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
    const actions = card
      ? JSON.stringify(CARD_CATALOG.get(card.cardId)?.effects).toLowerCase()
      : ''
    if (actions.includes('"action":"damage"')) return 1
    if (actions.includes('"action":"destroy"')) return 2
    if (actions.includes('"action":"buff"') || actions.includes('"action":"modify"'))
      return 3
    return 5
  }
  if (command.type === 'end-turn') return 99
  return 6
}

function prioritizeLethalCommands(
  state: OpeningMatchState,
  commands: readonly OpeningMatchCommand[]
): readonly OpeningMatchCommand[] {
  return [...commands].sort(
    (left, right) =>
      commandLethalPriority(state, left) - commandLethalPriority(state, right) ||
      canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
  )
}

function commandPathKey(commands: readonly OpeningMatchCommand[]): string {
  return commands.map(canonicalCommandKey).join('\u0000')
}

/**
 * Searches the full deterministic command frontier for a guaranteed win before
 * asking the provider to rank ordinary policies. New-information boundaries
 * are terminal for this search because their result cannot be proven fairly.
 */
export async function findGuaranteedLethalPolicy(
  match: OpeningMatchInstance,
  perspective: PlayerId
): Promise<AiLethalSearchResult> {
  const startedAt = performance.now()
  const roots = match.analyze((fork) => enumerateLegalCommands(fork, perspective))
  const queue: OpeningMatchCommand[][] = prioritizeLethalCommands(
    match.getState(),
    roots
  ).map((command) => [command])
  const seen = new Set<string>(queue.map(commandPathKey))
  let expandedNodes = 0

  while (
    queue.length > 0 &&
    expandedNodes < MAX_LETHAL_NODES &&
    performance.now() - startedAt < LETHAL_TIME_BUDGET_MS
  ) {
    const commands = queue.shift()!
    const line = inspect(match, perspective, commands)
    expandedNodes += 1
    if (line?.assessment.guaranteedLethal && line.outcome?.winner === 'self') {
      return {
        policy: {
          id: 'engine-guaranteed-lethal',
          commands: line.commands,
          actions: line.actions,
          completeTurn: line.completeTurn,
          stopsAtNewInformation: line.stopsAtNewInformation,
          assessment: line.assessment,
          ...(line.outcome ? { outcome: line.outcome } : {})
        },
        expandedNodes,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
        exhausted: false
      }
    }
    if (
      !line ||
      line.completeTurn ||
      line.stopsAtNewInformation ||
      commands.length >= MAX_LETHAL_DEPTH
    ) {
      continue
    }
    for (const next of prioritizeLethalCommands(line.state, line.next)) {
      const extended = [...commands, next]
      const key = commandPathKey(extended)
      if (seen.has(key)) continue
      seen.add(key)
      queue.push(extended)
    }
    if (expandedNodes % 32 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  return {
    policy: null,
    expandedNodes,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    exhausted:
      queue.length > 0 &&
      (expandedNodes >= MAX_LETHAL_NODES ||
        performance.now() - startedAt >= LETHAL_TIME_BUDGET_MS)
  }
}
