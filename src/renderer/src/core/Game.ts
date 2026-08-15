import { Application, Container } from 'pixi.js'
import { Scene } from '../scenes/Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../main'

/**
 * Owns the application and the active scene.
 *
 * The game logic always runs in a fixed design resolution (GAME_WIDTH ×
 * GAME_HEIGHT). A single "world" container is scaled to fit the current
 * renderer screen (app.screen), so scenes are authored in design
 * coordinates and are resolution-independent.
 */
export class Game {
  readonly app: Application
  private readonly world = new Container()
  private currentScene: Scene | null = null

  constructor(app: Application) {
    this.app = app
    this.app.stage.addChild(this.world)
  }

  async start(scene: Scene): Promise<void> {
    await this.changeScene(scene)
    this.app.ticker.add(this.tick, this)
    this.fitToScreen()
  }

  async changeScene(scene: Scene): Promise<void> {
    if (this.currentScene) {
      await this.currentScene.destroy()
      this.currentScene = null
    }

    this.world.removeChildren()
    this.currentScene = scene
    await this.currentScene.init(this.app)
    this.world.addChild(this.currentScene.root)
    this.fitToScreen()
  }

  private fitToScreen(): void {
    const scale = Math.min(
      this.app.screen.width / GAME_WIDTH,
      this.app.screen.height / GAME_HEIGHT
    )

    this.world.scale.set(scale)
    this.world.position.set(
      (this.app.screen.width - GAME_WIDTH * scale) / 2,
      (this.app.screen.height - GAME_HEIGHT * scale) / 2
    )
  }

  private tick(): void {
    this.fitToScreen()
    if (this.currentScene) {
      this.currentScene.update(this.app.ticker.deltaMS)
    }
  }
}