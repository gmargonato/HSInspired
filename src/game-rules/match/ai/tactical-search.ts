import type { PlayerId } from '../match-types'
import type {
  OpeningMatchAnalysis,
  OpeningMatchEvent,
  OpeningMatchState
} from '../opening-match-types'
import type { TurnMatchCommand } from '../turn-match'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords
} from '../rules/minion-attack-state'
import { canonicalCommandKey, enumerateLegalCommands } from './legal-commands'

export type TacticalOutcome = 'win' | 'loss' | 'draw' | 'ongoing' | 'unknown'

export function terminalOutcome(
  state: OpeningMatchState,
  playerId: PlayerId
): TacticalOutcome {
  if (state.phase !== 'ended') return 'ongoing'
  return state.winnerId === playerId ? 'win' : state.winnerId ? 'loss' : 'draw'
}

/** Draws/choices stop exact forecasting, even when a sampled deck is deterministic. */
export function revealsTacticalInformation(
  events: readonly OpeningMatchEvent[],
  allowOrdinaryTurnDraw = false
): boolean {
  return events.some((event, index) => {
    // A normal opposing turn draw does not change its available public attacks.
    // Triggered draws and draw effects (for example a deck trap) remain uncertain.
    if (
      allowOrdinaryTurnDraw &&
      event.type === 'card-drawn' &&
      event.reason === 'turn-start' &&
      !events
        .slice(index + 1)
        .some(
          (after) =>
            after.type === 'trigger-activated' || after.type === 'effect-resolved'
        )
    )
      return false
    return [
      'card-drawn',
      'card-generated',
      'card-burned',
      'card-discarded',
      'discover-started',
      'card-choice-started',
      'secret-resolution-started',
      'random-spell-started',
      'random-spell-completed'
    ].includes(event.type)
  })
}

export function tacticalStateKey(
  fork: OpeningMatchAnalysis,
  playerId: PlayerId
): string {
  // Observations omit concealed cards. Revision/event counters are not game geometry.
  return JSON.stringify(fork.getAiObservation?.(playerId, 'fair'), (key, value) =>
    ['revision', 'recentEvents'].includes(key) ? undefined : value
  )
}

export interface TacticalLine {
  readonly commands: readonly TurnMatchCommand[]
  readonly outcome: TacticalOutcome
  readonly proven: boolean
  readonly value: number
}

export interface TacticalSearchResult {
  readonly win: TacticalLine | null
  readonly lines: readonly TacticalLine[]
  readonly nodes: number
  readonly exhausted: boolean
  readonly complete: boolean
}

function isFaceAttackLine(line: TacticalLine): boolean {
  return line.commands.every(
    (command) => command.type === 'attack-character' && command.defender.kind === 'hero'
  )
}

function tacticalPositionValue(state: OpeningMatchState, playerId: PlayerId): number {
  return state.players.reduce((total, player) => {
    const sign = player.participantId === playerId ? 1 : -1
    return (
      total +
      sign *
        (player.hero.health * 10 +
          player.hero.armor * 10 +
          player.board.reduce(
            (sum, minion) =>
              sum +
              minion.attack * 3 +
              minion.health * 2 +
              (minion.divineShield ? 4 : 0),
            0
          ))
    )
  }, 0)
}

/**
 * A completion hint, never a lethal proof. Check ready damage before a useful
 * setup can be pruned in favor of developing another body's position score.
 * Legality supplies readiness, Taunt, Rush and attack-target restrictions.
 */
