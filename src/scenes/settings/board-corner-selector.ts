import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js'
import type { GameSettingsAssets } from '../../visual-components/assets'
import {
  GAME_HEIGHT,
  applyAnchoredPlacement,
  applyPlacement
} from '../../visual-components/layout'
import { Button } from '../../visual-components/controls/button'
import { SETTINGS_LAYOUT } from './settings-layout'

export interface BoardCornerSelection {
  readonly options: readonly { id: string; label: string }[]
  readonly selected: string | null
  readonly onSelect: (id: string) => void
}

const L = SETTINGS_LAYOUT.boardCorners

/** One continuous theme list; only catalogs taller than the screen need scrolling. */
export class BoardCornerSelector extends Container {
  private readonly dismiss = new Graphics()
  private readonly panel = new Container()
  private readonly list = new Container()
  private readonly clip = new Graphics()
  private scrollLimit = 0
  private readonly value: Text
  private selected: string | null

  constructor(
    assets: Pick<GameSettingsAssets, 'resolutionField' | 'resolutionButton'>,
    private readonly selection: BoardCornerSelection
  ) {
    super()
    this.label = 'settings.board-corners'
    this.selected = selection.selected
    this.dismiss.rect(0, 0, 1920, 1080).fill({ color: 0, alpha: 0 })
    this.dismiss.label = 'settings.board-corners-dismiss'
    this.dismiss.eventMode = 'static'
    this.dismiss.on('pointertap', () => this.closeOptions())
    this.dismiss.visible = false
    this.addChild(this.dismiss)
    const title = this.text('Board', 38, 0xffffff)
    title.label = 'settings.board-corners-title'
    applyAnchoredPlacement(title, L.title)
    const field = new Sprite(assets.resolutionField)
    field.label = 'settings.board-corners-field'
    applyAnchoredPlacement(field, L.field)
    field.eventMode = 'static'
    field.on('pointertap', () => this.toggle())
    this.value = this.text(this.selectedLabel(), 28, 0x120d09)
    this.value.label = 'settings.board-corners-value'
    applyAnchoredPlacement(this.value, L.value)
    const arrow = new Button(assets.resolutionButton, {
      sinkPx: 1,
      pressedScale: 0.94,
      hoverBrightness: 1.2,
      onClick: () => this.toggle()
    })
    arrow.label = 'settings.board-corners-button'
    applyPlacement(arrow, L.button)
    arrow.setBaseY(arrow.y)
    this.panel.label = 'settings.board-corners-options'
    applyPlacement(this.panel, L.options)
    this.panel.visible = false
    this.panel.eventMode = 'static'
    this.panel.on('wheel', (event) => {
      event.preventDefault()
      this.scroll(event.deltaY)
    })
    this.list.label = 'settings.board-options-list'
    this.clip.label = 'settings.board-options-clip'
    this.list.mask = this.clip
    this.addChild(title, field, this.value, arrow, this.panel)
  }

  closeOptions(): void {
    this.panel.visible = this.dismiss.visible = false
    window.removeEventListener('keydown', this.onKeyDown, true)
  }

  dispose(): void {
    this.closeOptions()
  }

  private toggle(): void {
    if (this.panel.visible) return this.closeOptions()
    this.list.y = 0
    this.panel.visible = this.dismiss.visible = true
    this.rebuild()
    window.addEventListener('keydown', this.onKeyDown, true)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!['Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') this.closeOptions()
    else this.scroll(event.key === 'ArrowDown' ? L.rowHeight : -L.rowHeight)
  }

  private scroll(delta: number): void {
    this.list.y = Math.max(-this.scrollLimit, Math.min(0, this.list.y - delta))
  }

  private selectedLabel(): string {
    return this.selection.options.find((o) => o.id === this.selected)?.label ?? ''
  }

  private text(text: string, fontSize: number, fill: number): Text {
    const label = new Text({ text, style: { fontFamily: 'Belwe', fontSize, fill } })
    label.eventMode = 'none'
    return label
  }

  private rebuild(): void {
    this.list.removeChildren().forEach((child) => child.destroy({ children: true }))
    this.panel.removeChildren().forEach((child) => {
      if (child !== this.list && child !== this.clip) child.destroy({ children: true })
    })
    const options = this.selection.options
    const contentHeight = options.length * L.rowHeight
    const height = Math.min(
      contentHeight,
      GAME_HEIGHT - L.options.position.y - L.screenMargin
    )
    this.scrollLimit = Math.max(0, contentHeight - height)
    const width = L.options.size.width
    const background = new Graphics()
      .roundRect(0, 0, width, height, 5)
      .fill({ color: 0x201b18, alpha: 0.98 })
      .stroke({ color: 0x8b7654, width: 3 })
    background.label = 'settings.board-corners-panel'
    this.clip.clear().rect(0, 0, width, height).fill(0xffffff)
    this.panel.addChild(background, this.list, this.clip)
    options.forEach((option, index) => {
      this.addRow(
        option.label,
        index,
        width,
        0,
        option.id === this.selected,
        () => {
          this.selection.onSelect(option.id)
          this.selected = option.id
          this.value.text = option.label
          this.closeOptions()
        },
        option.id
      )
    })
  }

  private addRow(
    text: string,
    index: number,
    width: number,
    x: number,
    selected: boolean,
    click: () => void,
    id: string
  ): void {
    const row = new Container()
    row.label = `settings.board-corners-${id}`
    row.position.set(x, index * L.rowHeight)
    row.hitArea = new Rectangle(0, 0, width, L.rowHeight)
    row.eventMode = 'static'
    row.cursor = 'pointer'
    const background = new Graphics()
    background.label = `${row.label}-background`
    const draw = (hover: boolean): void => {
      background
        .clear()
        .rect(2, 1, width - 4, L.rowHeight - 2)
        .fill(hover ? 0x9b835d : selected ? 0x5b5043 : 0x2b2521)
    }
    draw(false)
    const label = this.text(text, 26, 0xf5e3b6)
    label.label = `${row.label}-label`
    label.anchor.set(0.5)
    label.position.set(width / 2, L.rowHeight / 2)
    row.addChild(background, label)
    row.on('pointerover', () => draw(true))
    row.on('pointerout', () => draw(false))
    row.on('pointertap', (event) => {
      event.stopPropagation()
      click()
    })
    this.list.addChild(row)
  }
}
