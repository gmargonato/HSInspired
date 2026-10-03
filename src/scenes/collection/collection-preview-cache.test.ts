import { describe, expect, it, vi } from 'vitest'
import { Container, Sprite, Texture } from 'pixi.js'
import { CollectionView } from './collection-view'
import { DeckPanelView } from './deck-panel-view'
import { PremiumUpgradePanel } from './card-preview/premium-upgrade-panel'
import { premiumUpgradeCost } from '../../game-rules/progression/arcane-dust'
import type { ProgressionStore } from '../../application/contracts/progression-store'
import type { CardPreviewAssets } from '../../visual-components/assets'
import type { DeckMutationFailure } from '../../game-rules/decks'
import { CollectionPageView } from './collection-page-view'
import { CardView } from '../../visual-components/cards/card-view'
import { CardAssetResolver } from '../../visual-components/assets/card-asset-resolver'
import { CARD_CATALOG } from '../../game-rules/content/cards'
import type { CollectionAssets } from '../../visual-components/assets'
import type { CollectionPage } from './collection-pages'
import type { CollectionQueryController } from './collection-query-controller'
import { isArtworkVisible } from '../../visual-components/effects/premium-artwork-breath'
import {
  COLLECTION_PREVIEW_CACHE_OPTIONS,
  setCollectionPreviewCached
} from './collection-preview-cache'

function cacheTarget(initiallyCached = false) {
  const target = {
    isCachedAsTexture: initiallyCached,
    cacheAsTexture: vi.fn((value: boolean | object) => {
      target.isCachedAsTexture = value !== false
    })
  }
  return target
}

