import { describe, expect, it } from 'vitest'
import {
  asCardId,
  asClassId,
  asExpansionId,
  type CardDefinition
} from '../../../game/content/cards'
import { filterAddCardCards } from './add-card-picker-model'

function card(options: {
  readonly id: string
  readonly name: string
  readonly cardClass?: string
  readonly expansionId?: string
  readonly cost?: number
  readonly collectible?: boolean
}): CardDefinition {
  return {
    id: asCardId(options.id),
    expansionId: asExpansionId(options.expansionId ?? 'classic'),
    set: asExpansionId(options.expansionId ?? 'classic'),
    name: options.name,
    rarity: 'Common',
    cardClass: asClassId(options.cardClass ?? 'Neutral'),
    subtype: null,
    spellSchool: null,
    cost: options.cost ?? 2,
    rulesText: '',
    collectible: options.collectible ?? true,
    deckLegal: true,
    type: 'Minion',
    attack: 2,
    health: 2
  }
}

const noFilters = {
  query: '',
  cardClass: '',
  expansionId: '',
  collectibleOnly: false
} as const

describe('filterAddCardCards', () => {
  it('supports fuzzy multi-token matching against card names', () => {
    const cards = [
      card({ id: 'classic_hunters_mark', name: "Hunter's Mark" }),
      card({ id: 'classic_arcane_shot', name: 'Arcane Shot' })
    ]

    expect(
      filterAddCardCards(cards, { ...noFilters, query: 'hun mark' }).map(
        (entry) => entry.name
      )
    ).toEqual(["Hunter's Mark"])
  })

  it('applies class, expansion, and collectible filters together', () => {
    const cards = [
      card({
        id: 'classic_hunter_card',
        name: 'Hunter Card',
        cardClass: 'Hunter'
      }),
      card({
        id: 'basic_hunter_token',
        name: 'Hunter Token',
        cardClass: 'Hunter',
        expansionId: 'basic',
        collectible: false
      }),
      card({
        id: 'classic_mage_card',
        name: 'Mage Card',
        cardClass: 'Mage'
      })
    ]

    expect(
      filterAddCardCards(cards, {
        ...noFilters,
        cardClass: 'Hunter',
        expansionId: 'classic',
        collectibleOnly: true
      }).map((entry) => entry.name)
    ).toEqual(['Hunter Card'])
  })

  it('sorts an unsearched list by cost, then name', () => {
    const cards = [
      card({ id: 'classic_zebra', name: 'Zebra', cost: 1 }),
      card({ id: 'classic_alpha', name: 'Alpha', cost: 1 }),
      card({ id: 'classic_middle', name: 'Middle', cost: 2 })
    ]

    expect(filterAddCardCards(cards, noFilters).map((entry) => entry.name)).toEqual([
      'Alpha',
      'Zebra',
      'Middle'
    ])
  })
})
