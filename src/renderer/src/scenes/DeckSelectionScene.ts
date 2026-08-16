import { Container, Sprite } from 'pixi.js'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { ASSET_BUNDLE_IDS, DeckSelectionAssets } from '../core/assets'

/**
 * Full-viewport deck selection scene. It is presented through a transition
 * host when entered from the main menu; decks, names, wins, and a play button
 * will be added later.
 */
export class DeckSelectionScene extends Scene {
  private panel!: Container

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<DeckSelectionAssets>(
      ASSET_BUNDLE_IDS.deckSelection
    )

    this.panel = new Container()
    this.panel.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)

    const panel = new Sprite(assets.panel)
    panel.anchor.set(0.5)
    panel.position.set(0, 0)
    this.panel.addChild(panel)

    this.root.addChild(this.panel)
  }

  update(_deltaMS: number): void {}
}
