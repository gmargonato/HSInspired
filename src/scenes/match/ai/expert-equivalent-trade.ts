import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  BoardMinion,
  OpeningMatchCheckpoint,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import {
  sameAiIntent,
  type AiActionIntent
} from '../../../desktop/contracts/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'

const MAX_MS = 40
const MAX_DISPATCHES = 42

function plainTarget(minion: BoardMinion) {
  return (
    !minion.boardObject &&
    !minion.dormant &&
    !minion.enchantments?.length &&
    !minion.grantedTriggers?.length &&
    !minion.attachedEffects?.length &&
    !minion.deathrattles?.length &&
    !minion.divineShield &&
    !minion.immune &&
    (minion.silenced || CARD_CATALOG.get(minion.cardId)?.effects.length === 0)
  )
}

function targetKey(minion: BoardMinion) {
  // Compare only public combat characteristics. Never inspect deck provenance,
  // concealed deathrattle choices, remembered hidden cards, or future fields.
  return JSON.stringify({
    cardId: minion.cardId,
    attack: minion.attack,
    maxHealth: minion.maxHealth,
    keywords: minion.keywords,
    silenced: minion.silenced,
    frozenUntilTurn: minion.frozenUntilTurn,
    divineShield: minion.divineShield,
    divineShieldConsumed: minion.divineShieldConsumed,
    stealth: minion.stealth,
    stealthRevealed: minion.stealthRevealed,
    immune: minion.immune,
    spellImmune: minion.spellImmune,
    attacksUsedThisTurn: minion.attacksUsedThisTurn,
    maxAttacksPerTurn: minion.maxAttacksPerTurn,
    extraAttacksThisTurn: minion.extraAttacksThisTurn,
    spellDamage: minion.spellDamage,
    spellDamageMultiplier: minion.spellDamageMultiplier,
    healingMultiplier: minion.healingMultiplier,
    heroPowerMultiplier: minion.heroPowerMultiplier,
    ownerId: minion.ownerId,
    controllerId: minion.controllerId
  })
}

/**
 * A bounded tactical preference, not a universal strategic dominance proof.
 * Spend the already-selected attack on an otherwise equivalent plain target
 * it can kill, rather than leave both targets alive. Never add an attack or
 * change retaliation, own resources, or the known selected continuation.
 */
