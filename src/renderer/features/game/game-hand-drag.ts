import { type Container, type FederatedPointerEvent, type Renderer } from 'pixi.js'
import { gsap, type AnimationScope } from '../../animation/animations'
import type { CursorManager } from '../../ui/components/cursor'
import type { GameCardSlot } from './game-card-slot'
import type { HandEntry } from './game-hand-entry'
import type { HandCardTransform, HandPointer } from './hand-layout'
import {
  DEFAULT_HAND_DRAG,
  initialDragState,
  resolveDragCenter,
  stepDrag,
  type HandDragState
} from './hand-drag'
import {
  DEFAULT_DRAG_ROTATOR,
  MAX_TILT_X_DEG,
  MAX_TILT_Y_DEG,
  resetDragRotator,
  stepDragRotator,
  type DragRotatorState
} from './drag-rotator'
import { HandCardPerspective, type PerspectiveCorners } from './hand-card-perspective'
import { OPENING_TIMING } from './game-presentation-timing'

export const DRAG_MOVE_THRESHOLD = 10

interface HandDragContext {
  entryAt(index: number): HandEntry | undefined
  entryFor(slot: GameCardSlot): HandEntry | undefined
  beginTargetGesture(entry: HandEntry, pointer: HandPointer, pointerId: number): void
  tryTarget(entry: HandEntry, pointer: HandPointer, pointerId: number): boolean
  updateBoardPreview(pointer: HandPointer): void
  clearBoardPreview(): void
  clearHover(): void
  beginReflow(): void
  syncMana(): void
  onReturned(): void
  returnToHand(
    slot: GameCardSlot,
    transform: HandCardTransform,
    delay: number,
    positionDuration: number,
    scaleDuration: number
  ): Promise<void>
}

/** Owns a held card's pointer tracking, perspective snapshot, and ticker lifetime. */
export class GameHandDrag {
  private draggingIndex: number | null = null
  private dragPointer: HandPointer | null = null
  private dragState: HandDragState | null = null
  private dragRotator: DragRotatorState | null = null
  private dragTick: ((time: number, deltaMS: number) => void) | null = null
  private dragPerspective: HandCardPerspective | null = null
  private dragReturning = false
  private dragStartPointer: HandPointer | null = null
  private dragMovedBeyondThreshold = false

  constructor(
    private readonly layer: Container,
    private readonly renderer: Renderer,
    private readonly animations: Pick<AnimationScope, 'kill' | 'to'>,
    private readonly context: HandDragContext,
    private readonly cursor?: CursorManager | null
  ) {}

  get index(): number | null {
    return this.draggingIndex
  }
  get pointer(): HandPointer | null {
    return this.dragPointer
  }
  get returning(): boolean {
    return this.dragReturning
  }

  capturePerspective(): PerspectiveCorners | undefined {
    return this.dragPerspective?.captureCorners()
  }
  get movedBeyondThreshold(): boolean {
    return this.dragMovedBeyondThreshold
  }

  holdForPresentation(): void {
    this.dragReturning = true
  }
  presentationSettled(): void {
    this.dragReturning = false
  }
  setOutlineEnabled(enabled: boolean): void {
    this.dragPerspective?.setOutlineEnabled(enabled)
  }

  setDropAllowed(allowed: boolean): void {
    if (this.draggingIndex === null) return
    const entry = this.context.entryAt(this.draggingIndex)
    if (!entry) return
    this.dragPerspective?.setOutlinePalette(
      allowed && !this.dragReturning && entry.slot.isPlayableOutlineEnabled()
        ? 'blue'
        : entry.slot.getPlayableOutlinePalette()
    )
  }
  /** Benchmark movement does not synthesize a browser gesture. */
  moveForBenchmark(pointer: HandPointer): void {
    this.dragPointer = pointer
  }

  activate(): void {
    this.layer.on('globalpointermove', this.onPointerMove)
    this.layer.on('rightdown', this.onRightDown)
  }

  private readonly onPointerMove = (event: FederatedPointerEvent): void => {
    if (this.draggingIndex === null || this.dragReturning) return
    const local = event.getLocalPosition(this.layer)
    this.dragPointer = { x: local.x, y: local.y }
    if (this.dragStartPointer) {
      this.dragMovedBeyondThreshold =
        this.dragMovedBeyondThreshold ||
        Math.hypot(
          this.dragPointer.x - this.dragStartPointer.x,
          this.dragPointer.y - this.dragStartPointer.y
        ) > DRAG_MOVE_THRESHOLD
    }
    const entry = this.context.entryAt(this.draggingIndex)
    if (entry && this.context.tryTarget(entry, this.dragPointer, event.pointerId)) {
      return
    }
    this.context.updateBoardPreview(this.dragPointer)
  }
  private readonly onRightDown = (event: FederatedPointerEvent): void => {
    if (this.draggingIndex === null) return
    event.stopPropagation()
    this.end()
  }

  dispose(): void {
    this.layer.off('globalpointermove', this.onPointerMove)
    this.layer.off('rightdown', this.onRightDown)
    if (this.draggingIndex !== null) {
      this.context.entryAt(this.draggingIndex)?.slot.suppressPlayableOutline(false)
      if (this.dragTick) gsap.ticker.remove(this.dragTick)
      this.dragTick = null
      this.dragPerspective?.destroy()
      this.dragPerspective = null
      this.draggingIndex = null
      this.dragPointer = null
      this.dragStartPointer = null
      this.dragMovedBeyondThreshold = false
      this.dragState = null
      this.dragRotator = null
      this.dragReturning = false
    }
  }

