import { CARD_CATALOG, asCardId } from '../../../game-rules/content/cards'
import { HERO_POWER_CATALOG } from '../../../game-rules/content/hero-powers'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import type { TacticalLine } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchAnalysis,
  OpeningMatchState,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import {
  applyPublicAttackStep,
  inspectPublicAttackReply,
  protectiveSecretsSupported,
  type AttackReply
} from './expert-public-attack-reply'

export const EXPERT_PUBLIC_THREAT_MAX_MS = 750
export const EXPERT_PUBLIC_THREAT_MAX_DISPATCHES = 512

function onlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/** Closed support boundary; a sampled hidden condition cannot establish safety. */
function publicCombatSupported(state: OpeningMatchState, actorId: PlayerId): boolean {
  if (
    state.scheduledEffects?.length ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution
  )
    return false
  const plainEnchantments = (entries: readonly object[] | undefined) =>
    !entries?.some(
      (entry) =>
        ![undefined, 'permanent', 'this-turn'].includes(
          (entry as { duration?: string }).duration
        ) ||
        !onlyKeys(entry, [
          'id',
          'sourceInstanceId',
          'sourceCardId',
          'attackDelta',
          'healthDelta',
          'maximumHealthDelta',
          'duration',
          'expiresOnTurn',
          'continuous',
          'keywords'
        ])
    )
  for (const player of state.players) {
    const power = HERO_POWER_CATALOG.get(player.heroPower.id)
    if (
      (player.quest && player.quest.goal !== 'cast-generated-spell') ||
      !protectiveSecretsSupported(state, actorId) ||
      !plainEnchantments(player.hero.enchantments) ||
      player.heroPower.enchantments?.length ||
      !power
    )
      return false
    if (
      player.weapon &&
      (CARD_CATALOG.get(player.weapon.cardId)?.effects.length !== 0 ||
        !plainEnchantments(player.weapon.enchantments))
    )
      return false
    for (const minion of player.board) {
      if (
        minion.dormant ||
        minion.grantedTriggers?.length ||
        minion.attachedEffects?.length ||
        minion.deathrattles?.length ||
        !plainEnchantments(minion.enchantments)
      )
        return false
      const definition = CARD_CATALOG.get(minion.cardId)
      if (!definition) return false
      if (minion.silenced) continue
      if (
        definition.effects.some((effect) => {
          if (effect.trigger === 'battlecry' || effect.trigger === 'on-play')
            return false
          if (effect.trigger !== 'aura' || !onlyKeys(effect, ['trigger', 'actions']))
            return true
          return !effect.actions?.every((action) => {
            const target = action.target as Record<string, unknown> | undefined
            return (
              action.action === 'modify' &&
              onlyKeys(action, ['action', 'target', 'attack']) &&
              typeof action.attack === 'number' &&
              Number.isFinite(action.attack) &&
              target &&
              onlyKeys(target, ['controller', 'type', 'selection', 'exclude']) &&
              target.type === 'minion' &&
              ['all', 'adjacent', 'source'].includes(String(target.selection))
            )
          })
        })
      )
        return false
    }
    // Only inspect identities already public to the actor.
    const knownCards = [
      ...player.hand.filter(
        (card) => player.participantId === actorId || card.knownTo?.includes(actorId)
      ),
      ...player.deck.filter(
        (card) =>
          (player.participantId === actorId && card.startedInDeck) ||
          card.knownTo?.includes(actorId)
      )
    ]
    for (const card of knownCards) {
      if (
        CARD_CATALOG.get(card.cardId)?.effects.some((effect) => {
          if (
            effect.trigger === 'while-in-hand' &&
            effect.actions?.every((action) => {
              const target = action.target as Record<string, unknown> | undefined
              return (
                action.action === 'change-cost' &&
                target?.type === 'card' &&
                target.selection === 'source'
              )
            })
          )
            return false
          return (
            effect.trigger === 'while-in-hand' ||
            effect.trigger === 'while-in-deck' ||
            effect.trigger === 'on-draw'
          )
        })
      )
        return false
    }
  }
  return true
}

function dynamicEffect(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(dynamicEffect)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, item]) =>
      ['condition', 'conditions', 'reference'].includes(key) ||
      (key === 'zone' && ['hand', 'deck'].includes(String(item))) ||
      dynamicEffect(item)
  )
}

/**
 * Concealed cards are inert placeholders in this public-only reply model. This
 * deliberately excludes hidden plays, hidden passive effects and future draws;
 * it never mistakes one sampled identity for a public safety fact.
 */
function publicCombatCheckpoint(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId
): OpeningMatchCheckpoint {
  const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  return {
    ...fair,
    state: {
      ...fair.state,
      players: fair.state.players.map((player) => ({
        ...player,
        hand: player.hand.map((card) =>
          player.participantId === actorId || card.knownTo?.includes(actorId)
            ? card
            : {
                ...card,
                cardId: asCardId('classic_wisp'),
                baseCost: 0,
                currentCost: 0,
                enchantments: [],
                costAdjustments: []
              }
        ),
        deck: player.deck.map((card) =>
          (player.participantId === actorId && card.startedInDeck) ||
          card.knownTo?.includes(actorId)
            ? card
            : {
                ...card,
                cardId: asCardId('classic_wisp'),
                baseCost: 0,
                currentCost: 0,
                enchantments: [],
                costAdjustments: []
              }
        )
      })) as unknown as OpeningMatchState['players']
    }
  }
}

