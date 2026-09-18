import { CARD_CATALOG, type CardId } from '../content/cards'
import { cardDefinition, isRecord } from './effects/effect-primitives'
import type {
  CardChoiceOption,
  KazakusPotionCostOption,
  KazakusPotionRecipe,
  PendingCardChoice
} from './opening-match-types'
import type { DeterministicRng } from './rng'

export function kazakusCostOptions(
  action: Record<string, unknown>
): readonly KazakusPotionCostOption[] {
  if (!Array.isArray(action.costOptions)) return []
  return action.costOptions
    .map((value): KazakusPotionCostOption | null => {
      if (!isRecord(value) || typeof value.cost !== 'number') return null
      const presentationCardId =
        typeof value.presentationCardId === 'string'
          ? (value.presentationCardId as CardId)
          : null
      if (!presentationCardId || !CARD_CATALOG.get(presentationCardId)) return null
      const ingredientPool = Array.isArray(value.ingredientPool)
        ? value.ingredientPool
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry as CardId)
            .filter((cardId) => CARD_CATALOG.get(cardId) !== undefined)
        : []
      const recipes = Array.isArray(value.recipes)
        ? value.recipes
            .map((recipe): KazakusPotionRecipe | null => {
              if (!isRecord(recipe) || !Array.isArray(recipe.ingredients)) return null
              const ingredients = recipe.ingredients
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry as CardId)
              const cardId =
                typeof recipe.cardId === 'string' ? (recipe.cardId as CardId) : null
              return cardId && CARD_CATALOG.get(cardId) ? { ingredients, cardId } : null
            })
            .filter((recipe): recipe is KazakusPotionRecipe => recipe !== null)
        : []
      if (ingredientPool.length < 2 || recipes.length === 0) return null
      return {
        cost: Math.max(0, Math.floor(value.cost)),
        presentationCardId,
        ingredientPool,
        recipes
      }
    })
    .filter((option): option is KazakusPotionCostOption => option !== null)
}

export function ingredientChoiceOptions(
  cardIds: readonly CardId[]
): readonly CardChoiceOption[] {
  return cardIds.map((cardId, choice) => ({
    choice,
    label: cardDefinition(cardId)?.name ?? cardId,
    presentationCardId: cardId
  }))
}

/** Shared seeded offers for normal Kazakus crafting. */
export function potionIngredientOffers(
  pool: readonly CardId[],
  rng: DeterministicRng
): CardId[] {
  const shuffled = [...pool]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(rng.next() * (index + 1))
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!]
  }
  return shuffled.slice(0, 3)
}

export function firstPotionIngredientChoice(
  source: Pick<
    PendingCardChoice,
    'participantId' | 'sourceCardInstanceId' | 'sourceCardId' | 'queued'
  >,
  costOptions: readonly KazakusPotionCostOption[],
  selectedCostOption: KazakusPotionCostOption,
  rng: DeterministicRng
): PendingCardChoice {
  const offers = potionIngredientOffers(selectedCostOption.ingredientPool, rng)
  return {
    ...source,
    options: ingredientChoiceOptions(offers),
    resolution: {
      type: 'kazakus-potion',
      stage: 'first-ingredient',
      costOptions,
      selectedCostOption,
      firstIngredientOffers: offers
    }
  }
}
