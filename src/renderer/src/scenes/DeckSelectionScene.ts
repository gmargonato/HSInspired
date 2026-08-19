import { Container, Sprite } from 'pixi.js'
import { Button } from '../actors/Button'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { ASSET_BUNDLE_IDS, DeckSelectionAssets, SharedUIAssets } from '../core/assets'
import { CollectionScene } from './CollectionScene'
import { MainMenuScene } from './MainMenuScene'

// Manual nudges only. These coordinates are in the scene's 1920x1080 space,
// so button positions can be adjusted without touching the scene logic.
// The values align the buttons with the two empty slots in DECK_SELECTION.png.
const Layout = {
  panel: { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
  toCollectionButton: { x: 752, y: 1033 },
  backButton: { x: 1670, y: 1044 }
}

const FADE_TRANSITION_DURATION = 0.6
const FULL_VIEWPORT = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT
}

/**
 * Full-viewport deck selection scene. It is presented through a transition
 * host when entered from the main menu; decks, names, wins, and a play button
 * will be added later.
 */
export class DeckSelectionScene extends Scene {
  private panel!: Container
  private toCollectionButton!: Button
  private backButton!: Button
  private navigationStarted = false

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<DeckSelectionAssets>(
      ASSET_BUNDLE_IDS.deckSelection
    )
    const sharedAssets = await this.assetScope.acquire<SharedUIAssets>(
      ASSET_BUNDLE_IDS.sharedUI
    )

    this.panel = new Container()
    this.panel.position.set(Layout.panel.x, Layout.panel.y)

    const panel = new Sprite(assets.panel)
    panel.anchor.set(0.5)
    panel.position.set(0, 0)
    this.panel.addChild(panel)

    this.root.addChild(this.panel)

    this.toCollectionButton = new Button(assets.toCollectionButton, {
      onClick: () => this.onCollectionPressed()
    })
    this.toCollectionButton.position.set(
      Layout.toCollectionButton.x,
      Layout.toCollectionButton.y
    )
    this.toCollectionButton.setBaseY(Layout.toCollectionButton.y)
    this.root.addChild(this.toCollectionButton)

    this.backButton = new Button(sharedAssets.backButton, {
      clickSound: 'back-click',
      onClick: () => this.onBackPressed()
    })
    this.backButton.position.set(Layout.backButton.x, Layout.backButton.y)
    this.backButton.setBaseY(Layout.backButton.y)
    this.root.addChild(this.backButton)
  }

  private onCollectionPressed(): Promise<void> {
    if (this.navigationStarted) return Promise.resolve()
    this.beginNavigation()

    const destination = new CollectionScene()
    return this.sceneManager
      .transitionTo(destination, {
        inset: FULL_VIEWPORT,
        mode: 'fade',
        duration: FADE_TRANSITION_DURATION,
        afterTransition: () => destination.playCoverReveal()
      })
      .catch((error: unknown) => {
        this.restoreNavigation(error, 'collection')
        throw error
      })
  }

  private onBackPressed(): Promise<void> {
    if (this.navigationStarted) return Promise.resolve()
    this.beginNavigation()

    const destination = MainMenuScene.forReturn()
    return this.sceneManager
      .transitionTo(destination, destination.createReturnTransitionOptions())
      .catch((error: unknown) => {
        this.restoreNavigation(error, 'main menu')
        throw error
      })
  }

  private beginNavigation(): void {
    this.navigationStarted = true
    this.toCollectionButton.setEnabled(false)
    this.backButton.setEnabled(false)
  }

  private restoreNavigation(error: unknown, destinationName: string): void {
    console.error(`Failed to open ${destinationName}:`, error)
    this.navigationStarted = false
    this.toCollectionButton.setEnabled(true)
    this.backButton.setEnabled(true)
  }

  update(_deltaMS: number): void {}
}
