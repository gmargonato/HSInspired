// Despite its name, this installs Pixi's CSP-safe polyfills for code paths
// that otherwise generate runtime functions with eval.
import 'pixi.js/unsafe-eval'
import { Application } from 'pixi.js'
import { SceneManager } from './scenes/scene-manager'
import { SceneNavigator, type DevSceneFactory } from './app/scene-navigator'
import { createAppServices } from './app/services'
import type { AppLogger } from './app/services'
import { GAME_HEIGHT, GAME_WIDTH } from './app/config'
import { gsap } from './animation/animations'
import { CursorManager } from './ui/components/cursor'
import type { SceneRequest } from '../shared/scene-navigation'
import './styles.css'

export { GAME_HEIGHT, GAME_WIDTH }

type SceneMenuAPI = {
  onSceneRequest?: (listener: (request: SceneRequest) => void) => () => void
}

const createDevScene: DevSceneFactory | undefined = import.meta.env.DEV
  ? async (request) => {
      switch (request.id) {
        case 'hero-power-anim': {
          const { HeroPowerAnimScene } = await import('@hero-power-anim')
          return new HeroPowerAnimScene()
        }
        case 'card-inspector': {
          const { CardInspectorScene } = await import('@dev-inspector')
          return new CardInspectorScene()
        }
        case 'outline-lab': {
          const { OutlineLabScene } = await import('@outline-lab')
          return new OutlineLabScene()
        }
        case 'vfx-lab': {
          const { VfxLabScene } = await import('@vfx-lab')
          return new VfxLabScene()
        }
      }
    }
  : undefined

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
        listener(request)
      })
      return unsubscribe
    } catch (error) {
      logger.warn('The custom Scenes bridge could not be registered.', error)
    }
  }

  logger.warn('Scenes menu bridge is unavailable; developer navigation is disabled.')
  return () => undefined
}

function mountFpsCounter(app: Application, container: HTMLElement): () => void {
  const counter = document.createElement('div')
  counter.className = 'fps-counter'
  counter.textContent = '--'
  container.appendChild(counter)

  let frames = 0
  let sampleStart = performance.now()
  const updateCounter = (): void => {
    frames += 1
    const now = performance.now()
    const elapsed = now - sampleStart
    if (elapsed < 500) return

    counter.textContent = String(Math.round((frames * 1000) / elapsed))
    frames = 0
    sampleStart = now
  }
  app.ticker.add(updateCounter)

  return () => {
    app.ticker.remove(updateCounter)
    counter.remove()
  }
}

const ERROR_LOOP_THRESHOLD = 30
const ERROR_LOOP_WINDOW_MS = 3000

/**
 * A per-frame throw from a ticker or tween re-fires on every frame, which can
 * turn one broken view into an endless error loop. When the same uncaught
 * error repeats within a short window, halt the animation and render loops so
 * the failure stays visible instead of spinning forever.
 */
