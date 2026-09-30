export interface TargetGesturePoint {
  readonly x: number
  readonly y: number
}

export type TargetGesturePhase = 'pressed' | 'dragging'

export interface TargetGestureState<Source> {
  readonly source: Source
  readonly pointerId: number
  readonly start: TargetGesturePoint
  readonly phase: TargetGesturePhase
}

export interface TargetGestureRelease<Source> {
  readonly source: Source
  readonly pointerId: number
  readonly phase: TargetGesturePhase
}

/** Owns pointer identity, drag activation, and post-drag tap suppression. */
export class TargetGestureController<Source> {
  private state: TargetGestureState<Source> | null = null
  private suppressedTapPointerId: number | null = null

  get current(): TargetGestureState<Source> | null {
    return this.state
  }

  begin(source: Source, pointerId: number, start: TargetGesturePoint): void {
    this.state = { source, pointerId, start: { ...start }, phase: 'pressed' }
  }

  /** Returns true only for the movement that first activates dragging. */
  move(pointerId: number, point: TargetGesturePoint, threshold: number): boolean {
    const state = this.state
    if (!state || state.pointerId !== pointerId || state.phase === 'dragging') {
      return false
    }
    if (Math.hypot(point.x - state.start.x, point.y - state.start.y) < threshold) {
      return false
    }
    this.state = { ...state, phase: 'dragging' }
    return true
  }

  release(pointerId: number): TargetGestureRelease<Source> | null {
    const state = this.state
    if (!state || state.pointerId !== pointerId) return null
    this.state = null
    if (state.phase === 'dragging') this.suppressedTapPointerId = pointerId
    return { source: state.source, pointerId, phase: state.phase }
  }

  cancel(predicate?: (source: Source) => boolean): void {
    if (!this.state || (predicate && !predicate(this.state.source))) return
    this.state = null
  }

  consumeTap(pointerId: number): boolean {
    if (this.suppressedTapPointerId !== pointerId) return false
    this.suppressedTapPointerId = null
    return true
  }

  suppressTap(pointerId: number): void {
    this.suppressedTapPointerId = pointerId
  }

  releaseTap(pointerId: number): void {
    if (this.suppressedTapPointerId === pointerId) {
      this.suppressedTapPointerId = null
    }
  }

  clear(): void {
    this.state = null
    this.suppressedTapPointerId = null
  }
}