describe('collection render transactions', () => {
  function setup() {
    const pending: {
      resolve: (texture: Texture) => void
      reject: (error: Error) => void
    }[] = []
    const artwork = vi
      .spyOn(CardAssetResolver.prototype, 'loadArtwork')
      .mockImplementation(
        () =>
          new Promise<Texture>((resolve, reject) => pending.push({ resolve, reject }))
      )
    const created: Container[] = []
    const create = vi.spyOn(CardView, 'create').mockImplementation(async () => {
      const view = new Container()
      Object.assign(view, {
        plan: { width: 620 },
        renderedHeight: 900,
        enableTextureCache: () => undefined,
        setPremiumAppearancePaused: () => undefined
      })
      created.push(view)
      return view as CardView
    })
    const onMode = vi.fn()
    const view = new CollectionView({
      assets: { searchNoResults: Texture.EMPTY } as CollectionAssets,
      canvas: {} as HTMLCanvasElement,
      renderer: {} as never,
      cursor: null,
      callbacks: { onCollectibleModeChanged: onMode },
      state: {
        isNavigationReady: () => true,
        isNewDeckOpen: () => false,
        isEditorTransitioning: () => false,
        isEditorClosing: () => false,
        isEditorMutating: () => false,
        getActiveDeck: () => null
      }
    })
    const internals = view as unknown as {
      renderPages(pages: readonly CollectionPage[], index: number): Promise<void>
      pageIndex: number
      pageLoading: boolean
      pages: readonly CollectionPage[]
      pageView: CollectionPageView
      collectionQuery: CollectionQueryController
      buildFilteredPages(): readonly CollectionPage[]
      changePage(delta: number): void
      handleClassFilterTap(cardClass: 'Warrior'): void
      deckClass: string | null
      previousPageZone: Container
      nextPageZone: Container
      hoveredPageZone: 'collection-next-page' | 'collection-previous-page' | null
      searchClearButton: Sprite
    }
    internals.previousPageZone = new Container()
    internals.nextPageZone = new Container()
    internals.searchClearButton = new Sprite(Texture.EMPTY)
    const pages = [0, 1, 2].map((index): CollectionPage => ({
      cardClass: 'Mage',
      cards: [CARD_CATALOG.all[index]],
      pageNumber: index + 1,
      pageCount: 3
    }))
    return {
      view,
      internals,
      pending,
      pages,
      created,
      onMode,
      cleanup: () => {
        if (!internals.pageView.destroyed) view.onExit()
        internals.previousPageZone.destroy()
        internals.nextPageZone.destroy()
        internals.searchClearButton.destroy()
        view.destroy()
        artwork.mockRestore()
        create.mockRestore()
      }
    }
  }

  it('commits only the latest request when artwork completes out of order', async () => {
    const test = setup()
    try {
      const older = test.internals.renderPages(test.pages, 2)
      const latest = test.internals.renderPages(test.pages, 0)
      test.pending[1].resolve(Texture.EMPTY)
      await latest
      test.pending[0].resolve(Texture.EMPTY)
      await older
      expect(test.internals.pageIndex).toBe(0)
      expect(test.internals.pageView.currentPageIndex).toBe(0)
      expect(test.created[1].destroyed).toBe(true)
      expect(test.internals.pageLoading).toBe(false)
    } finally {
      test.cleanup()
    }
  })

  it('keeps empty results when an older page finishes loading', async () => {
    const test = setup()
    try {
      const older = test.internals.renderPages(test.pages, 2)
      await test.internals.renderPages([], 0)
      test.pending[0].resolve(Texture.EMPTY)
      await older
      expect(test.internals.pages).toEqual([])
      expect(test.internals.pageIndex).toBe(0)
      expect(test.created[0].destroyed).toBe(true)
    } finally {
      test.cleanup()
    }
  })

  it('restores the committed query and page after a current failure', async () => {
    const test = setup()
    try {
      const initial = test.internals.renderPages(test.pages, 1)
      test.pending[0].resolve(Texture.EMPTY)
      await initial
      test.internals.collectionQuery.setSearchQuery('new search')
      const failed = test.internals.renderPages(test.pages, 0)
      test.pending[1].reject(new Error('artwork unavailable'))
      await expect(failed).rejects.toThrow('artwork unavailable')
      expect(test.internals.collectionQuery.searchQuery).toBe('')
      expect(test.internals.pageIndex).toBe(1)
      expect(test.internals.pageView.currentPageIndex).toBe(1)
    } finally {
      test.cleanup()
    }
  })

  it('ignores outdated errors', async () => {
    const test = setup()
    try {
      const older = test.internals.renderPages(test.pages, 2)
      await test.internals.renderPages([], 0)
      test.pending[0].reject(new Error('outdated'))
      await expect(older).resolves.toBeUndefined()
    } finally {
      test.cleanup()
    }
  })

  it.each([0, 1])(
    'keeps Warrior page %i when deselecting the Warrior filter',
    async (warriorIndex) => {
      const test = setup()
      try {
        const allPages: CollectionPage[] = [
          { ...test.pages[0], cardClass: 'Druid', pageNumber: 1, pageCount: 1 },
          ...test.pages.slice(1).map((page, index): CollectionPage => ({
            ...page,
            cardClass: 'Warrior',
            pageNumber: index + 1,
            pageCount: 2
          }))
        ]
        test.internals.buildFilteredPages = () =>
          test.view.classFilter === 'Warrior' ? allPages.slice(1) : allPages
        test.view.setNavigationEnabled(true)
        const select = test.view.applyClassFilter('Warrior')
        test.pending[0].resolve(Texture.EMPTY)
        await select
        const browse = test.view.renderPage(warriorIndex)
        test.pending[1].resolve(Texture.EMPTY)
        await browse
        const anchor = test.view.captureBrowsingState().anchor

        test.internals.handleClassFilterTap('Warrior')
        test.pending[2].resolve(Texture.EMPTY)
        await vi.waitFor(() => expect(test.internals.pageLoading).toBe(false))
        expect(test.view.classFilter).toBeNull()
        expect(test.internals.pageIndex).toBe(warriorIndex + 1)
        expect(test.view.captureBrowsingState().anchor).toEqual(anchor)
        expect(test.internals.pages).toEqual(allPages)
      } finally {
        test.cleanup()
      }
    }
  )

  it('starts a fresh editor and restores the complete browsing query and page', async () => {
    const test = setup()
    try {
      test.internals.collectionQuery.setSearchQuery('original')
      test.internals.collectionQuery.toggleManaFilter(3)
      test.internals.collectionQuery.setClassFilter('Mage')
      const initial = test.internals.renderPages(test.pages, 1)
      test.pending[0].resolve(Texture.EMPTY)
      await initial
      const snapshot = test.view.captureBrowsingState()
      test.internals.buildFilteredPages = () => test.pages
      const editor = test.view.setDeckClass('Mage')
      test.pending[1].resolve(Texture.EMPTY)
      await editor
      expect(test.internals.collectionQuery.snapshot()).toMatchObject({
        searchQuery: '',
        classFilter: null,
        manaFilter: null,
        hiddenExpansionIds: [],
        collectibleMode: 'collectible'
      })
      expect(test.internals.deckClass).toBe('Mage')
      const restore = test.view.restoreBrowsingState(snapshot)
      test.pending[2].resolve(Texture.EMPTY)
      await restore
      expect(test.internals.collectionQuery.snapshot()).toEqual(snapshot.query)
      expect(test.internals.pageIndex).toBe(1)
      expect(test.internals.deckClass).toBeNull()
    } finally {
      test.cleanup()
    }
  })

  it('synchronizes page counts and boundary controls, including during loading', async () => {
    const test = setup()
    try {
      test.view.setNavigationEnabled(true)
      const first = test.internals.renderPages(test.pages, 0)
      expect(test.internals.nextPageZone.eventMode).toBe('none')
      test.pending[0].resolve(Texture.EMPTY)
      await first
      expect(test.internals.previousPageZone.eventMode).toBe('none')
      expect(test.internals.nextPageZone.eventMode).toBe('static')
      const last = test.internals.renderPages(test.pages, 2)
      test.pending[1].resolve(Texture.EMPTY)
      await last
      expect(test.internals.previousPageZone.eventMode).toBe('static')
      expect(test.internals.nextPageZone.eventMode).toBe('none')
      const label = test.internals.pageView.getChildByLabel(
        'collection.page-label'
      ) as unknown as { text: string }
      expect(label.text).toBe('Page 3')
      test.view.onPause()
      expect(test.internals.previousPageZone.eventMode).toBe('none')
      test.view.onResume()
      expect(test.internals.previousPageZone.eventMode).toBe('static')
      await test.internals.renderPages([], 0)
      expect(test.internals.previousPageZone.eventMode).toBe('none')
      expect(test.internals.nextPageZone.eventMode).toBe('none')
    } finally {
      test.cleanup()
    }
  })

  it.each([
    ['collection-next-page', 0, 1, 2, 'nextPageZone'],
    ['collection-previous-page', 2, 1, 0, 'previousPageZone']
  ] as const)(
    'retains %s hover across page turns until the boundary',
    async (variant, start, middle, end, zone) => {
      const test = setup()
      try {
        test.view.setNavigationEnabled(true)
        const first = test.internals.renderPages(test.pages, start)
        test.pending[0].resolve(Texture.EMPTY)
        await first
        test.internals.hoveredPageZone = variant

        const next = test.internals.renderPages(test.pages, middle)
        expect(test.internals[zone].eventMode).toBe('static')
        expect(test.internals.hoveredPageZone).toBe(variant)
        test.pending[1].resolve(Texture.EMPTY)
        await next
        expect(test.internals.hoveredPageZone).toBe(variant)

        const last = test.internals.renderPages(test.pages, end)
        test.pending[2].resolve(Texture.EMPTY)
        await last
        expect(test.internals[zone].eventMode).toBe('none')
        expect(test.internals.hoveredPageZone).toBeNull()
      } finally {
        test.cleanup()
      }
    }
  )

  it('ignores extra page turns during loading', async () => {
    const test = setup()
    try {
      test.view.setNavigationEnabled(true)
      const first = test.internals.renderPages(test.pages, 0)
      test.pending[0].resolve(Texture.EMPTY)
      await first
      test.internals.changePage(1)
      test.internals.changePage(1)
      expect(test.pending).toHaveLength(2)
      test.pending[1].resolve(Texture.EMPTY)
      await vi.waitFor(() => expect(test.internals.pageLoading).toBe(false))
      expect(test.internals.pageIndex).toBe(1)
    } finally {
      test.cleanup()
    }
  })

  it('discards a pending render when the scene exits', async () => {
    const test = setup()
    try {
      const pending = test.internals.renderPages(test.pages, 2)
      test.view.onExit()
      test.pending[0].resolve(Texture.EMPTY)
      await pending
      expect(test.internals.pageIndex).toBe(0)
      expect(test.created[0].destroyed).toBe(true)
    } finally {
      test.cleanup()
    }
  })
})