function installErrorLoopHalt(
  app: Application,
  logger: AppLogger
): (error: unknown) => void {
  let lastMessage: string | null = null
  let count = 0
  let windowStart = 0
  let halted = false

  return (error: unknown): void => {
    if (halted) return
    const message = error instanceof Error ? error.message : String(error)
    const now = performance.now()
    if (message !== lastMessage || now - windowStart > ERROR_LOOP_WINDOW_MS) {
      lastMessage = message
      count = 1
      windowStart = now
      return
    }
    count += 1
    if (count < ERROR_LOOP_THRESHOLD) return
    halted = true
    logger.error(
      `[Global] the same uncaught error repeated ${count} times in ${ERROR_LOOP_WINDOW_MS}ms; animation halted.`,
      error
    )
    gsap.globalTimeline.pause()
    app.ticker.stop()
  }
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('game-container')
  if (!container) {
    throw new Error('Game container was not found')
  }

  // The cursor is document-level infrastructure, so make it available before
  // asynchronous Pixi and scene initialization. This also ensures a renderer
  // reload cannot leave the native OS cursor active while the game boots.
  const cursor = new CursorManager(container)
  cursor.mount()

  const app = new Application()

  try {
    await app.init({
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      backgroundColor: 0x0a0f1e,
      antialias: true,
      powerPreference: 'high-performance',
      useBackBuffer: true,
      eventFeatures: { wheel: true },
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: window
    })
  } catch (error) {
    cursor.destroy()
    throw error
  }

  container.appendChild(app.canvas)

  const preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }
  app.canvas.addEventListener('contextmenu', preventContextMenu)

  const services = createAppServices()
  const haltOnErrorLoop = installErrorLoopHalt(app, services.logger)
  // Global error tracing for dev menu crashes
  window.addEventListener('error', (event) => {
    const error = event.error ?? event.message
    services.logger.error('[Global] uncaught error', error, event)
    haltOnErrorLoop(error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    services.logger.error('[Global] unhandled rejection', event.reason)
    haltOnErrorLoop(event.reason)
  })
  let sceneNavigator: SceneNavigator | null = null
  let removeSettingsShortcut = (): void => undefined
  let sceneManagerReady = false
  const pendingSceneRequests: SceneRequest[] = []

  const navigateSceneRequest = (request: SceneRequest): void => {
    if (!sceneManagerReady || !sceneNavigator) {
      pendingSceneRequests.push(request)
      return
    }

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

  let unsubscribeDevSceneSync = (): void => undefined
  let unsubscribeDevCommandHandler = (): void => undefined
  let removeFpsCounter = (): void => undefined
  let removeDevFilterToggle = (): void => undefined

  try {
    app.ticker.maxFPS = 60
    removeFpsCounter = mountFpsCounter(app, container)
    if (import.meta.env.DEV) {
      const { installDevFilterToggle } = await import('./app/dev-filter-toggle')
      removeDevFilterToggle = installDevFilterToggle(app)
    }

    const game = new SceneManager(app, {
      cursor,
      logger: services.logger
    })
    const navigator = new SceneNavigator(game, services, createDevScene)
    sceneNavigator = navigator

    if (import.meta.env.DEV) {
      const [{ installDevSceneSync }, { installDevCommandHandler }] = await Promise.all(
        [import('./app/dev-scene-sync'), import('./app/dev-command-handler')]
      )
      unsubscribeDevSceneSync = installDevSceneSync(game, services.logger)
      unsubscribeDevCommandHandler = installDevCommandHandler(
        game,
        services.logger,
        services.progressionStore,
        services.playerStatsStore,
        (message) => services.dialogs.error(message)
      )
    }

    const directInspectorStart =
      import.meta.env.DEV && import.meta.env.VITE_DEV_START_ROUTE === 'card-inspector'
    const directOutlineLabStart =
      import.meta.env.DEV && import.meta.env.VITE_DEV_START_ROUTE === 'outline-lab'
    const directVfxLabStart =
      import.meta.env.DEV && import.meta.env.VITE_DEV_START_ROUTE === 'vfx-lab'
    const directMatchPerformanceStart =
      import.meta.env.DEV &&
      import.meta.env.VITE_DEV_START_ROUTE === 'match-performance'
    const directGameStart =
      import.meta.env.DEV && import.meta.env.VITE_DEV_START_ROUTE === 'game'
    if (directInspectorStart) {
      const { CardInspectorScene } = await import('@dev-inspector')
      await game.start(new CardInspectorScene())
    } else if (directOutlineLabStart) {
      const { OutlineLabScene } = await import('@outline-lab')
      await game.start(new OutlineLabScene())
    } else if (directVfxLabStart) {
      const { VfxLabScene } = await import('@vfx-lab')
      await game.start(new VfxLabScene())
    } else {
      await game.start(navigator.createInitialScene())
      if (directGameStart) {
        await navigator.navigateRequest({
          id: 'game',
          params: { deckId: import.meta.env.VITE_DEV_HUMAN_DECK_ID }
        })
      }
    }

    if (directMatchPerformanceStart) {
      const { runMatchPerformanceBenchmark } = await import('@dev-match-performance')
      ;(
        window as Window & {
          __matchPerformanceBenchmark?: ReturnType<typeof runMatchPerformanceBenchmark>
        }
      ).__matchPerformanceBenchmark = runMatchPerformanceBenchmark({
        app,
        sceneManager: game,
        navigator,
        services
      })
    }

    const handleSettingsShortcut = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return
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

    if (import.meta.env.DEV && import.meta.hot) {
      import.meta.hot.on('vite:afterUpdate', () => cursor.mount())
    }

    // The native Electron menu sends requests through preload. Keep all scene
    // construction in the renderer, where SceneManager and Pixi are available.
    window.addEventListener(
      'beforeunload',
      () => {
        removeFpsCounter()
        removeDevFilterToggle()
        removeSettingsShortcut()
        unsubscribeFromSceneMenu()
        unsubscribeDevSceneSync()
        unsubscribeDevCommandHandler()
        app.canvas.removeEventListener('contextmenu', preventContextMenu)
        // The browser discards this document, its nodes, and listeners. Avoid
        // removing the custom cursor early while Vite performs a full reload.
      },
      { once: true }
    )
  } catch (error) {
    removeFpsCounter()
    removeDevFilterToggle()
    removeSettingsShortcut()
    unsubscribeFromSceneMenu()
    unsubscribeDevSceneSync()
    unsubscribeDevCommandHandler()
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
