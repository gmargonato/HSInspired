import { Application } from 'pixi.js'
import { SceneManager } from './scenes/scene-manager'
import { SceneNavigator } from './app/scene-navigator'
import { createAppServices } from './app/services'
import type { AppLogger } from './app/services'
import { GAME_HEIGHT, GAME_WIDTH } from './app/config'
import { CursorManager } from './ui/components/cursor'
import type { SceneRequest } from '../shared/scene-navigation'
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
function subscribeToSceneMenu(
  listener: (request: SceneRequest) => void,
  logger: AppLogger
): () => void {
  const sceneAPI = window.api as SceneMenuAPI | undefined
  if (typeof sceneAPI?.onSceneRequest === 'function') {
    try {
      const unsubscribe = sceneAPI.onSceneRequest((request) => {
        logger.info('[Scenes menu][renderer] received via window.api', request)
        listener(request)
      })
      logger.info('[Scenes menu][renderer] listening via window.api')
      return unsubscribe
    } catch (error) {
      logger.warn('The custom Scenes bridge could not be registered.', error)
    }
  }

  logger.warn('Scenes menu bridge is unavailable; developer navigation is disabled.')
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

  const services = createAppServices()
  let cursor: CursorManager | null = null
  let sceneNavigator: SceneNavigator | null = null
  let removeSettingsShortcut = (): void => undefined
  let sceneManagerReady = false
  const pendingSceneRequests: SceneRequest[] = []

  const navigateSceneRequest = (request: SceneRequest): void => {
    if (!sceneManagerReady || !sceneNavigator) {
      pendingSceneRequests.push(request)
      return
    }

    services.logger.info('[Scenes menu][renderer] navigating', request)
    void sceneNavigator.navigateRequest(request).catch((error: unknown) => {
      services.logger.error('Failed to navigate from the Scenes menu.', error)
    })
  }

  // Register before scene loading so native menu requests are not
  // lost while the renderer is becoming ready.
  const unsubscribeFromSceneMenu = subscribeToSceneMenu(
    navigateSceneRequest,
    services.logger
  )

  try {
    app.ticker.maxFPS = 60

    cursor = new CursorManager(container)
    cursor.mount()

    const game = new SceneManager(app, {
      cursor: cursor ?? undefined,
      logger: services.logger
    })
    const navigator = new SceneNavigator(game, services)
    sceneNavigator = navigator

    const directInspectorStart =
      import.meta.env.DEV && import.meta.env.VITE_DEV_START_ROUTE === 'card-inspector'
    if (directInspectorStart) {
      const { CardInspectorScene } = await import('@dev-inspector')
      await game.start(new CardInspectorScene())
    } else {
      await game.start(navigator.createInitialScene())
    }

    const handleSettingsShortcut = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.repeat) return
      if (!navigator.requestSettingsToggle()) return

      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', handleSettingsShortcut)
    removeSettingsShortcut = () =>
      window.removeEventListener('keydown', handleSettingsShortcut)

    if (import.meta.env.DEV) {
      const { createLayoutInspector } = await import('@dev-layout-inspector')
      const layoutInspector = createLayoutInspector(app, {
        getRoot: () => (game.current ? game.current.root : null)
      })
      const toggleLayoutInspector = (event: KeyboardEvent): void => {
        if (event.key !== 'F2' || event.repeat) return
        event.preventDefault()
        layoutInspector.toggle()
      }
      window.addEventListener('keydown', toggleLayoutInspector)
    }

    sceneManagerReady = true
    for (const request of pendingSceneRequests.splice(0)) {
      navigateSceneRequest(request)
    }

    // The native Electron menu sends requests through preload. Keep all scene
    // construction in the renderer, where SceneManager and Pixi are available.
    window.addEventListener(
      'beforeunload',
      () => {
        removeSettingsShortcut()
        unsubscribeFromSceneMenu()
        app.canvas.removeEventListener('contextmenu', preventContextMenu)
        cursor?.destroy()
      },
      { once: true }
    )
  } catch (error) {
    removeSettingsShortcut()
    unsubscribeFromSceneMenu()
    cursor?.destroy()
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