function faceAttackPressure(root: OpeningMatchAnalysis, playerId: PlayerId): number {
  const state = root.getState()
  const self = state.players.find((player) => player.participantId === playerId)!
  const enemy = state.players.find((player) => player.participantId !== playerId)!
  const targets = root.getLegality(playerId).legalAttackTargets
  let damage = 0
  for (const [id, defenders] of Object.entries(targets)) {
    if (!defenders.some((defender) => defender.kind === 'hero')) continue
    if (id === `${playerId}:hero`) {
      const hero = self.hero
      const keywords = hero.keywords ?? []
      const limit =
        hero.maxAttacksPerTurn ??
        (keywords.includes('mega-windfury') ? 4 : keywords.includes('windfury') ? 2 : 1)
      const used =
        hero.attacksUsedThisTurn ??
        (hero.lastAttackedOnTurn === state.turnNumber ? 1 : 0)
      const remaining = Math.max(0, limit - used)
      damage += Math.max(0, hero.attack) * remaining
      damage +=
        Math.max(0, self.weapon?.attack ?? 0) *
        Math.min(remaining, self.weapon?.durability ?? 0)
    } else {
      const minion = self.board.find((entry) => entry.instanceId === id)
      if (!minion) continue
      const keywords = effectiveBoardMinionKeywords(minion, state.turnNumber)
      const limit =
        minion.maxAttacksPerTurn ??
        (keywords.includes('mega-windfury') ? 4 : keywords.includes('windfury') ? 2 : 1)
      damage +=
        Math.max(0, minion.attack) *
        Math.max(
          0,
          limit +
            (minion.extraAttacksThisTurn ?? 0) -
            boardMinionAttacksUsed(minion, state.turnNumber)
        )
    }
  }
  return damage - enemy.hero.health - enemy.hero.armor
}