describe('collection rejection messages', () => {
  it.each(['upgrade', 'refund'] as const)(
    'explains unavailable premium %s without mutating purchases',
    async (action) => {
      const card = CARD_CATALOG.all.find(
        (entry) => (premiumUpgradeCost(entry) ?? 0) > 0
      )!
      const onMessage = vi.fn()
      const upgrade = vi.fn()
      const refund = vi.fn()
      const store = {
        getSnapshot: () => ({ dust: 0, premiumPurchases: {} }),
        subscribe: () => () => undefined,
        upgrade,
        refund
      } as unknown as ProgressionStore
      const assets = {
        upgradeWindow: Texture.EMPTY,
        disenchantButton: Texture.EMPTY,
        upgradeButton: Texture.EMPTY
      } as CardPreviewAssets
      const panel = new PremiumUpgradePanel(card, assets, store, undefined, onMessage)
      try {
        await (
          panel as unknown as { change(action: 'upgrade' | 'refund'): Promise<void> }
        ).change(action)
        expect(onMessage).toHaveBeenCalledOnce()
        expect(onMessage.mock.calls[0][0]).toContain(
          action === 'upgrade' ? 'Arcane Dust' : 'refund'
        )
        expect(upgrade).not.toHaveBeenCalled()
        expect(refund).not.toHaveBeenCalled()
      } finally {
        panel.destroy()
      }
    }
  )

  it.each<DeckMutationFailure>([
    {
      ok: false,
      code: 'deck-full',
      message: 'A deck cannot contain more than 30 cards.'
    },
    {
      ok: false,
      code: 'copy-limit',
      message: 'A card can only have two copies in a deck.'
    },
    {
      ok: false,
      code: 'copy-limit',
      message: 'A Legendary card can only have one copy in a deck.'
    },
    {
      ok: false,
      code: 'copy-limit',
      message: 'A deck cannot contain more than one Quest.'
    },
    {
      ok: false,
      code: 'card-not-allowed',
      message: 'That card cannot be added to a Mage deck.'
    }
  ])('forwards $message to the common message handler', (failure) => {
    const onMessage = vi.fn()
    const prototype = DeckPanelView.prototype as unknown as {
      reportCardAddFailure(result: DeckMutationFailure): void
    }
    prototype.reportCardAddFailure.call(
      { options: { callbacks: { onMessage } } },
      failure
    )
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(failure.message)
  })
})

