import { GAME_HEIGHT, GAME_WIDTH } from './config'
import { createAppServices, type AppServices } from './services'
import type { AppRoute, SceneRouter } from './router'
import { CARD_CATALOG, asHeroId } from '../../game/content/cards'
import { asPlayerId } from '../../game/match'
import { CardAssetResolver } from '../ui/asset-registry/card-asset-resolver'
import { CollectionScene } from '../scenes/collection-scene'
import { DeckSelectionScene } from '../scenes/deck-selection-scene'
import { MainMenuScene } from '../scenes/main-menu-scene'
import { NewDeckScene } from '../scenes/new-deck-scene'
import { GameScene } from '../scenes/game-scene'
import { TavernBrawlScene } from '../scenes/tavern-brawl-scene'
import { ArenaScene } from '../scenes/arena-scene'
import { GameSettingsScene, MenuSettingsScene } from '../scenes/settings-scenes'
import { CardViewScene } from '../scenes/card-view-scene'
import { Scene } from '../scenes/scene'
import { SceneManager } from '../scenes/scene-manager'
import type { SceneId, SceneRequest } from '../../shared/scene-navigation'
import type { SceneTransitionOptions } from '../scenes/scene-manager'
import { SCENE_SELECTION_GAP } from '../scenes/main-menu-scene'
import { MAX_DECK_CARDS, countDeckCards } from '../../game/decks'
import { createMatchSeed } from '../features/deck-selection/deck-selection-model'
import { createConstructedGameRoute } from './router'

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

function resolveGameDeckId(
  request: SceneRequest,
  dependencies: RendererSceneDependencies
): string | undefined {
  if (request.id !== 'game') return undefined
  const requested = (request as { params?: { deckId?: string } }).params?.deckId
  if (requested) return requested

  const decks = dependencies.services.deckStore.getDecks()
  const complete = decks.filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)
  return complete[0]?.id ?? decks[0]?.id
}

function createFallbackGameRoute(
  deckId: string | undefined,
  opponentId: string | undefined
) {
  const humanDeckId = deckId ?? 'dev-fallback-deck'
  const aiDeckId = opponentId ?? humanDeckId
  return {
    id: 'game' as const,
    setup: {
      seed: 1,
      participants: [
        {
          participantId: asPlayerId('human-player'),
          controllerKind: 'human' as const,
          heroId: asHeroId('jaina'),
          deckId: humanDeckId
        },
        {
          participantId: asPlayerId('ai-player'),
          controllerKind: 'ai' as const,
          heroId: asHeroId('guldan'),
          deckId: aiDeckId
        }
      ] as const
    }
  }
}

type DevSceneId = 'card-inspector' | 'outline-lab'
type StandardSceneId = Exclude<SceneId, DevSceneId>
type StandardSceneRequest = Exclude<SceneRequest, { readonly id: DevSceneId }>
export type DevSceneRequest = Extract<SceneRequest, { readonly id: DevSceneId }>
export type DevSceneFactory = (request: DevSceneRequest) => Promise<Scene>

