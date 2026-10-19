import { CARD_CATALOG } from '../../../game-rules/content/cards'
import {
  BASIC_HERO_POWER_UPGRADES,
  HERO_POWER_CATALOG
} from '../../../game-rules/content/hero-powers'
import type { AiObservation, AiObservedPlayer } from '../../../game-rules/match/ai'
import { canonicalCommandKey } from '../../../game-rules/match/ai/legal-commands'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchAnalysis,
  OpeningMatchCheckpoint,
  TurnMatchCommand
} from '../../../game-rules/match'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords
} from '../../../game-rules/match/rules/minion-attack-state'

type Attack = Extract<TurnMatchCommand, { type: 'attack-character' }>
export const EXPERT_DELAYED_DAMAGE_MAX_DISPATCHES = 32
export const EXPERT_DELAYED_DAMAGE_MAX_MS = 25
const BOARD_VALUE_EPSILON = 1e-6

/** An upper bound only: uncertain damage/setup leaves lethal choices to fallback. */
function possiblePublicLethal(
  observation: AiObservation,
  commands: readonly TurnMatchCommand[]
): boolean {
  const self = observation.players.find((player) => player.role === 'self')!
  const enemy = observation.players.find((player) => player.role === 'opponent')!
  // Reactive/aura setup can convert otherwise harmless plays into lethal. This
  // small rescue does not interpret those combos or replace tactical search.
  if (
    self.board.some(
      (minion) =>
        !minion.silenced &&
        (CARD_CATALOG.get(minion.cardId)?.effects.some(
          (effect) => effect.trigger !== 'battlecry'
        ) ||
          minion.grantedTriggers?.length ||
          minion.attachedEffects?.length ||
          minion.deathrattles?.length)
    )
  )
    return true
  const attackers = new Set(
    commands.flatMap((command) =>
      command.type === 'attack-character'
        ? [command.attacker.kind === 'minion' ? command.attacker.instanceId : 'hero']
        : []
    )
  )
  let damage = self.board.reduce(
    (total, minion) =>
      total +
      (attackers.has(minion.instanceId)
        ? Math.max(0, minion.attack) *
          Math.max(
            1,
            Math.max(
              minion.maxAttacksPerTurn ?? 1,
              effectiveBoardMinionKeywords(minion, observation.turnNumber).includes(
                'windfury'
              )
                ? 2
                : 1
            ) +
              (minion.extraAttacksThisTurn ?? 0) -
              boardMinionAttacksUsed(minion, observation.turnNumber)
          )
        : 0),
    0
  )
  if (attackers.has('hero'))
    damage +=
      (self.hero.attack + (self.weapon?.attack ?? 0)) *
      Math.max(
        1,
        (self.hero.maxAttacksPerTurn ?? 1) -
          (self.hero.lastAttackedOnTurn === observation.turnNumber
            ? (self.hero.attacksUsedThisTurn ?? 1)
            : 0)
      )
  const powerDamage = (id: string): number => {
    const effect = HERO_POWER_CATALOG.get(id)?.effect
    if (!effect) return Infinity
    if (
      effect.kind === 'gain-armor' ||
      effect.kind === 'draw-cards' ||
      effect.kind === 'draw-and-self-damage'
    )
      return 0
    if (
      effect.kind === 'damage-enemy-hero' ||
      effect.kind === 'damage-character' ||
      effect.kind === 'damage-random-enemy'
    )
      return effect.amount
    return Infinity
  }
  if (commands.some((command) => command.type === 'use-hero-power'))
    damage +=
      powerDamage(self.heroPower.id) * Math.max(1, self.hero.heroPowerMultiplier ?? 1)
  const setupDamage = (value: unknown, sourceCanAttack: boolean): number => {
    if (Array.isArray(value))
      return value.reduce(
        (total, entry) => total + setupDamage(entry, sourceCanAttack),
        0
      )
    if (!value || typeof value !== 'object') return 0
    const entry = value as Record<string, unknown>
    if (typeof entry.action === 'string') {
      if (entry.action === 'draw' || entry.action === 'gain-armor') return 0
      const target = entry.target as { type?: unknown; selection?: unknown } | undefined
      if (
        entry.action === 'modify' &&
        target?.type === 'minion' &&
        target.selection === 'source' &&
        !sourceCanAttack
      )
        return 0
      if (entry.action === 'damage') {
        // Damage-sensitive friendly triggers may turn minion damage into face damage.
        if (
          target?.type === 'minion' &&
          self.board.every(
            (minion) =>
              minion.silenced ||
              CARD_CATALOG.get(minion.cardId)?.effects.every(
                (effect) => effect.trigger === 'battlecry'
              )
          )
        )
          return 0
        return Infinity
      }
      if (entry.action === 'set-hero-power') {
        if (
          entry.power === 'discover-basic' ||
          entry.power === 'discover-current-tier'
        ) {
          const upgraded = Object.values(BASIC_HERO_POWER_UPGRADES)
          const ids =
            entry.power === 'discover-current-tier' &&
            upgraded.includes(self.heroPower.id)
              ? upgraded
              : Object.keys(BASIC_HERO_POWER_UPGRADES)
          // Unknown non-damage powers can only add attack up to the largest
          // printed basic/upgraded attack or weapon, unless other setup exists.
          return (
            Math.max(1, self.hero.heroPowerMultiplier ?? 1) *
            Math.max(1, self.hero.maxAttacksPerTurn ?? 1) *
            Math.max(
              ...ids.map((id) => {
                const effect = HERO_POWER_CATALOG.get(id)!.effect
                if (effect.kind === 'gain-attack-and-armor') return effect.attack
                if (effect.kind === 'equip-weapon') {
                  const weapon = CARD_CATALOG.get(effect.cardId)
                  return weapon?.type === 'Weapon' ? weapon.attack : Infinity
                }
                const amount = powerDamage(id)
                return Number.isFinite(amount) ? amount : 0
              })
            )
          )
        }
        return typeof entry.power === 'string' ? powerDamage(entry.power) : Infinity
      }
      return Infinity
    }
    return Object.values(entry).reduce<number>(
      (total, child) => total + setupDamage(child, sourceCanAttack),
      0
    )
  }
  const playable = new Set(
    commands.flatMap((command) =>
      command.type === 'play-card' ? [command.cardInstanceId] : []
    )
  )
  for (const card of self.hand.filter((card) => playable.has(card.instanceId))) {
    if (
      card.modifications?.attack !== undefined ||
      card.modifications?.enchantments?.length
    )
      return true
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition) return true
    // Equipping can change repeat attacks as well as damage; leave those lines
    // to the existing policy rather than undercounting a new windfury weapon.
    if (definition.type === 'Weapon') return true
    if (definition.type === 'Minion' && definition.keywords.includes('charge'))
      damage += definition.attack * (definition.keywords.includes('windfury') ? 2 : 1)
    damage += setupDamage(
      definition.effects,
      definition.type === 'Minion' && definition.keywords.includes('charge')
    )
  }
  return damage >= enemy.hero.health + enemy.hero.armor
}

