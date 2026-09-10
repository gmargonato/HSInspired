import {
  Container,
  Rectangle,
  type FederatedPointerEvent,
  type Renderer
} from 'pixi.js'
import { gsap, type AnimationScope } from '../../animation/animations'
import type { CursorManager } from '../../ui/components/cursor'
import type { GameCardSlot } from './game-card-slot'
import type { HandEntry } from './game-hand-entry'
import {
  DEFAULT_HAND_LAYOUT,
  type HandCardTransform,
  type HandPointer,
  handHoverHitBounds,
  layoutHand,
  resolveHandHover
} from './hand-layout'
import { isHandOwnedSlot } from './hand-play-gesture'
import { GameHandDrag } from './game-hand-drag'
import { OPENING_TIMING, RESOLUTION_TIMING } from './game-presentation-timing'
import { completeTimeline } from './game-presentation-animation'

interface HandCallbacks {
  beginTargetGesture(entry: HandEntry, pointer: HandPointer, pointerId: number): void
  tryTarget(entry: HandEntry, pointer: HandPointer, pointerId: number): boolean
  updateBoardPreview(pointer: HandPointer): void
  clearBoardPreview(): void
  syncMana(): void
  onReturned(): void
  onPointerDown(event: FederatedPointerEvent): void
  isHoverBlocked(): boolean
  allowsHandHit(x: number, y: number): boolean
  activateWindowInput(): void
}

interface HandCardTransport {
  hasDrawOrigin(slot: GameCardSlot): boolean
  departDeck(slot: GameCardSlot, duration: number, delay: number): Promise<void>
}

/** Owns hand membership, resting/hover presentation, input listeners, and held-card resources.
 * Removing an entry transfers its slot to the caller's outgoing presentation.
 */
export class GameHandView {
  readonly layer = new Container()
  readonly drag: GameHandDrag
  private readonly handEntries: HandEntry[] = []
  private localHoveredSlot: GameCardSlot | null = null
  private reflowing = false
  private handModeActive = false

  constructor(
    renderer: Renderer,
    private readonly animations: Pick<AnimationScope, 'kill' | 'to' | 'timeline'>,
    private readonly callbacks: HandCallbacks,
    private readonly transport: HandCardTransport,
    cursor?: CursorManager | null
  ) {
    this.layer.eventMode = 'none'
    this.layer.sortableChildren = true
    this.drag = new GameHandDrag(
      this.layer,
      renderer,
      animations,
      {
        entryAt: (index) => this.handEntries[index],
        entryFor: (slot) => this.handEntries.find((entry) => entry.slot === slot),
        beginTargetGesture: callbacks.beginTargetGesture,
        tryTarget: callbacks.tryTarget,
        updateBoardPreview: callbacks.updateBoardPreview,
        clearBoardPreview: callbacks.clearBoardPreview,
        syncMana: callbacks.syncMana,
        onReturned: callbacks.onReturned,
        clearHover: () => {
          this.localHoveredSlot = null
        },
        beginReflow: () => {
          this.reflowing = true
        },
        returnToHand: (slot, transform, delay, positionDuration, scaleDuration) =>
          this.animateSlotToHand(
            slot,
            transform,
            delay,
            positionDuration,
            scaleDuration
          )
      },
      cursor
    )
  }

  get entries(): readonly HandEntry[] {
    return this.handEntries
  }
  get hoveredSlot(): GameCardSlot | null {
    return this.localHoveredSlot
  }
  get isReflowing(): boolean {
    return this.reflowing
  }
  get active(): boolean {
    return this.handModeActive
  }

  append(entry: HandEntry): void {
    this.handEntries.push(entry)
  }
  removeAt(index: number): HandEntry | undefined {
    return this.handEntries.splice(index, 1)[0]
  }
  takeLast(): HandEntry | undefined {
    return this.handEntries.pop()
  }
  setReflowing(value: boolean): void {
    this.reflowing = value
  }
  resetHover(): void {
    this.localHoveredSlot = null
  }
  hoverForBenchmark(slot: GameCardSlot): void {
    this.localHoveredSlot = slot
  }

  dispose(): void {
    this.drag.dispose()
    for (const entry of this.handEntries) entry.slot.disposePlayableOutline()
    this.layer.destroy({ children: true })
  }

