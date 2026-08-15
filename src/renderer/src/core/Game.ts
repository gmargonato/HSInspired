import { Application } from 'pixi.js'
import { Scene } from '../scenes/Scene'

export class Game {
  readonly app: Application
  private currentScene: Scene | null = null

  constructor(app: Application) {
    this.app = app
  }

  async start(scene: Scene): Promise<void> {
    await this.changeScene(scene)
    this.app.ticker.add(this.tick, this)
  }

  async changeScene(scene: Scene): Promise<void> {
    if (this.currentScene) {
      await this.currentScene.destroy()
      this.currentScene = null
    }

    this.app.stage.removeChildren()
    this.currentScene = scene
    await this.currentScene.init(this.app)
    this.app.stage.addChild(this.currentScene.root)
  }

  private tick(): void {
    if (this.currentScene) {
      this.currentScene.update(this.app.ticker.deltaMS)
    }
  }
}