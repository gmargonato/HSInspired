import { createSeededRng, type DeterministicRng } from './rng'
import {
  cloneMatchState,
  type CommandResult,
  type MatchInstance,
  type MatchSetup,
  type MatchState
} from './match-types'
import { parseMatchCommand, parseMatchSetup } from './match-validation'

const INITIAL_STATE: MatchState = {
  status: 'waiting',
  readyParticipants: [],
  proofRandomValues: [],
  revision: 0
}

export function createMatch(
  setupValue: MatchSetup | unknown,
  rng?: DeterministicRng
): MatchInstance {
  const setup = parseMatchSetup(setupValue)
  const random = rng ?? createSeededRng(setup.seed)
  let state = cloneMatchState(INITIAL_STATE)

  return {
    setup,
    getState(): MatchState {
      return cloneMatchState(state)
    },
    dispatch(commandValue: unknown): CommandResult {
      const command = parseMatchCommand(commandValue)
      if (!command) {
        return {
          accepted: false,
          code: 'invalid-command',
          message: 'The match command is invalid.',
          state: cloneMatchState(state),
          events: []
        }
      }

      const participant = setup.participants.find(
        (candidate) => candidate.participantId === command.participantId
      )
      if (!participant) {
        return {
          accepted: false,
          code: 'unknown-participant',
          message: `Unknown participant: ${command.participantId}`,
          state: cloneMatchState(state),
          events: []
        }
      }
      if (state.readyParticipants.includes(participant.participantId)) {
        return {
          accepted: false,
          code: 'already-ready',
          message: `Participant ${participant.participantId} is already ready.`,
          state: cloneMatchState(state),
          events: []
        }
      }

      const readyParticipants = [...state.readyParticipants, participant.participantId]
      const randomValue = random.next()
      const events = [
        { type: 'participant-ready', participantId: participant.participantId },
        {
          type: 'readiness-updated',
          readyCount: readyParticipants.length,
          requiredCount: 2 as const
        },
        { type: 'proof-random-value', value: randomValue }
      ] as const
      const status =
        readyParticipants.length === setup.participants.length ? 'ready' : 'waiting'
      state = {
        status,
        readyParticipants,
        proofRandomValues: [...state.proofRandomValues, randomValue],
        revision: state.revision + 1
      }

      return {
        accepted: true,
        state: cloneMatchState(state),
        events:
          status === 'ready' ? [...events, { type: 'match-ready' as const }] : events
      }
    }
  }
}
