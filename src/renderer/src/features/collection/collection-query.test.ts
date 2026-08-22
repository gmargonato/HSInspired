import { describe, expect, it } from 'vitest'
import { asExpansionId, CARD_CATALOG } from '../../../../game/content/cards'
import { CollectionQueryController } from './collection-query-controller'
import { queryCollectionCards } from './collection-query'

describe('collection query', () => {
  it('applies class and expansion filters together', () => {
    const cards = queryCollectionCards(CARD_CATALOG.all, {
      classFilter: 'Mage',
      searchQuery: '',
      manaFilter: null,
      hiddenExpansionIds: [asExpansionId('naxxramas')]
    })

    expect(cards.length).toBeGreaterThan(0)
    expect(
      cards.every(
        (card) =>
          (card.cardClass === 'Mage' || card.cardClass === 'Neutral') &&
          card.expansionId !== 'naxxramas'
      )
    ).toBe(true)
  })

  it('toggles expansion visibility in query state', () => {
    const controller = new CollectionQueryController()
    const naxxramas = asExpansionId('naxxramas')

    controller.toggleExpansionVisibility(naxxramas)
    expect(controller.hiddenExpansionIds).toEqual([naxxramas])

    controller.toggleExpansionVisibility(naxxramas)
    expect(controller.hiddenExpansionIds).toEqual([])
  })
})
