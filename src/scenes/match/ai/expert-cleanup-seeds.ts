import { CARD_CATALOG } from '../../../game-rules/content'
import { canonicalCommandKey } from '../../../game-rules/match/ai'
import {
  revealsTacticalInformation,
  type TacticalLine
} from '../../../game-rules/match/ai/tactical-search'
import type {
  OpeningMatchAnalysis,
  OpeningMatchEvent,
  PlayerId,
  TurnMatchState
} from '../../../game-rules/match'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function simpleRandomMinionDamage(cardId: string): boolean {
  const definition = CARD_CATALOG.get(cardId)
  if (
    definition?.type !== 'Spell' ||
    definition.keywords.length ||
    definition.effects.length !== 1
  )
    return false
  const effect = definition.effects[0]!
  const action = effect.actions?.[0]
  const target = record(action?.target)
  return (
    effect.trigger === 'cast' &&
    Object.keys(effect).every((key) => key === 'trigger' || key === 'actions') &&
    effect.actions?.length === 1 &&
    action?.action === 'damage' &&
    typeof action.amount === 'number' &&
    action.amount > 0 &&
    Object.keys(action).every((key) => ['action', 'target', 'amount'].includes(key)) &&
    Object.keys(target).length === 3 &&
    target.controller === 'opponent' &&
    target.type === 'minion' &&
    target.selection === 'random'
  )
}

function canContinue(state: TurnMatchState, actorId: PlayerId): boolean {
  return (
    state.phase === 'turns' &&
    state.activePlayerId === actorId &&
    !state.pendingDiscover &&
    !state.pendingCardChoice &&
    !state.pendingResolution &&
    !state.players.some((player) => (player.secrets?.length ?? 0) > 0)
  )
}

function revealsInformation(events: readonly OpeningMatchEvent[]): boolean {
  return (
    revealsTacticalInformation(events) ||
    events.some((event) => event.type === 'effect-resolved' && event.cardReveal)
  )
}

/**
 * Reuse existing tactical lines as sampled rollout seeds when only their final,
 * simple random-minion cleanup advanced RNG. These lines remain unproven and
 * receive real search visits; this does not certify or force their continuation.
 */
export function expertSingletonCleanupSeeds(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  lines: readonly TacticalLine[],
  shouldStop: () => boolean = () => false
): readonly TacticalLine[] {
  const state = root.getState()
  const player = state.players.find((entry) => entry.participantId === actorId)
  if (!player || !root.getRandomState || !canContinue(state, actorId)) return []
  const selected = new Map<string, TacticalLine>()
  let reviewed = 0
  for (const line of [...lines].sort((a, b) => b.value - a.value)) {
    if (shouldStop() || reviewed >= 8) break
    if (line.proven || line.commands.length < 2 || line.commands.length > 6) continue
    const cleanup = line.commands.at(-1)!
    if (cleanup.type !== 'play-card') continue
    const card = player.hand.find(
      (entry) => entry.instanceId === cleanup.cardInstanceId
    )
    if (!card || !simpleRandomMinionDamage(card.cardId)) continue
    const key = canonicalCommandKey(line.commands[0]!)
    if (selected.has(key)) continue
    reviewed++
    const qualifies = root.analyze((fork) => {
      for (const command of line.commands.slice(0, -1)) {
        if (shouldStop() || !fork.getRandomState) return false
        const rng = JSON.stringify(fork.getRandomState())
        const result = fork.dispatch(command)
        if (
          !result.accepted ||
          shouldStop() ||
          !canContinue(result.state, actorId) ||
          revealsInformation(result.events) ||
          rng !== JSON.stringify(fork.getRandomState())
        )
          return false
      }
      if (shouldStop()) return false
      const before = fork.getState()
      const own = before.players.find((entry) => entry.participantId === actorId)!
      const enemy = before.players.find((entry) => entry.participantId !== actorId)!
      const held = own.hand.find((entry) => entry.instanceId === cleanup.cardInstanceId)
      if (
        !held ||
        held.cardId !== card.cardId ||
        enemy.board.length !== 1 ||
        enemy.board[0]!.dormant ||
        before.players.some((entry) => entry.quest)
      )
        return false
      const targetId = enemy.board[0]!.instanceId
      const result = fork.dispatch(cleanup)
      if (
        !result.accepted ||
        shouldStop() ||
        !canContinue(result.state, actorId) ||
        revealsInformation(result.events) ||
        result.state.players.find((entry) => entry.participantId !== actorId)!.board
          .length !== 0
      )
        return false
      // Check actual resolved events rather than assuming other board effects
      // cannot fire. Only the authored cast and its one damage action may resolve.
      const effects = result.events.filter((event) => event.type === 'effect-resolved')
      return (
        effects.length === 1 &&
        effects[0]!.action === 'damage' &&
        effects[0]!.sourceInstanceId === cleanup.cardInstanceId &&
        result.events.every((event) => {
          if (event.type === 'trigger-activated')
            return (
              event.source.instanceId === cleanup.cardInstanceId &&
              event.trigger === 'cast'
            )
          if (event.type === 'character-damaged')
            return (
              event.character.kind === 'minion' &&
              event.character.instanceId === targetId
            )
          return true
        })
      )
    })
    if (qualifies) selected.set(key, line)
  }
  return [...selected.values()]
}
