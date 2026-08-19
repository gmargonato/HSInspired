import { Application } from 'pixi.js'
import { MainMenuScene } from './scenes/MainMenuScene'
import { SceneManager } from './core/SceneManager'
import { SceneNavigator } from './core/SceneNavigator'
import { GAME_HEIGHT, GAME_WIDTH } from './core/config'
import { CursorManager } from './core/cursor'
import { gameAudio } from './core/audio'
import type { SceneRequest } from '../../shared/sceneNavigation'
import './styles.css'

export { GAME_HEIGHT, GAME_WIDTH }

type SceneMenuAPI = {
  onSceneRequest?: (listener: (request: SceneRequest) => void) => () => void
}

/**
 * Subscribe to the developer menu without making it a startup dependency.
 *
 * A missing bridge only disables the developer menu, not the game. The
 * preload intentionally exposes only this narrow API because the Electron
 * sandbox cannot load the external toolkit preload module.
 */
function subscribeToSceneMenu(listener: (request: SceneRequest) => void): () => void {
  const sceneAPI = window.api as SceneMenuAPI | undefined
  if (typeof sceneAPI?.onSceneRequest === 'function') {
    try {
      const unsubscribe = sceneAPI.onSceneRequest((request) => {
        console.info('[Scenes menu][renderer] received via window.api', request)
        listener(request)
      })
      console.info('[Scenes menu][renderer] listening via window.api')
      return unsubscribe
    } catch (error) {
      console.warn('The custom Scenes bridge could not be registered:', error)
    }
  }

  console.warn('Scenes menu bridge is unavailable; developer navigation is disabled')
  return () => undefined
}

async function bootstrap(): Promise<void> {
  const app = new Application()

  await app.init({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: 0x0a0f1e,
    antialias: true,
    eventFeatures: { wheel: true },
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    resizeTo: window
  })

  const container = document.getElementById('game-container')
  if (!container) {
    throw new Error('Game container was not found')
  }

  container.appendChild(app.canvas)

  const preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }
  app.canvas.addEventListener('contextmenu', preventContextMenu)

  await gameAudio.preload()
  const unlockAudio = (): void => gameAudio.unlock()
  app.canvas.addEventListener('pointerdown', unlockAudio, { capture: true })

  app.ticker.maxFPS = 60

  const cursor = new CursorManager(container)
  cursor.mount()

  try {
    const game = new SceneManager(app, { cursor })

    await game.start(new MainMenuScene())

    // The native Electron menu sends requests through preload. Keep all scene
    // construction in the renderer, where SceneManager and Pixi are available.
    const sceneNavigator = new SceneNavigator(game)
    const unsubscribeFromSceneMenu = subscribeToSceneMenu((request) => {
      console.info('[Scenes menu][renderer] navigating', request)
      void sceneNavigator.navigate(request).catch((error: unknown) => {
        console.error('Failed to navigate from the Scenes menu:', error)
      })
    })

    window.addEventListener(
      'beforeunload',
      () => {
        unsubscribeFromSceneMenu()
        app.canvas.removeEventListener('contextmenu', preventContextMenu)
        app.canvas.removeEventListener('pointerdown', unlockAudio, { capture: true })
        void gameAudio.dispose()
        cursor.destroy()
      },
      { once: true }
    )
  } catch (error) {
    void gameAudio.dispose()
    cursor.destroy()
    throw error
  }
}

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start the game:', error)

  const container = document.getElementById('game-container')
  if (container) {
    container.textContent = 'Unable to start the game. Please restart the application.'
  }
})
