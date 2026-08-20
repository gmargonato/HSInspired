import type { Deck } from '../decks'
import { asPlayerId, type MatchSetup } from './match-types'

export interface HumanVsAiDeckSelection {
  readonly humanDeck: Pick<Deck, 'id' | 'heroId'>
  readonly aiDeck: Pick<Deck, 'id' | 'heroId'>
}

/** Converts deck-selection output into the complete setup expected by GameScene. */
export function createHumanVsAiMatchSetup(
  selection: HumanVsAiDeckSelection,
  seed?: number
): MatchSetup {
  return {
    participants: [
      {
        participantId: asPlayerId('human-player'),
        controllerKind: 'human',
        heroId: selection.humanDeck.heroId,
        deckId: selection.humanDeck.id
      },
      {
        participantId: asPlayerId('ai-player'),
        controllerKind: 'ai',
        heroId: selection.aiDeck.heroId,
        deckId: selection.aiDeck.id
      }
    ],
    ...(seed === undefined ? {} : { seed })
  }
}