describe('collection preview cache', () => {
  it('pauses grid artwork behind a preview and resumes after closing it', () => {
    const stage = new Container()
    const collection = new Container()
    const artwork = new Container()
    const preview = new Container()
    const previewArtwork = new Container()
    stage.addChild(collection, preview)
    collection.addChild(artwork)
    preview.addChild(previewArtwork)
    try {
      expect(isArtworkVisible(artwork)).toBe(true)
      setCollectionPreviewCached(collection, true)
      expect(isArtworkVisible(artwork)).toBe(false)
      expect(isArtworkVisible(previewArtwork)).toBe(true)
      setCollectionPreviewCached(collection, false)
      expect(isArtworkVisible(artwork)).toBe(true)
      collection.visible = false
      expect(isArtworkVisible(artwork)).toBe(false)
    } finally {
      stage.destroy({ children: true })
    }
  })

  it('enables a bounded static texture once', () => {
    const target = cacheTarget()

    setCollectionPreviewCached(target, true)
    setCollectionPreviewCached(target, true)

    expect(target.cacheAsTexture).toHaveBeenCalledOnce()
    expect(target.cacheAsTexture).toHaveBeenCalledWith(COLLECTION_PREVIEW_CACHE_OPTIONS)
  })

  it('releases the texture when the Collection resumes', () => {
    const target = cacheTarget(true)

    setCollectionPreviewCached(target, false)
    setCollectionPreviewCached(target, false)

    expect(target.cacheAsTexture).toHaveBeenCalledOnce()
    expect(target.cacheAsTexture).toHaveBeenCalledWith(false)
  })
})
