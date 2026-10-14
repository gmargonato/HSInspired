import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'

export const EXPERT_COMMITTED_ORDER_MAX_MS = 25

/**
 * Review only an already selected adjacent pair. Keep the same attack target,
 * cards and mana expenditure; do not invent an attack or a different strategy.
 */
export function reviewCommittedActionOrder(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  first: TurnMatchCommand,
  second: TurnMatchCommand,
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now()
) {
  const stats = { dispatches: 0, abstained: false, durationMs: 0 }
  const started = now()
  const stop = () => shouldStop() || now() - started >= EXPERT_COMMITTED_ORDER_MAX_MS
  const state = checkpoint.state
  const refreshBeforeAttack =
    state.players.find((player) => player.participantId === actorId)?.weapon &&
    ['use-hero-power', 'play-card'].includes(first.type) &&
    second.type === 'attack-character' &&
    second.attacker.kind === 'hero'
  const attackBeforeCard =
    first.type === 'attack-character' &&
    first.defender.kind === 'hero' &&
    second.type === 'play-card'
  if (
    (!refreshBeforeAttack && !attackBeforeCard) ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.players.some(
      (player) => player.participantId !== actorId && player.secrets?.length
    )
  )
    return { improves: false, reason: null, stats }
  const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  const after = (commands: readonly TurnMatchCommand[]) => {
    const match = createOpeningMatchFromCheckpoint(fair)
    const rng = JSON.stringify(match.getCheckpoint().rngState)
    for (const command of commands) {
      if (stop()) {
        stats.abstained = true
        return undefined
      }
      stats.dispatches++
      const result = match.dispatch(command)
      if (
        !result.accepted ||
        result.state.phase !== 'turns' ||
        result.state.activePlayerId !== actorId ||
        result.state.pendingDiscover ||
        result.state.pendingCardChoice ||
        result.state.pendingResolution ||
        revealsTacticalInformation(result.events) ||
        JSON.stringify(match.getCheckpoint().rngState) !== rng
      )
        return undefined
    }
    return match.getCheckpoint()
  }
  const selected = after([first, second])
  const reordered = selected && after([second, first])
  let improves = false
  let reason: string | null = null
  if (selected && reordered && !stop()) {
    const selectedWeapon = selected.state.players.find(
      (player) => player.participantId === actorId
    )?.weapon
    const reorderedWeapon = reordered.state.players.find(
      (player) => player.participantId === actorId
    )?.weapon
    if (
      refreshBeforeAttack &&
      selectedWeapon &&
      reorderedWeapon &&
      // Extra durability can delay a valuable destruction/deathrattle effect.
      // Only an ordinary unenchanted weapon is a simple retained resource.
      CARD_CATALOG.get(reorderedWeapon.cardId)?.effects.length === 0 &&
      !reorderedWeapon.enchantments?.length &&
      reorderedWeapon.durability > selectedWeapon.durability
    ) {
      const comparable = (value: OpeningMatchCheckpoint) =>
        JSON.stringify({
          ...value,
          state: {
            ...value.state,
            // Trace is diagnostic, not input to game rules. History and every
            // other checkpoint field stay exact, including RNG and entity IDs.
            effectTrace: undefined,
            players: value.state.players.map((player) =>
              player.participantId === actorId
                ? { ...player, weapon: { ...player.weapon!, durability: 0 } }
                : player
            )
          }
        })
      improves = comparable(selected) === comparable(reordered)
      if (improves) reason = 'committed-weapon-refresh-order'
    }
    if (
      attackBeforeCard &&
      moreFaceDamageWithSameResources(selected, reordered, actorId)
    ) {
      improves = true
      reason = 'committed-attack-setup-order'
    }
  } else if (stop()) stats.abstained = true
  stats.durationMs = Math.max(0, now() - started)
  return { improves, reason, stats }
}

/** Normalize only the proved extra face damage and its exact history counters. */
export function moreFaceDamageWithSameResources(
  selected: OpeningMatchCheckpoint,
  reordered: OpeningMatchCheckpoint,
  actorId: PlayerId
): boolean {
  const before = selected.state.players.find(
    (player) => player.participantId !== actorId
  )!
  const after = reordered.state.players.find(
    (player) => player.participantId !== actorId
  )!
  const beforeHistory = selected.state.history
  const afterHistory = reordered.state.history
  if (!beforeHistory || !afterHistory) return false
  const healthGain = before.hero.health - after.hero.health
  const armorGain = before.hero.armor - after.hero.armor
  const damage = healthGain + armorGain
  if (
    healthGain < 0 ||
    armorGain < 0 ||
    damage <= 0 ||
    (after.hero.damageTaken ?? 0) - (before.hero.damageTaken ?? 0) !== healthGain ||
    afterHistory.damageDealtThisTurn - beforeHistory.damageDealtThisTurn !== damage ||
    afterHistory.damageTakenThisTurn - beforeHistory.damageTakenThisTurn !== damage
  )
    return false
  const normalize = (value: OpeningMatchCheckpoint) =>
    JSON.stringify({
      ...value,
      state: {
        ...value.state,
        effectTrace: undefined,
        history: {
          ...value.state.history,
          damageDealtThisTurn: 0,
          damageTakenThisTurn: 0
        },
        players: value.state.players.map((player) =>
          player.participantId !== actorId
            ? {
                ...player,
                hero: {
                  ...player.hero,
                  health: 0,
                  armor: 0,
                  damageTaken: 0
                }
              }
            : player
        )
      }
    })
  return normalize(selected) === normalize(reordered)
}
