import { type Container, type FederatedPointerEvent, type Renderer } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import type { CursorManager } from '../../../visual-components/controls/cursor'
import type { OutlinePaletteInput } from '../../../visual-components/effects/animated-outline'
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
import type { HandCardPerspective, PerspectiveCorners } from './hand-card-perspective'
import { HandCardPerspectivePool } from './hand-card-perspective-pool'
import { OPENING_TIMING } from '../presentation/game-presentation-timing'

export const DRAG_MOVE_THRESHOLD = 10
/** Stationary-pointer preparation only; hover visuals and actual pickup never wait. */
export const HAND_PREPARATION_DWELL_MS = 120

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

/** Owns a held card's pointer tracking and presentation, advanced by the scene frame. */
export class GameHandDrag {
  private draggingIndex: number | null = null
  private dragPointer: HandPointer | null = null
  private dragState: HandDragState | null = null
  private dragRotator: DragRotatorState | null = null
  private readonly perspectivePool: HandCardPerspectivePool
  private prepareSlot: GameCardSlot | null = null
  private prepareElapsedMS = 0
  private preparationPending = false
  private pendingPerspectiveSlot: GameCardSlot | null = null
  private perspectiveSlot: GameCardSlot | null = null
  private previewPending = false
  private dragPointerId: number | null = null
  private dragPerspective: HandCardPerspective | null = null
  private dragReturning = false
  private dragStartPointer: HandPointer | null = null
  private dragMovedBeyondThreshold = false

  constructor(
    private readonly layer: Container,
    renderer: Renderer,
    private readonly animations: Pick<AnimationScope, 'kill' | 'to'>,
    private readonly context: HandDragContext,
    private readonly cursor?: CursorManager | null
  ) {
    this.perspectivePool = new HandCardPerspectivePool(renderer)
  }

  get index(): number | null {
    return this.draggingIndex
  }
  get pointer(): HandPointer | null {
    return this.dragPointer
  }
  get returning(): boolean {
    return this.dragReturning
  }