export function reviewEquivalentTrade(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  selected: TurnMatchCommand,
  suffix: readonly AiActionIntent[],
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now()
) {
  const started = now()
  const stats = { dispatches: 0, abstained: false, durationMs: 0 }
  const stop = () =>
    shouldStop() || now() - started >= MAX_MS || stats.dispatches >= MAX_DISPATCHES
  const unchanged = () => ({ command: null as TurnMatchCommand | null, stats })
  const state = checkpoint.state
  if (
    selected.type !== 'attack-character' ||
    selected.attacker.kind !== 'minion' ||
    selected.defender.kind !== 'minion' ||
    suffix.length > 5 ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    state.players.some((p) => p.secrets?.length || p.quest)
  )
    return unchanged()
  const self = state.players.find((p) => p.participantId === actorId)!
  const enemy = state.players.find((p) => p.participantId !== actorId)!
  const attackerId = selected.attacker.instanceId,
    targetId = selected.defender.instanceId
  const attacker = self.board.find((m) => m.instanceId === attackerId)
  const target = enemy.board.find((m) => m.instanceId === targetId)
  if (
    !attacker ||
    !target ||
    !plainTarget(target) ||
    target.health <= attacker.attack ||
    attacker.attack <= 0
  )
    return unchanged()
  const candidates = enemy.board.filter(
    (m) =>
      m.instanceId !== targetId &&
      plainTarget(m) &&
      m.health <= attacker.attack &&
      targetKey(m) === targetKey(target)
  )
  if (!candidates.length) return unchanged()
  // No concealed entity participates in this review, even in suffix simulation.
  const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  const rng = JSON.stringify(fair.rngState)
  const simulate = (command: TurnMatchCommand) => {
    const match = createOpeningMatchFromCheckpoint({
      ...fair,
      setup: { ...fair.setup, recordEffectTrace: false }
    })
    const sequence = [aiActionIntent(command, enemy.participantId), ...suffix]
    for (const [index, intent] of sequence.entries()) {
      if (intent.type === 'end-turn') {
        if (index !== sequence.length - 1) return null
        break // Do not draw from the hidden opposing deck to evaluate a trade.
      }
      if (stop()) {
        stats.abstained = true
        return null
      }
      const legal = enumerateLegalCommands(
        {
          getState: match.getState,
          getPlayInput: match.getPlayInput!,
          getLegality: match.getLegality!
        },
        actorId
      )
      const action = legal.find((c) =>
        sameAiIntent(intent, aiActionIntent(c, enemy.participantId))
      )
      if (!action) return null
      stats.dispatches++
      const result = match.dispatch(action)
      if (
        !result.accepted ||
        result.state.phase !== 'turns' ||
        result.state.activePlayerId !== actorId ||
        result.state.pendingDiscover ||
        result.state.pendingCardChoice ||
        result.state.pendingResolution ||
        result.state.scheduledEffects?.length ||
        revealsTacticalInformation(result.events) ||
        result.events.some((e) => e.type === 'trigger-activated') ||
        JSON.stringify(match.getCheckpoint().rngState) !== rng
      )
        return null
    }
    return match.getState()
  }
  try {
    const before = simulate(selected)
    if (!before) return unchanged()
    const ownBefore = before.players.find((p) => p.participantId === actorId)!
    const enemyBefore = before.players.find(
      (p) => p.participantId === enemy.participantId
    )!
    if (!enemyBefore.board.some((m) => m.instanceId === targetId)) return unchanged()
    for (const candidate of candidates) {
      const command: TurnMatchCommand = {
        ...selected,
        defender: { kind: 'minion', instanceId: candidate.instanceId }
      }
      const after = simulate(command)
      if (!after) continue
      const ownAfter = after.players.find((p) => p.participantId === actorId)!
      const enemyAfter = after.players.find(
        (p) => p.participantId === enemy.participantId
      )!
      const rest = (p: typeof enemyAfter) =>
        JSON.stringify({ ...p, board: undefined, graveyard: undefined })
      const others = (p: typeof enemyAfter) =>
        JSON.stringify(
          p.board.filter(
            (m) => m.instanceId !== targetId && m.instanceId !== candidate.instanceId
          )
        )
      const remaining = enemyAfter.board.find((m) => m.instanceId === targetId)
      // One additional opposing death can shift later temporal ordinals by
      // exactly one. Keep entity IDs, old ordinals and all relative ordering;
      // allow that one offset only on post-root friendly play/death events.
      const shiftedOrdinal = (before: number | undefined, after: number | undefined) =>
        before !== undefined &&
        before >= checkpoint.nextEntityOrdinal &&
        after === before + 1
          ? before
          : after
      const ownComparable = {
        ...ownAfter,
        board: ownAfter.board.map((m, index) => ({
          ...m,
          playOrder: shiftedOrdinal(ownBefore.board[index]?.playOrder, m.playOrder)
        })),
        graveyard: ownAfter.graveyard?.map((g, index) => ({
          ...g,
          deathOrdinal: shiftedOrdinal(
            ownBefore.graveyard?.[index]?.deathOrdinal,
            g.deathOrdinal
          )
        }))
      }
      const beforeTarget = enemyBefore.board.find((m) => m.instanceId === targetId)
      const gravesWithoutExtra = enemyAfter.graveyard?.filter(
        (g) => g.minion.instanceId !== candidate.instanceId
      )
      const globalKey = (value: typeof before) =>
        JSON.stringify({
          ...value,
          players: undefined,
          history: undefined,
          effectTrace: undefined,
          nextEntityOrdinal: undefined
        })
      const total = (p: typeof enemyAfter, key: 'health' | 'attack') =>
        p.board.reduce((n, m) => n + m[key], 0)
      if (
        !enemyAfter.board.some((m) => m.instanceId === candidate.instanceId) &&
        remaining &&
        beforeTarget &&
        targetKey(remaining) === targetKey(beforeTarget) &&
        JSON.stringify(gravesWithoutExtra) === JSON.stringify(enemyBefore.graveyard) &&
        enemyBefore.board.some((m) => m.instanceId === candidate.instanceId) &&
        JSON.stringify(ownBefore) === JSON.stringify(ownComparable) &&
        rest(enemyBefore) === rest(enemyAfter) &&
        others(enemyBefore) === others(enemyAfter) &&
        globalKey(before) === globalKey(after) &&
        enemyAfter.board.length === enemyBefore.board.length - 1 &&
        total(enemyAfter, 'health') <= total(enemyBefore, 'health') &&
        total(enemyAfter, 'attack') < total(enemyBefore, 'attack') &&
        !stop()
      )
        return { command, stats }
    }
    return unchanged()
  } finally {
    stats.durationMs = Math.max(0, now() - started)
  }
}
