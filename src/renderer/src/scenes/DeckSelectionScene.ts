import type { AudioService } from '../app/audio'
import type { SceneRouter } from '../app/router'
import type { AppLogger } from '../app/services'
import type { DeckStore } from '../features/deck-builder/deck-store'
import { DeckSelectionView } from '../features/deck-selection/DeckSelectionView'
import {
  chooseOpponentDeck,
  createMatchSeed
} from '../features/deck-selection/deck-selection-model'
import { createHumanVsAiGameRoute } from '../app/router'
import type { Deck } from '../../../game/decks'
import { Scene } from './Scene'

/** Route adapter for the feature-owned complete-deck selection view. */
export class DeckSelectionScene extends Scene {
  private readonly view: DeckSelectionView
  private readonly deckStore: DeckStore
  private readonly router?: SceneRouter

  constructor(
    deckStore: DeckStore,
    router?: SceneRouter,
    audio?: AudioService,
    logger?: AppLogger
  ) {
    super()
    this.deckStore = deckStore
    this.router = router
    this.view = new DeckSelectionView(
      deckStore,
      {
        onCollectionPressed: () =>
          router?.navigate({ id: 'collection' }) ??
          Promise.reject(new Error('Deck selection router is not configured')),
        onBackPressed: () =>
          router?.navigate({ id: 'main-menu', entryMode: 'returning' }) ??
          Promise.reject(new Error('Deck selection router is not configured')),
        onPlayPressed: (deck) => this.onPlayPressed(deck)
      },
      audio,
      logger
    )
  }

  async init(): Promise<void> {
    await this.view.mount()
    this.root.addChild(this.view)
  }

  update(_deltaMS: number): void {}

  protected onExit(): void {
    void this.view.dispose()
  }

  private async onPlayPressed(deck: Deck): Promise<void> {
    await this.deckStore.load()
    const seed = createMatchSeed()
    const opponent = chooseOpponentDeck(this.deckStore.getDecks(), deck.id, seed)
    if (!opponent) {
      throw new Error('At least one complete deck is required to start a game.')
    }

    if (!this.router) throw new Error('Deck selection router is not configured')
    await this.router.navigate(
      createHumanVsAiGameRoute(
        {
          humanDeck: { id: deck.id, heroId: deck.heroId },
          aiDeck: { id: opponent.id, heroId: opponent.heroId }
        },
        seed
      )
    )
  }
}