  clearHover(): void {
    if (this.localHoveredSlot === null) return
    this.localHoveredSlot = null
    if (this.drag.index === null) this.applyHoverDelta()
  }

  activate(): void {
    if (this.handModeActive) return
    this.handModeActive = true
    this.layer.eventMode = 'static'
    this.callbacks.activateWindowInput()
    const bounds = handHoverHitBounds(DEFAULT_HAND_LAYOUT)
    const handRect = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
    // The fixed hand zone sits above board controls in the display tree. A
    // resting hand area owns card input; elsewhere, holes
    // expose only board objects that can currently accept pointer input.
    this.layer.hitArea = {
      contains: (x: number, y: number): boolean => {
        if (!handRect.contains(x, y)) return false

        const resolved = resolveHandHover(
          { x, y },
          this.handEntries.map((entry) => entry.restTransform),
          DEFAULT_HAND_LAYOUT
        )
        const entry = resolved !== null ? this.handEntries[resolved] : undefined
        if (entry && isHandOwnedSlot(entry.slot, this.layer)) return true

        return this.callbacks.allowsHandHit(x, y)
      }
    } as unknown as Rectangle
    this.layer.on('pointermove', (event: FederatedPointerEvent) => {
      if (!this.handModeActive || this.reflowing || this.callbacks.isHoverBlocked())
        return
      const local = event.getLocalPosition(this.layer)
      if (this.drag.index !== null) return
      // Include arriving slots in the fan geometry, but only let cards that
      // have reached the hand own hover. Missing edge transforms would make
      // the hit resolver reject the entire fan during a draw.
      const transforms = this.handEntries.map((entry) => entry.restTransform)
      const resolved = resolveHandHover(local, transforms, DEFAULT_HAND_LAYOUT)
      const candidate =
        resolved !== null ? (this.handEntries[resolved]?.slot ?? null) : null
      const nearest =
        candidate && isHandOwnedSlot(candidate, this.layer) ? candidate : null
      if (nearest === this.localHoveredSlot) return
      this.localHoveredSlot = nearest
      this.applyHoverDelta()
    })
    this.layer.on('pointerleave', () => {
      if (!this.handModeActive || this.drag.index !== null) return
      this.localHoveredSlot = null
      this.applyHoverDelta()
    })
    this.layer.on('pointerdown', (event: FederatedPointerEvent) => {
      this.callbacks.onPointerDown(event)
    })
    this.drag.activate()
  }

  async applyLayout(opts: {
    readonly positionDuration: number
    readonly scaleDuration: number
    readonly delayedInstanceId?: string
    readonly preserveHover?: boolean
  }): Promise<void> {
    const transforms = layoutHand(this.handEntries.length, DEFAULT_HAND_LAYOUT, null)
    await Promise.all(
      this.handEntries.map((entry, index) => {
        const transform = transforms[index]
        if (!transform) return Promise.resolve()
        entry.restTransform = transform
        if (opts.preserveHover && entry.card.instanceId !== opts.delayedInstanceId) {
          // Existing cards remain hoverable while the incoming card travels.
          // Use interruptible tweens instead of a layout timeline so changing
          // hover cannot fight the reflow or delay completion of the draw.
          if (!isHandOwnedSlot(entry.slot, this.layer) || this.drag.index === index)
            return Promise.resolve()
          const hoveredIndex = entry.slot === this.localHoveredSlot ? index : -1
          entry.displaced = hoveredIndex >= 0
          this.animateHoverTarget(
            entry.slot,
            this.computeHoverTarget(transform, index, hoveredIndex),
            entry.displaced,
            opts.positionDuration,
            opts.scaleDuration
          )
          return Promise.resolve()
        }
        entry.displaced = false
        const delay =
          opts.delayedInstanceId !== undefined &&
          entry.card.instanceId === opts.delayedInstanceId
            ? RESOLUTION_TIMING.generatedCardDelay
            : 0
        return this.animateSlotToHand(
          entry.slot,
          transform,
          delay,
          opts.positionDuration,
          opts.scaleDuration
        )
      })
    )
  }

