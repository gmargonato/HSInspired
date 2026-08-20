import { GAME_HEIGHT, GAME_WIDTH } from './config'
import { createAppServices, type AppServices } from './services'
import type { AppRoute, SceneRouter } from './router'
import { CARD_CATALOG } from '../../../game/content/cards'
import { CardAssetResolver } from '../ui/asset-registry/card-asset-resolver'
import { CollectionScene } from '../scenes/CollectionScene'
import { DeckSelectionScene } from '../scenes/DeckSelectionScene'
import { MainMenuScene } from '../scenes/MainMenuScene'
import { NewDeckScene } from '../scenes/NewDeckScene'
import { CardViewScene } from '../scenes/CardViewScene'
import { Scene } from '../scenes/Scene'
import { SceneManager } from '../scenes/SceneManager'
import type { SceneId, SceneRequest } from '../../../shared/sceneNavigation'
import type { SceneTransitionOptions } from '../scenes/SceneManager'
import { SCENE_SELECTION_GAP } from '../scenes/MainMenuScene'

const FULL_VIEWPORT = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT
}

export interface RendererSceneDependencies {
  readonly services: AppServices
  readonly router?: SceneRouter
}

const defaultDependencies: RendererSceneDependencies = {
  services: createAppServices()
}

type SceneFactory = (
  request: SceneRequest,
  dependencies: RendererSceneDependencies
) => Scene

const SCENE_FACTORIES: Record<SceneId, SceneFactory> = {
  'main-menu': (_request, dependencies) =>
    new MainMenuScene(
      dependencies.router,
      'closed',
      dependencies.services.audio,
      dependencies.services.logger
    ),
  'deck-selection': (_request, dependencies) =>
    new DeckSelectionScene(
      dependencies.router,
      dependencies.services.audio,
      dependencies.services.logger
    ),
  collection: (_request, dependencies) =>
    new CollectionScene(
      dependencies.services.deckStore,
      dependencies.router,
      dependencies.services.audio,
      dependencies.services.dialogs,
      dependencies.services.logger
    ),
  'new-deck': (_request, dependencies) =>
    new NewDeckScene(
      dependencies.services.deckStore,
      dependencies.services.audio,
      dependencies.services.logger
    )
}

/** Creates a fresh scene instance for a native-menu request. */
export function createScene(
  request: SceneRequest,
  dependencies: RendererSceneDependencies = defaultDependencies
): Scene {
  const factory = SCENE_FACTORIES[request.id]
  if (!factory) throw new Error(`Unknown scene request: ${request.id}`)
  return factory(request, dependencies)
}

/** App-level route composition. Scenes only emit typed routes through this port. */
export class SceneNavigator implements SceneRouter {
  private readonly cardResolver = new CardAssetResolver()

  constructor(
    private readonly sceneManager: SceneManager,
    private readonly services: AppServices = createAppServices()
  ) {}

  /** The renderer composition root uses this for the normal startup route. */
  createInitialScene(): Scene {
    return this.createRouteScene({ id: 'main-menu', entryMode: 'closed' })
  }

  async navigate(route: AppRoute): Promise<void> {
    const scene = this.createRouteScene(route)

    if (route.id === 'card-preview') {
      await this.sceneManager.push(scene)
      return
    }

    await this.sceneManager.transitionTo(
      scene,
      this.createTransitionOptions(route, scene)
    )
  }

  async navigateRequest(request: SceneRequest): Promise<void> {
    const route: AppRoute =
      request.id === 'main-menu'
        ? {
            id: 'main-menu',
            entryMode:
              this.sceneManager.current instanceof MainMenuScene
                ? 'closed'
                : 'returning'
          }
        : request.id === 'deck-selection'
          ? { id: 'deck-selection' }
          : request.id === 'collection'
            ? { id: 'collection' }
            : { id: 'new-deck' }
    await this.navigate(route)
  }

  private createTransitionOptions(
    route: AppRoute,
    scene: Scene
  ): SceneTransitionOptions {
    const previous = this.sceneManager.current
    const afterTransition =
      scene instanceof CollectionScene
        ? () => scene.playCoverReveal()
        : scene instanceof NewDeckScene
          ? () => scene.open()
          : undefined

    if (
      route.id === 'main-menu' &&
      route.entryMode === 'returning' &&
      scene instanceof MainMenuScene
    ) {
      return scene.createReturnTransitionOptions()
    }

    if (
      previous instanceof MainMenuScene &&
      (route.id === 'deck-selection' || route.id === 'collection')
    ) {
      return {
        inset: SCENE_SELECTION_GAP,
        scaleMode: 'cover',
        duration: 0.45,
        hostParent: previous.root,
        hostIndex: previous.isDestinationTransitionOpen
          ? 2
          : previous.root.children.length,
        beforeExpand: previous.isDestinationTransitionOpen
          ? () => previous.prepareDestinationTransition()
          : undefined,
        afterTransition
      }
    }

    if (previous instanceof DeckSelectionScene && route.id === 'collection') {
      return {
        inset: FULL_VIEWPORT,
        mode: 'fade',
        duration: 0.6,
        afterTransition
      }
    }

    return {
      inset: FULL_VIEWPORT,
      scaleMode: 'cover',
      overlayAlpha: 0.25,
      duration: 0.2,
      afterTransition
    }
  }

  private createRouteScene(route: AppRoute): Scene {
    switch (route.id) {
      case 'main-menu':
        return new MainMenuScene(
          this,
          route.entryMode ?? 'closed',
          this.services.audio,
          this.services.logger
        )
      case 'deck-selection':
        return new DeckSelectionScene(this, this.services.audio, this.services.logger)
      case 'collection':
        return new CollectionScene(
          this.services.deckStore,
          this,
          this.services.audio,
          this.services.dialogs,
          this.services.logger
        )
      case 'new-deck':
        return new NewDeckScene(
          this.services.deckStore,
          this.services.audio,
          this.services.logger
        )
      case 'game':
        throw new Error(
          `GameScene is not implemented yet; received setup for ${route.setup.participants.length} participants.`
        )
      case 'card-preview':
        return new CardViewScene({
          card: CARD_CATALOG.require(route.cardId),
          sourceBounds: route.sourceBounds,
          resolver: this.cardResolver
        })
    }

    const exhaustiveRoute: never = route
    throw new Error(`Unknown route: ${String(exhaustiveRoute)}`)
  }
}
