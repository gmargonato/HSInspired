import { CARD_CATALOG } from '../../../game-rules/content'
import type { AiObservedPlayer } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchAnalysis,
  OpeningMatchCheckpoint,
  OpeningMatchState
} from '../../../game-rules/match/opening-match-types'
import type { PlayerId } from '../../../game-rules/match/match-types'
import {
  enumerateLegalCommands,
  type TurnMatchCommand
} from '../../../game-rules/match'
import { effectiveBoardMinionKeywords } from '../../../game-rules/match/rules/minion-attack-state'
import { hasKnownCthunPayoff, unpaidActionPenalty } from './expert-ai-action-safety'
import { wastesImmediateTemporaryMana } from './expert-temporary-mana'
import { wastesEmptySelectorSpell } from './expert-empty-selector'
import { canonicalCommandKey } from '../../../game-rules/match/ai/legal-commands'
import {
  revealsTacticalInformation,
  terminalOutcome,
  type TacticalOutcome
} from '../../../game-rules/match/ai/tactical-search'

export const EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES = 32
export const EXPERT_TERMINAL_SAFETY_MAX_MS = 25

export interface ExpertTerminalInspector {
  (command: TurnMatchCommand): TacticalOutcome
  readonly stats: {
    probes: number
    cacheHits: number
    workAbstentions: number
    timeAbstentions: number
  }
}

/** One command only: never turn a predicted opponent reply into a certain loss. */
export function inspectExpertTerminalAction(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand
): TacticalOutcome {
  return root.analyze((fork) => {
    const state = fork.getState()
    if (
      !fork.getAiObservation ||
      !fork.getRandomState ||
      state.phase !== 'turns' ||
      state.players.some(
        (player) =>
          player.participantId !== actorId &&
          player.secrets?.some((secret) => !secret.revealed)
      )
    )
      return 'unknown'
    const rng = JSON.stringify(fork.getRandomState())
    const result = fork.dispatch(command)
    if (
      !result.accepted ||
      rng !== JSON.stringify(fork.getRandomState()) ||
      revealsTacticalInformation(result.events)
    )
      return 'unknown'
    return terminalOutcome(result.state, actorId)
  })
}

/**
 * Selected-first callers share one fair fork and at most 32 one-command probes.
 * The cap bounds dispatches, not wall time; unknown (including exhaustion) is
 * never a safety proof. Repeated cache checks at the same revision are free.
 */
export function createExpertTerminalInspector(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  maxDispatches = EXPERT_TERMINAL_SAFETY_MAX_DISPATCHES,
  outcomes = new Map<string, TacticalOutcome>(),
  shouldStop: () => boolean = () => false
): ExpertTerminalInspector {
  let match: ReturnType<typeof createOpeningMatchFromCheckpoint> | undefined
  let dispatched = 0
  let first = true
  const stats = { probes: 0, cacheHits: 0, workAbstentions: 0, timeAbstentions: 0 }
  const inspect = (command: TurnMatchCommand): TacticalOutcome => {
    const selected = first
    first = false
    const key = canonicalCommandKey(command)
    const cached = outcomes.get(key)
    if (cached !== undefined) {
      stats.cacheHits++
      return cached
    }
    if (dispatched >= maxDispatches) {
      stats.workAbstentions++
      return 'unknown'
    }
    if (!selected && shouldStop()) {
      stats.timeAbstentions++
      return 'unknown'
    }
    match ??= createOpeningMatchFromCheckpoint(
      createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
    )
    dispatched++
    stats.probes++
    const outcome = match.analyze((fork) =>
      inspectExpertTerminalAction(fork, actorId, command)
    )
    outcomes.set(key, outcome)
    return outcome
  }
  return Object.assign(inspect, { stats })
}

export interface ExpertActionOutcome {
  readonly penalty: number
  /** A witnessed same-play replacement, never an arbitrary unpenalized sibling. */
  readonly preferredAlternativeKey?: string
  readonly reason?:
    | 'no-payoff'
    | 'unpaid-sacrifice'
    | 'unpaid-friendly-damage'
    | 'wasted-healing-target'
    | 'opponent-heal'
    | 'imminent-clear'
    | 'attack-before-buff'
    | 'attack-before-setup'
    | 'wasted-before-clear'
}

