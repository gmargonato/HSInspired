import { Application } from 'pixi.js'
import { MainMenuScene } from './scenes/MainMenuScene'
import { Game } from './core/Game'

export const GAME_WIDTH = 1920
export const GAME_HEIGHT = 1080

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

  app.ticker.maxFPS = 60

  const game = new Game(app)

  await game.start(new MainMenuScene())

  document.getElementById('game-container')?.appendChild(app.canvas)
}

void bootstrap()