import { CARD_CATALOG } from '../../../game-rules/content'
import type { AiObservation } from '../../../game-rules/match/ai'
import { canonicalCommandKey } from '../../../game-rules/match/ai/legal-commands'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchState,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import type { RuntimeEnchantment } from '../../../game-rules/match/opening-match-types'

export const EXPERT_EXPIRING_ATTACK_MAX_DISPATCHES = 8
export const EXPERT_EXPIRING_ATTACK_MAX_MS = 25

type HeroAttack = Extract<TurnMatchCommand, { type: 'attack-character' }>

function onlyKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

/** Unknown enchantments are not evidence that spending an attack is free. */
function plainAttack(enchantment: RuntimeEnchantment): boolean {
  return (
    onlyKeys(enchantment, [
      'id',
      'sourceInstanceId',
      'sourceCardId',
      'attackDelta',
      'duration',
      'expiresOnTurn',
      'continuous'
    ]) &&
    typeof enchantment.attackDelta === 'number' &&
    Number.isFinite(enchantment.attackDelta) &&
    enchantment.attackDelta > 0
  )
}

/**
 * No guessed next draw is simulated. Only public metadata can exclude a known
 * boundary payoff/cost; unknown mechanics conservatively keep the selected pass.
 */
function supportsFreeExpiringAttack(
  state: OpeningMatchState,
  actorId: PlayerId
): boolean {
  const self = state.players.find((player) => player.participantId === actorId)
  const opponent = state.players.find((player) => player.participantId !== actorId)
  if (
    !self ||
    !opponent ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    opponent.deck.length === 0 ||
    self.hero.baseAttack !== 0 ||
    self.hero.attack <= 0 ||
    (self.hero.attacksUsedThisTurn ?? 0) !== 0 ||
    self.hero.lastAttackedOnTurn === state.turnNumber ||
    self.hero.maxAttacksPerTurn !== 1 ||
    self.hero.frozenUntilTurn != null ||
    self.hero.keywords?.length ||
    self.hero.baseKeywords?.length
  )
    return false
  const temporary = self.hero.enchantments ?? []
  if (
    !temporary.length ||
    !temporary.every(
      (entry) =>
        plainAttack(entry) &&
        !entry.continuous &&
        entry.duration === 'this-turn' &&
        entry.expiresOnTurn === state.turnNumber
    ) ||
    temporary.reduce((sum, entry) => sum + entry.attackDelta!, 0) !== self.hero.attack
  )
    return false
  for (const player of state.players) {
    if (
      player.weapon ||
      player.quest ||
      player.secrets?.length ||
      player.hero.health <= 0 ||
      player.heroPower.enchantments?.length ||
      (player.participantId === actorId && player.pendingCostModifiers?.length) ||
      (player.participantId !== actorId && player.hero.enchantments?.length)
    )
      return false
    for (const minion of player.board) {
      if (
        minion.grantedTriggers?.length ||
        minion.attachedEffects?.length ||
        minion.dormant ||
        minion.health <= 0 ||
        minion.enchantments?.some(
          (entry) =>
            !plainAttack(entry) ||
            entry.duration !== 'permanent' ||
            entry.expiresOnTurn !== undefined
        )
      )
        return false
      const definition = CARD_CATALOG.get(minion.cardId)
      if (!definition) return false
      if (minion.silenced) continue
      if (
        definition.effects.some((effect) => {
          // These dormant events cannot fire during an otherwise unchanged nonlethal attack.
          if (
            effect.trigger === 'battlecry' ||
            effect.trigger === 'deathrattle' ||
            effect.trigger === 'on-play'
          )
            return false
          if (effect.trigger !== 'aura' || !onlyKeys(effect, ['trigger', 'actions']))
            return true
          return !effect.actions?.every((action) => {
            const target = action.target
            const selector = target as Readonly<Record<string, unknown>>
            return (
              action.action === 'modify' &&
              onlyKeys(action, ['action', 'target', 'attack']) &&
              typeof action.attack === 'number' &&
              Number.isFinite(action.attack) &&
              target &&
              typeof target === 'object' &&
              !Array.isArray(target) &&
              onlyKeys(target, ['controller', 'type', 'selection', 'exclude']) &&
              selector.type === 'minion' &&
              ['all', 'adjacent', 'source'].includes(String(selector.selection))
            )
          })
        })
      )
        return false
    }
    // Inspect only cards public to the actor, never a hidden opponent hand/deck.
    for (const card of player.hand.filter(
      (card) => player.participantId === actorId || card.knownTo?.includes(actorId)
    )) {
      const definition = CARD_CATALOG.get(card.cardId)
      if (
        !definition ||
        (player.participantId === actorId &&
          (card.enchantments?.length ||
            card.costAdjustments?.some(
              (entry) =>
                entry.expiresOnTurn !== undefined || entry.startsOnTurn !== undefined
            ))) ||
        definition.effects.some(
          (effect) =>
            effect.trigger === 'while-in-hand' || effect.trigger === 'while-in-deck'
        )
      )
        return false
    }
  }
  return true
}

