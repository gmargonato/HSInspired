import type { Deck } from '../../../game/decks'
import {
  createTurnMatch,
  type TurnMatchEvent,
  type TurnMatchInstance,
  type TurnMatchResult,
  type TurnMatchState
} from '../../../game/match'
import type { MatchSetup, PlayerId } from '../../../game/match'

export interface GameBoardSessionOptions {
  readonly setup: MatchSetup
  readonly decks: readonly Deck[]
}

/**
 * Feature session boundary between GameBoardView and the deterministic domain
 * engine. Participant roles and command dispatch live here; Pixi presentation
 * code consumes snapshots and events without constructing the match itself.
 */
export class GameBoardSession {
  readonly match: TurnMatchInstance
  readonly localParticipantId: PlayerId
  readonly remoteParticipantId: PlayerId
  readonly localPlayerNumber: 1 | 2
  readonly remotePlayerNumber: 1 | 2
  private readonly aiObservedEvents: TurnMatchEvent[] = []

  constructor(options: GameBoardSessionOptions) {
    const match = createTurnMatch(options.setup, options.decks)
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
      dispatch: (command: unknown) => {
        const result = match.dispatch(command)
        if (result.accepted) {
          this.aiObservedEvents.push(...result.events)
        }
        return result
      }
    }
    const state = match.getState()
    this.localPlayerNumber = this.findPlayer(state, human.participantId).playerNumber
    this.remotePlayerNumber = this.findPlayer(state, remote.participantId).playerNumber
  }

  getState(): TurnMatchState {
    return this.match.getState()
  }

  dispatch(command: unknown): TurnMatchResult {
    return this.match.dispatch(command)
  }

  getAiObservedEvents(limit = 80): readonly TurnMatchEvent[] {
    return this.aiObservedEvents.slice(-Math.max(0, limit))
  }

  findPlayer(state: TurnMatchState, participantId: PlayerId) {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) throw new Error(`Unknown participant ${participantId}`)
    return player
  }
}
