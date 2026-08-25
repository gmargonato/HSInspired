import { Scene } from './scene'
import type { SceneRouter } from '../app/router'
import type { AppLogger } from '../app/services'
import type { SceneTransitionOptions } from './scene-manager'
import {
  MainMenuView,
  type MainMenuEntryMode,
  type MainMenuRoute
} from '../features/main-menu/main-menu-view'
import { SCENE_SELECTION_GAP } from '../features/main-menu/main-menu-layout'

export { SCENE_SELECTION_GAP }

/**
 * Full-screen lifecycle adapter for the main-menu feature. The chest, lids,
 * buttons, and their choreography live in MainMenuView; this class only
 * connects that view to SceneManager's transition protocol.
 */
export class MainMenuScene extends Scene {
  private readonly view: MainMenuView
  /** Compatibility state for pre-load transition tests and dev hooks. */
  private transitionOpened = false

  constructor(
    private readonly router?: SceneRouter,
    private readonly entryMode: MainMenuEntryMode = 'closed',
    private readonly logger: AppLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()

    const viewRouter = this.router
      ? {
          navigate: (route: MainMenuRoute) => this.router!.navigate(route)
        }
      : undefined
    this.view = new MainMenuView({
      assetScope: this.assetScope,
      router: viewRouter,
      entryMode: this.entryMode,
      logger: this.logger
    })
  }

  get isDestinationTransitionOpen(): boolean {
    return this.transitionOpened || this.view.isDestinationTransitionOpen
  }

  /** Parent slot used by SceneManager for menu destination previews. */
  get destinationTransitionHost(): MainMenuView['transitionHost'] {
    return this.view.transitionHost
  }

  prepareDestinationTransition(): Promise<void> {
    return this.view.prepareDestinationTransition()
  }

  createReturnTransitionOptions(): SceneTransitionOptions {
    if (this.entryMode !== 'returning') {
      throw new Error('Return transition options require a returning main menu')
    }

    return {
      inset: SCENE_SELECTION_GAP,
      mode: 'collapse',
      scaleMode: 'cover',
      duration: 0.45,
      hostParent: this.destinationTransitionHost,
      hostIndex: 0,
      afterCollapse: () => this.view.closeReturningChest(),
      afterTransition: () => this.view.revealReturnedMenu()
    }
  }

  async init(): Promise<void> {
    this.root.addChild(this.view)
    await this.view.init()
  }

  update(deltaMS: number): void {
    this.view?.update(deltaMS)
  }
}
