import { describeAiEvents } from '../../../game/match/ai/event-narrative'
import type { Deck } from '../../../game/decks'
import type { OpponentStrategyBrief } from '../../../game/decks/opponent-strategy'
import type { JsonObject } from '../../../shared/ipc/ai'
import {
  createTurnMatch,
  type OpeningMatchAnalysis,
  type AiObservation,
  type OpeningMatchPublicEvent,
  type TurnMatchInstance,
  type TurnMatchResult,
  type TurnMatchState
} from '../../../game/match'
import type { MatchSetup, PlayerId } from '../../../game/match'
import type { MatchRecorder } from './match-recorder'
import { captureMatchCommand, captureMatchStart } from './match-log-capture'

export interface GameBoardSessionOptions {
  readonly recorder?: MatchRecorder
  readonly setup: MatchSetup
  readonly decks: readonly Deck[]
  readonly opponentStrategy?: OpponentStrategyBrief
}

/**
 * Feature session boundary between GameBoardView and the deterministic domain
 * engine. Participant roles and command dispatch live here; Pixi presentation
 * code consumes snapshots and events without constructing the match itself.
 */
export class GameBoardSession {
  readonly opponentStrategy?: OpponentStrategyBrief
  readonly match: TurnMatchInstance
  readonly localParticipantId: PlayerId
  readonly remoteParticipantId: PlayerId
  readonly localPlayerNumber: 1 | 2
  readonly remotePlayerNumber: 1 | 2
  private readonly aiObservedEvents: OpeningMatchPublicEvent[] = []
  private readonly listeners = new Set<(result: TurnMatchResult) => void>()
  private readonly revealedCards = new Map<string, string>()
  private eventOffset = 0

  subscribe(listener: (result: TurnMatchResult) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  acknowledgeAiEvents(cursor: number): void {
    const remove = Math.max(
      0,
      Math.min(cursor - this.eventOffset, this.aiObservedEvents.length - 64)
    )
    this.aiObservedEvents.splice(0, remove)
    this.eventOffset += remove
  }
  getAiEventCursor(): number {
    return this.eventOffset + this.aiObservedEvents.length
  }
  getAiEventsSince(cursor: number): readonly OpeningMatchPublicEvent[] {
    return this.aiObservedEvents.slice(Math.max(0, cursor - this.eventOffset))
  }
  getAiPublicHistory(): JsonObject {
    return {
      revealedCards: Object.fromEntries(this.revealedCards),
      recentEvents: describeAiEvents(
        this.aiObservedEvents.slice(-64),
        this.remoteParticipantId
      )
    }
  }

  constructor(options: GameBoardSessionOptions) {
    this.opponentStrategy = options.opponentStrategy
    const match = createTurnMatch(options.setup, options.decks)
    let logState = match.getState()
    const human = options.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )
    const remote = options.setup.participants.find(
      (participant) => participant.controllerKind === 'ai'
    )
    if (!human || !remote) {
      throw new Error('GameBoardSession requires one human and one AI participant.')
    }

    this.localParticipantId = human.participantId
    this.remoteParticipantId = remote.participantId
    this.match = {
      ...match,
      // Bind previews to the underlying engine so simulations cannot pollute
      // the renderer's authoritative-event history.
      preview: (command: unknown) => match.preview(command),
      previewSequence: (commands: readonly unknown[]) =>
        match.previewSequence(commands),
      analyze: <T>(operation: (fork: OpeningMatchAnalysis) => T) =>
        match.analyze(operation),
      dispatch: (command: unknown) => {
        const before = logState
        const result = match.dispatch(command)
        logState = result.state
        options.recorder?.record(
          'events',
          'command',
          () => captureMatchCommand(before, result, command),
          typeof command === 'object' &&
            command !== null &&
            'participantId' in command &&
            command.participantId === remote.participantId
            ? options.recorder?.decisionId
            : ''
        )
        if (result.accepted) {
          const events = (
            match.getPublicEvents?.(remote.participantId, result.events) ?? []
          ).filter((event) => event.type !== 'effect-resolved')
          this.aiObservedEvents.push(...events)
          const collect = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const entry = value as Record<string, unknown>
            const id = entry.instanceId ?? entry.id
            if (typeof id === 'string' && typeof entry.cardId === 'string')
              this.revealedCards.set(id, entry.cardId)
            Object.values(entry).forEach(collect)
          }
          collect(events)
          for (const listener of this.listeners) listener(result)
        }
        if (result.accepted && result.state.phase === 'ended')
          options.recorder?.finish('completed')
        return result
      }
    }
    const state = match.getState()
    this.localPlayerNumber = this.findPlayer(state, human.participantId).playerNumber
    this.remotePlayerNumber = this.findPlayer(state, remote.participantId).playerNumber
    options.recorder?.setContext(() => ({
      revision: logState.revision,
      turnNumber: logState.turnNumber
    }))
    options.recorder?.record(
      'events',
      'match-start',
      () => captureMatchStart(options.setup, state),
      ''
    )
  }

  getState(): TurnMatchState {
    return this.match.getState()
  }

  dispatch(command: unknown): TurnMatchResult {
    return this.match.dispatch(command)
  }

  getAiObservation(): AiObservation {
    const observation = this.match.getAiObservation?.(this.remoteParticipantId, 'fair')
    if (!observation)
      throw new Error('The match engine does not expose AI observations.')
    return observation
  }

  findPlayer(state: TurnMatchState, participantId: PlayerId) {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) throw new Error(`Unknown participant ${participantId}`)
    return player
  }
}