  ownsPointer(pointerId: number): boolean {
    return this.draggingIndex !== null && this.dragPointerId === pointerId
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

  refreshOutlineAppearance(): void {
    const slot = this.perspectiveSlot
    if (!slot || !this.dragPerspective) return
    this.dragPerspective.setOutlineAppearance(
      slot.getPlayableOutlinePalette(),
      slot.getPlayableOutlinePreset(),
      slot.getPlayableOutlineTuning()
    )
  }

  setDropAllowed(allowed: boolean, palette: OutlinePaletteInput = 'blue'): void {
    if (this.draggingIndex === null) return
    const entry = this.context.entryAt(this.draggingIndex)
    if (!entry) return
    this.dragPerspective?.setOutlinePalette(
      allowed && !this.dragReturning && entry.slot.isPlayableOutlineEnabled()
        ? palette
        : entry.slot.getPlayableOutlinePalette()
    )
  }
  /** Benchmark movement does not synthesize a browser gesture. */
  moveForBenchmark(pointer: HandPointer): void {
    this.dragPointer = pointer
    this.previewPending = true
  }

  /** Prepare a hovered card after pointer rest; scene warmup can bypass the dwell. */
  prepare(slot: GameCardSlot | null, immediate = false): void {
    if (this.prepareSlot === slot) {
      if (immediate && this.preparationPending)
        this.prepareElapsedMS = HAND_PREPARATION_DWELL_MS
      return
    }
    this.prepareSlot = slot
    this.prepareElapsedMS = immediate ? HAND_PREPARATION_DWELL_MS : 0
    this.preparationPending = slot !== null
  }

  /** Moving across even one card must not allocate preparation during a hand sweep. */
  deferPreparation(): void {
    if (this.preparationPending) this.prepareElapsedMS = 0
  }

  /** A transferred card must not remain retained by hand-only preparation. */
  invalidate(slot: GameCardSlot): void {
    if (this.prepareSlot === slot) this.prepare(null)
    if (this.pendingPerspectiveSlot === slot) this.pendingPerspectiveSlot = null
    // A play can detach the slot while borrowing its visible perspective. Its
    // resources are released after that transfer finishes, not during onDetach.
    if (this.perspectiveSlot !== slot) this.perspectivePool.invalidate(slot.card)
  }

  /** Flush a release/click sample in hand-local coordinates before deciding its action. */
  flushPointer(pointer: HandPointer, pointerId: number): void {
    if (!this.ownsPointer(pointerId)) return
    this.samplePointer(pointer, pointerId)
    this.flushBoardPreview()
  }

  /** Runs before board shadows and rendering, once for each presented frame. */
  update(deltaMS: number): void {
    this.stepDragFrame(deltaMS)
    this.activatePendingPerspective()
    this.flushBoardPreview()
    const slot = this.prepareSlot
    if (slot && this.preparationPending) {
      this.prepareElapsedMS += Math.max(0, deltaMS)
      if (this.prepareElapsedMS >= HAND_PREPARATION_DWELL_MS) {
        this.preparationPending = false
        if (!slot.destroyed && !slot.card.destroyed && this.context.entryFor(slot)) {
          this.perspectivePool.prepare(slot.card, this.perspectiveOptions(slot))
        }
      }
    }
    this.perspectivePool.flush()
  }

  private activatePendingPerspective(): void {
    const slot = this.pendingPerspectiveSlot
    this.pendingPerspectiveSlot = null
    if (
      !slot ||
      slot.destroyed ||
      slot.card.destroyed ||
      this.draggingIndex === null ||
      !this.context.entryFor(slot)
    )
      return
    slot.suppressPlayableOutline(true)
    try {
      this.dragPerspective = this.perspectivePool.acquire(
        slot.card,
        this.perspectiveOptions(slot)
      )
      this.perspectiveSlot = slot
    } catch (error) {
      slot.suppressPlayableOutline(false)
      throw error
    }
    this.applyTilt()
    this.dragPerspective.update()
    this.previewPending = true
  }

  private releasePerspective(): void {
    const slot = this.perspectiveSlot
    if (this.dragPerspective) this.perspectivePool.release(this.dragPerspective)
    this.dragPerspective = null
    this.perspectiveSlot = null
    this.pendingPerspectiveSlot = null
    if (slot && !this.context.entryFor(slot)) this.perspectivePool.invalidate(slot.card)
  }

  private perspectiveOptions(slot: GameCardSlot) {
    return {
      outlineTexture: slot.playableOutlineTexture,
      outlineEnabled: slot.isPlayableOutlineEnabled(),
      outlinePalette: slot.getPlayableOutlinePalette(),
      outlinePreset: slot.getPlayableOutlinePreset(),
      outlineTuning: slot.getPlayableOutlineTuning()
    }
  }

  private flushBoardPreview(): void {
    if (!this.previewPending) return
    this.previewPending = false
    if (this.draggingIndex !== null && !this.dragReturning && this.dragPointer) {
      this.context.updateBoardPreview(this.dragPointer)
    }
  }

  activate(): void {
    this.layer.on('globalpointermove', this.onPointerMove)
    this.layer.on('rightdown', this.onRightDown)
  }

  private readonly onPointerMove = (event: FederatedPointerEvent): void => {
    if (this.draggingIndex === null || this.dragReturning) return
    const local = event.getLocalPosition(this.layer)
    this.samplePointer(local, event.pointerId)
  }

  private samplePointer(pointer: HandPointer, pointerId: number): void {
    if (
      this.draggingIndex === null ||
      this.dragReturning ||
      pointerId !== this.dragPointerId
    )
      return
    this.dragPointer = { x: pointer.x, y: pointer.y }
    if (this.dragStartPointer) {
      this.dragMovedBeyondThreshold =
        this.dragMovedBeyondThreshold ||
        Math.hypot(
          this.dragPointer.x - this.dragStartPointer.x,
          this.dragPointer.y - this.dragStartPointer.y
        ) > DRAG_MOVE_THRESHOLD
    }
    const entry = this.context.entryAt(this.draggingIndex)
    if (entry && this.context.tryTarget(entry, this.dragPointer, pointerId)) {
      return
    }
    this.previewPending = true
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
      this.releasePerspective()
      this.draggingIndex = null
      this.dragPointer = null
      this.dragStartPointer = null
      this.dragMovedBeyondThreshold = false
      this.dragState = null
      this.dragRotator = null
      this.dragReturning = false
    }
    this.dragPointerId = null
    this.previewPending = false
    this.prepare(null)
    this.pendingPerspectiveSlot = null
    this.perspectivePool.dispose()
  }

  begin(index: number, pointer: HandPointer, pointerId: number): void {
    const entry = this.context.entryAt(index)
    const rest = entry?.restTransform
    if (!entry || !rest) return
    this.draggingIndex = index
    this.dragPointerId = pointerId
    this.dragPointer = { ...pointer }
    this.dragStartPointer = { ...pointer }
    this.dragMovedBeyondThreshold = false
    this.dragReturning = false
    this.context.beginTargetGesture(entry, pointer, pointerId)
    // Start from the card's current (hovered) position so the pickup glides up
    // toward the cursor instead of snapping back to the resting baseline.
    this.dragState = initialDragState(
      entry.slot.x,
      entry.slot.y,
      entry.slot.scale.x,
      pointer
    )
    const center = resolveDragCenter(entry.slot.x, entry.slot.y, entry.slot.scale.x)
    this.dragRotator = resetDragRotator(center.x, center.y)
    this.releasePerspective()
    // Pointerdown keeps the existing card visible. Even a cold pickup prepares
    // its GPU presentation in the next scene frame, alongside the first pose.
    this.pendingPerspectiveSlot = entry.slot
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

    this.context.syncMana()
    this.previewPending = false
    this.prepare(null)
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
    this.dragPointerId = null
    this.previewPending = false
    this.pendingPerspectiveSlot = null
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
    this.releasePerspective()
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
    this.releasePerspective()
    this.draggingIndex = null
    this.dragPointer = null
    this.dragPointerId = null
    this.previewPending = false
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
    this.releasePerspective()
    this.draggingIndex = null
    this.dragPointer = null
    this.dragPointerId = null
    this.previewPending = false
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
    this.dragPointerId = null
    this.previewPending = false
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.dragRotator = null
    onDetach?.()
    this.releasePerspective()
    this.cursor?.setContextVariant(null)
    this.context.clearHover()
    this.draggingIndex = null
  }
}
