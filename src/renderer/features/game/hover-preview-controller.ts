export interface HoverPreviewControllerOptions<T> {
  readonly delayMs: number
  readonly key: (target: T) => string
  readonly onEnter: (target: T) => void
  readonly onActivate: (target: T) => void
  readonly onLeave: (target: T) => void
}

interface ActiveHover<T> {
  readonly key: string
  readonly target: T
}

/** Keeps one delayed hover intent alive and cancels stale pointer transitions. */
export class HoverPreviewController<T> {
  private active: ActiveHover<T> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: HoverPreviewControllerOptions<T>) {}

  enter(target: T): void {
    const key = this.options.key(target)
    if (this.active?.key === key) return

    this.leave()
    this.active = { key, target }
    this.options.onEnter(target)
    this.timer = setTimeout(
      () => {
        this.timer = null
        if (this.active?.key !== key) return
        this.options.onActivate(target)
      },
      Math.max(0, this.options.delayMs)
    )
  }

  leave(target?: T): void {
    if (!this.active) return
    if (target && this.options.key(target) !== this.active.key) return

    const previous = this.active
    this.active = null
    this.clearTimer()
    this.options.onLeave(previous.target)
  }

  currentKey(): string | null {
    return this.active?.key ?? null
  }

  cancel(): void {
    this.leave()
  }

  dispose(): void {
    this.leave()
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
