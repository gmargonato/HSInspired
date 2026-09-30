import { Application, Container } from 'pixi.js'
import { AnimationScope } from '../animation/animations'
import { AssetScope } from '../assets/asset-scope'
import type { SceneManagerPort } from '../../application/contracts/scene-manager-port'

export type SceneLifecycle =
  'new' | 'loading' | 'active' | 'paused' | 'failed' | 'unloading' | 'unloaded'

interface AnimationOwner {
  pauseAnimations(): void
  resumeAnimations(): void
  killAnimations(): void
}

function isAnimationOwner(value: Container): value is Container & AnimationOwner {
  const candidate = value as Partial<AnimationOwner>
  return (
    typeof candidate.pauseAnimations === 'function' &&
    typeof candidate.resumeAnimations === 'function' &&
    typeof candidate.killAnimations === 'function'
  )
}

/**
 * Base class for every scene, both full-screen scenes and nested sub-scenes.
 * A scene owns its root container, child scenes, assets, and animations.
 */
export abstract class Scene {
  readonly root: Container = new Container()

  private app: Application | null = null
  private manager: SceneManagerPort | null = null
  private subScenes: Scene[] = []
  private active = false
  private lifecycle: SceneLifecycle = 'new'
  private rootDestroyed = false
  private readonly animationScope = new AnimationScope()
  protected readonly assetScope = new AssetScope()

  abstract init(): Promise<void> | void
  abstract update(deltaMS: number): void

  get state(): SceneLifecycle {
    return this.lifecycle
  }

  get isLoaded(): boolean {
    return this.lifecycle === 'active' || this.lifecycle === 'paused'
  }

  async load(app: Application, manager?: SceneManagerPort): Promise<void> {
    if (this.lifecycle !== 'new') {
      throw new Error(`Cannot load a scene from the ${this.lifecycle} state`)
    }

    this.app = app
    this.manager = manager ?? null
    this.lifecycle = 'loading'

    try {
      await this.init()
      this.active = true
      this.lifecycle = 'active'
      this.onEnter()
    } catch (error) {
      this.active = false
      this.lifecycle = 'failed'
      await this.releaseResources().catch(() => undefined)
      throw error
    }
  }

  async unload(): Promise<void> {
    if (this.lifecycle === 'new' || this.lifecycle === 'unloaded') return
    if (this.lifecycle === 'unloading') return

    const shouldExit = this.lifecycle === 'active' || this.lifecycle === 'paused'
    let firstError: unknown
    this.active = false
    this.lifecycle = 'unloading'

    try {
      if (shouldExit) this.onExit()
    } catch (error) {
      firstError = error
    }

    try {
      await this.releaseResources()
    } catch (error) {
      firstError ??= error
    } finally {
      this.active = false
      this.app = null
      this.manager = null
      this.lifecycle = 'unloaded'
    }

    if (firstError) throw firstError
  }

  pause(): void {
    if (this.lifecycle !== 'active') return

    this.active = false
    this.lifecycle = 'paused'
    let firstError: unknown

    try {
      this.onPause()
    } catch (error) {
      firstError = error
    }

    try {
      this.pauseAnimations()
    } catch (error) {
      firstError ??= error
    }

    for (const scene of this.subScenes) {
      try {
        scene.pause()
      } catch (error) {
        firstError ??= error
      }
    }

    if (firstError !== undefined) throw firstError
  }

  resume(): void {
    if (this.lifecycle !== 'paused') return

    this.active = true
    this.lifecycle = 'active'
    let firstError: unknown

    try {
      this.onResume()
    } catch (error) {
      firstError = error
    }

    try {
      this.resumeAnimations()
    } catch (error) {
      firstError ??= error
    }

    for (const scene of this.subScenes) {
      try {
        scene.resume()
      } catch (error) {
        firstError ??= error
      }
    }

    if (firstError !== undefined) throw firstError
  }

  tick(deltaMS: number): void {
    if (!this.active) return

    this.update(deltaMS)
    for (const scene of this.subScenes) {
      scene.tick(deltaMS)
    }
  }

  protected get appInstance(): Application {
    if (!this.app) {
      throw new Error('Scene accessed app before load()')
    }
    return this.app
  }

  protected get sceneManager(): SceneManagerPort {
    if (!this.manager) {
      throw new Error('Scene accessed SceneManager before load()')
    }
    return this.manager
  }

  protected tweenTo(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    return this.animationScope.to(target, vars)
  }

  protected timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
    return this.animationScope.timeline(vars)
  }

  protected killTweensOf(target: gsap.TweenTarget): void {
    this.animationScope.kill(target)
  }

  protected onEnter(): void {}
  protected onExit(): void {}
  protected onPause(): void {}
  protected onResume(): void {}

  async addSubScene(scene: Scene, index?: number): Promise<void> {
    await scene.load(this.appInstance, this.manager ?? undefined)
    this.attachSubScene(scene, index)
  }

  /**
   * Attaches a scene that has already been loaded. This is useful when a
   * caller wants to preload assets before making a sub-scene visible.
   */
  attachSubScene(scene: Scene, index?: number): void {
    if (!scene.isLoaded) {
      throw new Error('Cannot attach a scene before it has loaded')
    }
    if (this.subScenes.includes(scene)) {
      throw new Error('Scene is already attached')
    }

    this.subScenes.push(scene)
    if (index === undefined) {
      this.root.addChild(scene.root)
    } else {
      this.root.addChildAt(scene.root, index)
    }

    if (this.lifecycle === 'paused') {
      scene.pause()
    }
  }

  async removeSubScene(scene: Scene): Promise<void> {
    const index = this.subScenes.indexOf(scene)
    if (index === -1) return

    this.subScenes.splice(index, 1)
    this.root.removeChild(scene.root)
    await scene.unload()
  }

  private async releaseResources(): Promise<void> {
    let firstError: unknown

    for (const scene of this.subScenes) {
      try {
        await scene.unload()
      } catch (error) {
        firstError ??= error
      }
    }
    this.subScenes.length = 0

    try {
      this.killAnimations()
    } catch (error) {
      firstError ??= error
    }

    if (!this.rootDestroyed) {
      try {
        this.root.destroy({ children: true })
        this.rootDestroyed = true
      } catch (error) {
        firstError ??= error
      }
    }

    try {
      await this.assetScope.releaseAll()
    } catch (error) {
      firstError ??= error
    }

    if (firstError !== undefined) throw firstError
  }

  private forEachAnimationOwner(callback: (owner: AnimationOwner) => void): void {
    const visit = (object: Container): void => {
      if (isAnimationOwner(object)) callback(object)
      for (const child of object.children) {
        if (child instanceof Container) visit(child)
      }
    }

    visit(this.root)
  }

  private pauseAnimations(): void {
    this.animationScope.pause()
    this.forEachAnimationOwner((owner) => owner.pauseAnimations())
  }

  private resumeAnimations(): void {
    this.animationScope.resume()
    this.forEachAnimationOwner((owner) => owner.resumeAnimations())
  }

  private killAnimations(): void {
    this.animationScope.kill()
    this.forEachAnimationOwner((owner) => owner.killAnimations())
  }
}
