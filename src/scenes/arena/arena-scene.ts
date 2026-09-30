import type { AppLogger, DialogService } from '../../application/services'
import type { SceneRouter } from '../../application/navigation/router'
import { ArenaView } from './arena-view'
import {
  ASSET_BUNDLE_IDS,
  type ArenaAssets,
  type DeckPresentationAssets,
  type SharedUIAssets
} from '../../visual-components/assets'
import type { ArenaStore } from '../../application/contracts/arena-store'
import type { ProgressionStore } from '../../application/contracts/progression-store'
import { Scene } from '../../visual-components/lifecycle/scene'
import type { DevCommand, DevArenaAvailability } from '../../desktop/contracts/dev-menu'

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
    },
    private readonly progression?: ProgressionStore
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
    if (snapshot.rewards) await this.progression?.refresh()

    this.view = new ArenaView(
      this.arenaStore,
      assets,
      heroAssets,
      sharedAssets,
      this.appInstance.renderer,
      {
        onDevAvailabilityChanged: (availability) => {
          if (import.meta.env.DEV && this.state === 'active')
            window.api?.devMenu?.notifyArenaAvailability(availability)
        },
        onRewardsSaved: async () => {
          await this.progression?.refresh()
        },
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

  get devAvailability(): DevArenaAvailability {
    return this.view?.devAvailability ?? { retire: false, scores: false }
  }

  async runDevCommand(
    command: Extract<DevCommand, { type: 'arena:retire' | 'arena:set-score' }>
  ): Promise<void> {
    if (import.meta.env.DEV) await this.view?.runDevCommand(command)
  }

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
