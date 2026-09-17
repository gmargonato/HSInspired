import type { CardDefinition } from '../../game/content/cards'
import { CardAssetResolver } from '../ui/asset-registry/card-asset-resolver'
import { Scene } from './scene'
import type { ProgressionStore } from '../ui/progression-store'
import {
  CardPreviewView,
  type CardPreviewSourceBounds
} from '../features/card-preview/card-preview-view'
import {
  cardDetailRows,
  type CardDetailRow
} from '../features/card-preview/card-detail-panel'

export { cardDetailRows }
export type { CardDetailRow, CardPreviewSourceBounds }

export interface CardViewSceneOptions {
  readonly card: CardDefinition
  readonly sourceBounds: CardPreviewSourceBounds
  readonly resolver?: CardAssetResolver
  readonly progression?: ProgressionStore
}

/** Lifecycle adapter for the feature-owned enlarged card preview. */
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