/** No platform clock: the caller owns elapsed time, cancellation and work limits. */
export function searchTactics(
  root: OpeningMatchAnalysis,
  playerId: PlayerId,
  options: {
    readonly commands?: readonly TurnMatchCommand[]
    readonly maxDepth?: number
    readonly maxNodes?: number
    readonly width?: number
    readonly shouldStop?: () => boolean
    readonly publicRepliesOnly?: boolean
    readonly evaluate?: (fork: OpeningMatchAnalysis) => number
    readonly prior?: (command: TurnMatchCommand, state: OpeningMatchState) => number
  } = {}
): TacticalSearchResult {
  const maxDepth = options.maxDepth ?? 6
  const maxNodes = options.maxNodes ?? 2_000
  const width = options.width ?? 12
  let nodes = 0
  let exhausted = false
  let complete = true
  let win: TacticalLine | null = null
  const lines: TacticalLine[] = []
  const seen = new Set<string>()
  const stop = () => nodes >= maxNodes || options.shouldStop?.() === true
  // Complete a promising ready-damage line without waiting for every breadth
  // layer. This is one deterministic attack order, not another search budget.
  // Failed probes are discarded; only an engine-proven win escapes this fork.
  const finishFaceAttacks = (
    root: OpeningMatchAnalysis,
    parent: TacticalLine
  ): TacticalLine | null =>
    root.analyze((fork) => {
      const commands = [...parent.commands]
      while (commands.length < maxDepth) {
        if (stop()) {
          exhausted = true
          complete = false
          return null
        }
        const before = fork.getState()
        if (
          before.players.some(
            (player) =>
              player.participantId !== playerId &&
              player.secrets?.some((secret) => !secret.revealed)
          )
        )
          return null
        const attacks = enumerateLegalCommands(fork, playerId).filter(
          (command) =>
            command.type === 'attack-character' && command.defender.kind === 'hero'
        )
        const command = attacks.find(
          (attack) =>
            commands.length > 0 ||
            !options.commands ||
            options.commands.some(
              (allowed) => canonicalCommandKey(allowed) === canonicalCommandKey(attack)
            )
        )
        if (!command) return null
        if (stop()) {
          exhausted = true
          complete = false
          return null
        }
        const rng = JSON.stringify(fork.getRandomState?.())
        nodes++
        const result = fork.dispatch(command)
        if (
          !result.accepted ||
          !fork.getAiObservation ||
          !fork.getRandomState ||
          rng !== JSON.stringify(fork.getRandomState()) ||
          revealsTacticalInformation(result.events)
        )
          return null
        commands.push(command)
        const outcome = terminalOutcome(result.state, playerId)
        if (outcome === 'win')
          return {
            commands,
            outcome,
            proven: true,
            value:
              options.evaluate?.(fork) ?? tacticalPositionValue(result.state, playerId)
          }
        if (
          outcome !== 'ongoing' ||
          result.state.activePlayerId !== playerId ||
          result.state.pendingDiscover ||
          result.state.pendingCardChoice ||
          result.state.pendingResolution
        )
          return null
      }
      return null
    })
  let frontier: TacticalLine[] = [
    { commands: [], outcome: 'ongoing', proven: true, value: 0 }
  ]

  for (let depth = 0; depth < maxDepth && frontier.length && !win; depth++) {
    const next: TacticalLine[] = []
    let completion: TacticalLine | null = null
    for (const parent of frontier) {
      if (stop()) {
        exhausted = true
        complete = false
        break
      }
      root.analyze((fork) => {
        for (const command of parent.commands) {
          if (!fork.dispatch(command).accepted) {
            complete = false
            return
          }
        }
        const state = fork.getState()
        let commands =
          depth === 0 && options.commands
            ? options.commands
            : enumerateLegalCommands(fork, playerId)
        if (options.publicRepliesOnly)
          commands = commands.filter(
            (command) =>
              command.type === 'attack-character' ||
              command.type === 'use-hero-power' ||
              command.type === 'end-turn'
          )
        commands = [...commands].sort(
          (left, right) =>
            (options.prior?.(right, state) ?? 0) -
              (options.prior?.(left, state) ?? 0) ||
            canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
        )
        for (const command of commands) {
          if (stop()) {
            exhausted = true
            complete = false
            break
          }
          nodes++
          const line = fork.analyze((child): TacticalLine | null => {
            const rngBefore = child.getRandomState?.()
            const before = child.getState()
            // Never establish proof by choosing an identity for a concealed Secret.
            const concealedSecret = before.players.some(
              (player) =>
                player.participantId !== playerId &&
                player.secrets?.some((secret) => !secret.revealed)
            )
            const result = child.dispatch(command)
            if (!result.accepted) {
              complete = false
              return null
            }
            const proven =
              parent.proven &&
              !concealedSecret &&
              child.getAiObservation !== undefined &&
              child.getRandomState !== undefined &&
              JSON.stringify(rngBefore) === JSON.stringify(child.getRandomState()) &&
              !revealsTacticalInformation(
                result.events,
                options.publicRepliesOnly === true && command.type === 'end-turn'
              )
            const outcome = terminalOutcome(result.state, playerId)
            const value =
              options.evaluate?.(child) ?? tacticalPositionValue(result.state, playerId)
            const line: TacticalLine = {
              commands: [...parent.commands, command],
              outcome,
              proven,
              value
            }
            if (outcome === 'win' && proven) {
              win = line
              return line
            }
            if (!proven) complete = false
            if (
              outcome === 'ongoing' &&
              proven &&
              result.state.activePlayerId === playerId &&
              !result.state.pendingDiscover &&
              !result.state.pendingCardChoice
            ) {
              const key = tacticalStateKey(child, playerId)
              if (!seen.has(key)) {
                seen.add(key)
                next.push(line)
                // The one-action guard and final depth have no next frontier.
                if (!completion && depth + 1 < maxDepth) {
                  const hint = faceAttackPressure(child, playerId)
                  if (hint >= 0) {
                    const finished = finishFaceAttacks(child, line)
                    // Keep the proof, but let the current breadth layer find a
                    // shorter direct win before accepting this longer line.
                    if (finished) completion = finished
                  }
                }
              }
            }
            return line
          })
          if (line) lines.push(line)
          if (win) break
        }
      })
      if (win) break
    }
    if (
      !win &&
      completion &&
      depth === 0 &&
      maxDepth > 1 &&
      !isFaceAttackLine(completion)
    ) {
      if (stop()) {
        exhausted = true
        complete = false
      } else {
        const state = root.getState()
        const allowsFaceAttack =
          !options.commands ||
          options.commands.some(
            (command) =>
              command.type === 'attack-character' && command.defender.kind === 'hero'
          )
        if (
          allowsFaceAttack &&
          state.phase === 'turns' &&
          state.activePlayerId === playerId &&
          !state.pendingDiscover &&
          !state.pendingCardChoice &&
          !state.pendingResolution &&
          faceAttackPressure(root, playerId) >= 0
        ) {
          // Preserve the ordinary direct-win scan first. Before adopting a
          // setup-prefixed proof, see whether existing attacks already win.
          // Failure or exhaustion keeps the prior proof; all work is shared.
          const attackOnly = finishFaceAttacks(root, frontier[0]!)
          if (attackOnly) completion = attackOnly
        }
      }
    }
    // A deadline may leave the layer incomplete; an already engine-proven
    // completion remains usable, without claiming it is the shortest win.
    if (!win && completion) {
      win = completion
      lines.push(completion)
    }
    next.sort(
      (left, right) =>
        right.value - left.value || left.commands.length - right.commands.length
    )
    if (next.length > width || (depth === maxDepth - 1 && next.length)) complete = false
    frontier = next.slice(0, width)
    if (exhausted) break
  }
  return { win, lines, nodes, exhausted, complete }
}