/** Conservatively keep setup attacks when a bounded search cannot rule out an answer. */
function canAnswerClear(root: OpeningMatchAnalysis, actorId: PlayerId): boolean {
  let remaining = 48
  const visit = (fork: OpeningMatchAnalysis, depth: number): boolean => {
    const state = fork.getState()
    if (state.phase === 'ended' || !hasImminentBoardClear(state)) return true
    if (
      state.pendingDiscover ||
      state.pendingCardChoice ||
      depth >= 6 ||
      remaining <= 0
    )
      return true
    const commands = enumerateLegalCommands(fork, actorId).filter(
      (c) => c.type !== 'end-turn'
    )
    for (const command of commands) {
      if (--remaining < 0) return true
      if (
        fork.analyze(
          (next) => next.dispatch(command).accepted && visit(next, depth + 1)
        )
      )
        return true
    }
    return false
  }
  return visit(root, 0)
}

/** Penalize only a legal face alternative with a strictly better post-clear result. */
function wastedClearActionPenalty(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: Extract<TurnMatchCommand, { type: 'attack-character' | 'end-turn' }>
): ExpertActionOutcome {
  if (
    (command.type === 'attack-character' &&
      (command.attacker.kind !== 'minion' || command.defender.kind !== 'minion')) ||
    !hasImminentBoardClear(root.getState())
  )
    return { penalty: 0 }
  const attackerId =
    command.type === 'attack-character' && command.attacker.kind === 'minion'
      ? command.attacker.instanceId
      : undefined
  const face = enumerateLegalCommands(root, actorId).find(
    (c) =>
      c.type === 'attack-character' &&
      c.attacker.kind === 'minion' &&
      (attackerId === undefined || c.attacker.instanceId === attackerId) &&
      c.defender.kind === 'hero'
  )
  if (!face) return { penalty: 0 }
  const attacked = root.analyze((fork) => {
    if (command.type === 'attack-character') {
      const result = fork.dispatch(command)
      if (
        !result.accepted ||
        result.state.phase === 'ended' ||
        !hasImminentBoardClear(result.state)
      )
        return undefined
    }
    const boundary = evaluateExpertBoundary(fork, (end) =>
      end === fork || end.getState().phase === 'ended'
        ? undefined
        : end.getAiObservation?.(actorId, 'fair')
    )
    return boundary && (command.type === 'end-turn' || !canAnswerClear(fork, actorId))
      ? boundary
      : undefined
  })
  if (!attacked) return { penalty: 0 }
  return root.analyze((fork) => {
    if (!fork.dispatch(face).accepted) return { penalty: 0 }
    return evaluateExpertBoundary(fork, (end) => {
      if (end === fork || end.getState().phase === 'ended') return { penalty: 0 }
      const alternative = end.getAiObservation?.(actorId, 'fair')
      let damageGain = 0
      const equivalent =
        alternative &&
        attacked.players.every((before) => {
          const after = alternative.players.find(
            (p) => p.participantId === before.participantId
          )!
          if (before.participantId === actorId)
            return position(before) === position(after)
          damageGain =
            before.hero.health +
            before.hero.armor -
            after.hero.health -
            after.hero.armor
          return (
            position(before) ===
            position({
              ...after,
              hero: {
                ...after.hero,
                health: before.hero.health,
                armor: before.hero.armor,
                damageTaken: before.hero.damageTaken
              }
            })
          )
        })
      return equivalent && damageGain > 0
        ? { penalty: 0.25, reason: 'wasted-before-clear' }
        : { penalty: 0 }
    })
  })
}

