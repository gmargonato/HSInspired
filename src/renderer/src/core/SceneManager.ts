import { Application, Container, Graphics } from 'pixi.js'
import { GAME_HEIGHT, GAME_WIDTH } from './config'
import { AnimationScope } from './animations'
import { Scene } from '../scenes/Scene'
import type { CursorManager } from './cursor'
import {
  DEFAULT_SCENE_EXPAND_DURATION,
  SceneTransitionHost
} from './SceneTransitionHost'
import type { TransitionRect, TransitionScaleMode } from './SceneTransitionHost'

const DEFAULT_SCENE_FADE_DURATION = 0.6

export interface SceneTransitionOptions {
  inset: TransitionRect
  /** Selects an inset expansion, inset collapse, or two-stage opacity fade. */
  mode?: 'expand' | 'collapse' | 'fade'
  scaleMode?: TransitionScaleMode
  overlayAlpha?: number
  duration?: number
  hostParent?: Container
  hostIndex?: number
  beforeExpand?: (
    host: SceneTransitionHost,
    previous: Scene,
    next: Scene
  ) => Promise<void> | void
  /** Runs after collapse while the outgoing scene is still inside the inset. */
  afterCollapse?: (
    host: SceneTransitionHost,
    previous: Scene,
    next: Scene
  ) => Promise<void> | void
  /**
   * Runs after the destination transition has completed, become active, and
   * the previous scene has been unloaded. Destination-specific reveals belong
   * here so they do not begin inside a transition preview or fade.
   */
  afterTransition?: (previous: Scene, next: Scene) => Promise<void> | void
}

export interface SceneManagerOptions {
  /** App-wide services that scenes may consume without owning their lifecycle. */
  cursor?: CursorManager
}

/** Owns the Pixi application and a serialized stack of full-screen scenes. */
export class SceneManager {
  readonly app: Application
  /** The future settings scene can call cursor?.setScale(value). */
  readonly cursor: CursorManager | null
  private readonly world = new Container()
  private readonly stack: Scene[] = []
  private transition: Promise<void> = Promise.resolve()
  private transitioningScene: Scene | null = null
  private started = false

