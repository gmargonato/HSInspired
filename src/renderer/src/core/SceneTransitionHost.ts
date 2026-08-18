import { Container, Graphics } from 'pixi.js'
import { AnimationScope } from './animations'
import { GAME_HEIGHT, GAME_WIDTH } from './config'

export type TransitionScaleMode = 'cover' | 'contain'

export interface TransitionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SceneTransitionHostOptions {
  inset: TransitionRect
  scaleMode?: TransitionScaleMode
  overlayAlpha?: number
  initialState?: 'inset' | 'full'
}

export const DEFAULT_SCENE_EXPAND_DURATION = 0.45
export const DEFAULT_SCENE_OVERLAY_ALPHA = 0.85

export function calculateTransitionScale(
  inset: TransitionRect,
  mode: TransitionScaleMode = 'cover'
): number {
  const widthScale = inset.width / GAME_WIDTH
  const heightScale = inset.height / GAME_HEIGHT

  return mode === 'contain'
    ? Math.min(widthScale, heightScale)
    : Math.max(widthScale, heightScale)
}

type TransitionState = {
  scale: number
  clipX: number
  clipY: number
  clipWidth: number
  clipHeight: number
  overlayAlpha: number
}

/**
 * Presents a full-viewport scene through an inset expansion or collapse. The
 * scene root remains in its normal 1920x1080 coordinate space while the host
 * owns the presentation transform and mask.
 */
export class SceneTransitionHost extends Container {
  readonly sceneRoot: Container

  private readonly content: Container
  private readonly darkOverlay: Graphics
  private readonly clip: Graphics
  private readonly animations = new AnimationScope()
  private readonly state: TransitionState
  private readonly initialOverlayAlpha: number
  private readonly sceneEventMode: Container['eventMode']
  private inset: TransitionRect
  private insetScale: number
  private disposed = false

  constructor(sceneRoot: Container, options: SceneTransitionHostOptions) {
    super()

    this.sceneRoot = sceneRoot
    this.sceneEventMode = sceneRoot.eventMode
    this.inset = { ...options.inset }
    this.insetScale = calculateTransitionScale(options.inset, options.scaleMode)
    sceneRoot.eventMode = 'none'
    this.content = new Container()
    this.content.pivot.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.content.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.content.addChild(sceneRoot)
    this.addChild(this.content)

    this.initialOverlayAlpha = clampOverlayAlpha(
      options.overlayAlpha ?? DEFAULT_SCENE_OVERLAY_ALPHA
    )
    this.darkOverlay = new Graphics()
    this.darkOverlay.eventMode = 'none'
    this.darkOverlay.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 })
    this.addChild(this.darkOverlay)

    this.clip = new Graphics()
    this.clip.eventMode = 'none'
    this.addChild(this.clip)
    this.mask = this.clip

    this.state = {
      scale: 1,
      clipX: 0,
      clipY: 0,
      clipWidth: GAME_WIDTH,
      clipHeight: GAME_HEIGHT,
      overlayAlpha: this.initialOverlayAlpha
    }

    if (options.initialState === 'full') {
      this.setFullViewport()
    } else {
      this.setInset(options.inset, options.scaleMode)
    }
  }

  setInset(inset: TransitionRect, mode: TransitionScaleMode = 'cover'): void {
    this.inset = { ...inset }
    this.insetScale = calculateTransitionScale(inset, mode)
    this.state.scale = this.insetScale
    this.state.clipX = inset.x
    this.state.clipY = inset.y
    this.state.clipWidth = inset.width
    this.state.clipHeight = inset.height
    this.state.overlayAlpha = this.initialOverlayAlpha
    this.applyState()
  }

  setFullViewport(): void {
    this.state.scale = 1
    this.state.clipX = 0
    this.state.clipY = 0
    this.state.clipWidth = GAME_WIDTH
    this.state.clipHeight = GAME_HEIGHT
    this.state.overlayAlpha = 0
    this.applyState()
  }

  expand(duration = DEFAULT_SCENE_EXPAND_DURATION): Promise<void> {
    if (this.disposed) return Promise.resolve()

    return new Promise<void>((resolve) => {
      const timeline = this.animations.timeline({
        onComplete: () => {
          this.restoreSceneInteractivity()
          resolve()
        },
        onInterrupt: () => {
          this.restoreSceneInteractivity()
          resolve()
        }
      })

      timeline.to(
        this.state,
        {
          scale: 1,
          clipX: 0,
          clipY: 0,
          clipWidth: GAME_WIDTH,
          clipHeight: GAME_HEIGHT,
          overlayAlpha: 0,
          duration,
          ease: 'power2.out',
          onUpdate: () => this.applyState()
        },
        0
      )
    })
  }

  /** Shrinks a full-viewport scene back into the configured inset. */
  collapse(duration = DEFAULT_SCENE_EXPAND_DURATION): Promise<void> {
    if (this.disposed) return Promise.resolve()

    return new Promise<void>((resolve) => {
      const timeline = this.animations.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        this.state,
        {
          scale: this.insetScale,
          clipX: this.inset.x,
          clipY: this.inset.y,
          clipWidth: this.inset.width,
          clipHeight: this.inset.height,
          overlayAlpha: this.initialOverlayAlpha,
          duration,
          ease: 'power2.in',
          onUpdate: () => this.applyState()
        },
        0
      )
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.animations.kill()
    this.restoreSceneInteractivity()
    this.detachSceneRoot()
    this.mask = null
    this.parent?.removeChild(this)
    this.destroy({ children: true })
  }

  private detachSceneRoot(): void {
    if (this.sceneRoot.parent === this.content) {
      this.content.removeChild(this.sceneRoot)
    }
  }

  private restoreSceneInteractivity(): void {
    this.sceneRoot.eventMode = this.sceneEventMode
  }

  private applyState(): void {
    this.content.scale.set(this.state.scale)
    this.darkOverlay.alpha = this.state.overlayAlpha
    this.clip
      .clear()
      .rect(
        this.state.clipX,
        this.state.clipY,
        this.state.clipWidth,
        this.state.clipHeight
      )
      .fill({ color: 0xffffff })
  }
}

function clampOverlayAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha))
}
