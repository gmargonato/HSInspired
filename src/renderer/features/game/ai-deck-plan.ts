import { CARD_CATALOG } from '../../../game/content/cards'
import type { Deck } from '../../../game/decks'
import type { AiDeckPlan, AiDeckPlanRequest, JsonValue } from '../../../shared/ipc/ai'

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function createDeckPlanRequest(
  deck: Deck,
  deadlineAtMs: number
): AiDeckPlanRequest {
  return {
    requestId: `deck-plan-${Date.now()}`,
    deadlineAtMs,
    deck: {
      heroId: deck.heroId,
      cards: Object.entries(deck.cards)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([cardId, count]) => {
          const definition = CARD_CATALOG.require(cardId)
          return {
            cardId,
            count,
            name: definition.name,
            type: definition.type,
            cost: definition.cost,
            rulesText: definition.rulesText,
            keywords: definition.keywords ?? [],
            effects: json(definition.effects)
          }
        })
    }
  }
}

export function validateDeckPlan(plan: AiDeckPlan, deck: Deck): AiDeckPlan {
  const cardIds = new Set(Object.keys(deck.cards))
  for (const resource of plan.preserve) {
    if (!cardIds.has(resource.cardId)) {
      throw new Error(
        `Deck plan references card outside the exact deck: ${resource.cardId}.`
      )
    }
  }
  return plan
}

/** Provider-offline behavior stays generic; it never guesses a named archetype. */
export function createFallbackDeckPlan(): AiDeckPlan {
  return {
    strategy: 'Use the exact cards efficiently and adapt to the public board.',
    winConditions: ['Build a legal path that reduces the opposing hero to zero.'],
    priorities: [
      'Take lethal when available.',
      'Prevent immediate defeat.',
      'Answer dangerous repeatable effects efficiently.',
      'Preserve cards when another play reaches the same result.'
    ],
    preserve: [],
    mulligan: ['Prefer cards that create a productive early turn.']
  }
}
