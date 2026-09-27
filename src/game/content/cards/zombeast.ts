import {
  asCardId,
  asClassId,
  asExpansionId,
  cardHasTribe,
  type CardDefinition,
  type CardId,
  type MinionCardDefinition
} from './card-definition'
import { validateCardRecord } from './card-validator'

const PREFIX = 'zombeast:'

/** Ordered components also provide a stable identity across workers/checkpoints. */
export function zombeastId(first: CardId | string, second: CardId | string): CardId {
  return asCardId(`${PREFIX}${first}:${second}`)
}

export function zombeastComponents(id: string): readonly [CardId, CardId] | undefined {
  if (!id.startsWith(PREFIX)) return undefined
  const parts = id.slice(PREFIX.length).split(':')
  return parts.length === 2 && parts.every(Boolean)
    ? [asCardId(parts[0]!), asCardId(parts[1]!)]
    : undefined
}

/** Internal attack restrictions are text-pool abilities, not printed keywords. */
export function zombeastPool(card: CardDefinition): 'first' | 'second' | undefined {
  if (
    card.type !== 'Minion' ||
    !card.collectible ||
    card.cost > 5 ||
    !cardHasTribe(card, 'Beast')
  )
    return undefined
  if (card.cardClass !== 'Hunter' && card.cardClass !== 'Neutral') return undefined
  if (card.id === 'whispers_of_the_old_gods_silithid_swarmer') return 'first'
  if (card.effects.length === 0) return 'second'
  // Mixed printed keywords and effects (e.g. King of Beasts) are excluded.
  return card.keywords.length === 0 ? 'first' : undefined
}

export function zombeastPoolCards(
  cards: readonly CardDefinition[],
  stage: 'first' | 'second'
): readonly MinionCardDefinition[] {
  return cards.filter(
    (card): card is MinionCardDefinition => zombeastPool(card) === stage
  )
}

export function createZombeastDefinitions(
  cards: readonly CardDefinition[]
): readonly CardDefinition[] {
  const first = cards.filter(
    (card): card is MinionCardDefinition => zombeastPool(card) === 'first'
  )
  const second = cards.filter(
    (card): card is MinionCardDefinition => zombeastPool(card) === 'second'
  )
  return first.flatMap((left) =>
    second.map((right): CardDefinition => {
      const id = zombeastId(left.id, right.id)
      // Weasel's authored shuffle uses its own ID; the stitched minion must shuffle itself.
      const effects =
        left.id === 'mean_streets_of_gadgetzan_weasel_tunneler'
          ? left.effects.map((effect) => ({
              ...effect,
              actions: effect.actions?.map((action) =>
                action.cardId === left.id ? { ...action, cardId: id } : action
              )
            }))
          : left.effects
      const definition: MinionCardDefinition = {
        ...left,
        id,
        name: 'Zombeast',
        cardClass: asClassId('Hunter'),
        expansionId: asExpansionId('knights-of-the-frozen-throne'),
        set: asExpansionId('knights-of-the-frozen-throne'),
        rarity: 'Summon',
        cost: left.cost + right.cost,
        attack: left.attack + right.attack,
        health: left.health + right.health,
        subtype: 'Beast',
        tribes: ['Undead', 'Beast'],
        rulesText: [left.rulesText, right.rulesText].filter(Boolean).join('\n'),
        keywords: [...new Set([...left.keywords, ...right.keywords])],
        effects: [...effects, ...right.effects],
        collectible: false,
        deckLegal: false
      }
      return validateCardRecord(definition, definition.expansionId, id)
    })
  )
}
