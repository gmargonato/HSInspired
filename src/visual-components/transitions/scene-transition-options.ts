import type { Container } from 'pixi.js'
import type { Scene } from '../lifecycle/scene'
import type {
  SceneTransitionHost,
  TransitionRect,
  TransitionScaleMode
} from './scene-transition-host'

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
