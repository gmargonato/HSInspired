import { ColorMatrixFilter, type Container } from 'pixi.js'
import { gsap } from '../../animation/animations'

export const PREMIUM_ARTWORK_BREATH_SECONDS = 3

export function isArtworkVisible(target: Container): boolean {
  if (!target.parent) return false
  for (let node: Container | null = target; node; node = node.parent) {
    if (!node.visible || !node.renderable) return false
    // Cached ancestors display a frozen snapshot, including the Collection behind a modal.
    if (node.isCachedAsTexture) return false
  }
  return true
}

/** One artwork-only color pass, paused while neither the art nor its snapshots are visible. */
export class PremiumArtworkBreath {
  private filter: ColorMatrixFilter | null = null
  private enabled = false
  private elapsed = 0

  constructor(
    private readonly artwork: Container,
    private readonly isVisible: () => boolean = () => isArtworkVisible(artwork),
    private readonly onUpdate: () => void = () => undefined
  ) {}

  private readonly tick = (_time: number, deltaMS: number): void => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (!this.isVisible()) return
    this.elapsed =
      (this.elapsed + Math.min(deltaMS, 100) / 1000) % PREMIUM_ARTWORK_BREATH_SECONDS
    // Pixi's saturation amount is additive: 0 = 100%, 1 = 200%.
    const amount =
      (1 - Math.cos((this.elapsed * Math.PI * 2) / PREMIUM_ARTWORK_BREATH_SECONDS)) / 2
    this.filter?.saturate(amount, false)
    this.onUpdate()
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.elapsed = 0
    this.filter?.reset()
    if (enabled) {
      this.filter ??= new ColorMatrixFilter()
      this.filter.resolution = 'inherit'
      this.artwork.filters = [...(this.artwork.filters ?? []), this.filter]
      gsap.ticker.add(this.tick)
    } else {
      gsap.ticker.remove(this.tick)
      this.artwork.filters = (this.artwork.filters ?? []).filter(
        (filter) => filter !== this.filter
      )
    }
  }

  destroy(): void {
    this.setEnabled(false)
    this.filter?.destroy()
    this.filter = null
  }
}
