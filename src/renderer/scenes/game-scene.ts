import type { AppLogger } from '../app/services'
import type { GameRoute } from '../app/router'
import type { DeckStore } from '../ui/deck-store'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type GameAssets
} from '../ui/asset-registry'
import { GameBoardView } from '../features/game/game-board-view'
import { Scene } from './scene'

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
    this.logger?.info('[GameScene] init start', this.route)
    const gameAssets = await this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game)
    this.logger?.info('[GameScene] game assets acquired')
    const heroAssets = await this.assetScope.acquire<DeckPresentationAssets>(
      ASSET_BUNDLE_IDS.deckPresentation
    )
    this.logger?.info('[GameScene] hero assets acquired')
    await this.assetScope.acquire(ASSET_BUNDLE_IDS.cardRendering)
    this.logger?.info('[GameScene] card rendering bundle acquired')
    await this.deckStore.load()
    this.logger?.info(
      '[GameScene] deckStore loaded',
      this.deckStore.getDecks().map((d) => d.id)
    )

    const decks = this.route.setup.participants.map((participant) => {
      const deck = this.deckStore.getDeck(participant.deckId)
      if (!deck)
        throw new Error(`The selected deck ${participant.deckId} is unavailable.`)
      return deck
    })
    this.logger?.info(
      '[GameScene] decks resolved',
      decks.map((d) => `${d.id} — ${d.heroId}`)
    )

    await this.waitForFonts()
    this.logger?.info('[GameScene] fonts ready')

    this.view = new GameBoardView({
      route: this.route,
      decks,
      gameAssets,
      heroAssets,
      renderer: this.appInstance.renderer,
      cursor: this.sceneManager.cursor,
      logger: this.logger
    })
    this.logger?.info('[GameScene] GameBoardView created')
    try {
      await this.view.mount()
      this.logger?.info('[GameScene] view mounted')
      this.root.addChild(this.view)
      this.logger?.info('[GameScene] view added to root')
    } catch (error) {
      this.logger?.error('[GameScene] view mount failed', error)
      this.view.dispose()
      this.view = null
      throw error
    }
  }

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return

    const fontLoads = Promise.all([
      document.fonts.load('47px Belwe'),
      document.fonts.load('normal 44px "Franklin Gothic Condensed"'),
      document.fonts.load('bold 44px "Franklin Gothic Condensed"')
    ])

    // Fonts are not critical for board visibility; a hanging load (e.g. blocked
    // @font-face, CSP, or missing file) would otherwise leave the fade overlay
    // black forever because SceneManager.fadeImmediate awaits scene.load which
    // awaits this. Race against a short timeout so the match remains playable
    // with fallback fonts and the board is not stuck blank.
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, 2500)
    })

    try {
      await Promise.race([fontLoads, timeout])
      // If the race resolved via timeout, the real loads may still settle later.
      // Swallow their eventual rejection so it does not surface as an unhandled
      // rejection that could be mistaken for a mount failure.
      void fontLoads.catch((error) => {
        this.logger?.warn('[GameScene] font load rejected after timeout', error)
      })
    } catch (error) {
      this.logger?.warn(
        '[GameScene] font loading failed, continuing with fallback',
        error
      )
    }
  }

  update(_deltaMS: number): void {}

  playOpeningReveal(): Promise<void> {
    return this.view?.playOpeningReveal() ?? Promise.resolve()
  }

  async devAddCard(cardId: string): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devAddCard(cardId)
  }

  openAddCardPicker(): void {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    this.view.openAddCardPicker()
  }

  async devSetMana(available: number, maximum: number): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devSetMana(available, maximum)
  }

  toggleDeckTracker(): void {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    this.view.toggleDeckTracker()
  }

  protected onExit(): void {
    if (!this.view) return
    this.root.removeChild(this.view)
    this.view.dispose()
    this.view = null
  }
}
