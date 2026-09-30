import type { Renderer } from 'pixi.js'
import type { CardView } from '../../../visual-components/cards/card-view'
import {
  HandCardPerspective,
  type HandCardPerspectiveOptions
} from './hand-card-perspective'

/** Keeps the next pickup and the last held card ready, bounded to two presentations. */
export class HandCardPerspectivePool {
  private readonly entries = new Map<CardView, HandCardPerspective>()
  private active: HandCardPerspective | null = null
  private lastHeld: HandCardPerspective | null = null
  private disposed = false

  constructor(private readonly renderer: Renderer) {}

  prepare(card: CardView, options: HandCardPerspectiveOptions = {}): void {
    if (this.disposed || card.destroyed || !card.parent) return
    this.getOrPrepare(card, options)
  }

  acquire(
    card: CardView,
    options: HandCardPerspectiveOptions = {}
  ): HandCardPerspective {
    if (this.disposed)
      throw new Error('Cannot acquire a disposed hand presentation pool.')
    if (this.active) this.release(this.active)
    const presentation = this.getOrPrepare(card, options)
    if (!presentation)
      throw new Error('Cannot prepare a detached or destroyed hand card.')
    presentation.activate(options)
    this.active = presentation
    return presentation
  }

  release(presentation: HandCardPerspective): void {
    presentation.deactivate()
    if (this.active === presentation) this.active = null
    if (!presentation.isDestroyed) this.lastHeld = presentation
    this.prune()
  }

  flush(): void {
    this.prune()
    this.active?.flushSnapshot()
  }

  /** Called when a hand slot transfers ownership or replaces its card face. */
  invalidate(card: CardView): void {
    const presentation = this.entries.get(card)
    if (!presentation) return
    presentation.destroy()
    this.entries.delete(card)
    if (this.active === presentation) this.active = null
    if (this.lastHeld === presentation) this.lastHeld = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const presentation of this.entries.values()) presentation.destroy()
    this.entries.clear()
    this.active = null
    this.lastHeld = null
  }

  private prune(): void {
    for (const [card, presentation] of this.entries) {
      if (card.destroyed || presentation.isDestroyed) this.invalidate(card)
    }
  }

  private getOrPrepare(
    card: CardView,
    options: HandCardPerspectiveOptions
  ): HandCardPerspective | undefined {
    this.prune()
    if (card.destroyed || !card.parent) return undefined
    const existing = this.entries.get(card)
    if (existing?.isCompatible(options)) return existing
    if (existing === this.active) return existing
    if (existing) this.invalidate(card)
    if (this.entries.size >= 2) {
      const victim = [...this.entries].find(
        ([, value]) => value !== this.active && value !== this.lastHeld
      )
      if (!victim) return undefined
      this.invalidate(victim[0])
    }
    const presentation = new HandCardPerspective(this.renderer, card, options, false)
    this.entries.set(card, presentation)
    return presentation
  }
}
