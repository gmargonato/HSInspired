import { asHeroId } from '../content/cards'
import {
  asPlayerId,
  type MatchCommand,
  type MatchParticipantSetup,
  type MatchSetup
} from './match-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${path} must be a non-empty string`)
  return value.trim()
}

function participant(value: unknown, path: string): MatchParticipantSetup {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  const participantId = requiredString(value.participantId, `${path}.participantId`)
  const controllerKind = value.controllerKind
  if (controllerKind !== 'human' && controllerKind !== 'ai') {
    throw new Error(`${path}.controllerKind must be human or ai`)
  }
  return {
    participantId: asPlayerId(participantId),
    controllerKind,
    heroId: asHeroId(requiredString(value.heroId, `${path}.heroId`)),
    deckId: requiredString(value.deckId, `${path}.deckId`)
  }
}

export function parseMatchSetup(value: unknown): MatchSetup {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw new Error('MatchSetup must contain a participants array')
  }
  if (value.participants.length !== 2) {
    throw new Error('MatchSetup must contain exactly two participants')
  }
  const first = participant(value.participants[0], 'participants[0]')
  const second = participant(value.participants[1], 'participants[1]')
  if (first.participantId === second.participantId) {
    throw new Error('Match participants must have distinct ids')
  }
  if (
    value.seed !== undefined &&
    (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed))
  ) {
    throw new Error('MatchSetup.seed must be a safe integer')
  }
  if (
    value.modeId !== undefined &&
    (typeof value.modeId !== 'string' || value.modeId.trim() === '')
  ) {
    throw new Error('MatchSetup.modeId must be a non-empty string')
  }
  const startingParticipantId =
    value.startingParticipantId === undefined
      ? undefined
      : asPlayerId(requiredString(value.startingParticipantId, 'startingParticipantId'))
  if (
    startingParticipantId !== undefined &&
    startingParticipantId !== first.participantId &&
    startingParticipantId !== second.participantId
  ) {
    throw new Error('MatchSetup.startingParticipantId must identify a participant')
  }
  if (value.skipMulligan !== undefined && typeof value.skipMulligan !== 'boolean') {
    throw new Error('MatchSetup.skipMulligan must be a boolean')
  }
  return {
    participants: [first, second],
    ...(typeof value.modeId === 'string' ? { modeId: value.modeId.trim() } : {}),
    ...(value.seed === undefined ? {} : { seed: value.seed }),
    ...(startingParticipantId === undefined ? {} : { startingParticipantId }),
    ...(value.skipMulligan === true ? { skipMulligan: true } : {})
  }
}

export function parseMatchCommand(value: unknown): MatchCommand | null {
  if (!isRecord(value) || value.type !== 'ready') return null
  if (typeof value.participantId !== 'string' || value.participantId.trim() === '')
    return null
  return { type: 'ready', participantId: asPlayerId(value.participantId) }
}