/** Review later steps of a shortlisted line; root penalties are already counted separately. */
export function expertContinuationPenalty(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  commands: readonly TurnMatchCommand[],
  shouldStop: () => boolean = () => false
): number {
  return root.analyze((fork) => {
    let penalty = 0
    for (let index = 0; index < Math.min(commands.length, 8); index++) {
      if (shouldStop() || fork.getState().activePlayerId !== actorId) break
      const command = commands[index]
      if (index > 0)
        penalty = Math.max(
          penalty,
          inspectExpertAction(fork, actorId, command, shouldStop).penalty,
          unpaidActionPenalty(command, fork.getState(), actorId)
        )
      if (command.type === 'end-turn') break
      const result = fork.dispatch(command)
      if (!result.accepted) return Math.max(penalty, 0.35)
      if (result.state.phase === 'ended')
        return result.state.winnerId === actorId ? 0 : penalty
    }
    return penalty
  })
}

/** Compare the actual attack with legal targeted buffs first, not hypothetical readiness. */
function attackBeforeBuffPenalty(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: Extract<TurnMatchCommand, { type: 'attack-character' }>
): ExpertActionOutcome {
  if (command.attacker.kind !== 'minion') return { penalty: 0 }
  const attackerId = command.attacker.instanceId
  const player = root.getState().players.find((p) => p.participantId === actorId)!
  const buffs = new Set(
    player.hand
      .filter(
        (card) =>
          (card.currentCost ?? CARD_CATALOG.get(card.cardId)?.cost ?? Infinity) <=
            player.mana.available &&
          CARD_CATALOG.get(card.cardId)?.effects.some((effect) =>
            effect.actions?.some(
              (action) =>
                action.action === 'modify' &&
                action.duration === 'this-turn' &&
                typeof action.attack === 'number' &&
                action.attack > 0
            )
          )
      )
      .map((card) => card.instanceId)
  )
  if (!buffs.size) return { penalty: 0 }
  const attack = root.analyze((fork) => fork.dispatch(command))
  if (!attack.accepted || attack.state.phase === 'ended') return { penalty: 0 }
  const health = (state: OpeningMatchState, friendly: boolean) => {
    const p = state.players.find((p) => (p.participantId === actorId) === friendly)!
    if (!friendly && command.defender.kind === 'hero')
      return p.hero.health + p.hero.armor
    const id = friendly
      ? attackerId
      : command.defender.kind === 'minion'
        ? command.defender.instanceId
        : ''
    return p.board.find((m) => m.instanceId === id)?.health ?? 0
  }
  const candidates = enumerateLegalCommands(root, actorId).filter(
    (c) =>
      c.type === 'play-card' &&
      buffs.has(c.cardInstanceId) &&
      c.targets?.some(
        (t) =>
          t.kind === 'minion' &&
          t.participantId === actorId &&
          t.instanceId === attackerId
      )
  )
  for (const buff of candidates) {
    const better = root.analyze((fork) => {
      if (!fork.dispatch(buff).accepted) return false
      const result = fork.dispatch(command)
      if (!result.accepted) return false
      if (result.state.phase === 'ended') return result.state.winnerId === actorId
      return (
        health(result.state, true) >= health(attack.state, true) &&
        health(result.state, false) <= health(attack.state, false) &&
        (health(result.state, true) > health(attack.state, true) ||
          health(result.state, false) < health(attack.state, false))
      )
    })
    if (better) return { penalty: 0.25, reason: 'attack-before-buff' }
  }
  return { penalty: 0 }
}

/** Ignore expenditure itself, but retain changes to cards, stats, quests and effects. */
function position(
  player: AiObservedPlayer,
  spentCard?: string,
  lostMinions: readonly string[] = [],
  ignoreUnusableRitual = false
): string {
  return JSON.stringify({
    hero: player.hero,
    board: player.board.filter((m) => !lostMinions.includes(m.instanceId)),
    weapon: player.weapon,
    hand: player.hand.filter((c) => c.instanceId !== spentCard),
    deckSize: player.deckSize,
    fatigueDamage: player.fatigueDamage,
    quest: player.quest,
    secrets: player.secrets,
    effects: ignoreUnusableRitual
      ? { ...player.effects, cthun: undefined }
      : player.effects,
    maximumMana: player.mana.maximum,
    heroPower: {
      ...player.heroPower,
      // Using a power spends its activation. A spell refreshing it is a payoff.
      available: spentCard ? player.heroPower.available : undefined,
      usesThisTurn: undefined
    }
  })
}

