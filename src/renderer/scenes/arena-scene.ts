import type { AppLogger, DialogService } from '../app/services'
import type { SceneRouter } from '../app/router'
import { ArenaView } from '../features/arena/arena-view'
import {
  ASSET_BUNDLE_IDS,
  type ArenaAssets,
  type DeckPresentationAssets,
  type SharedUIAssets
} from '../ui/asset-registry'
import type { ArenaStore } from '../ui/arena-store'
import { Scene } from './scene'

export class ArenaScene extends Scene {
  private view: ArenaView | null = null

  constructor(
    private readonly arenaStore: ArenaStore,
    private readonly router?: SceneRouter,
    private readonly dialogs?: DialogService,
    private readonly logger: AppLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()
  }

  async init(): Promise<void> {
    const [assets, heroAssets, sharedAssets, snapshot] = await Promise.all([
      this.assetScope.acquire<ArenaAssets>(ASSET_BUNDLE_IDS.arena),
      this.assetScope.acquire<DeckPresentationAssets>(
        ASSET_BUNDLE_IDS.deckPresentation
      ),
      this.assetScope.acquire<SharedUIAssets>(ASSET_BUNDLE_IDS.sharedUI),
      this.arenaStore.load()
    ])
    await this.assetScope.acquire(ASSET_BUNDLE_IDS.cardRendering)
    await this.waitForFonts()

    this.view = new ArenaView(
      this.arenaStore,
      assets,
      heroAssets,
      sharedAssets,
      this.appInstance.renderer,
      {
        onBack: () =>
          this.router?.navigate({ id: 'main-menu', entryMode: 'returning' }),
        onPlay: (route) => this.router?.navigate(route),
        onError: (message, error) => {
          this.logger.error(message, error)
          this.dialogs?.error(message)
        }
      }
    )
    this.root.addChild(this.view)
    await this.view.mount(snapshot)
  }

  update(_deltaMS: number): void {}

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    await Promise.all([
      document.fonts.load('700 31px Belwe'),
      document.fonts.load('700 82px Belwe')
    ])
  }

  protected onExit(): void {
    if (!this.view) return
    this.root.removeChild(this.view)
    this.view.dispose()
    this.view = null
  }
}