/**
 * Inspect the actual pass before search spends resources. A defense proves only
 * this action followed immediately by End Turn against the closed public attack
 * model. Extending the seed must not inherit that survival certificate.
 */
export function inspectExpertPublicThreat(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  commands: readonly TurnMatchCommand[] | undefined = undefined,
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now()
) {
  const started = now()
  const stats = {
    supported: false,
    scope: 'attacks-only' as const,
    dispatches: 0,
    reviewedLines: 0,
    exhausted: false,
    durationMs: 0
  }
  const defenses: TacticalLine[] = []
  let reply: AttackReply['reply'] = 'unknown'
  const stop = () =>
    stats.dispatches >= EXPERT_PUBLIC_THREAT_MAX_DISPATCHES ||
    shouldStop() ||
    now() - started >= EXPERT_PUBLIC_THREAT_MAX_MS
  const finish = () => {
    stats.exhausted = stop()
    stats.durationMs = Math.max(0, now() - started)
    return { reply, defenses, stats, rootRevision: checkpoint.state.revision, actorId }
  }
  const state = checkpoint.state
  const supported = (position: OpeningMatchState) =>
    publicCombatSupported(position, actorId)
  if (
    stop() ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    !supported(state)
  )
    return finish()
  stats.supported = true
  const match = createOpeningMatchFromCheckpoint(
    publicCombatCheckpoint(checkpoint, actorId)
  )
  const bounded = (fork: OpeningMatchAnalysis): OpeningMatchAnalysis => ({
    ...fork,
    dispatch(command) {
      if (stop())
        return {
          accepted: false,
          code: 'resolution-budget-exhausted',
          message: 'Public threat inspection reached its limit.',
          state: fork.getState(),
          events: []
        }
      stats.dispatches++
      return fork.dispatch(command)
    },
    analyze(operation) {
      return fork.analyze((child) => operation(bounded(child)))
    }
  })
  match.analyze((unbounded) => {
    const root = bounded(unbounded)
    const end: TurnMatchCommand = { type: 'end-turn', participantId: actorId }
    const threat = root.analyze((fork) => {
      if (stop() || !applyPublicAttackStep(fork, end) || stop())
        return { reply: 'unknown' as const }
      return inspectPublicAttackReply(fork, actorId, supported, stop)
    })
    reply = threat.reply
    if (reply !== 'lethal' || stop()) return
    const candidates: { command: TurnMatchCommand; value: number; priority: number }[] =
      []
    // Every supplied legal immediate action is considered, with no card IDs or
    // selected-plan eligibility. Complete the immediate-win scan before proofs.
    const legalCommands = commands ?? enumerateLegalCommands(root, actorId)
    if (stop()) return
    for (const command of legalCommands) {
      if (stop()) break
      if (command.type === 'end-turn') continue
      root.analyze((fork) => {
        if (command.type === 'play-card') {
          const card = fork
            .getState()
            .players.find((player) => player.participantId === actorId)
            ?.hand.find((card) => card.instanceId === command.cardInstanceId)
          if (!card || dynamicEffect(CARD_CATALOG.get(card.cardId)?.effects)) return
        }
        if (!applyPublicAttackStep(fork, command) || stop()) return
        const position = fork.getState()
        if (position.phase === 'ended') {
          if (position.winnerId === actorId)
            defenses.push({
              commands: [command],
              outcome: 'win',
              proven: true,
              value: Infinity
            })
          return
        }
        if (!supported(position) || position.activePlayerId !== actorId) return
        const self = position.players.find(
          (player) => player.participantId === actorId
        )!
        const enemy = position.players.find(
          (player) => player.participantId !== actorId
        )!
        const pressure = enemy.board.reduce(
          (sum, minion) =>
            sum +
            ((minion.frozenUntilTurn ?? -1) < position.turnNumber + 1
              ? Math.max(0, minion.attack) * (minion.maxAttacksPerTurn ?? 1)
              : 0),
          Math.max(0, enemy.hero.attack) + Math.max(0, enemy.weapon?.attack ?? 0)
        )
        // Ordering only: exhaustive verification below determines certification.
        candidates.push({
          command,
          value: self.mana.available,
          priority:
            self.hero.health + self.hero.armor > pressure
              ? 2
              : self.secrets?.length
                ? 1
                : 0
        })
      })
    }
    if (stop() || defenses.some((line) => line.outcome === 'win')) return
    candidates.sort((a, b) => b.priority - a.priority || b.value - a.value)
    for (const candidate of candidates) {
      if (stop()) break
      const review = root.analyze((fork) => {
        if (
          !applyPublicAttackStep(fork, candidate.command) ||
          stop() ||
          !supported(fork.getState()) ||
          !applyPublicAttackStep(fork, end) ||
          stop()
        )
          return { reply: 'unknown' as const }
        stats.reviewedLines++
        return inspectPublicAttackReply(fork, actorId, supported, stop, threat.witness)
      })
      if (review.reply === 'clear' && !stop())
        defenses.push({
          commands: [candidate.command, end],
          outcome: 'ongoing',
          proven: true,
          value: candidate.value
        })
    }
  })
  return finish()
}