export function hasExpertDelayedDamageSource(
  minion: AiObservedPlayer['board'][number]
): boolean {
  return (
    !minion.silenced &&
    !minion.dormant &&
    CARD_CATALOG.get(minion.cardId)?.effects.some(
      (effect) =>
        effect.trigger === 'start-of-turn' &&
        effect.actions?.some(
          (action) =>
            action.action === 'damage' &&
            typeof action.target === 'object' &&
            action.target !== null &&
            !Array.isArray(action.target) &&
            'type' in action.target &&
            action.target.type === 'minion' &&
            action.target.selection === 'all'
        )
    ) === true
  )
}

function boardValue(player: Pick<AiObservedPlayer, 'board'>, turn: number): number {
  return player.board.reduce((total, minion) => {
    const keywords = effectiveBoardMinionKeywords(minion, turn)
    return (
      total +
      Math.max(0, minion.attack) * 2.2 +
      Math.max(0, minion.health) * 1.7 +
      (keywords.includes('divine-shield') ? 2 : 0) +
      (keywords.includes('taunt') ? 3.5 : 0)
    )
  }, 0)
}

/**
 * A bounded public-board preference, not a proof against hidden replies. Compare
 * passing with a complete one/two-attack answer to visible delayed area damage.
 * Boundary draws have no identity value; effects sourced from concealed cards,
 * random results, secrets and choices invalidate the comparison.
 */
