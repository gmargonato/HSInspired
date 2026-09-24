import type { Container } from 'pixi.js'
import type { AnimationScope } from '../../animation/animations'
import type { MinionView } from '../../rendering/minions/minion-view'
import { layoutBoardRow, type BoardRowConfig } from './board-layout'
import { BOARD_TIMING } from './game-presentation-timing'

export type BoardSide = 'local' | 'remote'
interface PlacementGap {
  readonly owner: string
  readonly index: number
}
interface BoardRow {
  readonly views: MinionView[]
  readonly layer: Container
  readonly config: BoardRowConfig
  preview: PlacementGap | null
  pendingPreview: PlacementGap | null | undefined
  entrance: PlacementGap | null
}

/** Owns presented row membership, reserved spaces, and resting-position movement.
 * Effect/combat presenters borrow position control only for their travel animation.
 */
export class BoardPositionController {
  private readonly rows: Record<BoardSide, BoardRow>
  private readonly moving = new Set<Container>()
  private readonly shifts = new Map<
    MinionView,
    { x: number; y: number; done: Promise<void>; cancel(): void }
  >()
  private disposed = false

  constructor(
    local: { layer: Container; config: BoardRowConfig },
    remote: { layer: Container; config: BoardRowConfig },
    private readonly animations: AnimationScope
  ) {
    const row = (value: typeof local): BoardRow => ({
      ...value,
      views: [],
      preview: null,
      pendingPreview: undefined,
      entrance: null
    })
    this.rows = { local: row(local), remote: row(remote) }
  }

  views(side: BoardSide): readonly MinionView[] {
    return this.rows[side].views
  }

  private rowFor(view: Container): BoardRow | undefined {
    return Object.values(this.rows).find((row) =>
      row.views.includes(view as MinionView)
    )
  }

  preview(side: BoardSide, owner: string, index: number | null): void {
    const row = this.rows[side]
    const gap = index === null ? null : { owner, index }
    const current = row.pendingPreview === undefined ? row.preview : row.pendingPreview
    if (current?.owner === owner && current.index === index) return
    if (index === null && current?.owner !== owner) return
    if (row.entrance || row.views.some((view) => this.moving.has(view))) {
      row.pendingPreview = gap
      return
    }
    row.preview = gap
    void this.layout(side)
  }

  /** Reservations start with the presented event, never a future match snapshot. */
  reserve(side: BoardSide, owner: string, index: number): void {
    const row = this.rows[side]
    if (row.entrance && row.entrance.owner !== owner)
      throw new Error('A board row already has an active entrance.')
    row.entrance = { owner, index: Math.max(0, Math.min(index, row.views.length)) }
    row.preview = null
    if (row.pendingPreview?.owner === owner) row.pendingPreview = undefined
  }

  entrancePosition(side: BoardSide, owner: string) {
    const row = this.rows[side]
    if (row.entrance?.owner !== owner)
      throw new Error('Missing board entrance reservation.')
    return this.insertionPosition(side, row.entrance.index)
  }

  insertionPosition(side: BoardSide, index: number) {
    const row = this.rows[side]
    return layoutBoardRow(row.views.length + 1, row.config)[
      Math.max(0, Math.min(index, row.views.length))
    ]!
  }

  slotPosition(view: MinionView) {
    const row = this.rowFor(view)
    return row ? this.targets(row)[row.views.indexOf(view)] : undefined
  }

  finishEntrance(side: BoardSide, owner: string): void {
    const row = this.rows[side]
    if (row.entrance && row.entrance.owner !== owner) return
    row.entrance = null
    if (row.pendingPreview?.owner === owner) row.pendingPreview = undefined
    this.applyPendingPreview(row)
    void this.layout(side)
  }

  insert(
    side: BoardSide,
    index: number,
    view: MinionView,
    owner = view.instanceId
  ): void {
    this.detach(view)
    const row = this.rows[side]
    const entrance = row.entrance?.owner === owner ? row.entrance : null
    const position = Math.max(0, Math.min(entrance?.index ?? index, row.views.length))
    row.views.splice(position, 0, view)
    row.layer.addChildAt(view, Math.min(position, row.layer.children.length))
    // Occupy the reservation atomically; the visible arrangement does not change.
    if (entrance) {
      row.entrance = null
      row.preview = null
      if (row.pendingPreview?.owner === owner) row.pendingPreview = undefined
    }
  }

