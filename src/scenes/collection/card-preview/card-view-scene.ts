import type { CardDefinition } from '../../../game-rules/content/cards'
import { CardAssetResolver } from '../../../visual-components/assets/card-asset-resolver'
import { Scene } from '../../../visual-components/lifecycle/scene'
import type { ProgressionStore } from '../../../application/contracts/progression-store'
import { CardPreviewView, type CardPreviewSourceBounds } from './card-preview-view'
import { cardDetailRows, type CardDetailRow } from './card-detail-panel'

export { cardDetailRows }
export type { CardDetailRow, CardPreviewSourceBounds }

export interface CardViewSceneOptions {
  readonly card: CardDefinition
  readonly sourceBounds: CardPreviewSourceBounds
  readonly resolver?: CardAssetResolver
  readonly progression?: ProgressionStore
}

/** Lifecycle adapter for the collection's enlarged card preview. */
export class CardViewScene extends Scene {
  private readonly options: CardViewSceneOptions
  private view!: CardPreviewView

  constructor(options: CardViewSceneOptions) {
    super()
    this.options = options
  }

  async init(): Promise<void> {
    this.view = new CardPreviewView({
      ...this.options,
      assetScope: this.assetScope,
      onPresentationOffset: (x, y) => this.sceneManager.setPresentationOffset?.(x, y),
      onClose: async () => {
        await this.sceneManager.pop()
      }
    })
    await this.view.init()
    this.root.addChild(this.view)
  }

  update(deltaMS: number): void {
    this.view?.update(deltaMS)
  }

  protected onEnter(): void {
    this.view.enter(this.appInstance.canvas)
  }

  protected onExit(): void {
    this.view.exit(this.appInstance.canvas)
  }
}