  constructor(app: Application, options: SceneManagerOptions = {}) {
    this.app = app
    this.cursor = options.cursor ?? null
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

  async transitionTo(scene: Scene, options: SceneTransitionOptions): Promise<void> {
    return this.enqueue(async () => {
      if (!this.started) {
        throw new Error('SceneManager must be started before transitioning scenes')
      }
      if (options.mode === 'fade') {
        await this.fadeImmediate(scene, options)
      } else if (options.mode === 'collapse') {
        await this.collapseImmediate(scene, options)
      } else {
        await this.transitionImmediate(scene, options)
      }
    })
  }

  /**
   * Places the destination underneath the current scene, shrinks the current
   * scene into the configured inset, and then promotes the destination.
   */
  private async collapseImmediate(
    scene: Scene,
    options: SceneTransitionOptions
  ): Promise<void> {
    const previous = this.current
    if (!previous) {
      throw new Error('Cannot transition without a current scene')
    }

    const previousWorldIndex =
      previous.root.parent === this.world
        ? this.world.getChildIndex(previous.root)
        : this.world.children.length
    let loaded = false
    let host: SceneTransitionHost | null = null
    let committed = false
    this.transitioningScene = scene

    try {
      await scene.load(this.app, this)
      loaded = true

      this.world.addChildAt(
        scene.root,
        Math.min(Math.max(previousWorldIndex, 0), this.world.children.length)
      )

      host = new SceneTransitionHost(previous.root, {
        inset: options.inset,
        scaleMode: options.scaleMode,
        overlayAlpha: options.overlayAlpha,
        initialState: 'full'
      })

      const parent = options.hostParent ?? this.world
      if (options.hostIndex === undefined) {
        parent.addChild(host)
      } else {
        parent.addChildAt(
          host,
          Math.min(Math.max(options.hostIndex, 0), parent.children.length)
        )
      }

      this.fitToScreen()
      await host.collapse(options.duration ?? DEFAULT_SCENE_EXPAND_DURATION)
      await options.afterCollapse?.(host, previous, scene)

      host.dispose()
      host = null
      this.stack[this.stack.length - 1] = scene
      this.transitioningScene = null
      committed = true
      await previous.unload()
      this.fitToScreen()
      await this.runAfterTransition(options, previous, scene)
    } catch (error) {
      this.transitioningScene = null

      if (!committed) {
        host?.dispose()

        if (scene.root.parent === this.world) {
          this.world.removeChild(scene.root)
        }
        if (!previous.root.parent) {
          this.world.addChildAt(
            previous.root,
            Math.min(Math.max(previousWorldIndex, 0), this.world.children.length)
          )
        }

        if (loaded || scene.state !== 'new') {
          await scene.unload().catch(() => undefined)
        }
        this.fitToScreen()
      }

      throw error
    }
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
      await scene.load(this.app, this)
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

  private async transitionImmediate(
    scene: Scene,
    options: SceneTransitionOptions
  ): Promise<void> {
    const previous = this.current
    if (!previous) {
      throw new Error('Cannot transition without a current scene')
    }

    let loaded = false
    let host: SceneTransitionHost | null = null
    let committed = false
    this.transitioningScene = scene

    try {
      await scene.load(this.app, this)
      loaded = true

      host = new SceneTransitionHost(scene.root, {
        inset: options.inset,
        scaleMode: options.scaleMode,
        overlayAlpha: options.overlayAlpha
      })

      const parent = options.hostParent ?? this.world
      if (options.hostIndex === undefined) {
        parent.addChild(host)
      } else {
        parent.addChildAt(
          host,
          Math.min(Math.max(options.hostIndex, 0), parent.children.length)
        )
      }

      await options.beforeExpand?.(host, previous, scene)
      await host.expand(options.duration ?? DEFAULT_SCENE_EXPAND_DURATION)

      this.world.addChild(scene.root)
      this.stack[this.stack.length - 1] = scene
      this.transitioningScene = null
      host.dispose()
      committed = true
      await previous.unload()
      this.fitToScreen()
      await this.runAfterTransition(options, previous, scene)
    } catch (error) {
      this.transitioningScene = null

      if (!committed) {
        host?.dispose()

        if (loaded || scene.state !== 'new') {
          await scene.unload().catch(() => undefined)
        }
      }

      throw error
    }
  }

  /**
   * Performs a real two-stage fade: the current scene reaches black first,
   * then the destination is swapped in underneath the black overlay and is
   * faded back into view. This is intentionally separate from
   * SceneTransitionHost, whose overlay only fades the destination in.
   */
  private async fadeImmediate(
    scene: Scene,
    options: SceneTransitionOptions
  ): Promise<void> {
    const previous = this.current
    if (!previous) {
      throw new Error('Cannot transition without a current scene')
    }

    const fadeDuration = Math.max(0, options.duration ?? DEFAULT_SCENE_FADE_DURATION)
    const halfDuration = fadeDuration / 2
    let loaded = false
    let committed = false
    let overlay: Graphics | null = null
    this.transitioningScene = scene

    try {
      overlay = new Graphics()
      overlay.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 })
      overlay.alpha = 0
      // The overlay prevents the outgoing scene from receiving input while
      // the screen is fading out.
      overlay.eventMode = 'static'
      this.world.addChild(overlay)
      this.fitToScreen()

      await this.fadeOverlay(overlay, 1, halfDuration)

      await scene.load(this.app, this)
      loaded = true

      this.world.addChild(scene.root)
      // Adding the destination moves it above the overlay, so add the
      // overlay again to keep the scene hidden until the fade-back begins.
      this.world.addChild(overlay)
      this.stack[this.stack.length - 1] = scene
      this.transitioningScene = null
      committed = true
      await previous.unload()
      this.fitToScreen()

      await this.fadeOverlay(overlay, 0, halfDuration)
      this.removeFadeOverlay(overlay)
      overlay = null
      await this.runAfterTransition(options, previous, scene)
    } catch (error) {
      this.transitioningScene = null

      if (!committed && (loaded || scene.state !== 'new')) {
        await scene.unload().catch(() => undefined)
      }

      if (overlay) {
        this.removeFadeOverlay(overlay)
      }

      throw error
    }
  }

  private fadeOverlay(
    overlay: Graphics,
    alpha: number,
    duration: number
  ): Promise<void> {
    const animations = new AnimationScope()

    return new Promise<void>((resolve) => {
      const timeline = animations.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        overlay,
        {
          alpha,
          duration,
          ease: 'power2.inOut'
        },
        0
      )
    })
  }

  private removeFadeOverlay(overlay: Graphics): void {
    overlay.parent?.removeChild(overlay)
    overlay.destroy()
  }

  private async runAfterTransition(
    options: SceneTransitionOptions,
    previous: Scene,
    next: Scene
  ): Promise<void> {
    try {
      await options.afterTransition?.(previous, next)
    } catch (error) {
      // The destination is already committed and the source has been
      // unloaded, so rolling back would leave callers holding destroyed UI.
      // Keep navigation usable and report the destination reveal failure.
      console.error('Destination reveal failed after scene transition:', error)
    }
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
    if (this.transitioningScene && this.transitioningScene !== this.current) {
      this.transitioningScene.tick(this.app.ticker.deltaMS)
    }
  }
}