function hasDeferredCastPayoff(player: AiObservedPlayer): boolean {
  return player.hand.some((card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    return (
      JSON.stringify(definition?.effects)?.includes('friendly-spells-cast-this-game') ||
      ((card.currentCost ?? definition?.cost ?? Infinity) <= player.mana.available &&
        definition?.effects.some((effect) =>
          JSON.stringify(effect.condition)?.includes('"combo"')
        ))
    )
  })
}

/** Recognize authored health-dependent setup, without forecasting the follow-up. */
function enablesHeldDamagePayoff(
  before: AiObservedPlayer,
  after: AiObservedPlayer
): boolean {
  const inspect = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(inspect)
    if (!value || typeof value !== 'object') return false
    const entry = value as Record<string, unknown>
    if (
      entry.type === 'player-health-lte' &&
      entry.player === 'self' &&
      typeof entry.value === 'number' &&
      before.hero.health > entry.value &&
      after.hero.health <= entry.value
    )
      return true
    if (entry.reference === 'matching-entity-count') {
      const selector = entry.selector as Record<string, unknown> | undefined
      const filter = selector?.filter as Record<string, unknown> | undefined
      if (
        (selector?.controller === 'self' || selector?.controller === 'any') &&
        (selector.type === 'character' ||
          selector.type === 'hero' ||
          selector.type === 'minion') &&
        filter?.damaged === true
      ) {
        const count = (player: AiObservedPlayer) =>
          (selector.type !== 'minion' && player.hero.health < player.hero.maxHealth
            ? 1
            : 0) +
          (selector.type !== 'hero'
            ? player.board.filter((minion) => minion.health < minion.maxHealth).length
            : 0)
        if (count(after) > count(before)) return true
      }
    }
    return Object.values(entry).some(inspect)
  }
  return after.hand.some((card) => inspect(CARD_CATALOG.get(card.cardId)?.effects))
}

/** A chosen self-hero target must pay for its damage beyond ordinary development. */
function unpaidTargetedHeroDamage(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: Extract<TurnMatchCommand, { type: 'play-card' }>
): ExpertActionOutcome {
  if (
    !command.targets?.some(
      (target) => target.kind === 'hero' && target.participantId === actorId
    )
  )
    return { penalty: 0 }
  return root.analyze((fork) => {
    const before = fork.getAiObservation?.(actorId, 'fair')
    const self = before?.players.find((player) => player.participantId === actorId)
    if (!self) return { penalty: 0 }
    const rng = JSON.stringify(fork.getRandomState?.())
    const result = fork.dispatch(command)
    if (
      !result.accepted ||
      result.state.phase === 'ended' ||
      result.state.pendingDiscover ||
      result.state.pendingCardChoice ||
      rng !== JSON.stringify(fork.getRandomState?.()) ||
      revealsTacticalInformation(result.events)
    )
      return { penalty: 0 }
    const after = fork.getAiObservation?.(actorId, 'fair')
    const next = after?.players.find((player) => player.participantId === actorId)
    if (
      !after ||
      !next ||
      self.hero.health + self.hero.armor <= next.hero.health + next.hero.armor ||
      hasDeferredCastPayoff(next) ||
      enablesHeldDamagePayoff(self, next) ||
      self.handSize >= 10
    )
      return { penalty: 0 }
    const otherwiseUnchanged = before!.players.every((player) => {
      const changed = after.players.find(
        (entry) => entry.participantId === player.participantId
      )!
      if (player.participantId !== actorId)
        return position(player) === position(changed)
      return (
        position(player, command.cardInstanceId) ===
        position(
          {
            ...changed,
            hero: {
              ...changed.hero,
              health: player.hero.health,
              armor: player.hero.armor,
              damageTaken: player.hero.damageTaken
            }
          },
          command.cardInstanceId,
          // Only the played body is ordinary development. Additional summons,
          // healing, draw, cost changes and damage-trigger effects remain payoffs.
          [command.cardInstanceId]
        )
      )
    })
    return otherwiseUnchanged
      ? { penalty: 0.35, reason: 'unpaid-friendly-damage' }
      : { penalty: 0 }
  })
}

