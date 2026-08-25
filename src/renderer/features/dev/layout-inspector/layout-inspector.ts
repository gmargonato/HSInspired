import { Application, Container, Graphics, Text, type ContainerChild } from 'pixi.js'
import { isLayoutLabel } from '../../../rendering/layout'

export interface LayoutInspectorOptions {
  /** Returns the root container of the currently active scene, if any. */
  readonly getRoot: () => Container | null
}

/**
 * A development-only overlay that annotates every labelled Pixi object in the
 * active scene with its name, its bounding box, and its anchor ("registration"
 * point). It is the live counterpart to the layout modules: open a `*-layout.ts`
 * file to read and tune the values, then toggle this overlay to see them.
 *
 * Toggle with the keyboard shortcut registered in `main.ts` (default: F2).
 * The overlay is dev-only and must never be a production dependency; `main.ts`
 * imports it behind `import.meta.env.DEV` and the `@dev-layout-inspector` alias
 * resolves to an empty placeholder in production builds.
 */
export class LayoutInspector {
  private readonly overlay = new Container()
  private enabled = false
  private readonly getRoot: () => Container | null

  constructor(
    private readonly app: Application,
    options: LayoutInspectorOptions
  ) {
    this.getRoot = options.getRoot
    this.overlay.eventMode = 'none'
    this.overlay.visible = false
    this.app.stage.addChild(this.overlay)
    this.app.ticker.add(this.tick)
  }

  get isVisible(): boolean {
    return this.enabled
  }

  toggle(): void {
    this.enabled = !this.enabled
    this.overlay.visible = this.enabled
  }

  dispose(): void {
    this.app.ticker.remove(this.tick)
    this.overlay.destroy({ children: true })
  }

  private readonly tick = (): void => {
    if (!this.enabled) return
    this.redraw()
  }

  private redraw(): void {
    const root = this.getRoot()
    for (const child of this.overlay.removeChildren()) {
      child.destroy({ children: true })
    }
    if (!root) return

    const graphics = new Graphics()
    graphics.eventMode = 'none'
    this.overlay.addChild(graphics)
    this.visit(root, graphics)
  }

  private visit(container: Container, graphics: Graphics): void {
    for (const child of container.children) {
      if (child.label) this.draw(child, graphics)
      if (child.children.length > 0) this.visit(child, graphics)
    }
  }

  private draw(target: ContainerChild, graphics: Graphics): void {
    const bounds = target.getBounds()
    if (bounds.width === 0 || bounds.height === 0) return

    graphics
      .rect(bounds.x, bounds.y, bounds.width, bounds.height)
      .stroke({ color: 0xffe066, width: 1, alpha: 0.85 })

    const anchor = target.getGlobalPosition()
    const half = 6
    graphics
      .moveTo(anchor.x - half, anchor.y)
      .lineTo(anchor.x + half, anchor.y)
      .moveTo(anchor.x, anchor.y - half)
      .lineTo(anchor.x, anchor.y + half)
      .stroke({ color: 0xff5d5d, width: 2, alpha: 0.9 })

    const label = new Text({
      text: `${target.label}${isLayoutLabel(target.label) ? '' : ' [invalid label]'} · (${Math.round(anchor.x)}, ${Math.round(anchor.y)}) · ${target.scale.x.toFixed(2)}x`,
      style: {
        fontFamily: 'Arial',
        fontSize: 11,
        fill: 0xffe066,
        stroke: { color: 0x000000, width: 3 },
        align: 'left'
      }
    })
    label.eventMode = 'none'
    label.anchor.set(0, 0.5)
    label.position.set(bounds.x + 4, bounds.y + 8)
    this.overlay.addChild(label)
  }
}
