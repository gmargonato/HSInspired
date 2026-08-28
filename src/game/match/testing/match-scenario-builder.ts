import { CARD_CATALOG, asCardId, asHeroId } from '../../content/cards'
import type { Deck } from '../../decks'
import { asPlayerId, type MatchSetup, type PlayerId } from '../match-types'
import { createSeededRng, type DeterministicRng } from '../rng'
import { createOpeningMatch, type OpeningMatchInstance } from '../opening-match'

export interface MatchScenarioBuilderOptions {
  readonly seed?: number
  readonly cardId?: string
  readonly firstHeroId?: string
  readonly secondHeroId?: string
  readonly firstController?: 'human' | 'ai'
  readonly secondController?: 'human' | 'ai'
}

export interface MatchScenario {
  readonly match: OpeningMatchInstance
  readonly setup: MatchSetup
  readonly participants: readonly [PlayerId, PlayerId]
  readonly decks: readonly [Deck, Deck]
  readonly rng: DeterministicRng
  confirmBothMulligans(): void
}

function createDeck(id: string, heroId: string, cardId: string): Deck {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) throw new Error(`Scenario card ${cardId} does not exist.`)
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: { [definition.id]: 30 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

/**
 * Creates a real-catalog match with explicit seeded randomness. The builder is shared
 * by characterization and later effect scenarios so tests do not invent a second setup
 * path that can drift from the public facade.
 */
export function createMatchScenario(
  options: MatchScenarioBuilderOptions = {}
): MatchScenario {
  const seed = options.seed ?? 0x5eeded
  const cardId = options.cardId ?? 'basic_acidic_swamp_ooze'
  const firstHeroId = options.firstHeroId ?? 'jaina'
  const secondHeroId = options.secondHeroId ?? 'garrosh'
  const setup: MatchSetup = {
    seed,
    recordEffectTrace: true,
    participants: [
      {
        participantId: asPlayerId('scenario-player-one'),
        controllerKind: options.firstController ?? 'human',
        heroId: asHeroId(firstHeroId),
        deckId: 'scenario-deck-one'
      },
      {
        participantId: asPlayerId('scenario-player-two'),
        controllerKind: options.secondController ?? 'ai',
        heroId: asHeroId(secondHeroId),
        deckId: 'scenario-deck-two'
      }
    ]
  }
  const decks = [
    createDeck('scenario-deck-one', firstHeroId, cardId),
    createDeck('scenario-deck-two', secondHeroId, cardId)
  ] as const
  const rng = createSeededRng(seed)
  const match = createOpeningMatch(setup, decks, rng)
  const participants = [
    setup.participants[0].participantId,
    setup.participants[1].participantId
  ] as const
  return {
    match,
    setup,
    participants,
    decks,
    rng,
    confirmBothMulligans(): void {
      for (const participantId of participants) {
        const result = match.dispatch({
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: []
        })
        if (!result.accepted) throw new Error(result.message)
      }
    }
  }
}

export function scenarioCard(cardId: string): {
  readonly cardId: ReturnType<typeof asCardId>
} {
  if (!CARD_CATALOG.get(cardId))
    throw new Error(`Scenario card ${cardId} does not exist.`)
  return { cardId: asCardId(cardId) }
}