  begin(index: number, pointer: HandPointer, pointerId: number): void {
    const entry = this.context.entryAt(index)
    const rest = entry?.restTransform
    if (!entry || !rest) return
    this.draggingIndex = index
    this.dragPointer = { ...pointer }
    this.dragStartPointer = { ...pointer }
    this.dragMovedBeyondThreshold = false
    this.dragReturning = false
    this.context.beginTargetGesture(entry, pointer, pointerId)
    // Start from the card's current (hovered) position so the pickup glides up
    // toward the cursor instead of snapping back to the resting baseline.
    this.dragState = initialDragState(entry.slot.x, entry.slot.y, entry.slot.scale.x)
    const center = resolveDragCenter(entry.slot.x, entry.slot.y, entry.slot.scale.x)
    this.dragRotator = resetDragRotator(center.x, center.y)
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    const outlineEnabled = entry.slot.isPlayableOutlineEnabled()
    entry.slot.suppressPlayableOutline(true)
    try {
      this.dragPerspective = new HandCardPerspective(this.renderer, entry.slot.card, {
        outlineTexture: entry.slot.playableOutlineTexture,
        outlineEnabled,
        // Keep the hand color until the pointer reaches a valid drop area.
        outlinePalette: entry.slot.getPlayableOutlinePalette(),
        outlinePreset: entry.slot.getPlayableOutlinePreset()
      })
    } catch (error) {
      entry.slot.suppressPlayableOutline(false)
      throw error
    }
    this.cursor?.setContextVariant('grab')

    this.animations.kill(entry.slot)
    this.animations.kill(entry.slot.scale)
    this.animations.to(entry.slot, {
      rotation: 0,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    entry.slot.zIndex = 1000

    const tick = (_time: number, deltaMS: number): void => this.stepDragFrame(deltaMS)
    this.dragTick = tick
    gsap.ticker.add(tick)
    this.context.syncMana()
    this.context.updateBoardPreview(pointer)
  }

  private stepDragFrame(deltaMS: number): void {
    if (this.draggingIndex === null) return
    if (this.dragReturning) {
      // Feed the anchored centre so the held tilt decays without new input.
      if (this.dragRotator) {
        this.dragRotator = stepDragRotator(
          this.dragRotator,
          this.dragRotator.prevX,
          this.dragRotator.prevY,
          deltaMS,
          DEFAULT_DRAG_ROTATOR
        )
        this.applyTilt()
      }
      this.dragPerspective?.update()
      return
    }
    if (!this.dragPointer || !this.dragState) return
    const entry = this.context.entryAt(this.draggingIndex)
    if (!entry || entry.slot.destroyed) {
      this.end()
      return
    }
    this.dragState = stepDrag(
      this.dragState,
      this.dragPointer.x,
      this.dragPointer.y,
      deltaMS,
      DEFAULT_HAND_DRAG
    )
    entry.slot.position.set(this.dragState.x, this.dragState.y)
    entry.slot.scale.set(this.dragState.scale)
    const center = resolveDragCenter(
      this.dragState.x,
      this.dragState.y,
      this.dragState.scale
    )
    this.dragRotator = stepDragRotator(
      this.dragRotator ?? resetDragRotator(center.x, center.y),
      center.x,
      center.y,
      deltaMS,
      DEFAULT_DRAG_ROTATOR
    )
    this.applyTilt()
    this.dragPerspective?.update()
  }

  /** Maps rotator degrees onto the normalized tilt the projection consumes. */
  private applyTilt(): void {
    if (!this.dragRotator) return
    this.dragPerspective?.setTarget({
      x: this.dragRotator.rollDeg / MAX_TILT_Y_DEG,
      y: -this.dragRotator.pitchDeg / MAX_TILT_X_DEG
    })
  }

  end(): void {
    if (this.draggingIndex === null || this.dragReturning) return
    this.setDropAllowed(false)
    const index = this.draggingIndex
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.dragReturning = true
    this.cursor?.setContextVariant(null)
    this.context.clearHover()
    this.context.clearBoardPreview()
    const entry = this.context.entryAt(index)
    if (entry?.restTransform) {
      void this.context
        .returnToHand(
          entry.slot,
          entry.restTransform,
          0,
          OPENING_TIMING.hover,
          OPENING_TIMING.hover
        )
        .then(() => this.finishDrag(index, entry.slot))
      return
    }
    this.finishDrag(index)
  }

  private finishDrag(index: number, slot?: GameCardSlot): void {
    if (this.draggingIndex !== index) return
    const entry = slot ? this.context.entryFor(slot) : this.context.entryAt(index)
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.draggingIndex = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragRotator = null
    this.dragReturning = false
    if (entry) {
      entry.slot.suppressPlayableOutline(false)
      entry.displaced = false
    }
    this.context.syncMana()
    this.context.onReturned()
  }

  releaseForTargeting(entry: HandEntry): void {
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.draggingIndex = null
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.dragRotator = null
    this.context.clearHover()
    entry.displaced = false
    entry.slot.suppressPlayableOutline(true)
    this.cursor?.setContextVariant(null)
    this.context.clearBoardPreview()
  }

  hideForPendingPlay(entry: HandEntry): void {
    entry.slot.visible = false
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.draggingIndex = null
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.dragRotator = null
    this.context.clearHover()
    this.cursor?.setContextVariant(null)
    this.context.clearBoardPreview()
  }

  acceptCard(onDetach?: () => void): void {
    this.dragReturning = true
    this.context.beginReflow()
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.dragRotator = null
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    onDetach?.()
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.cursor?.setContextVariant(null)
    this.context.clearHover()
    this.draggingIndex = null
  }
}