  applyHoverDelta(): void {
    const hoveredIndex = this.localHoveredSlot
      ? this.handEntries.findIndex((entry) => entry.slot === this.localHoveredSlot)
      : -1

    this.handEntries.forEach((entry, index) => {
      if (!isHandOwnedSlot(entry.slot, this.layer)) {
        entry.displaced = false
        return
      }
      if (!entry.restTransform) return
      const shouldDisplace = hoveredIndex >= 0 && index === hoveredIndex
      if (!shouldDisplace && !entry.displaced) return
      if (shouldDisplace && entry.displaced) return
      const target = this.computeHoverTarget(entry.restTransform, index, hoveredIndex)
      if (shouldDisplace) {
        // Appear enlarged just below the final hover position, then settle upward.
        entry.slot.position.set(
          target.x,
          target.y + DEFAULT_HAND_LAYOUT.hoverSettleDistance
        )
        entry.slot.rotation = target.rotation
      }
      this.animateHoverTarget(
        entry.slot,
        target,
        shouldDisplace,
        shouldDisplace ? OPENING_TIMING.hoverSettle : OPENING_TIMING.hover
      )
      entry.displaced = shouldDisplace
    })
    this.callbacks.syncMana()
  }

  private computeHoverTarget(
    rest: HandCardTransform,
    index: number,
    hoveredIndex: number
  ): HandCardTransform {
    if (hoveredIndex < 0 || index !== hoveredIndex) return rest
    return {
      x: rest.x,
      y: rest.y - DEFAULT_HAND_LAYOUT.hoverLift,
      rotation: 0,
      scale: DEFAULT_HAND_LAYOUT.hoverScale,
      zIndex: 1000
    }
  }

  private animateHoverTarget(
    slot: GameCardSlot,
    target: HandCardTransform,
    isHovered: boolean,
    positionDuration = isHovered ? 0 : OPENING_TIMING.hover,
    scaleDuration = isHovered ? 0 : OPENING_TIMING.hover
  ): void {
    // Also cancel reflow tweens that have not started yet; overwrite:auto
    // only resolves active conflicts and can otherwise lower a new hover.
    gsap.killTweensOf(slot, 'x,y,rotation')
    gsap.killTweensOf(slot.scale, 'x,y')
    this.animations.to(slot, {
      x: target.x,
      y: target.y,
      rotation: target.rotation,
      duration: positionDuration,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    this.animations.to(slot.scale, {
      x: target.scale,
      y: target.scale,
      duration: scaleDuration,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    slot.zIndex = target.zIndex
  }

  animateSlotToHand(
    slot: GameCardSlot,
    transform: HandCardTransform,
    delay: number,
    positionDuration: number,
    scaleDuration: number
  ): Promise<void> {
    gsap.killTweensOf(slot)
    gsap.killTweensOf(slot.scale)
    gsap.killTweensOf(slot.skew)

    if (this.transport.hasDrawOrigin(slot)) {
      slot.position.set(transform.x, transform.y)
      slot.rotation = transform.rotation
      slot.scale.set(transform.scale)
      slot.skew.set(0, 0)
      slot.zIndex = transform.zIndex
      return this.transport.departDeck(
        slot,
        Math.max(positionDuration, scaleDuration),
        delay
      )
    }

    const timeline = this.animations.timeline()
    timeline.to(slot, {
      x: transform.x,
      y: transform.y,
      rotation: transform.rotation,
      alpha: 1,
      duration: positionDuration,
      delay,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: transform.scale,
        y: transform.scale,
        duration: scaleDuration,
        delay,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration: positionDuration,
        delay,
        ease: 'power2.out'
      },
      0
    )
    slot.zIndex = transform.zIndex
    return completeTimeline(timeline)
  }

  configureSlot(slot: GameCardSlot): void {
    if (!import.meta.env.DEV || import.meta.env.VITE_MATCH_OUTLINE_MODE !== 'live') {
      slot.enableBakedPlayableOutline(DEFAULT_HAND_LAYOUT.cardScale)
    }
    slot.setMulliganInteractionEnabled(false)
    slot.removeAllListeners('pointertap')
    slot.removeAllListeners('pointerover')
    slot.removeAllListeners('pointerout')
  }
}