/** A soft same-card target comparison; triggers and healing conversion stay visible. */
function wastedHealingTarget(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: Extract<TurnMatchCommand, { type: 'play-card' }>
): ExpertActionOutcome {
  const self = root
    .getState()
    .players.find((player) => player.participantId === actorId)
  const card = self?.hand.find((entry) => entry.instanceId === command.cardInstanceId)
  const definition = card && CARD_CATALOG.get(card.cardId)
  const target = command.targets?.[0]
  if (
    !self ||
    !target ||
    command.targets?.length !== 1 ||
    target.participantId !== actorId ||
    !definition?.effects.length ||
    !definition.effects.every(
      (effect) =>
        (effect.trigger === 'cast' || effect.trigger === 'battlecry') &&
        effect.actions?.length &&
        effect.actions.every((action) => action.action === 'restore')
    )
  )
    return { penalty: 0 }
  const selectedTarget =
    target.kind === 'hero'
      ? self.hero
      : target.kind === 'minion'
        ? self.board.find((minion) => minion.instanceId === target.instanceId)
        : undefined
  if (!selectedTarget || selectedTarget.health < selectedTarget.maxHealth)
    return { penalty: 0 }
  if (
    self.hero.health >= self.hero.maxHealth &&
    !self.board.some((minion) => minion.health < minion.maxHealth)
  )
    return { penalty: 0 }
  // Healing replacements are a separate tactical use, never a wasted heal.
  if (
    self.board.some(
      (minion) =>
        !minion.silenced &&
        !minion.dormant &&
        CARD_CATALOG.get(minion.cardId)?.effects.some((effect) =>
          effect.actions?.some(
            (action) =>
              action.action === 'replace-event' && action.event === 'health-restored'
          )
        )
    )
  )
    return { penalty: 0 }
  const simulate = (action: TurnMatchCommand) =>
    root.analyze((fork) => {
      const rng = JSON.stringify(fork.getRandomState?.())
      const result = fork.dispatch(action)
      if (
        !result.accepted ||
        result.state.phase !== 'turns' ||
        result.state.pendingDiscover ||
        result.state.pendingCardChoice ||
        revealsTacticalInformation(result.events) ||
        rng !== JSON.stringify(fork.getRandomState?.())
      )
        return undefined
      return fork.getAiObservation?.(actorId, 'fair')
    })
  const selected = simulate(command)
  if (!selected) return { penalty: 0 }
  const selectedSelf = selected.players.find(
    (player) => player.participantId === actorId
  )!
  let preferredAlternativeKey: string | undefined
  for (const alternate of enumerateLegalCommands(root, actorId)) {
    if (
      alternate.type !== 'play-card' ||
      alternate.cardInstanceId !== command.cardInstanceId ||
      alternate.choice !== command.choice ||
      alternate.position !== command.position ||
      alternate.targets?.length !== 1 ||
      alternate.targets[0]?.participantId !== actorId ||
      canonicalCommandKey(alternate) === canonicalCommandKey(command)
    )
      continue
    const alternateTarget = alternate.targets[0]!
    const wounded =
      alternateTarget.kind === 'hero'
        ? self.hero
        : alternateTarget.kind === 'minion'
          ? self.board.find(
              (minion) => minion.instanceId === alternateTarget.instanceId
            )
          : undefined
    if (!wounded || wounded.health >= wounded.maxHealth) continue
    const improved = simulate(alternate)
    if (!improved) return { penalty: 0 }
    const improvedSelf = improved.players.find(
      (player) => player.participantId === actorId
    )!
    // The controller may choose any same-play target. If one healing destination
    // removes a held damaged-count/health-threshold payoff, leave target choice
    // to search rather than certifying another destination as a hard repair.
    if (enablesHeldDamagePayoff(improvedSelf, selectedSelf)) return { penalty: 0 }
    let healing = 0
    const equivalent = selected.players.every((before) => {
      const after = improved.players.find(
        (player) => player.participantId === before.participantId
      )!
      if (before.participantId !== actorId) return position(before) === position(after)
      if (
        JSON.stringify(before.mana) !== JSON.stringify(after.mana) ||
        after.hero.health < before.hero.health ||
        before.board.length !== after.board.length
      )
        return false
      healing += after.hero.health - before.hero.health
      const board = after.board.map((minion) => {
        const old = before.board.find((entry) => entry.instanceId === minion.instanceId)
        if (!old || minion.health < old.health) return minion
        healing += minion.health - old.health
        return { ...minion, health: old.health, damageTaken: old.damageTaken }
      })
      return (
        position(before) ===
        position({
          ...after,
          board,
          hero: {
            ...after.hero,
            health: before.hero.health,
            damageTaken: before.hero.damageTaken
          }
        })
      )
    })
    if (equivalent && healing > 0)
      preferredAlternativeKey ??= canonicalCommandKey(alternate)
  }
  return preferredAlternativeKey
    ? { penalty: 0.25, reason: 'wasted-healing-target', preferredAlternativeKey }
    : { penalty: 0 }
}

