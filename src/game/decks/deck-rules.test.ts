import { describe, expect, it } from 'vitest'
import { MAX_DECK_CARDS, countDeckCards, type Deck } from './deck'
import { addCardToDeck, isCollectibleDeckCard, removeCardFromDeck } from './deck-rules'
import { CARD_CATALOG } from '../content/cards'
import { asHeroId } from '../content'

const baseDeck: Deck = {
  id: 'deck-test',
  name: 'Test deck',
  heroId: asHeroId('jaina'),
  cards: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('deck rules', () => {
  it('allows two non-legendary copies but only one legendary copy', () => {
    const common = CARD_CATALOG.require('basic_fireball')
    const legendary = CARD_CATALOG.require('classic_archmage_antonidas')

    const firstCommon = addCardToDeck(baseDeck, common)
    expect(firstCommon.ok).toBe(true)
    if (!firstCommon.ok) return

    const secondCommon = addCardToDeck(firstCommon.deck, common)
    expect(secondCommon.ok).toBe(true)
    if (!secondCommon.ok) return

    expect(addCardToDeck(secondCommon.deck, common)).toMatchObject({
      ok: false,
      code: 'copy-limit'
    })

    const firstLegendary = addCardToDeck(secondCommon.deck, legendary)
    expect(firstLegendary.ok).toBe(true)
    if (!firstLegendary.ok) return

    expect(addCardToDeck(firstLegendary.deck, legendary)).toMatchObject({
      ok: false,
      code: 'copy-limit'
    })
  })

  it('rejects cards after the deck reaches thirty total cards', () => {
    const cards = Object.fromEntries(
      Array.from({ length: MAX_DECK_CARDS }, (_, index) => [`card-${index}`, 1])
    )
    const fullDeck = { ...baseDeck, cards }

    expect(countDeckCards(fullDeck)).toBe(MAX_DECK_CARDS)
    expect(
      addCardToDeck(fullDeck, CARD_CATALOG.require('basic_fireball'))
    ).toMatchObject({
      ok: false,
      code: 'deck-full'
    })
  })

  it('decrements duplicate copies before removing the final copy', () => {
    const card = CARD_CATALOG.require('basic_fireball')
    const doubleCopyDeck: Deck = {
      ...baseDeck,
      cards: { [card.id]: 2 }
    }

    const firstRemoval = removeCardFromDeck(doubleCopyDeck, card.id)
    expect(firstRemoval.ok).toBe(true)
    if (!firstRemoval.ok) return

    expect(firstRemoval.deck.cards[card.id]).toBe(1)

    const finalRemoval = removeCardFromDeck(firstRemoval.deck, card.id)
    expect(finalRemoval.ok).toBe(true)
    if (!finalRemoval.ok) return

    expect(finalRemoval.deck.cards[card.id]).toBeUndefined()
    expect(countDeckCards(finalRemoval.deck)).toBe(0)
  })

  it('rejects off-class and non-collectible cards', () => {
    const mageDeck = { ...baseDeck, heroId: asHeroId('jaina') }
    const warrior = CARD_CATALOG.require('basic_execute')
    const coin = CARD_CATALOG.require('basic_the_coin')
    expect(addCardToDeck(mageDeck, warrior)).toMatchObject({
      ok: false,
      code: 'card-not-allowed'
    })
    expect(addCardToDeck(mageDeck, coin)).toMatchObject({
      ok: false,
      code: 'card-not-allowed'
    })
    expect(isCollectibleDeckCard(coin)).toBe(false)
  })
})
