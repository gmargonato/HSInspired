import { Container, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { Deck } from '../../../game/decks'
import { DeckListView } from './deck-list-view'

function deck(id: string): Deck {
  return {
    id: id as Deck['id'],
    name: id,
    heroId: 'jaina' as Deck['heroId'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards: {}
  }
}

describe('DeckListView', () => {
  it('owns list rendering, scrolling, and button enablement', () => {
    const view = new DeckListView({
      maxDecks: 9,
      newDeckButton: Texture.EMPTY,
      verticalSlider: Texture.EMPTY,
      onWheel: vi.fn(),
      onSliderDown: vi.fn(),
      onSliderMove: vi.fn(),
      onSliderUp: vi.fn(),
      frameForDeck: () => Texture.EMPTY
    })
    const parent = new Container()
    view.mount(parent)
    const maxScroll = view.render([deck('one'), deck('two'), deck('three')])

    expect(view.entries).toHaveLength(4)
    expect(view.buttons).toHaveLength(4)
    expect(view.countLabel.text).toBe('3 / 9 Decks')
    expect(view.setScroll(-10000, maxScroll)).toBe(-maxScroll)

    view.setInteractionEnabled(false, true)
    expect(view.buttons.every((button) => button.eventMode === 'none')).toBe(true)
    parent.destroy({ children: true })
  })
})
