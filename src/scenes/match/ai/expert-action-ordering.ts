import { CARD_CATALOG } from '../../../game-rules/content'
import {
  canonicalCommandKey,
  enumerateLegalCommands
} from '../../../game-rules/match/ai'
import type { AiObservation } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchAnalysis,
  OpeningMatchCheckpoint,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'

export const EXPERT_ORDERING_MAX_CANDIDATES = 8
export const EXPERT_ORDERING_BUDGET_MS = 100
export const EXPERT_ORDERING_MAX_DISPATCHES = 32

/** Only mechanics whose immediate value can change when an attack is spent. */
function isAttackSetup(cardId: string): boolean {
  return (
    CARD_CATALOG.get(cardId)?.effects.some((effect) =>
      effect.actions?.some((action) => {
        if (effect.trigger === 'aura' && action.action === 'modify')
          return typeof action.attack === 'number' && action.attack > 0
        if (
          action.action !== 'summon' ||
          typeof action.count !== 'object' ||
          !action.count
        )
          return false
        const count = action.count as {
          reference?: string
          selector?: { controller?: string; type?: string }
        }
        return (
          count.reference === 'matching-entity-count' &&
          count.selector?.controller === 'opponent' &&
          count.selector.type === 'minion'
        )
      })
    ) === true
  )
}

function afterLine(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  commands: readonly TurnMatchCommand[],
  takeWork: () => boolean
): AiObservation | undefined {
  return root.analyze((fork) => {
    if (!fork.getAiObservation || !fork.getRandomState) return undefined
    const rng = JSON.stringify(fork.getRandomState())
    for (const command of commands) {
      if (!takeWork()) return undefined
      const result = fork.dispatch(command)
      if (
        !result.accepted ||
        result.state.phase !== 'turns' ||
        result.state.activePlayerId !== actorId ||
        result.state.pendingDiscover ||
        result.state.pendingCardChoice ||
        result.state.pendingResolution ||
        JSON.stringify(fork.getRandomState()) !== rng ||
        revealsTacticalInformation(result.events) ||
        result.events.some((event) => event.type === 'trigger-activated')
      )
        return undefined
    }
    return fork.getAiObservation(actorId, 'fair')
  })
}

/**
 * A local sequencing benefit, not a claim of global dominance: extra tokens may
 * consume valuable space. All other public facts must match in the two orders.
 */
function sameResourcesWithLocalGain(
  afterAttack: AiObservation,
  beforeAttack: AiObservation,
  actorId: PlayerId,
  originalIds: ReadonlySet<string>
): boolean {
  let gained = false
  const normalized = {
    ...beforeAttack,
    players: beforeAttack.players.map((player) => {
      const other = afterAttack.players.find(
        (entry) => entry.participantId === player.participantId
      )!
      if (player.participantId !== actorId) {
        const gain =
          other.hero.health + other.hero.armor - player.hero.health - player.hero.armor
        if (
          gain < 0 ||
          player.hero.health > other.hero.health ||
          player.hero.armor > other.hero.armor
        )
          return player
        gained ||= gain > 0
        return {
          ...player,
          hero: {
            ...player.hero,
            health: other.hero.health,
            armor: other.hero.armor,
            damageTaken: other.hero.damageTaken
          }
        }
      }
      // Death/event ordering may consume different entity ordinals. Match only
      // new summons by their complete remaining shape; root identities and all
      // references inside enchantments/effects remain exact.
      const unmatched = other.board.filter(
        (minion) => !originalIds.has(minion.instanceId)
      )
      const semanticKey = (minion: (typeof player.board)[number]) =>
        JSON.stringify({ ...minion, instanceId: undefined })
      const board = player.board.map((minion) => {
        if (originalIds.has(minion.instanceId)) return minion
        const index = unmatched.findIndex(
          (entry) => semanticKey(entry) === semanticKey(minion)
        )
        if (index < 0) return minion
        const match = unmatched.splice(index, 1)[0]!
        return { ...minion, instanceId: match.instanceId }
      })
      const additional = board.filter(
        (minion) =>
          !originalIds.has(minion.instanceId) &&
          !other.board.some((entry) => entry.instanceId === minion.instanceId)
      )
      if (additional.some((minion) => minion.attack <= 0 || minion.health <= 0))
        return player
      gained ||= additional.length > 0
      return {
        ...player,
        board: board.filter((minion) => !additional.includes(minion))
      }
    })
  }
  const key = (observation: unknown) =>
    JSON.stringify(observation, (name, value) =>
      name === 'revision' || name === 'recentEvents' ? undefined : value
    )
  return gained && key(afterAttack) === key(normalized)
}

/** One allowance is shared across every candidate reviewed at this root. */
export function createExpertAttackOrderInspector(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  shouldStop: () => boolean = () => false
) {
  const stats = {
    dispatches: 0,
    comparisons: 0,
    cacheHits: 0,
    abstentions: 0,
    durationMs: 0
  }
  const memo = new Map<string, boolean>()
  let started: number | undefined
  let match: ReturnType<typeof createOpeningMatchFromCheckpoint> | undefined
  const originalIds = new Set<string>()
  const state = checkpoint.state
  const self = state.players.find((player) => player.participantId === actorId)
  const setupIds = new Set(
    self?.hand
      .filter((card) => isAttackSetup(card.cardId))
      .map((card) => card.instanceId)
  )
  const stop = () =>
    shouldStop() ||
    stats.dispatches >= EXPERT_ORDERING_MAX_DISPATCHES ||
    (started !== undefined && performance.now() - started >= EXPERT_ORDERING_BUDGET_MS)
  const takeWork = () => {
    if (stop()) {
      stats.abstentions++
      return false
    }
    stats.dispatches++
    return true
  }
  const inspect = (command: TurnMatchCommand): boolean => {
    if (command.type !== 'attack-character' || !setupIds.size) return false
    const key = canonicalCommandKey(command)
    const cached = memo.get(key)
    if (cached !== undefined) {
      stats.cacheHits++
      return cached
    }
    if (stop()) {
      stats.abstentions++
      return false
    }
    if (
      state.phase !== 'turns' ||
      state.pendingDiscover ||
      state.pendingCardChoice ||
      state.pendingResolution ||
      state.players.some(
        (player) =>
          player.participantId !== actorId &&
          player.secrets?.some((secret) => !secret.revealed)
      )
    )
      return false
    const callStarted = performance.now()
    started ??= callStarted
    try {
      if (!match) {
        const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
        match = createOpeningMatchFromCheckpoint(fair)
        JSON.stringify(fair.state, (name, value) => {
          if (name === 'instanceId' && typeof value === 'string') originalIds.add(value)
          return value
        })
      }
      const improves = match.analyze((fork) => {
        const candidates = enumerateLegalCommands(fork, actorId)
          .filter(
            (candidate) =>
              candidate.type === 'play-card' && setupIds.has(candidate.cardInstanceId)
          )
          .slice(0, EXPERT_ORDERING_MAX_CANDIDATES)
        for (const setup of candidates) {
          if (stop()) {
            stats.abstentions++
            break
          }
          stats.comparisons++
          const attackFirst = afterLine(fork, actorId, [command, setup], takeWork)
          if (!attackFirst) continue
          const setupFirst = afterLine(fork, actorId, [setup, command], takeWork)
          if (
            setupFirst &&
            sameResourcesWithLocalGain(attackFirst, setupFirst, actorId, originalIds)
          )
            return true
        }
        return false
      })
      memo.set(key, improves)
      return improves
    } finally {
      stats.durationMs += performance.now() - callStarted
    }
  }
  return Object.assign(inspect, { stats })
}
