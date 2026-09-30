import type { Deck } from '../decks'
import { asPlayerId, type MatchSetup } from './match-types'

export interface HumanVsAiDeckSelection {
  readonly humanDeck: Pick<Deck, 'id' | 'heroId'>
  readonly aiDeck: Pick<Deck, 'id' | 'heroId'>
}

export interface HumanVsAiMatchOptions {
  readonly humanSeat?: 'first' | 'second'
  readonly skipMulligan?: boolean
}

/** Converts deck-selection output into the complete setup expected by GameScene. */
export function createHumanVsAiMatchSetup(
  selection: HumanVsAiDeckSelection,
  seed?: number,
  options: HumanVsAiMatchOptions = {}
): MatchSetup {
  const humanParticipantId = asPlayerId('human-player')
  const aiParticipantId = asPlayerId('ai-player')
  return {
    participants: [
      {
        participantId: humanParticipantId,
        controllerKind: 'human',
        heroId: selection.humanDeck.heroId,
        deckId: selection.humanDeck.id
      },
      {
        participantId: aiParticipantId,
        controllerKind: 'ai',
        heroId: selection.aiDeck.heroId,
        deckId: selection.aiDeck.id
      }
    ],
    ...(seed === undefined ? {} : { seed }),
    ...(options.humanSeat === undefined
      ? {}
      : {
          startingParticipantId:
            options.humanSeat === 'first' ? humanParticipantId : aiParticipantId
        }),
    ...(options.skipMulligan === true ? { skipMulligan: true } : {})
  }
}