  /** Event positions are sequential insertions; lay out only the completed row. */
  insertBatch(
    side: BoardSide,
    entries: readonly { position: number; view: MinionView }[]
  ): void {
    const row = this.rows[side]
    if (row.entrance) throw new Error('A board row already has an active entrance.')
    row.preview = null
    row.pendingPreview = undefined
    // Reconciled members may already exist; rebuild this group in event order.
    for (const { view } of entries) this.detach(view)
    for (const { position, view } of entries) this.insert(side, position, view)
  }

  detach(view: MinionView): void {
    this.shifts.get(view)?.cancel()
    for (const row of Object.values(this.rows)) {
      const index = row.views.indexOf(view)
      if (index >= 0) row.views.splice(index, 1)
    }
  }

  reorder(side: BoardSide, instanceIds: readonly string[]): void {
    this.rows[side].views.sort(
      (a, b) => instanceIds.indexOf(a.instanceId!) - instanceIds.indexOf(b.instanceId!)
    )
  }

  beginMotion(view: Container): void {
    this.shifts.get(view as MinionView)?.cancel()
    this.animations.kill(view)
    this.moving.add(view)
  }

  endMotion(view: Container): void {
    this.moving.delete(view)
    // A death or control transfer may already have removed the travelling view
    // from its original row. Release that row's deferred preview as well.
    for (const row of Object.values(this.rows)) this.applyPendingPreview(row)
  }

  private applyPendingPreview(row: BoardRow): void {
    if (row.entrance || row.views.some((view) => this.moving.has(view))) return
    if (row.pendingPreview !== undefined) {
      row.preview = row.pendingPreview
      row.pendingPreview = undefined
      void this.layout(row === this.rows.local ? 'local' : 'remote')
    }
  }

  private targets(row: BoardRow) {
    const gap = row.entrance ?? row.preview
    const targets = layoutBoardRow(row.views.length + (gap ? 1 : 0), row.config)
    return row.views.map(
      (_, index) => targets[gap && index >= gap.index ? index + 1 : index]!
    )
  }

  restingPosition(view: MinionView): { x: number; y: number } | undefined {
    const row = this.rowFor(view)
    if (!row || !view.parent) return undefined
    const target = this.slotPosition(view)!
    return view.parent.toLocal(row.layer.toGlobal(target))
  }

  async layout(side: BoardSide): Promise<void> {
    if (this.disposed) return
    const row = this.rows[side]
    const targets = this.targets(row)
    await Promise.all(
      row.views.map((view, index) => {
        if (this.moving.has(view) || view.destroyed) return
        const target = targets[index]!
        const position = view.parent!.toLocal(row.layer.toGlobal(target))
        const y = position.y - (view.isSelected() ? 12 : 0)
        const existing = this.shifts.get(view)
        if (existing?.x === position.x && existing.y === y) return existing.done
        existing?.cancel()
        view.setBaseScale(target.scale)
        if (view.x === position.x && view.y === y) return
        let resolve!: () => void
        const done = new Promise<void>((complete) => {
          resolve = complete
        })
        const tween = this.animations.to(view, {
          x: position.x,
          y,
          duration: BOARD_TIMING.rowShift,
          ease: 'power2.out',
          overwrite: 'auto'
        })
        const finish = (): void => {
          if (this.shifts.get(view) === shift) this.shifts.delete(view)
          resolve()
        }
        const shift = {
          x: position.x,
          y,
          done,
          cancel: (): void => {
            this.animations.cancel(tween)
            finish()
          }
        }
        this.shifts.set(view, shift)
        tween.eventCallback('onComplete', finish)
        tween.eventCallback('onInterrupt', finish)
        return done
      })
    )
  }

  dispose(): void {
    this.disposed = true
    for (const shift of [...this.shifts.values()]) shift.cancel()
    this.moving.clear()
    for (const row of Object.values(this.rows)) {
      row.preview = row.entrance = null
      row.pendingPreview = undefined
      row.views.length = 0
    }
  }
}