const SCENE_FACTORIES: Record<StandardSceneId, SceneFactory> = {
  'main-menu': (_request, dependencies) =>
    new MainMenuScene(dependencies.router, 'closed', dependencies.services.logger),
  'deck-selection': (_request, dependencies) =>
    new DeckSelectionScene(
      dependencies.services.deckStore,
      dependencies.services.playerStatsStore,
      dependencies.router,
      dependencies.services.logger
    ),
  collection: (_request, dependencies) =>
    new CollectionScene(
      dependencies.services.deckStore,
      dependencies.router,
      dependencies.services.dialogs,
      dependencies.services.logger
    ),
  arena: (_request, dependencies) =>
    new ArenaScene(
      dependencies.services.arenaStore,
      dependencies.router,
      dependencies.services.dialogs,
      dependencies.services.logger,
      dependencies.services.progressionStore
    ),
  'new-deck': (_request, dependencies) =>
    new NewDeckScene(dependencies.services.deckStore, dependencies.services.logger),
  'tavern-brawl': (_request, dependencies) =>
    new TavernBrawlScene(
      dependencies.services.playerStatsStore,
      dependencies.router,
      dependencies.services.logger
    ),
  game: (request, dependencies) => {
    const requestedDeckId = resolveGameDeckId(request, dependencies)
    const decks = dependencies.services.deckStore.getDecks()
    const deck = requestedDeckId
      ? decks.find((candidate) => candidate.id === requestedDeckId)
      : undefined
    const seed = createMatchSeed()
    if (deck && countDeckCards(deck) === MAX_DECK_CARDS) {
      return new GameScene(
        createConstructedGameRoute(
          deck,
          seed,
          decks,
          import.meta.env.DEV ? import.meta.env.VITE_DEV_AI_DECK_ID : undefined
        ),
        dependencies.services.deckStore,
        dependencies.services.playerStatsStore,
        dependencies.services.arenaStore,
        dependencies.services.logger,
        dependencies.router,
        dependencies.services.ai,
        dependencies.services.matchLogs,
        (message, retry) => dependencies.services.dialogs.error(message, retry),
        dependencies.services.progressionStore,
        dependencies.services.dialogs,
        dependencies.services.preferences
      )
    }

    // Fallback for tests / empty stores where deckStore has no complete decks.
    // Production navigateRequest will reject with a clear error before reaching here.
    const fallbackRoute = createFallbackGameRoute(
      deck?.id ?? requestedDeckId,
      undefined
    )
    return new GameScene(
      fallbackRoute as unknown as ConstructorParameters<typeof GameScene>[0],
      dependencies.services.deckStore,
      dependencies.services.playerStatsStore,
      dependencies.services.arenaStore,
      dependencies.services.logger,
      dependencies.router,
      dependencies.services.ai,
      dependencies.services.matchLogs,
      (message, retry) => dependencies.services.dialogs.error(message, retry),
      dependencies.services.progressionStore,
      dependencies.services.dialogs,
      dependencies.services.preferences
    )
  }
}

/** Creates a fresh scene instance for a native-menu request. */
export function createScene(
  request: StandardSceneRequest,
  dependencies: RendererSceneDependencies = defaultDependencies
): Scene {
  const factory = SCENE_FACTORIES[request.id]
  if (!factory) throw new Error(`Unknown scene request: ${request.id}`)
  return factory(request, dependencies)
}

/** App-level route composition. Scenes only emit typed routes through this port. */
export class SceneNavigator implements SceneRouter {
  private readonly cardResolver = new CardAssetResolver()
  private settingsTogglePending = false

  constructor(
    private readonly sceneManager: SceneManager,
    private readonly services: AppServices = createAppServices(),
    private readonly createDevScene?: DevSceneFactory
  ) {}

  /** The renderer composition root uses this for the normal startup route. */
  createInitialScene(): Scene {
    return this.createRouteScene({ id: 'main-menu', entryMode: 'closed' })
  }

  async navigate(route: AppRoute): Promise<void> {
    await this.services.progressionStore.load()
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
    if (request.id === 'card-inspector' || request.id === 'outline-lab') {
      if (!this.createDevScene) {
        throw new Error('Development labs are available only in development builds.')
      }
      const scene = await this.createDevScene(request)
      await this.sceneManager.transitionTo(scene, {
        inset: FULL_VIEWPORT,
        mode: 'fade',
        duration: 0.3
      })
      return
    }

    if (request.id === 'game') {
      await this.services.deckStore.load()
      const decks = this.services.deckStore.getDecks()
      const gameParams = 'params' in request ? request.params : undefined
      const requestedDeckId = gameParams?.deckId
      const launchMode = gameParams?.launchMode
      const targetDeckId =
        requestedDeckId ??
        decks.filter((deck) => countDeckCards(deck) === MAX_DECK_CARDS)[0]?.id

      if (!targetDeckId) {
        throw new Error(
          'No complete deck is available for the dev Match. Create a 30-card deck in Collection first.'
        )
      }

      const deck = decks.find((candidate) => candidate.id === targetDeckId)
      if (!deck) {
        throw new Error(`The selected deck ${targetDeckId} is unavailable.`)
      }

      const seed = createMatchSeed()
      await this.navigate(
        createConstructedGameRoute(
          deck,
          seed,
          decks,
          import.meta.env.DEV ? import.meta.env.VITE_DEV_AI_DECK_ID : undefined,
          launchMode === 'first-player'
            ? { humanSeat: 'first' }
            : launchMode === 'second-player'
              ? { humanSeat: 'second' }
              : launchMode === 'skip-mulligan'
                ? { skipMulligan: true }
                : undefined
        )
      )
      return
    }

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
            : request.id === 'arena'
              ? { id: 'arena' }
              : request.id === 'tavern-brawl'
                ? { id: 'tavern-brawl' }
                : { id: 'new-deck' }
    await this.navigate(route)
  }