export function findExpertDelayedDamageRescue(
  checkpoint: OpeningMatchCheckpoint,
  observation: AiObservation,
  legalCommands: readonly TurnMatchCommand[],
  shouldStop?: () => boolean
) {
  const started = performance.now()
  const stop =
    shouldStop ?? (() => performance.now() - started >= EXPERT_DELAYED_DAMAGE_MAX_MS)
  let dispatches = 0
  let abstained = false
  const result = (command?: Attack) => ({
    command,
    dispatches,
    abstained,
    durationMs: performance.now() - started
  })
  const actorId = observation.perspectivePlayerId
  const state = checkpoint.state
  const opponent = observation.players.find((player) => player.role === 'opponent')
  const sources = new Set(
    opponent?.board.filter(hasExpertDelayedDamageSource).map((m) => m.instanceId)
  )
  if (
    !sources.size ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingResolution ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.scheduledEffects?.length ||
    observation.players.some((player) => player.secrets.length)
  )
    return result()
  if (stop()) {
    abstained = true
    return result()
  }
  const attacks = (commands: readonly TurnMatchCommand[], target?: string) =>
    commands
      .filter(
        (command): command is Attack =>
          command.type === 'attack-character' &&
          command.participantId === actorId &&
          command.attacker.kind === 'minion' &&
          command.defender.kind === 'minion' &&
          (target
            ? command.defender.instanceId === target
            : sources.has(command.defender.instanceId))
      )
      .sort((left, right) =>
        canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
      )
      .slice(0, 8)
  const initial = attacks(legalCommands)
  if (!initial.length || possiblePublicLethal(observation, legalCommands))
    return result()
  const match = createOpeningMatchFromCheckpoint(
    createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  )
  const publicSources = new Set(
    observation.players.flatMap((player) => player.board.map((m) => m.instanceId))
  )
  const dispatch = (fork: OpeningMatchAnalysis, command: TurnMatchCommand) => {
    if (
      stop() ||
      dispatches >= EXPERT_DELAYED_DAMAGE_MAX_DISPATCHES ||
      !fork.getRandomState
    ) {
      abstained = true
      return false
    }
    const rng = JSON.stringify(fork.getRandomState())
    dispatches++
    const outcome = fork.dispatch(command)
    const boundary = command.type === 'end-turn'
    if (
      !outcome.accepted ||
      rng !== JSON.stringify(fork.getRandomState()) ||
      revealsTacticalInformation(
        boundary
          ? outcome.events.filter((event) => event.type !== 'card-drawn')
          : outcome.events
      ) ||
      outcome.events.some(
        (event) =>
          (event.type === 'trigger-activated' &&
            !publicSources.has(event.source.instanceId)) ||
          (event.type === 'effect-resolved' &&
            !publicSources.has(event.sourceInstanceId) &&
            !(
              boundary &&
              event.action === 'draw' &&
              event.actionPath === 'turn-start.draw' &&
              event.sourceCardId === null
            ))
      ) ||
      outcome.state.pendingResolution ||
      outcome.state.pendingDiscover ||
      outcome.state.pendingCardChoice ||
      stop()
    ) {
      abstained = true
      return false
    }
    return true
  }
  const endTurn: TurnMatchCommand = { type: 'end-turn', participantId: actorId }
  const summary = (fork: OpeningMatchAnalysis) => {
    // The fork is already fair. Project just public hero/board fields instead
    // of cloning full observations (hands, decks and history) at each boundary.
    const view = fork.getState()
    if (view.phase !== 'turns') return undefined
    const self = view.players.find((player) => player.participantId === actorId)!
    const enemy = view.players.find((player) => player.participantId !== actorId)!
    const ownBoard = boardValue(self, view.turnNumber)
    return {
      ownBoard,
      balance: ownBoard - boardValue(enemy, view.turnNumber),
      ownHealth: self.hero.health + self.hero.armor,
      enemyHealth: enemy.hero.health + enemy.hero.armor
    }
  }
  const baseline = match.analyze((fork) =>
    dispatch(fork, endTurn) ? summary(fork) : undefined
  )
  if (!baseline) return result()
  if (stop()) {
    abstained = true
    return result()
  }
  const current = match.analyze(summary)
  if (
    !current ||
    baseline.ownBoard >= current.ownBoard - BOARD_VALUE_EPSILON ||
    baseline.balance >= current.balance - BOARD_VALUE_EPSILON
  )
    return result()
  const better = (fork: OpeningMatchAnalysis) => {
    if (!dispatch(fork, endTurn)) return false
    const after = summary(fork)
    if (stop()) {
      abstained = true
      return false
    }
    return (
      after !== undefined &&
      after.ownHealth >= baseline.ownHealth &&
      after.enemyHealth <= baseline.enemyHealth &&
      after.ownBoard > baseline.ownBoard + BOARD_VALUE_EPSILON &&
      after.balance > baseline.balance + BOARD_VALUE_EPSILON
    )
  }
  const nextAttacks = (
    fork: OpeningMatchAnalysis,
    target: string
  ): readonly Attack[] => {
    if (stop() || !fork.getAttackLegality) return []
    const commands: Attack[] = []
    for (const [instanceId, targets] of Object.entries(
      fork.getAttackLegality(actorId).legalAttackTargets
    )) {
      if (instanceId === `${actorId}:hero`) continue
      for (const defender of targets)
        commands.push({
          type: 'attack-character',
          participantId: actorId,
          attacker: { kind: 'minion', instanceId },
          defender
        })
    }
    return attacks(commands, target)
  }
  const answer = match.analyze((root) => {
    for (const first of initial) {
      if (stop() || dispatches >= EXPERT_DELAYED_DAMAGE_MAX_DISPATCHES) {
        abstained = true
        break
      }
      const target = first.defender.kind === 'minion' ? first.defender.instanceId : ''
      const removed = (fork: OpeningMatchAnalysis) =>
        !fork
          .getState()
          .players.some((player) => player.board.some((m) => m.instanceId === target))
      const found = root.analyze((fork) => {
        if (!dispatch(fork, first)) return false
        if (removed(fork)) return better(fork)
        return nextAttacks(fork, target).some((second) =>
          fork.analyze(
            (child) => dispatch(child, second) && removed(child) && better(child)
          )
        )
      })
      if (found) return first
    }
    return undefined
  })
  if (answer && stop()) {
    abstained = true
    return result()
  }
  return result(answer)
}
