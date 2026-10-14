import { CARD_CATALOG, asCardId } from '../../../game-rules/content/cards'
import { HERO_POWER_CATALOG } from '../../../game-rules/content/hero-powers'
import {
  sameAiIntent,
  type AiActionIntent
} from '../../../desktop/contracts/ipc/ai-deliberation'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import {
  inspectTacticalLine,
  searchTactics,
  revealsTacticalInformation,
  type TacticalLine
} from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchAnalysis,
  OpeningMatchState,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import { aiActionIntent } from './ai-action-intent'

export const EXPERT_VISIBLE_SURVIVAL_MAX_MS = 750
export const EXPERT_VISIBLE_SURVIVAL_MAX_DISPATCHES = 512

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
      player.quest ||
      player.secrets?.length ||
      !plainEnchantments(player.hero.enchantments) ||
      player.heroPower.enchantments?.length ||
      !power ||
      ![
        'gain-attack-and-armor',
        'damage-enemy-hero',
        'damage-character',
        'damage-all-minions',
        'restore-character',
        'gain-armor',
        'buff-friendly-beast',
        'buff-friendly-minions',
        'restore-and-buff-minion'
      ].includes(power.effect.kind)
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
        CARD_CATALOG.get(card.cardId)?.effects.some(
          (effect) =>
            effect.trigger === 'while-in-hand' ||
            effect.trigger === 'while-in-deck' ||
            effect.trigger === 'on-draw'
        )
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

/** A search hint only. The engine's complete public reply review supplies safety. */
function defensivePosition(state: OpeningMatchState, actorId: PlayerId): number {
  const self = state.players.find((player) => player.participantId === actorId)!
  const enemy = state.players.find((player) => player.participantId !== actorId)!
  const health = self.hero.health + self.hero.armor
  const attack = enemy.board.reduce(
    (sum, minion) =>
      sum + Math.max(0, minion.attack) * Math.max(1, minion.maxAttacksPerTurn ?? 1),
    Math.max(0, enemy.hero.attack) + Math.max(0, enemy.weapon?.attack ?? 0)
  )
  return (
    Math.min(0, health - attack - 1) * 100 +
    health * 5 -
    attack * 10 +
    self.board.reduce((sum, minion) => sum + minion.attack + minion.health, 0) -
    enemy.board.reduce((sum, minion) => sum + minion.health, 0) +
    self.mana.available
  )
}

/**
 * Repair a selected continuation with an engine-proven public lethal reply. Reuse
 * the tactical search, then require a complete public attack/power reply check
 * for a replacement. Hidden cards and future draws are never a safety claim.
 * Work and wall caps are shared; an incomplete reply is unknown, not safe.
 */
export function findExpertVisibleDefense(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  commands: readonly TurnMatchCommand[],
  selectedIntents?: readonly AiActionIntent[],
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now()
) {
  const started = now()
  const stats = {
    supported: false,
    selectedReply: 'unknown' as 'lethal' | 'clear' | 'unknown',
    dispatches: 0,
    tacticalNodes: 0,
    reviewedLines: 0,
    exhausted: false,
    durationMs: 0
  }
  const stop = () =>
    stats.dispatches >= EXPERT_VISIBLE_SURVIVAL_MAX_DISPATCHES ||
    shouldStop() ||
    now() - started >= EXPERT_VISIBLE_SURVIVAL_MAX_MS
  let defense: TacticalLine | undefined
  const state = checkpoint.state
  if (
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    !publicCombatSupported(state, actorId) ||
    stop()
  ) {
    stats.exhausted = stop()
    stats.durationMs = Math.max(0, now() - started)
    return { defense, stats }
  }
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
          message: 'Public survival review reached its limit.',
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
    const supportedLine = (line: readonly TurnMatchCommand[]) =>
      root.analyze((fork) => {
        for (const command of line) {
          if (stop() || !publicCombatSupported(fork.getState(), actorId)) return false
          if (command.type === 'play-card') {
            const card = fork
              .getState()
              .players.find((p) => p.participantId === actorId)
              ?.hand.find((c) => c.instanceId === command.cardInstanceId)
            if (!card || dynamicEffect(CARD_CATALOG.get(card.cardId)?.effects))
              return false
          }
          const rng = JSON.stringify(fork.getRandomState?.())
          const result = fork.dispatch(command)
          if (
            !result.accepted ||
            rng !== JSON.stringify(fork.getRandomState?.()) ||
            revealsTacticalInformation(result.events, command.type === 'end-turn')
          )
            return false
          if (result.state.phase === 'ended') return true
          if (!publicCombatSupported(result.state, actorId)) return false
        }
        return true
      })
    const selected = root.analyze((fork) => {
      const line: TurnMatchCommand[] = []
      const opponentId = state.players.find(
        (p) => p.participantId !== actorId
      )!.participantId
      for (const intent of selectedIntents ?? []) {
        if (stop()) return undefined
        const command = enumerateLegalCommands(fork, actorId).find((candidate) =>
          sameAiIntent(intent, aiActionIntent(candidate, opponentId))
        )
        if (!command || !fork.dispatch(command).accepted) return undefined
        line.push(command)
        if (command.type === 'end-turn' || fork.getState().phase === 'ended') break
      }
      return line
    })
    if (!selected || !supportedLine(selected)) return
    const reviewed = inspectTacticalLine(root, actorId, selected, stop, 128)
    stats.selectedReply = reviewed.reply
    if (reviewed.outcome !== 'loss' && reviewed.reply !== 'lethal') return
    const tactics = searchTactics(root, actorId, {
      commands: commands.filter((command) => command.type !== 'end-turn'),
      maxDepth: 3,
      maxNodes: 256,
      width: 6,
      shouldStop: stop,
      evaluate: (fork) => defensivePosition(fork.getState(), actorId)
    })
    stats.tacticalNodes = tactics.nodes
    stats.exhausted ||= tactics.exhausted
    if (tactics.win && supportedLine(tactics.win.commands)) {
      defense = tactics.win
      return
    }
    const lines = tactics.lines
      .filter((line) => line.proven && line.outcome === 'ongoing')
      .sort(
        (left, right) =>
          right.value - left.value || left.commands.length - right.commands.length
      )
      .slice(0, 6)
    for (const line of lines) {
      if (stop()) break
      if (!supportedLine(line.commands)) continue
      stats.reviewedLines++
      const reviewed = inspectTacticalLine(root, actorId, line.commands, stop, 128)
      if (
        reviewed.outcome === 'win' ||
        (reviewed.outcome === 'ongoing' && reviewed.reply === 'clear')
      ) {
        defense = line
        return
      }
    }
  })
  stats.exhausted ||= stop()
  stats.durationMs = Math.max(0, now() - started)
  return { defense, stats }
}
