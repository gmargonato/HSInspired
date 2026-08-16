import { Application } from 'pixi.js'
import { MainMenuScene } from './scenes/MainMenuScene'
import { SceneManager } from './core/SceneManager'
import { GAME_HEIGHT, GAME_WIDTH } from './core/config'
import './styles.css'

export { GAME_HEIGHT, GAME_WIDTH }

async function bootstrap(): Promise<void> {
  const app = new Application()

  await app.init({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: 0x0a0f1e,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    resizeTo: window
  })

  const container = document.getElementById('game-container')
  if (!container) {
    throw new Error('Game container was not found')
  }

  container.appendChild(app.canvas)

  app.ticker.maxFPS = 60

  const game = new SceneManager(app)

  await game.start(new MainMenuScene())
}

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start the game:', error)

  const container = document.getElementById('game-container')
  if (container) {
    container.textContent = 'Unable to start the game. Please restart the application.'
  }
})
