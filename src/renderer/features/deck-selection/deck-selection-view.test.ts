import { Sprite, Text, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { asHeroId } from '../../../game/content/cards'
import type { Deck } from '../../../game/decks'
import type { DeckStore } from '../../ui/deck-store'
import type { Button } from '../../ui/components/button'
import { DeckSelectionView } from './deck-selection-view'

vi.mock('../../ui/asset-registry/asset-scope', () => ({
  registerAssetBundle: () => undefined,
  AssetScope: class {
    acquire(bundleId: string): Promise<Record<string, Texture>> {
      const texture = Texture.EMPTY
      const bundles: Record<string, Record<string, Texture>> = {
        'deck-selection': {
          panel: texture,
          toCollectionButton: texture,
          playButton: texture
        },
        'shared-ui': { backButton: texture, doneButton: texture },
        'deck-presentation': {
          mageDeckFrame: texture,
          warriorDeckFrame: texture,
          'hero-jaina': texture,
          'hero-garrosh': texture
        }
      }
      return Promise.resolve(bundles[bundleId] ?? {})
    }

    releaseAll(): Promise<void> {
      return Promise.resolve()
    }
  }
}))

vi.mock('../../ui/components/button', async () => {
  const { Container, Sprite } = await import('pixi.js')

  return {
    Button: class extends Container {
      readonly sprite: Sprite

      constructor(
        texture: import('pixi.js').Texture,
        options: { onClick?: () => void | Promise<void> } = {}
      ) {
        super()
        this.sprite = new Sprite(texture)
        this.addChild(this.sprite)
        this.on('pointertap', () => options.onClick?.())
      }

      setBaseY(_y: number): void {}

      setEnabled(enabled: boolean): void {
        this.eventMode = enabled ? 'static' : 'none'
      }
    }
  }
})

function makeDeck(id: string, heroId: string): Deck {
  return {
    id,
    name: `Deck ${id}`,
    heroId: asHeroId(heroId),
    cards: { card: 30 },
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z'
  }
}

describe('DeckSelectionView', () => {
  it('reveals hero details and hands the selected deck to Play', async () => {
    const decks = [makeDeck('mage', 'jaina'), makeDeck('warrior', 'garrosh')]
    const store = {
      load: vi.fn().mockResolvedValue(undefined),
      getDecks: () => decks
    } as unknown as DeckStore
    const onPlayPressed = vi.fn()
    const view = new DeckSelectionView(store, { onPlayPressed })

    await view.mount()

    const internals = view as unknown as {
      deckButtons: Button[]
      deckOutlines: Array<{ isEnabled(): boolean }>
      heroPortrait: Sprite
      heroName: Text
      playButton: Sprite
    }

    expect(internals.deckOutlines).toHaveLength(2)
    expect(internals.deckOutlines.map((outline) => outline.isEnabled())).toEqual([
      false,
      false
    ])
    expect(internals.heroPortrait.visible).toBe(false)
    expect(internals.heroPortrait.scale.x).toBeCloseTo(1)
    expect(internals.heroPortrait.scale.y).toBeCloseTo(1)
    expect(internals.heroName.visible).toBe(false)
    expect(internals.playButton.visible).toBe(false)
    expect(internals.playButton.eventMode).toBe('none')

    internals.deckButtons[0]?.emit('pointertap', { button: 0 } as never)
    expect(internals.deckOutlines.map((outline) => outline.isEnabled())).toEqual([
      true,
      false
    ])
    expect(internals.heroPortrait.visible).toBe(true)
    expect(internals.heroName.text).toBe('Jaina Proudmoore')
    expect(internals.playButton.visible).toBe(true)

    internals.deckButtons[1]?.emit('pointertap', { button: 0 } as never)
    expect(internals.deckOutlines.map((outline) => outline.isEnabled())).toEqual([
      false,
      true
    ])
    expect(internals.heroName.text).toBe('Garrosh Hellscream')

    internals.playButton.emit('pointertap', { button: 0 } as never)
    expect(onPlayPressed).toHaveBeenCalledWith(decks[1])

    await view.dispose()
  })
})
