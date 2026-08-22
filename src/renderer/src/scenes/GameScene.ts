import type { AppLogger } from '../app/services'
import type { GameRoute } from '../app/router'
import type { DeckStore } from '../features/deck-builder/deck-store'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type GameAssets
} from '../ui/asset-registry'
import { GameBoardView } from '../features/game/GameBoardView'
import { Scene } from './Scene'

/** Full-screen route adapter for the first playable opening sequence. */
export class GameScene extends Scene {
  private readonly deckStore: DeckStore
  private readonly route: GameRoute
  private readonly logger?: AppLogger
  private view: GameBoardView | null = null

  constructor(route: GameRoute, deckStore: DeckStore, logger?: AppLogger) {
    super()
    this.route = route
    this.deckStore = deckStore
    this.logger = logger
  }

  async init(): Promise<void> {
    const gameAssets = await this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game)
    const heroAssets = await this.assetScope.acquire<DeckPresentationAssets>(
      ASSET_BUNDLE_IDS.deckPresentation
    )
    await this.assetScope.acquire(ASSET_BUNDLE_IDS.cardRendering)
    await this.deckStore.load()

    const decks = this.route.setup.participants.map((participant) => {
      const deck = this.deckStore.getDeck(participant.deckId)
      if (!deck)
        throw new Error(`The selected deck ${participant.deckId} is unavailable.`)
      return deck
    })

    await this.waitForFonts()

    this.view = new GameBoardView({
      route: this.route,
      decks,
      gameAssets,
      heroAssets,
      renderer: this.appInstance.renderer,
      cursor: this.sceneManager.cursor,
      logger: this.logger
    })
    try {
      await this.view.mount()
      this.root.addChild(this.view)
    } catch (error) {
      this.view.dispose()
      this.view = null
      throw error
    }
  }

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return

    await Promise.all([
      document.fonts.load('47px Belwe'),
      document.fonts.load('normal 44px "Franklin Gothic Condensed"'),
      document.fonts.load('bold 44px "Franklin Gothic Condensed"')
    ])
  }

  update(_deltaMS: number): void {}

  playOpeningReveal(): Promise<void> {
    return this.view?.playOpeningReveal() ?? Promise.resolve()
  }

  protected onExit(): void {
    if (!this.view) return
    this.root.removeChild(this.view)
    this.view.dispose()
    this.view = null
  }
}
