import type { Deck } from '../../../game/decks'
import type { JsonObject } from '../../../shared/ipc/ai'
import {
  createTurnMatch,
  type OpeningMatchAnalysis,
  type AiObservation,
  type OpeningMatchEvent,
  type OpeningMatchPublicEvent,
  type OpeningMatchPublicState,
  type TurnMatchInstance,
  type TurnMatchResult,
  type TurnMatchState
} from '../../../game/match'
import type { MatchSetup, PlayerId } from '../../../game/match'
import type { MatchRecorder } from './match-recorder'
import { captureMatchCommand, captureMatchStart } from './match-log-capture'

function delayedAiEffects(
  events: readonly OpeningMatchEvent[],
  participantId: PlayerId,
  sourceParticipantId: PlayerId | undefined,
  commandType: string,
  beforeTurnNumber: number,
  afterTurnNumber: number
): JsonObject | undefined {
  let cardsDrawn = 0
  let cardsBurned = 0
  let fatigueDamage = 0
  const eventTypes = new Set<string>()
  const drawnCardIds: string[] = []
  const burnedCardIds: string[] = []

  for (const event of events) {
    if (!('participantId' in event) || event.participantId !== participantId) continue
    switch (event.type) {
      case 'card-drawn':
        cardsDrawn += 1
        eventTypes.add(event.type)
        drawnCardIds.push(String(event.card.cardId))
        break
      case 'card-burned':
        cardsBurned += 1
        eventTypes.add(event.type)
        burnedCardIds.push(String(event.card.cardId))
        break
      case 'fatigue':
        fatigueDamage += Math.max(0, event.amount)
        eventTypes.add(event.type)
        break
    }
  }

  if (cardsDrawn === 0 && cardsBurned === 0 && fatigueDamage === 0) return undefined
  return {
    participantId,
    ...(sourceParticipantId ? { sourceParticipantId } : {}),
    commandType,
    beforeTurnNumber,
    afterTurnNumber,
    eventTypes: [...eventTypes],
    cardsDrawn,
    cardsBurned,
    fatigueDamage,
    ...(drawnCardIds.length ? { drawnCardIds } : {}),
    ...(burnedCardIds.length ? { burnedCardIds } : {})
  }
}

export interface GameBoardSessionOptions {
  readonly recorder?: MatchRecorder
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
  private readonly aiObservedEvents: OpeningMatchPublicEvent[] = []

  constructor(options: GameBoardSessionOptions) {
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
        const input =
          command && typeof command === 'object'
            ? (command as { readonly participantId?: unknown; readonly type?: unknown })
            : {}
        const commandParticipantId =
          typeof input.participantId === 'string'
            ? (input.participantId as PlayerId)
            : undefined
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
        if (result.accepted && commandParticipantId !== remote.participantId) {
          const effects = delayedAiEffects(
            result.events,
            remote.participantId,
            commandParticipantId,
            typeof input.type === 'string' ? input.type : 'unknown',
            before.turnNumber,
            result.state.turnNumber
          )
          if (effects)
            options.recorder?.record('decisions', 'boundary-effects', effects, '')
        }
        if (result.accepted) {
          this.aiObservedEvents.push(
            ...(match.getPublicEvents?.(remote.participantId, result.events) ?? [])
          )
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

  getAiPublicState(): OpeningMatchPublicState {
    const state = this.match.getPublicState?.(this.remoteParticipantId)
    if (!state) throw new Error('The match engine does not expose public AI state.')
    return state
  }

  getAiObservation(): AiObservation {
    const observation = this.match.getAiObservation?.(this.remoteParticipantId, 'fair')
    if (!observation)
      throw new Error('The match engine does not expose AI observations.')
    return observation
  }

  getAiObservedEvents(limit?: number): readonly OpeningMatchPublicEvent[] {
    return limit === undefined
      ? [...this.aiObservedEvents]
      : this.aiObservedEvents.slice(-Math.max(0, limit))
  }

  findPlayer(state: TurnMatchState, participantId: PlayerId) {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) throw new Error(`Unknown participant ${participantId}`)
    return player
  }
}
