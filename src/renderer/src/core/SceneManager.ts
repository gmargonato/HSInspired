import { Application, Container } from 'pixi.js'
import { GAME_HEIGHT, GAME_WIDTH } from './config'
import { Scene } from '../scenes/Scene'

/** Owns the Pixi application and a serialized stack of full-screen scenes. */
export class SceneManager {
  readonly app: Application
  private readonly world = new Container()
  private readonly stack: Scene[] = []
  private transition: Promise<void> = Promise.resolve()
  private started = false

  constructor(app: Application) {
    this.app = app
    this.app.stage.addChild(this.world)
  }

  get current(): Scene | null {
    return this.stack[this.stack.length - 1] ?? null
  }

  async start(scene: Scene): Promise<void> {
    return this.enqueue(async () => {
      if (this.started) return

      await this.pushImmediate(scene)
      this.started = true
      this.app.ticker.add(this.tick, this)
      this.fitToScreen()
    })
  }

  async push(scene: Scene): Promise<void> {
    return this.enqueue(async () => {
      if (!this.started) {
        throw new Error('SceneManager must be started before pushing scenes')
      }
      await this.pushImmediate(scene)
    })
  }

  async pop(): Promise<Scene | null> {
    return this.enqueue(() => this.popImmediate())
  }

  async stop(): Promise<void> {
    return this.enqueue(async () => {
      while (this.stack.length > 0) {
        await this.popImmediate()
      }

      this.app.ticker.remove(this.tick, this)
      this.started = false
      this.fitToScreen()
    })
  }

  private async pushImmediate(scene: Scene): Promise<void> {
    const previous = this.current
    let loaded = false
    try {
      previous?.pause()
      await scene.load(this.app)
      loaded = true
      this.stack.push(scene)
      this.world.addChild(scene.root)
      this.fitToScreen()
    } catch (error) {
      if (this.stack[this.stack.length - 1] === scene) {
        this.stack.pop()
        if (scene.root.parent === this.world) {
          this.world.removeChild(scene.root)
        }
      }

      if (loaded || scene.state !== 'new') {
        await scene.unload().catch(() => undefined)
      }
      if (previous?.state === 'paused') previous.resume()
      this.fitToScreen()
      throw error
    }
  }

  private async popImmediate(): Promise<Scene | null> {
    const top = this.stack.pop()
    if (!top) return null

    if (top.root.parent === this.world) {
      this.world.removeChild(top.root)
    }

    const previous = this.current
    let firstError: unknown

    try {
      await top.unload()
    } catch (error) {
      firstError = error
    }

    try {
      previous?.resume()
    } catch (error) {
      firstError ??= error
    }
    this.fitToScreen()

    if (firstError) throw firstError
    return top
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation)
    this.transition = result.then(
      () => undefined,
      () => undefined
    )
    return result
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

  private tick = (): void => {
    this.fitToScreen()
    this.current?.tick(this.app.ticker.deltaMS)
  }
}
