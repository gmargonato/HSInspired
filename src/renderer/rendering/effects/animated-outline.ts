import type { Container, Rectangle, Texture } from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import { AuraFilter } from './aura-filter'
import {
  getOutlineTuning,
  OUTLINE_PALETTES,
  type OutlinePalette,
  type OutlinePaletteName,
  type OutlinePresetName,
  type OutlineTuning
} from './outline-tuning'
export { OUTLINE_PALETTES } from './outline-tuning'
export type {
  OutlinePalette,
  OutlinePaletteName,
  OutlinePresetName,
  OutlineTuning
} from './outline-tuning'
export type OutlinePaletteInput = OutlinePaletteName | OutlinePalette
export interface AnimatedOutlineOptions {
  readonly palette?: OutlinePaletteInput
  readonly preset?: OutlinePresetName
  /** Silhouette distance fields are always cached for Aura. */
  readonly cacheDistance?: boolean
  /** Original silhouette and its rectangle inside a padded perspective mesh. */
  readonly silhouette?: { readonly texture: Texture; readonly bounds: Rectangle }
}
const startTime = performance.now()
/** Metaball V5 Aura. The existing outline interface keeps callers small. */
export class AnimatedOutline extends Actor {
  private static readonly debugInstances = new Set<AnimatedOutline>()
  private static debugSuppressed = false
  private debugRenderable: boolean | null = null
  private readonly filter: AuraFilter
  private enabled = true
  private readonly clock = { value: 0 }
  private readonly timeTween: gsap.core.Tween
  static setDebugSuppressed(suppressed: boolean): void {
    if (!import.meta.env.DEV) return
    this.debugSuppressed = suppressed
    for (const outline of this.debugInstances) outline.syncDebugSuppression()
  }
  constructor(
    private readonly target: Container,
    options: AnimatedOutlineOptions = {}
  ) {
    super()
    this.label = 'aura-shader'
    this.filter = new AuraFilter(target, options.silhouette)
    this.setTuning(getOutlineTuning(options.preset ?? 'button'))
    this.setPalette(options.palette ?? 'blue')
    target.filters = [...(target.filters ?? []), this.filter]
    this.timeTween = this.tweenTo(this.clock, {
      value: 1,
      duration: 1,
      ease: 'none',
      repeat: -1,
      onUpdate: () => {
        this.filter.auraUniforms.uniforms.uTime = (performance.now() - startTime) / 1000
        this.filter.syncPadding()
      }
    })
    if (import.meta.env.DEV) {
      AnimatedOutline.debugInstances.add(this)
      this.syncDebugSuppression()
    }
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.target.visible = enabled
    if (enabled) {
      this.filter.syncPadding()
      this.timeTween.resume()
    } else this.timeTween.pause()
  }
  isEnabled(): boolean {
    return this.enabled
  }
  setPalette(palette: OutlinePaletteInput): void {
    this.filter.setPalette(
      typeof palette === 'string' ? OUTLINE_PALETTES[palette] : palette
    )
  }
  setPreset(preset: OutlinePresetName): void {
    this.setTuning(getOutlineTuning(preset))
  }
  setTuning(tuning: OutlineTuning): void {
    this.filter.setTuning(tuning)
  }
  getPadding(): number {
    return this.filter.padding
  }
  setAnimationTime(time: number): void {
    this.timeTween.pause()
    this.filter.auraUniforms.uniforms.uTime = time
  }
  override dispose(): void {
    AnimatedOutline.debugInstances.delete(this)
    if (!this.target.destroyed) {
      if (this.debugRenderable !== null) this.target.renderable = this.debugRenderable
      this.target.filters = (this.target.filters ?? []).filter(
        (filter) => filter !== this.filter
      )
    }
    this.filter.destroy()
    super.dispose()
  }
  private syncDebugSuppression(): void {
    if (AnimatedOutline.debugSuppressed) {
      this.debugRenderable ??= this.target.renderable
      this.target.renderable = false
    } else if (this.debugRenderable !== null) {
      this.target.renderable = this.debugRenderable
      this.debugRenderable = null
    }
  }
}
export { AnimatedOutline as Aura }