function samePositionWithDamage(
  before: AiObservation,
  after: AiObservation,
  beforeState: OpeningMatchState,
  afterState: OpeningMatchState,
  actorId: PlayerId,
  command: HeroAttack
): boolean {
  let damage = 0
  const restored = {
    ...after,
    revision: before.revision,
    players: after.players.map((player) => {
      const original = before.players.find(
        (entry) => entry.participantId === player.participantId
      )!
      if (player.participantId === actorId)
        return {
          ...player,
          hero: {
            ...player.hero,
            lastAttackedOnTurn: original.hero.lastAttackedOnTurn,
            attacksUsedThisTurn: original.hero.attacksUsedThisTurn
          }
        }
      if (command.defender.kind === 'hero') {
        if (
          player.hero.health <= 0 ||
          player.hero.health > original.hero.health ||
          player.hero.armor > original.hero.armor
        )
          return player
        damage =
          original.hero.health +
          original.hero.armor -
          player.hero.health -
          player.hero.armor
        return {
          ...player,
          hero: {
            ...player.hero,
            health: original.hero.health,
            armor: original.hero.armor,
            damageTaken: original.hero.damageTaken
          }
        }
      }
      const targetId = command.defender.instanceId
      return {
        ...player,
        board: player.board.map((minion) => {
          if (minion.instanceId !== targetId) return minion
          const target = original.board.find((entry) => entry.instanceId === targetId)
          if (!target || minion.health <= 0 || minion.health >= target.health)
            return minion
          damage = target.health - minion.health
          return { ...minion, health: target.health, damageTaken: target.damageTaken }
        })
      }
    })
  }
  const originalHero = before.players.find(
    (player) => player.participantId === actorId
  )!.hero
  const spentHero = after.players.find(
    (player) => player.participantId === actorId
  )!.hero
  const history = beforeState.history
  const nextHistory = afterState.history
  return (
    damage > 0 &&
    spentHero.lastAttackedOnTurn === before.turnNumber &&
    spentHero.attacksUsedThisTurn === (originalHero.attacksUsedThisTurn ?? 0) + 1 &&
    JSON.stringify(before) === JSON.stringify(restored) &&
    !!history &&
    !!nextHistory &&
    nextHistory.damageDealtThisTurn === history.damageDealtThisTurn + damage &&
    nextHistory.damageTakenThisTurn === history.damageTakenThisTurn + damage &&
    JSON.stringify(history) ===
      JSON.stringify({
        ...nextHistory,
        damageDealtThisTurn: history.damageDealtThisTurn,
        damageTakenThisTurn: history.damageTakenThisTurn
      }) &&
    JSON.stringify(beforeState.scheduledEffects) ===
      JSON.stringify(afterState.scheduledEffects)
  )
}

/**
 * A local preference over pass, not global dominance. One selection shares all
 * work and time caps. Atomic dispatches cannot be interrupted; stop before each.
 */
export function createExpertExpiringAttackInspector(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  shouldStop: () => boolean,
  now: () => number = () => performance.now()
) {
  const stats = { dispatches: 0, cacheHits: 0, abstentions: 0, durationMs: 0 }
  const memo = new Map<string, boolean>()
  let started: number | undefined
  let match: ReturnType<typeof createOpeningMatchFromCheckpoint> | undefined
  let fair: OpeningMatchCheckpoint | undefined
  const stop = () => {
    const time = now()
    return (
      !Number.isFinite(time) ||
      shouldStop() ||
      stats.dispatches >= EXPERT_EXPIRING_ATTACK_MAX_DISPATCHES ||
      (started !== undefined &&
        (time < started || time - started >= EXPERT_EXPIRING_ATTACK_MAX_MS))
    )
  }
  const inspect = (command: TurnMatchCommand): boolean => {
    if (
      command.type !== 'attack-character' ||
      command.attacker.kind !== 'hero' ||
      command.participantId !== actorId
    )
      return false
    if (stop()) {
      stats.abstentions++
      return false
    }
    const key = canonicalCommandKey(command)
    const cached = memo.get(key)
    if (cached !== undefined) {
      stats.cacheHits++
      return cached
    }
    const callStarted = now()
    started ??= callStarted
    try {
      fair ??= createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
      if (!supportsFreeExpiringAttack(fair.state, actorId)) return false
      match ??= createOpeningMatchFromCheckpoint(fair)
      if (stop()) {
        stats.abstentions++
        return false
      }
      const improves = match.analyze((fork) => {
        if (!fork.getAiObservation || !fork.getRandomState) return false
        const beforeState = fork.getState()
        const before = fork.getAiObservation(actorId, 'fair')
        const rng = JSON.stringify(fork.getRandomState())
        if (stop()) {
          stats.abstentions++
          return false
        }
        stats.dispatches++
        const result = fork.dispatch(command)
        if (
          !result.accepted ||
          result.state.phase !== 'turns' ||
          result.state.activePlayerId !== actorId ||
          result.state.pendingDiscover ||
          result.state.pendingCardChoice ||
          result.state.pendingResolution ||
          rng !== JSON.stringify(fork.getRandomState()) ||
          revealsTacticalInformation(result.events) ||
          result.events.some((event) => event.type === 'trigger-activated')
        )
          return false
        return samePositionWithDamage(
          before,
          fork.getAiObservation(actorId, 'fair'),
          beforeState,
          result.state,
          actorId,
          command
        )
      })
      memo.set(key, improves)
      return improves
    } finally {
      const elapsed = now() - callStarted
      if (Number.isFinite(elapsed) && elapsed >= 0) stats.durationMs += elapsed
    }
  }
  return Object.assign(inspect, { stats })
}