/** One reversible simulation on an already fair search fork, never a live dispatch. */
export function inspectExpertAction(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  command: TurnMatchCommand,
  shouldStop: () => boolean = () => false,
  measureResourceProbe: (probe: () => boolean) => boolean = (probe) => probe()
): ExpertActionOutcome {
  if (command.type === 'attack-character') {
    const buff = attackBeforeBuffPenalty(root, actorId, command)
    return buff.penalty > 0 ? buff : wastedClearActionPenalty(root, actorId, command)
  }
  if (command.type === 'end-turn')
    return wastedClearActionPenalty(root, actorId, command)
  if (command.type !== 'play-card' && command.type !== 'use-hero-power')
    return { penalty: 0 }
  if (command.type === 'play-card') {
    if (
      measureResourceProbe(() =>
        wastesEmptySelectorSpell(root, actorId, command, shouldStop)
      )
    )
      return { penalty: 0.35, reason: 'no-payoff' }
    if (wastesImmediateTemporaryMana(root, actorId, command))
      return { penalty: 0.35, reason: 'no-payoff' }
    const damage = unpaidTargetedHeroDamage(root, actorId, command)
    if (damage.penalty > 0) return damage
    const healing = wastedHealingTarget(root, actorId, command)
    if (healing.penalty > 0) return healing
    const state = root.getState()
    const card = state.players
      .find((p) => p.participantId === actorId)
      ?.hand.find((c) => c.instanceId === command.cardInstanceId)
    if (
      card &&
      CARD_CATALOG.get(card.cardId)?.type !== 'Spell' &&
      !hasImminentBoardClear(state)
    )
      return { penalty: 0 }
  }
  return root.analyze((fork) => {
    const before = fork.getAiObservation?.(actorId, 'fair')
    const self = before?.players.find((p) => p.participantId === actorId)
    if (!self) return { penalty: 0 }
    const ritualPayoff = hasKnownCthunPayoff([
      ...self.hand,
      ...self.board,
      ...before!.selfOriginalDeck.cards
    ])
    const payoffPosition = (
      player: AiObservedPlayer,
      spentCard?: string,
      lostMinions: readonly string[] = []
    ) =>
      position(
        player,
        spentCard,
        lostMinions,
        player.participantId === actorId && !ritualPayoff
      )
    const spentCard = command.type === 'play-card' ? command.cardInstanceId : undefined
    const card = self.hand.find((c) => c.instanceId === spentCard)
    const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
    const isSpell = !card || definition?.type === 'Spell'
    // Only immediate effects whose payoff is represented below. Deck replacement,
    // delayed effects and future-turn enchantments must not be mistaken for no-ops.
    if (
      definition?.type === 'Spell' &&
      !definition.effects.every(
        (effect) =>
          effect.trigger === 'cast' &&
          effect.actions?.every((action) =>
            [
              'damage',
              'restore',
              'spend-all-mana',
              'summon-random',
              'sacrifice-and-damage'
            ].includes(action.action)
          )
      )
    )
      return { penalty: 0 }
    if (!isSpell && !hasImminentBoardClear(fork.getState())) return { penalty: 0 }
    const unplayed = !isSpell
      ? evaluateExpertBoundary(fork, (boundary) =>
          boundary.getAiObservation?.(actorId, 'fair')
        )
      : undefined
    const result = fork.dispatch(command)
    if (!result.accepted || result.state.phase === 'ended') return { penalty: 0 }
    const after = fork.getAiObservation?.(actorId, 'fair')
    const nextSelf = after?.players.find((p) => p.participantId === actorId)
    if (
      !after ||
      !nextSelf ||
      result.state.pendingDiscover ||
      result.state.pendingCardChoice
    )
      return { penalty: 0 }
    if (!isSpell) {
      const summoned = nextSelf.board.filter(
        (m) => !self.board.some((old) => old.instanceId === m.instanceId)
      )
      // Immediate attackers may answer the clear before the boundary; the full
      // sequence search decides that payoff instead of a one-action penalty.
      if (
        summoned.some((m) =>
          effectiveBoardMinionKeywords(m, result.state.turnNumber).some(
            (keyword) => keyword === 'charge' || keyword === 'rush'
          )
        )
      )
        return { penalty: 0 }
      // A battlecry can prepare an existing attacker or soften the clear source.
      // Let sequence search resolve that answer instead of assuming an immediate pass.
      if (
        nextSelf.board.some((m) => {
          const old = self.board.find((old) => old.instanceId === m.instanceId)
          return (
            old &&
            m.attack > old.attack &&
            enumerateLegalCommands(fork, actorId).some(
              (c) =>
                c.type === 'attack-character' &&
                c.attacker.kind === 'minion' &&
                c.attacker.instanceId === m.instanceId
            )
          )
        }) ||
        before!.players.some(
          (p) =>
            p.participantId !== actorId &&
            p.board.some((m) => {
              const next = after.players
                .find((n) => n.participantId === p.participantId)
                ?.board.find((n) => n.instanceId === m.instanceId)
              return !next || next.health < m.health || (!m.silenced && next.silenced)
            })
        )
      )
        return { penalty: 0 }
      return evaluateExpertBoundary(fork, (boundary) => {
        if (boundary === fork || boundary.getState().phase === 'ended')
          return { penalty: 0 }
        const survivors = boundary
          .getState()
          .players.find((p) => p.participantId === actorId)!.board
        // A deathrattle that rebuilds the board is a real payoff, not wasted development.
        if (
          summoned.length &&
          !survivors.some(
            (m) => !self.board.some((old) => old.instanceId === m.instanceId)
          )
        ) {
          const played = boundary.getAiObservation?.(actorId, 'fair')
          // Compare with passing without spending the card. Retain healing, draws,
          // quests, battlecries and surviving deathrattles; one point of nonlethal
          // face damage alone does not pay for losing a developed minion.
          const littlePayoff =
            unplayed &&
            played &&
            unplayed.players.every((before) => {
              const after = played.players.find(
                (p) => p.participantId === before.participantId
              )!
              const damage =
                before.hero.health +
                before.hero.armor -
                after.hero.health -
                after.hero.armor
              if (before.participantId === actorId || damage < 0 || damage > 1)
                return position(before, spentCard) === position(after, spentCard)
              return (
                position(before, spentCard) ===
                position(
                  {
                    ...after,
                    hero: {
                      ...after.hero,
                      health: before.hero.health,
                      armor: before.hero.armor,
                      damageTaken: before.hero.damageTaken
                    }
                  },
                  spentCard
                )
              )
            })
          return {
            penalty: littlePayoff ? 0.35 : 0,
            ...(littlePayoff ? { reason: 'imminent-clear' as const } : {})
          }
        }
        return { penalty: 0 }
      })
    }
    // A cast can be setup even without immediate board value. Do not suppress
    // combo activation or making room before a draw into a full hand.
    if (spentCard && (hasDeferredCastPayoff(nextSelf) || self.handSize >= 10))
      return { penalty: 0 }
    if (
      result.events.some(
        (e) =>
          e.type === 'character-healed' && e.participantId !== actorId && e.amount > 0
      ) &&
      payoffPosition(self, spentCard) === payoffPosition(nextSelf, spentCard)
    )
      return { penalty: 0.25, reason: 'opponent-heal' }
    const enemyUnchanged = before!.players
      .filter((p) => p.participantId !== actorId)
      .every((p) => {
        const next = after.players.find((n) => n.participantId === p.participantId)!
        return position(p) === position(next)
      })
    if (!enemyUnchanged) return { penalty: 0 }
    if (payoffPosition(self, spentCard) === payoffPosition(nextSelf, spentCard))
      return { penalty: 0.35, reason: 'no-payoff' }
    const lost = self.board
      .filter((m) => !nextSelf.board.some((n) => n.instanceId === m.instanceId))
      .map((m) => m.instanceId)
    if (
      lost.length &&
      payoffPosition(self, spentCard, lost) === payoffPosition(nextSelf, spentCard)
    ) {
      // Deaths can advance resurrection plans; retain a soft penalty rather
      // than removing the action from the legal search space.
      return { penalty: 0.25, reason: 'unpaid-sacrifice' }
    }
    return { penalty: 0 }
  })
}