/** Invalid commands and missing information are distinct from a terminal game. */
export function inspectTacticalLine(
  root: OpeningMatchAnalysis,
  playerId: PlayerId,
  commands: readonly TurnMatchCommand[],
  shouldStop: () => boolean = () => false,
  replyNodeLimit = 96
): { outcome: TacticalOutcome; reply: 'lethal' | 'clear' | 'unknown' } {
  return root.analyze((fork) => {
    if (shouldStop() || !fork.getAiObservation)
      return { outcome: 'unknown', reply: 'unknown' }
    let certain = true
    const apply = (command: TurnMatchCommand) => {
      const rng = fork.getRandomState?.()
      const secret = fork
        .getState()
        .players.some(
          (player) =>
            player.participantId !== playerId &&
            player.secrets?.some((entry) => !entry.revealed)
        )
      const result = fork.dispatch(command)
      certain &&=
        !secret &&
        fork.getRandomState !== undefined &&
        JSON.stringify(rng) === JSON.stringify(fork.getRandomState()) &&
        !revealsTacticalInformation(result.events, command.type === 'end-turn')
      return result.accepted
    }
    for (const command of commands) {
      if (shouldStop() || !apply(command))
        return { outcome: 'unknown', reply: 'unknown' }
      const outcome = terminalOutcome(fork.getState(), playerId)
      if (outcome !== 'ongoing')
        return { outcome: certain ? outcome : 'unknown', reply: 'unknown' }
      if (fork.getState().activePlayerId !== playerId) break
    }
    if (fork.getState().activePlayerId === playerId) {
      if (!apply({ type: 'end-turn', participantId: playerId }))
        return { outcome: 'unknown', reply: 'unknown' }
    }
    const outcome = terminalOutcome(fork.getState(), playerId)
    if (!certain) return { outcome: 'unknown', reply: 'unknown' }
    if (outcome !== 'ongoing') return { outcome, reply: 'unknown' }
    const opponentId = fork.getState().activePlayerId
    if (!opponentId || opponentId === playerId)
      return { outcome: 'unknown', reply: 'unknown' }
    const response = searchTactics(fork, opponentId, {
      publicRepliesOnly: true,
      maxNodes: replyNodeLimit,
      maxDepth: 8,
      width: 24,
      shouldStop
    })
    return {
      outcome,
      reply: response.win ? 'lethal' : response.complete ? 'clear' : 'unknown'
    }
  })
}
