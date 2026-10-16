import {
  Container,
  Rectangle,
  type FederatedPointerEvent,
  type Renderer
} from 'pixi.js'
import {
  gsap,
  type AnimationScope
} from '../../../visual-components/animation/animations'
import type { CursorManager } from '../../../visual-components/controls/cursor'
import type { GameCardSlot } from './game-card-slot'
import type { HandEntry } from './game-hand-entry'
import {
  DEFAULT_HAND_LAYOUT,
  type HandCardTransform,
  type HandPointer,
  handHoverHitBounds,
  handHoverTarget,
  layoutHand,
  resolveHandHover
} from './hand-layout'
import { isHandOwnedSlot } from './hand-play-gesture'
import { GameHandDrag } from './game-hand-drag'
import {
  HAND_FOCUS_TIMING,
  handEaseOutExpo,
  RESOLUTION_TIMING
} from '../presentation/game-presentation-timing'
import { completeTimeline } from '../presentation/game-presentation-animation'
import { MATCH_SHADOW_CONFIG } from '../board/match-shadow-config'
import { ACTIVE_HAND_CARD_DEPTH } from '../match-layers'

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
  private cachedRestTransforms: readonly (HandCardTransform | undefined)[] | null = null
  private localHoveredSlot: GameCardSlot | null = null
  private reflowing = false
  private handModeActive = false
  private hoverPointer: HandPointer | null = null
  private hoverRefreshPending = true

  constructor(
    private readonly renderer: Renderer,
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
          this.resetHover()
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
  get restTransforms(): readonly (HandCardTransform | undefined)[] {
    return (this.cachedRestTransforms ??= this.handEntries.map(
      (entry) => entry.restTransform
    ))
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
    this.cachedRestTransforms = null
  }
  insert(index: number, entry: HandEntry): void {
    this.handEntries.splice(index, 0, entry)
    this.cachedRestTransforms = null
  }
  removeAt(index: number): HandEntry | undefined {
    this.cachedRestTransforms = null
    const entry = this.handEntries.splice(index, 1)[0]
    if (entry) this.drag.invalidate(entry.slot)
    return entry
  }
  takeLast(): HandEntry | undefined {
    this.cachedRestTransforms = null
    const entry = this.handEntries.pop()
    if (entry) this.drag.invalidate(entry.slot)
    return entry
  }
  setReflowing(value: boolean): void {
    this.reflowing = value
    this.hoverRefreshPending = true
  }
  resetHover(): void {
    this.localHoveredSlot = null
    this.drag.prepare(null)
    this.hoverRefreshPending = true
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
    this.hoverRefreshPending = true
    if (this.localHoveredSlot === null) return
    this.localHoveredSlot = null
    this.drag.prepare(null)
    if (this.drag.index === null) this.applyHoverDelta()
  }

  activate(): void {
    if (this.handModeActive) return
    this.handModeActive = true
    this.layer.eventMode = 'static'
    this.callbacks.activateWindowInput()
    const bounds = handHoverHitBounds(DEFAULT_HAND_LAYOUT)
    const handRect = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
    // Product decision: hover and pickup are limited to the resting hand zone.
    // Enlarging a card changes its appearance, never its interactive area.
    // The fixed hand zone sits above board controls in the display tree. A
    // resting hand area owns card input; elsewhere, holes
    // expose only board objects that can currently accept pointer input.
    this.layer.hitArea = {
      contains: (x: number, y: number): boolean => {
        if (!handRect.contains(x, y)) return false

        const resolved = resolveHandHover(
          { x, y },
          this.restTransforms,
          DEFAULT_HAND_LAYOUT
        )
        const entry = resolved !== null ? this.handEntries[resolved] : undefined
        if (entry && isHandOwnedSlot(entry.slot, this.layer)) return true

        return this.callbacks.allowsHandHit(x, y)
      }
    } as unknown as Rectangle
    this.layer.on('pointermove', (event: FederatedPointerEvent) => {
      const local = event.getLocalPosition(this.layer)
      this.hoverPointer = { x: local.x, y: local.y }
      this.hoverRefreshPending = true
      if (this.isHoverBlocked()) return
      this.drag.deferPreparation()
      this.resolveHover(local)
    })
    this.layer.on('pointerleave', () => {
      this.hoverPointer = null
      this.hoverRefreshPending = true
      if (!this.handModeActive || this.drag.index !== null) return
      this.localHoveredSlot = null
      this.applyHoverDelta()
    })
    this.layer.on('pointerdown', (event: FederatedPointerEvent) => {
      this.callbacks.onPointerDown(event)
    })
    this.drag.activate()
    this.drag.prepare(
      this.handEntries.find((entry) => isHandOwnedSlot(entry.slot, this.layer))?.slot ??
        null,
      true
    )
  }

  private isHoverBlocked(): boolean {
    return (
      !this.handModeActive ||
      this.layer.eventMode === 'none' ||
      this.reflowing ||
      this.callbacks.isHoverBlocked() ||
      this.drag.index !== null
    )
  }

  /** Restore stationary-pointer inspection after targeting, reflow, or drag ends. */
  refreshHover(): void {
    if (this.isHoverBlocked()) {
      this.hoverRefreshPending = true
      return
    }
    if (!this.hoverRefreshPending) return
    let pointer = this.hoverPointer
    const events = this.renderer.events
    if (events) {
      const global = events.pointer.global
      pointer = this.layer.toLocal(global)
      // Re-test the actual input target: a modal can cover a stationary pointer.
      let target: Container | null = events.rootBoundary.hitTest(global.x, global.y)
      while (target && target !== this.layer) target = target.parent
      if (!target) {
        this.clearHover()
        // Retry while an overlay covers the hand, but not outside the hand zone.
        this.hoverRefreshPending =
          this.layer.hitArea?.contains(pointer.x, pointer.y) === true
        return
      }
    }
    if (pointer) this.resolveHover(pointer)
    else this.hoverRefreshPending = false
  }

  private resolveHover(pointer: HandPointer): void {
    this.hoverRefreshPending = false
    // Arriving cards contribute geometry, but only hand-owned cards can hover.
    const resolved = resolveHandHover(pointer, this.restTransforms, DEFAULT_HAND_LAYOUT)
    const candidate =
      resolved !== null ? (this.handEntries[resolved]?.slot ?? null) : null
    const nearest =
      candidate && isHandOwnedSlot(candidate, this.layer) ? candidate : null
    if (nearest === this.localHoveredSlot) return
    this.localHoveredSlot = nearest
    this.applyHoverDelta()
  }

  async applyLayout(opts: {
    readonly positionDuration: number
    readonly scaleDuration: number
    readonly delayedInstanceId?: string
    readonly preserveHover?: boolean
  }): Promise<void> {
    const transforms = layoutHand(this.handEntries.length, DEFAULT_HAND_LAYOUT)
    this.cachedRestTransforms = transforms
    this.hoverRefreshPending = true
    await Promise.all(
      this.handEntries.map((entry, index) => {
        if (this.drag.isAwaitingPresentation(entry.slot)) return Promise.resolve()
        const transform = transforms[index]
        if (!transform) return Promise.resolve()
        entry.restTransform = transform
        entry.slot.shadow.restingScale = transform.scale
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
      // Focus snaps scale/rotation and vertical pose before moving. Keep the
      // currently displayed X, including when focus interrupts a hand reflow.
      const startY = shouldDisplace
        ? target.y + DEFAULT_HAND_LAYOUT.hoverSettleDistance
        : target.y - DEFAULT_HAND_LAYOUT.hoverReturnLift
      this.animateHoverTarget(entry.slot, target, HAND_FOCUS_TIMING.move, 0, startY)
      entry.displaced = shouldDisplace
    })
    this.drag.prepare(this.localHoveredSlot)
    this.callbacks.syncMana()
  }

  private computeHoverTarget(
    rest: HandCardTransform,
    index: number,
    hoveredIndex: number
  ): HandCardTransform {
    if (hoveredIndex < 0 || index !== hoveredIndex) return rest
    return handHoverTarget(rest)
  }

  private animateHoverTarget(
    slot: GameCardSlot,
    target: HandCardTransform,
    positionDuration: number,
    scaleDuration: number,
    startY?: number
  ): void {
    if (slot.destroyed) return
    // Also cancel reflow tweens that have not started yet; overwrite:auto
    // only resolves active conflicts and can otherwise lower a new hover.
    gsap.killTweensOf(slot, 'x,y,rotation')
    gsap.killTweensOf(slot.scale, 'x,y')
    if (startY !== undefined) slot.y = startY
    this.animations.to(slot, {
      x: target.x,
      y: target.y,
      duration: positionDuration,
      ease: handEaseOutExpo,
      overwrite: 'auto'
    })
    if (scaleDuration === 0) {
      slot.rotation = target.rotation
      slot.scale.set(target.scale)
    } else {
      this.animations.to(slot, {
        rotation: target.rotation,
        duration: scaleDuration,
        ease: handEaseOutExpo,
        overwrite: 'auto'
      })
      this.animations.to(slot.scale, {
        x: target.scale,
        y: target.scale,
        duration: scaleDuration,
        ease: handEaseOutExpo,
        overwrite: 'auto'
      })
    }
    slot.zIndex = target.zIndex
  }

  animateSlotToHand(
    slot: GameCardSlot,
    transform: HandCardTransform,
    delay: number,
    positionDuration: number,
    scaleDuration: number
  ): Promise<void> {
    if (slot.destroyed) return Promise.resolve()
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
      alpha: 1,
      duration: positionDuration,
      delay,
      ease: handEaseOutExpo
    })
    timeline.to(
      slot,
      {
        rotation: transform.rotation,
        duration: scaleDuration,
        delay,
        ease: handEaseOutExpo
      },
      0
    )
    timeline.to(
      slot.scale,
      {
        x: transform.scale,
        y: transform.scale,
        duration: scaleDuration,
        delay,
        ease: handEaseOutExpo
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
        ease: handEaseOutExpo
      },
      0
    )
    // Hovered/held cards retain priority over the fan for the entire return.
    const keepRaised = slot.zIndex === ACTIVE_HAND_CARD_DEPTH
    if (!keepRaised) slot.zIndex = transform.zIndex
    return completeTimeline(timeline, () => {
      if (!slot.destroyed && this.localHoveredSlot !== slot) {
        const entry = this.handEntries.find((candidate) => candidate.slot === slot)
        if (entry && slot.parent === this.layer)
          slot.zIndex = entry.restTransform?.zIndex ?? transform.zIndex
      }
    })
  }

  configureSlot(slot: GameCardSlot): void {
    // A canceled minion preview reuses its original hand slot.
    slot.shadow.restingScale = DEFAULT_HAND_LAYOUT.cardScale
    slot.shadow.maximumHeight = MATCH_SHADOW_CONFIG.heldCardHeight
    slot.shadow.minimumHeight = 0
    slot.setMulliganInteractionEnabled(false)
    slot.removeAllListeners('pointertap')
    slot.removeAllListeners('pointerover')
    slot.removeAllListeners('pointerout')
  }
}