  /** Handles settings-only Escape presses without taking over contextual overlays. */
  requestSettingsToggle(): boolean {
    const current = this.sceneManager.current
    let operation: (() => Promise<unknown>) | null = null

    if (current instanceof MenuSettingsScene || current instanceof GameSettingsScene) {
      operation = () => this.sceneManager.pop()
    } else if (current instanceof GameScene) {
      const gameScene = current
      operation = () =>
        this.sceneManager.push(
          new GameSettingsScene({
            onConcede: async () => {
              await this.sceneManager.pop()
              gameScene.concede()
            },
            onRestart: async () => {
              await this.sceneManager.pop()
              await this.navigate(gameScene.createRestartRoute())
            },
            onQuit: async () => {
              await this.sceneManager.pop()
              await this.navigate(gameScene.createExitRoute())
            }
          })
        )
    } else if (
      current instanceof MainMenuScene ||
      current instanceof DeckSelectionScene ||
      current instanceof CollectionScene ||
      current instanceof ArenaScene ||
      current instanceof NewDeckScene ||
      current instanceof TavernBrawlScene
    ) {
      operation = () => this.sceneManager.push(new MenuSettingsScene())
    }

    if (!operation) return false
    if (this.settingsTogglePending) return true

    this.settingsTogglePending = true
    void operation()
      .catch((error: unknown) => {
        this.services.logger.error('Failed to toggle the settings overlay.', error)
      })
      .finally(() => {
        this.settingsTogglePending = false
      })
    return true
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
          : scene instanceof GameScene
            ? () => scene.playOpeningReveal()
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
      (route.id === 'deck-selection' ||
        route.id === 'collection' ||
        route.id === 'arena' ||
        route.id === 'tavern-brawl')
    ) {
      return {
        inset: SCENE_SELECTION_GAP,
        scaleMode: 'cover',
        duration: 0.45,
        hostParent: previous.destinationTransitionHost,
        hostIndex: 0,
        beforeExpand: previous.isDestinationTransitionOpen
          ? () => previous.prepareDestinationTransition()
          : undefined,
        afterTransition
      }
    }

    if (
      previous instanceof DeckSelectionScene &&
      (route.id === 'collection' || route.id === 'game')
    ) {
      return {
        inset: FULL_VIEWPORT,
        mode: 'fade',
        duration: 0.6,
        afterTransition
      }
    }

    if (
      previous instanceof GameScene &&
      (route.id === 'deck-selection' ||
        route.id === 'tavern-brawl' ||
        route.id === 'arena')
    ) {
      return {
        inset: FULL_VIEWPORT,
        mode: 'fade',
        duration: 0.6,
        afterTransition
      }
    }

    if (route.id === 'game') {
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
          this.services.logger
        )
      case 'deck-selection':
        return new DeckSelectionScene(
          this.services.deckStore,
          this.services.playerStatsStore,
          this,
          this.services.logger
        )
      case 'collection':
        return new CollectionScene(
          this.services.deckStore,
          this,
          this.services.dialogs,
          this.services.logger
        )
      case 'arena':
        return new ArenaScene(
          this.services.arenaStore,
          this,
          this.services.dialogs,
          this.services.logger,
          this.services.progressionStore
        )
      case 'new-deck':
        return new NewDeckScene(this.services.deckStore, this.services.logger)
      case 'tavern-brawl':
        return new TavernBrawlScene(
          this.services.playerStatsStore,
          this,
          this.services.logger
        )
      case 'game':
        return new GameScene(
          route,
          this.services.deckStore,
          this.services.playerStatsStore,
          this.services.arenaStore,
          this.services.logger,
          this,
          this.services.ai,
          this.services.matchLogs,
          (message, retry) => this.services.dialogs.error(message, retry),
          this.services.progressionStore,
          this.services.dialogs,
          this.services.preferences
        )
      case 'card-preview':
        return new CardViewScene({
          card: CARD_CATALOG.require(route.cardId),
          sourceBounds: route.sourceBounds,
          resolver: this.cardResolver,
          progression: this.services.progressionStore
        })
    }

    const exhaustiveRoute: never = route
    throw new Error(`Unknown route: ${String(exhaustiveRoute)}`)
  }
}
