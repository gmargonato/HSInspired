import type { SceneRouter } from '../../application/navigation/router'
import type { AppLogger } from '../../application/services'
import type { DeckStore } from '../../application/contracts/deck-store'
import { DeckSelectionView } from './deck-selection-view'
import { createMatchSeed } from '../../application/match-seed'
import { createConstructedGameRoute } from '../../application/navigation/router'
import type { Deck } from '../../game-rules/decks'
import type { PlayerStatsStore } from '../../application/contracts/player-stats-store'
import type { PreferencesApi } from '../../desktop/contracts/ipc/preferences'
import { Scene } from '../../visual-components/lifecycle/scene'

/** Route adapter for the feature-owned complete-deck selection view. */
export class DeckSelectionScene extends Scene {
  private readonly view: DeckSelectionView
  private readonly deckStore: DeckStore
  private readonly router?: SceneRouter
  private readonly preferencesApi?: PreferencesApi

  constructor(
    deckStore: DeckStore,
    playerStatsStore: PlayerStatsStore,
    router?: SceneRouter,
    private readonly logger?: AppLogger
  ) {
    super()
    this.deckStore = deckStore
    this.router = router
    this.preferencesApi =
      typeof window === 'undefined' ? undefined : window.api?.preferences
    this.view = new DeckSelectionView(
      deckStore,
      playerStatsStore,
      {
        onBackPressed: () =>
          router?.navigate({ id: 'main-menu', entryMode: 'returning' }) ??
          Promise.reject(new Error('Deck selection router is not configured')),
        onPlayPressed: (deck) => this.onPlayPressed(deck)
      },
      logger,
      this.preferencesApi
    )
  }

  async init(): Promise<void> {
    await this.view.mount()
    this.root.addChild(this.view)
  }

  update(_deltaMS: number): void {}

  /** Re-renders the rank medal after a dev-menu rank override. */
  refreshRank(): void {
    this.view.refreshRankMedal()
  }

  protected onExit(): void {
    void this.view.dispose()
  }

  private async onPlayPressed(deck: Deck): Promise<void> {
    await this.deckStore.load()
    const seed = createMatchSeed()
    if (!this.router) throw new Error('Deck selection router is not configured')
    this.rememberLastPlayedDeck(deck.id)
    await this.router.navigate(
      createConstructedGameRoute(
        deck,
        seed,
        this.deckStore.getDecks(),
        import.meta.env.DEV ? import.meta.env.VITE_DEV_AI_DECK_ID : undefined
      )
    )
  }

  private rememberLastPlayedDeck(deckId: string): void {
    if (!this.preferencesApi) return
    void this.preferencesApi
      .set({ lastPlayedDeckId: deckId })
      .catch((error: unknown) => {
        this.logger?.warn('Failed to remember the last played deck.', error)
      })
  }
}
