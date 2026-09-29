import type { PlayerId } from '../match-types'
import type {
  OpeningMatchAnalysis,
  OpeningMatchEvent,
  OpeningMatchState
} from '../opening-match-types'
import type { TurnMatchCommand } from '../turn-match'
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
  let frontier: TacticalLine[] = [
    { commands: [], outcome: 'ongoing', proven: true, value: 0 }
  ]

  for (let depth = 0; depth < maxDepth && frontier.length && !win; depth++) {
    const next: TacticalLine[] = []
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
              command.type !== 'end-turn' &&
              result.state.activePlayerId === playerId &&
              !result.state.pendingDiscover &&
              !result.state.pendingCardChoice
            ) {
              const key = tacticalStateKey(child, playerId)
              if (!seen.has(key)) {
                seen.add(key)
                next.push(line)
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
      if (command.type === 'end-turn') break
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
