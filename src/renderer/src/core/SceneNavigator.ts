import { GAME_HEIGHT, GAME_WIDTH } from './config'
import { SceneManager } from './SceneManager'
import { CollectionScene } from '../scenes/CollectionScene'
import { DeckSelectionScene } from '../scenes/DeckSelectionScene'
import { MainMenuScene } from '../scenes/MainMenuScene'
import { CardViewScene } from '../scenes/CardViewScene'
import { Scene } from '../scenes/Scene'
import type { SceneId, SceneRequest } from '../../../shared/sceneNavigation'

const FULL_VIEWPORT = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT
}

type SceneFactory = (request: SceneRequest) => Scene

/**
 * Renderer-side scene registration.
 *
 * The shared scene catalog automatically creates the native menu entries.
 * This exhaustive map is the renderer hook for those entries: adding an id
 * to the shared catalog makes TypeScript require its constructor here too.
 * Parameterized scenes can read `request.params` in their factory.
 */
const SCENE_FACTORIES: Record<SceneId, SceneFactory> = {
  'main-menu': () => new MainMenuScene(),
  'deck-selection': () => new DeckSelectionScene(),
  collection: () => new CollectionScene(),
  'card-view': () => new CardViewScene()
}

/** Creates a fresh scene instance for a native-menu request. */
export function createScene(request: SceneRequest): Scene {
  const factory = SCENE_FACTORIES[request.id]
  if (!factory) throw new Error(`Unknown scene request: ${request.id}`)

  return factory(request)
}

/**
 * Handles developer scene jumps without coupling Electron's main process to
 * Pixi or to scene-specific UI choreography such as the chest lids.
 */
export class SceneNavigator {
  constructor(private readonly sceneManager: SceneManager) {}

  async navigate(request: SceneRequest): Promise<void> {
    console.info('[Scenes menu][navigator] creating scene', request)
    const scene = createScene(request)

    // A debug jump is available from every scene, so use the generic
    // full-viewport transition instead of MainMenuScene's lid animation.
    await this.sceneManager.transitionTo(scene, {
      inset: FULL_VIEWPORT,
      scaleMode: 'cover',
      overlayAlpha: 0.25,
      duration: 0.2,
      afterTransition:
        scene instanceof CollectionScene ? () => scene.playCoverReveal() : undefined
    })

    console.info('[Scenes menu][navigator] transition complete', request)
  }
}
