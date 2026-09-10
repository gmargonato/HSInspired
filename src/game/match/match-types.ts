import type { HeroId } from '../content/cards'

export type PlayerId = string & { readonly __playerId: unique symbol }
export type ControllerKind = 'human' | 'ai'

export function asPlayerId(value: string): PlayerId {
  return value as PlayerId
}

export interface MatchParticipantSetup {
  readonly participantId: PlayerId
  readonly controllerKind: ControllerKind
  readonly heroId: HeroId
  readonly deckId: string
}

export interface MatchSetup {
  readonly participants: readonly [MatchParticipantSetup, MatchParticipantSetup]
  /** Extensible rules/profile identifier; omitted legacy setups use constructed. */
  readonly modeId?: string
  readonly seed?: number
  /** Optional deterministic seat override used by development match launches. */
  readonly startingParticipantId?: PlayerId
  /** Development launch option that keeps both opening hands unchanged. */
  readonly skipMulligan?: boolean
  /** Development/test diagnostics only; normal matches do not retain effect traces. */
  readonly recordEffectTrace?: boolean
}

export interface MatchState {
  readonly status: 'waiting' | 'ready'
  readonly readyParticipants: readonly PlayerId[]
  readonly proofRandomValues: readonly number[]
  readonly revision: number
}

export interface ParticipantReadyEvent {
  readonly type: 'participant-ready'
  readonly participantId: PlayerId
}

export interface ReadinessUpdatedEvent {
  readonly type: 'readiness-updated'
  readonly readyCount: number
  readonly requiredCount: 2
}

export interface ProofRandomValueEvent {
  readonly type: 'proof-random-value'
  readonly value: number
}

export interface MatchReadyEvent {
  readonly type: 'match-ready'
}

export type MatchDomainEvent =
  | ParticipantReadyEvent
  | ReadinessUpdatedEvent
  | ProofRandomValueEvent
  | MatchReadyEvent

export interface ReadyCommand {
  readonly type: 'ready'
  readonly participantId: PlayerId
}

export type MatchCommand = ReadyCommand

export interface AcceptedCommandResult {
  readonly accepted: true
  readonly state: MatchState
  readonly events: readonly MatchDomainEvent[]
}

export interface RejectedCommandResult {
  readonly accepted: false
  readonly code: 'invalid-command' | 'unknown-participant' | 'already-ready'
  readonly message: string
  readonly state: MatchState
  readonly events: readonly []
}

export type CommandResult = AcceptedCommandResult | RejectedCommandResult

export interface MatchInstance {
  readonly setup: MatchSetup
  getState(): MatchState
  dispatch(command: unknown): CommandResult
}

export interface MatchProofOutput {
  readonly setup: MatchSetup
  readonly initialState: MatchState
  readonly acceptedResult: CommandResult
  readonly rejectedResult: CommandResult
  readonly finalState: MatchState
  readonly serialized: string
}

export function cloneMatchState(state: MatchState): MatchState {
  return {
    ...state,
    readyParticipants: [...state.readyParticipants],
    proofRandomValues: [...state.proofRandomValues]
  }
}
