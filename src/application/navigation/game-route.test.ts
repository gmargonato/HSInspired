import { CollectionScene } from '../../scenes/collection/collection-scene'
import type { CollectionBrowsingState } from '../../scenes/collection/collection-view'
import { defaultCollectionQuery } from '../../scenes/collection/collection-query-controller'
import type { DeckStore } from '../contracts/deck-store'
import { asPlayerId, type MatchSetup } from '../../game-rules/match'
import { asHeroId } from '../../game-rules/content/cards'
import { createRestartGameRoute, type GameRoute } from './game-route'
import { describe, expect, it, vi } from 'vitest'
import type { Deck } from '../../game-rules/decks'

describe('createRestartGameRoute', () => {
  it('preserves the matchup while replacing the match seed', () => {
    const setup: MatchSetup = {
      seed: 11,
      participants: [
        {
          participantId: asPlayerId('human-player'),
          controllerKind: 'human',
          heroId: asHeroId('jaina'),
          deckId: 'human-deck'
        },
        {
          participantId: asPlayerId('ai-player'),
          controllerKind: 'ai',
          heroId: asHeroId('guldan'),
          deckId: 'ai-deck'
        }
      ]
    }
    const route: GameRoute = { id: 'game', setup }

    expect(createRestartGameRoute(route, 22)).toEqual({
      id: 'game',
      setup: {
        ...setup,
        seed: 22
      }
    })
  })

  it('preserves Tavern mode and temporary decks', () => {
    const decks: readonly Deck[] = [
      {
        id: 'temporary-deck',
        name: 'Temporary',
        heroId: asHeroId('jaina'),
        cards: {},
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z'
      }
    ]
    const route: GameRoute = {
      id: 'game',
      mode: 'tavern-brawl',
      deckSnapshots: decks,
      setup: {
        seed: 11,
        participants: [
          {
            participantId: asPlayerId('human-player'),
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: asPlayerId('ai-player'),
            controllerKind: 'ai',
            heroId: asHeroId('guldan'),
            deckId: 'ai-deck'
          }
        ]
      }
    }

    expect(createRestartGameRoute(route, 22)).toMatchObject({
      mode: 'tavern-brawl',
      deckSnapshots: decks,
      setup: { seed: 22 }
    })
  })
})

describe('collection deck browsing restoration', () => {
  function setup() {
    const snapshot: CollectionBrowsingState = {
      query: { ...defaultCollectionQuery(), searchQuery: 'dragon', manaFilter: 3 },
      anchor: null
    }
    const deck = { id: 'test-deck', name: 'Test deck' } as Deck
    let activeDeckId: string | null = null
    const collectionView = {
      captureBrowsingState: vi.fn(() => snapshot),
      restoreBrowsingState: vi.fn(async () => undefined),
      setDeckClass: vi.fn(async () => undefined),
      setNavigationEnabled: vi.fn(),
      refreshCompletionState: vi.fn()
    }
    const deckPanel = {
      getActiveDeckId: () => activeDeckId,
      getDeckEntryOrigin: () => null,
      getDeckClass: () => 'Mage',
      isTransitioning: false,
      isClosing: false,
      enterEditor: vi.fn(async () => {
        activeDeckId = deck.id
      }),
      exitEditor: vi.fn(async () => {
        activeDeckId = null
      }),
      setInteractionEnabled: vi.fn(),
      renderDeckList: vi.fn()
    }
    const selector = {
      isOpen: false,
      open: vi.fn(async () => {
        selector.isOpen = true
      })
    }
    const error = vi.fn()
    const scene = new CollectionScene(
      { getDeck: () => deck } as unknown as DeckStore,
      undefined,
      {
        confirm: () => true,
        abandon: () => undefined,
        error
      }
    )
    Object.assign(scene, {
      collectionView,
      deckPanel,
      newDeckScene: selector,
      navigationReady: true,
      collectionBackButton: { visible: true, setEnabled: vi.fn() }
    })
    const actions = scene as unknown as {
      enterDeck(id: string): Promise<void>
      exitDeckEditor(): Promise<void>
      beginNewDeckCreation(): Promise<void>
      handleNewDeckCreationCancelled(): Promise<void>
      handleNewDeckHeroSelected(heroClass: 'Mage'): Promise<void>
      handleNewDeckCreated(deck: Deck): Promise<void>
      previousBrowsingState: CollectionBrowsingState | null
    }
    return {
      scene,
      actions,
      collectionView,
      deckPanel,
      selector,
      snapshot,
      deck,
      error
    }
  }

  it('restores the original snapshot after editing an existing deck', async () => {
    const test = setup()
    try {
      await test.actions.enterDeck(test.deck.id)
      expect(test.collectionView.setDeckClass).toHaveBeenCalledWith('Mage')
      expect(test.actions.previousBrowsingState).toBe(test.snapshot)
      await test.actions.exitDeckEditor()
      expect(test.collectionView.restoreBrowsingState).toHaveBeenCalledWith(
        test.snapshot
      )
      expect(test.deckPanel.getActiveDeckId()).toBeNull()
      expect(test.actions.previousBrowsingState).toBeNull()
    } finally {
      test.scene.root.destroy({ children: true })
    }
  })

  it('restores browsing after cancelling deck creation', async () => {
    const test = setup()
    try {
      await test.actions.beginNewDeckCreation()
      await test.actions.handleNewDeckHeroSelected('Mage')
      test.selector.isOpen = false
      await test.actions.handleNewDeckCreationCancelled()
      expect(test.collectionView.restoreBrowsingState).toHaveBeenCalledWith(
        test.snapshot
      )
      expect(test.actions.previousBrowsingState).toBeNull()
    } finally {
      test.scene.root.destroy({ children: true })
    }
  })

  it('keeps the original snapshot through deck creation into editing', async () => {
    const test = setup()
    try {
      await test.actions.beginNewDeckCreation()
      await test.actions.handleNewDeckHeroSelected('Mage')
      test.selector.isOpen = false
      await test.actions.handleNewDeckCreated(test.deck)
      expect(test.collectionView.captureBrowsingState).toHaveBeenCalledTimes(1)
      await test.actions.exitDeckEditor()
      expect(test.collectionView.restoreBrowsingState).toHaveBeenCalledWith(
        test.snapshot
      )
    } finally {
      test.scene.root.destroy({ children: true })
    }
  })

  it('restores browsing when editor entry fails', async () => {
    const test = setup()
    try {
      test.collectionView.setDeckClass.mockRejectedValueOnce(new Error('render failed'))
      await test.actions.enterDeck(test.deck.id)
      expect(test.deckPanel.enterEditor).not.toHaveBeenCalled()
      expect(test.collectionView.restoreBrowsingState).toHaveBeenCalledWith(
        test.snapshot
      )
      expect(test.collectionView.setNavigationEnabled).toHaveBeenLastCalledWith(true)
      expect(test.error).toHaveBeenCalled()
    } finally {
      test.scene.root.destroy({ children: true })
    }
  })

  it('retains the editor and snapshot when restoring browsing fails', async () => {
    const test = setup()
    try {
      await test.actions.enterDeck(test.deck.id)
      test.collectionView.restoreBrowsingState.mockRejectedValueOnce(
        new Error('render failed')
      )
      await test.actions.exitDeckEditor()
      expect(test.deckPanel.exitEditor).not.toHaveBeenCalled()
      expect(test.actions.previousBrowsingState).toBe(test.snapshot)
      expect(test.collectionView.setNavigationEnabled).toHaveBeenLastCalledWith(true)
    } finally {
      test.scene.root.destroy({ children: true })
    }
  })
})
