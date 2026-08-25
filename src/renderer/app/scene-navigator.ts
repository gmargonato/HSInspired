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
import { GameSettingsScene, MenuSettingsScene } from '../scenes/settings-scenes'
import { CardViewScene } from '../scenes/card-view-scene'
import { Scene } from '../scenes/scene'
import { SceneManager } from '../scenes/scene-manager'
import type { SceneId, SceneRequest } from '../../shared/scene-navigation'
import type { SceneTransitionOptions } from '../scenes/scene-manager'
import { SCENE_SELECTION_GAP } from '../scenes/main-menu-scene'
import { MAX_DECK_CARDS, countDeckCards } from '../../game/decks'
import {
  chooseOpponentDeck,
  createMatchSeed
} from '../features/deck-selection/deck-selection-model'
import { createHumanVsAiGameRoute } from './router'

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

const SCENE_FACTORIES: Record<SceneId, SceneFactory> = {
  'main-menu': (_request, dependencies) =>
    new MainMenuScene(dependencies.router, 'closed', dependencies.services.logger),
  'deck-selection': (_request, dependencies) =>
    new DeckSelectionScene(
      dependencies.services.deckStore,
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
  'new-deck': (_request, dependencies) =>
    new NewDeckScene(dependencies.services.deckStore, dependencies.services.logger),
  game: (request, dependencies) => {
    const requestedDeckId = resolveGameDeckId(request, dependencies)
    const decks = dependencies.services.deckStore.getDecks()
    const deck = requestedDeckId
      ? decks.find((candidate) => candidate.id === requestedDeckId)
      : undefined
    const seed = createMatchSeed()
    const opponent = requestedDeckId
      ? chooseOpponentDeck(decks, requestedDeckId, seed)
      : undefined

    if (deck && opponent) {
      return new GameScene(
        createHumanVsAiGameRoute(
          {
            humanDeck: { id: deck.id, heroId: deck.heroId },
            aiDeck: { id: opponent.id, heroId: opponent.heroId }
          },
          seed
        ),
        dependencies.services.deckStore,
        dependencies.services.logger
      )
    }

    // Fallback for tests / empty stores where deckStore has no complete decks.
    // Production navigateRequest will reject with a clear error before reaching here.
    const fallbackRoute = createFallbackGameRoute(
      deck?.id ?? requestedDeckId,
      opponent?.id
    )
    return new GameScene(
      fallbackRoute as unknown as ConstructorParameters<typeof GameScene>[0],
      dependencies.services.deckStore,
      dependencies.services.logger
    )
  }
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
  private settingsTogglePending = false

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
    this.services.logger.info('[SceneNavigator] navigateRequest', request)
    if (request.id === 'game') {
      this.services.logger.info('[SceneNavigator] game request start')
      await this.services.deckStore.load()
      const decks = this.services.deckStore.getDecks()
      this.services.logger.info(
        '[SceneNavigator] decks loaded',
        decks.map((d) => `${d.id} — ${d.heroId} — ${countDeckCards(d)}`)
      )
      const requestedDeckId = (request as { params?: { deckId?: string } }).params
        ?.deckId
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
      const opponent = chooseOpponentDeck(decks, targetDeckId, seed)
      if (!opponent) {
        throw new Error('At least one complete deck is required to start a game.')
      }
      this.services.logger.info('[SceneNavigator] navigating to game', {
        human: deck.id,
        opponent: opponent.id,
        seed
      })

      await this.navigate(
        createHumanVsAiGameRoute(
          {
            humanDeck: { id: deck.id, heroId: deck.heroId },
            aiDeck: { id: opponent.id, heroId: opponent.heroId }
          },
          seed
        )
      )
      this.services.logger.info('[SceneNavigator] game navigate done')
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
      operation = () => this.sceneManager.push(new GameSettingsScene())
    } else if (
      current instanceof MainMenuScene ||
      current instanceof DeckSelectionScene ||
      current instanceof CollectionScene ||
      current instanceof NewDeckScene
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
    this.services.logger.info('[SceneNavigator] createTransitionOptions', {
      previous: previous?.constructor.name ?? 'null',
      route: route.id
    })
    const afterTransition =
      scene instanceof CollectionScene
        ? () => {
            this.services.logger.info(
              '[SceneNavigator] afterTransition: Collection playCoverReveal'
            )
            return scene.playCoverReveal()
          }
        : scene instanceof NewDeckScene
          ? () => {
              this.services.logger.info(
                '[SceneNavigator] afterTransition: NewDeck open'
              )
              return scene.open()
            }
          : scene instanceof GameScene
            ? () => {
                this.services.logger.info(
                  '[SceneNavigator] afterTransition: Game playOpeningReveal'
                )
                return scene.playOpeningReveal()
              }
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
      case 'new-deck':
        return new NewDeckScene(this.services.deckStore, this.services.logger)
      case 'game':
        return new GameScene(route, this.services.deckStore, this.services.logger)
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