export function createExpertActionInspector(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  shouldStop?: () => boolean,
  measureResourceProbe: (probe: () => boolean) => boolean = (probe) => probe()
): (command: TurnMatchCommand) => ExpertActionOutcome {
  // Fallback callers without a turn budget still bound the added resource probe.
  const resourceDeadline = performance.now() + EXPERT_TERMINAL_SAFETY_MAX_MS
  const stopResourceProbe = shouldStop ?? (() => performance.now() >= resourceDeadline)
  // Preserve the actual public count before any fair hidden-identity sampling.
  const hasPublicSecrets = checkpoint.state.players.some((p) => p.secrets?.length)
  let match: ReturnType<typeof createOpeningMatchFromCheckpoint> | undefined
  return (command) => {
    if (
      command.type !== 'play-card' &&
      command.type !== 'use-hero-power' &&
      command.type !== 'attack-character' &&
      command.type !== 'end-turn'
    )
      return { penalty: 0 }
    match ??= createOpeningMatchFromCheckpoint(
      createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
    )
    return match.analyze((fork) =>
      inspectExpertAction(
        fork,
        actorId,
        command,
        () => hasPublicSecrets || stopResourceProbe(),
        measureResourceProbe
      )
    )
  }
}

/** Only extend across an imminent authored board clear, not an arbitrary turn. */
export function hasImminentBoardClear(state: OpeningMatchState): boolean {
  if (state.phase !== 'turns') return false
  return state.players.some((player) =>
    player.board.some(
      (minion) =>
        !minion.silenced &&
        !minion.dormant &&
        CARD_CATALOG.get(minion.cardId)?.effects.some(
          (effect) =>
            ((effect.trigger === 'end-of-turn' &&
              player.participantId === state.activePlayerId) ||
              (effect.trigger === 'start-of-turn' &&
                player.participantId !== state.activePlayerId)) &&
            effect.actions?.some(
              (action) =>
                action.action === 'destroy' &&
                typeof action.target === 'object' &&
                action.target !== null &&
                !Array.isArray(action.target) &&
                'type' in action.target &&
                action.target.type === 'minion' &&
                action.target.selection === 'all'
            )
        )
    )
  )
}

/** Resolve the real boundary, including deathrattles, inside a reversible fork. */
export function evaluateExpertBoundary<T>(
  root: OpeningMatchAnalysis,
  evaluate: (fork: OpeningMatchAnalysis) => T
): T {
  const state = root.getState()
  if (
    !hasImminentBoardClear(state) ||
    !state.activePlayerId ||
    state.pendingDiscover ||
    state.pendingCardChoice
  )
    return evaluate(root)
  return root.analyze((fork) => {
    const result = fork.dispatch({
      type: 'end-turn',
      participantId: state.activePlayerId!
    })
    const changedBoard = state.players.some((player) =>
      player.board.some(
        (minion) =>
          !result.state.players.some((next) =>
            next.board.some((m) => m.instanceId === minion.instanceId)
          )
      )
    )
    return result.accepted && (result.state.phase === 'ended' || changedBoard)
      ? evaluate(fork)
      : evaluate(root)
  })
}
