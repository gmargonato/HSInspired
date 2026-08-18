import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import type { FederatedWheelEvent } from 'pixi.js'
import type { CardDefinition, CardType } from '../../../../card-lab/card-catalog'
import { CARD_CATALOG, CARD_TYPES } from '../../../../card-lab/card-catalog'
import { CardAssetResolver } from '../../../../card-lab/card-asset-manifest'
import { CardView } from '../../../../card-lab/card-view'
import type { CardLayer } from '../../../../card-lab/card-render-plan'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { Scene } from './Scene'

const Layout = {
  leftPanel: { x: 24, y: 24, width: 500, height: 1032 },
  filters: { x: 42, y: 106, width: 464, height: 96 },
  listViewport: { x: 42, y: 218, width: 464, height: 812 },
  rightPanel: { x: 548, y: 24, width: 1348, height: 1032 },
  cardStage: { x: 572, y: 140, width: 1300, height: 880 },
  layerViewer: { x: 1434, y: 140, width: 420, height: 880 },
  layerViewport: { x: 1450, y: 211, width: 388, height: 792 }
} as const

const LIST_ROW_HEIGHT = 38
const LIST_ROW_GAP = 4
const LIST_ROW_STEP = LIST_ROW_HEIGHT + LIST_ROW_GAP
const FILTER_BUTTON_WIDTH = 140
const FILTER_BUTTON_HEIGHT = 26
const FILTER_BUTTON_GAP = 8
const FILTER_COLUMNS = 3
const LAYER_ROW_HEIGHT = 25
const LAYER_ROW_GAP = 3
const LAYER_ROW_STEP = LAYER_ROW_HEIGHT + LAYER_ROW_GAP

type CardFilter = 'All' | CardType

const COLORS = {
  background: 0x0c1019,
  panel: 0x151c29,
  panelBorder: 0x34445f,
  stage: 0x0f1520,
  row: 0x1b2638,
  rowHover: 0x304762,
  rowSelected: 0x6b5429,
  rowBorder: 0x3c506e,
  rowSelectedBorder: 0xe7bd5a,
  heading: 0xf1e4c8,
  body: 0xc3cada,
  muted: 0x8290a8,
  error: 0xff9b86
} as const

function drawPanel(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: number
): void {
  graphics.roundRect(x, y, width, height, 10).fill(fill)
  graphics
    .roundRect(x, y, width, height, 10)
    .stroke({ color: COLORS.panelBorder, width: 2, alpha: 0.9 })
}

class UiButton extends Container {
  private readonly buttonWidth: number
  private readonly buttonHeight: number
  private readonly background = new Graphics()
  private readonly labelText: Text
  private readonly onClick: () => void
  private hovered = false
  private selected = false
  private enabled = true

  constructor(label: string, width: number, height: number, onClick: () => void) {
    super()
    this.buttonWidth = width
    this.buttonHeight = height
    this.onClick = onClick

    this.addChild(this.background)

    this.labelText = new Text({
      text: label,
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 14,
        fill: COLORS.heading,
        align: 'center'
      }
    })
    this.labelText.anchor.set(0.5)
    this.labelText.position.set(width / 2, height / 2)
    this.labelText.eventMode = 'none'
    this.addChild(this.labelText)

    const availableWidth = width - 12
    if (this.labelText.width > availableWidth) {
      this.labelText.scale.x = availableWidth / this.labelText.width
    }

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(0, 0, width, height)
    this.on('pointerover', this.handlePointerOver)
    this.on('pointerout', this.handlePointerOut)
    this.on('pointertap', this.handleTap)
    this.redraw()
  }

  setSelected(selected: boolean): void {
    this.selected = selected
    this.redraw()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.eventMode = enabled ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'
    this.hovered = false
    this.redraw()
  }

  private readonly handlePointerOver = (): void => {
    if (!this.enabled) return
    this.hovered = true
    this.redraw()
  }

  private readonly handlePointerOut = (): void => {
    if (!this.enabled) return
    this.hovered = false
    this.redraw()
  }

  private readonly handleTap = (): void => {
    if (this.enabled) this.onClick()
  }

  private redraw(): void {
    const fill = this.selected
      ? COLORS.rowSelected
      : this.hovered
        ? COLORS.rowHover
        : COLORS.row
    const border = this.selected ? COLORS.rowSelectedBorder : COLORS.rowBorder

    this.alpha = this.enabled ? 1 : 0.45
    this.background.clear()
    this.background.roundRect(0, 0, this.buttonWidth, this.buttonHeight, 5).fill(fill)
    this.background
      .roundRect(0, 0, this.buttonWidth, this.buttonHeight, 5)
      .stroke({ color: border, width: this.selected ? 2 : 1, alpha: 0.9 })
  }
}

class CardListButton extends Container {
  readonly card: CardDefinition

  private readonly rowWidth: number
  private readonly background = new Graphics()
  private readonly title: Text
  private readonly metadata: Text
  private readonly onSelect: (card: CardDefinition) => void
  private hovered = false
  private selected = false

  constructor(
    card: CardDefinition,
    width: number,
    onSelect: (card: CardDefinition) => void
  ) {
    super()
    this.card = card
    this.rowWidth = width
    this.onSelect = onSelect

    this.addChild(this.background)

    this.title = new Text({
      text: card.name,
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 18,
        fill: COLORS.heading
      }
    })
    this.title.position.set(14, LIST_ROW_HEIGHT / 2)
    this.title.anchor.set(0, 0.5)
    this.title.eventMode = 'none'
    this.addChild(this.title)

    this.metadata = new Text({
      text: `${card.set.toUpperCase()} · ${card.type}`,
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 14,
        fill: COLORS.muted,
        align: 'right'
      }
    })
    this.metadata.position.set(width - 12, LIST_ROW_HEIGHT / 2)
    this.metadata.anchor.set(1, 0.5)
    this.metadata.eventMode = 'none'
    this.addChild(this.metadata)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(0, 0, width, LIST_ROW_HEIGHT)
    this.on('pointerover', this.handlePointerOver)
    this.on('pointerout', this.handlePointerOut)
    this.on('pointertap', this.handleTap)
    this.redraw()
  }

  setSelected(selected: boolean): void {
    this.selected = selected
    this.redraw()
  }

  private readonly handlePointerOver = (): void => {
    this.hovered = true
    this.redraw()
  }

  private readonly handlePointerOut = (): void => {
    this.hovered = false
    this.redraw()
  }

  private readonly handleTap = (): void => {
    this.onSelect(this.card)
  }

  private redraw(): void {
    const fill = this.selected
      ? COLORS.rowSelected
      : this.hovered
        ? COLORS.rowHover
        : COLORS.row
    const border = this.selected ? COLORS.rowSelectedBorder : COLORS.rowBorder

    this.background.clear()
    this.background.roundRect(0, 0, this.rowWidth, LIST_ROW_HEIGHT, 6).fill(fill)
    this.background
      .roundRect(0, 0, this.rowWidth, LIST_ROW_HEIGHT, 6)
      .stroke({ color: border, width: this.selected ? 2 : 1, alpha: 0.9 })
  }
}

class LayerToggle extends Container {
  readonly layerId: string

  private readonly rowWidth: number
  private readonly background = new Graphics()
  private readonly checkbox = new Graphics()
  private readonly labelText: Text
  private readonly onChange: (visible: boolean) => void
  private hovered = false
  private checked = true

  constructor(
    layerId: string,
    label: string,
    width: number,
    onChange: (visible: boolean) => void
  ) {
    super()
    this.layerId = layerId
    this.rowWidth = width
    this.onChange = onChange

    this.addChild(this.background)
    this.addChild(this.checkbox)

    this.labelText = new Text({
      text: label,
      style: {
        fontFamily: 'Consolas',
        fontSize: 14,
        fill: COLORS.body
      }
    })
    this.labelText.position.set(32, LAYER_ROW_HEIGHT / 2)
    this.labelText.anchor.set(0, 0.5)
    this.labelText.eventMode = 'none'
    this.addChild(this.labelText)

    const availableWidth = width - 42
    if (this.labelText.width > availableWidth) {
      this.labelText.scale.x = availableWidth / this.labelText.width
    }

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(0, 0, width, LAYER_ROW_HEIGHT)
    this.on('pointerover', this.handlePointerOver)
    this.on('pointerout', this.handlePointerOut)
    this.on('pointertap', this.handleTap)
    this.redraw()
  }

  setChecked(checked: boolean): void {
    this.checked = checked
    this.redraw()
  }

  get isChecked(): boolean {
    return this.checked
  }

  private readonly handlePointerOver = (): void => {
    this.hovered = true
    this.redraw()
  }

  private readonly handlePointerOut = (): void => {
    this.hovered = false
    this.redraw()
  }

  private readonly handleTap = (): void => {
    this.checked = !this.checked
    this.redraw()
    this.onChange(this.checked)
  }

  private redraw(): void {
    this.background.clear()
    this.background
      .roundRect(0, 0, this.rowWidth, LAYER_ROW_HEIGHT, 4)
      .fill(this.hovered ? COLORS.rowHover : COLORS.row)
    this.background
      .roundRect(0, 0, this.rowWidth, LAYER_ROW_HEIGHT, 4)
      .stroke({ color: COLORS.rowBorder, width: 1, alpha: 0.75 })

    this.checkbox.clear()
    this.checkbox.roundRect(7, 4, 17, 17, 3).fill(0x0e141e)
    this.checkbox.roundRect(7, 4, 17, 17, 3).stroke({
      color: this.checked ? COLORS.rowSelectedBorder : COLORS.muted,
      width: 1.5
    })
    if (this.checked) {
      this.checkbox
        .moveTo(10, 12)
        .lineTo(14, 17)
        .lineTo(22, 8)
        .stroke({ color: COLORS.rowSelectedBorder, width: 2.5 })
    }
  }
}

function layerLabel(layer: CardLayer): string {
  return `${layer.id} [${layer.kind}]`
}

/** Development-only card catalog screen used to validate the renderer in-game. */
export class CardViewScene extends Scene {
  private readonly cards = CARD_CATALOG.all
  private readonly resolver = new CardAssetResolver()
  private readonly listButtons: CardListButton[] = []
  private readonly filterButtons: UiButton[] = []
  private readonly filterButtonByFilter = new Map<CardFilter, UiButton>()
  private readonly layerRows: LayerToggle[] = []

  private filteredButtons: CardListButton[] = []
  private listViewport!: Container
  private listContent!: Container
  private cardStage!: Container
  private layerViewport!: Container
  private layerContent!: Container
  private listSummaryText!: Text
  private layerSummaryText!: Text
  private selectedCardText!: Text
  private statusText!: Text
  private diagnosticsText!: Text
  private premiumButton!: UiButton
  private currentView: CardView | null = null
  private selectedCard: CardDefinition | null = null
  private premium = false
  private scrollOffset = 0
  private layerScrollOffset = 0
  private renderSequence = 0
  private disposed = false

  async init(): Promise<void> {
    await this.waitForFonts()
    this.root.addChild(this.createBackground())
    this.createPanels()
    this.createList()
    this.createCardStage()
    // The stage and layer viewer are created after the controls. Re-adding
    // this control keeps the standard/premium toggle above every scene panel.
    this.root.addChild(this.premiumButton)

    const firstCard = this.cards[0]
    if (firstCard) {
      this.selectedCard = firstCard
      this.selectButton(firstCard)
      await this.renderCard(firstCard)
    }
  }

  update(_deltaMS: number): void {}

  protected onExit(): void {
    this.disposed = true
    this.renderSequence += 1
  }

  private async waitForFonts(): Promise<void> {
    if (!document.fonts) return

    await Promise.all([
      document.fonts.load('30px Belwe'),
      document.fonts.load('38px "Arial Narrow"'),
      document.fonts.load('18px "Franklin Gothic Condensed"')
    ])
  }

  private createBackground(): Graphics {
    return new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill(COLORS.background)
  }

  private createPanels(): void {
    const panels = new Graphics()
    drawPanel(
      panels,
      Layout.leftPanel.x,
      Layout.leftPanel.y,
      Layout.leftPanel.width,
      Layout.leftPanel.height,
      COLORS.panel
    )
    drawPanel(
      panels,
      Layout.rightPanel.x,
      Layout.rightPanel.y,
      Layout.rightPanel.width,
      Layout.rightPanel.height,
      COLORS.panel
    )
    this.root.addChild(panels)

    const leftHeading = new Text({
      text: 'CARD VIEW',
      style: {
        fontFamily: 'Belwe',
        fontSize: 30,
        fill: COLORS.heading
      }
    })
    leftHeading.position.set(Layout.leftPanel.x + 20, Layout.leftPanel.y + 18)
    this.root.addChild(leftHeading)

    this.listSummaryText = new Text({
      text: `${this.cards.length} cards · scroll and click to render`,
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 18,
        fill: COLORS.body
      }
    })
    this.listSummaryText.position.set(Layout.leftPanel.x + 20, Layout.leftPanel.y + 62)
    this.root.addChild(this.listSummaryText)

    this.createFilters()

    const rightHeading = new Text({
      text: 'Rendered card',
      style: {
        fontFamily: 'Belwe',
        fontSize: 30,
        fill: COLORS.heading
      }
    })
    rightHeading.position.set(Layout.rightPanel.x + 24, Layout.rightPanel.y + 18)
    this.root.addChild(rightHeading)

    this.selectedCardText = new Text({
      text: 'Select a card',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 20,
        fill: COLORS.body
      }
    })
    this.selectedCardText.position.set(
      Layout.rightPanel.x + 24,
      Layout.rightPanel.y + 60
    )
    this.root.addChild(this.selectedCardText)

    this.statusText = new Text({
      text: 'Waiting for a card',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 16,
        fill: COLORS.muted
      }
    })
    this.statusText.position.set(Layout.rightPanel.x + 24, Layout.rightPanel.y + 88)
    this.root.addChild(this.statusText)

    this.diagnosticsText = new Text({
      text: '',
      style: {
        fontFamily: 'Consolas',
        fontSize: 14,
        fill: COLORS.muted
      }
    })
    this.diagnosticsText.position.set(
      Layout.rightPanel.x + 520,
      Layout.rightPanel.y + 88
    )
    this.root.addChild(this.diagnosticsText)

    this.premiumButton = new UiButton('PREMIUM', 112, 26, () => {
      this.premium = !this.premium
      this.premiumButton.setSelected(this.premium)
      if (this.selectedCard) void this.renderCard(this.selectedCard)
    })
    this.premiumButton.position.set(Layout.rightPanel.x + 24, Layout.rightPanel.y + 108)
    this.root.addChild(this.premiumButton)
  }

  private createFilters(): void {
    const filters = new Graphics()
    drawPanel(
      filters,
      Layout.filters.x,
      Layout.filters.y,
      Layout.filters.width,
      Layout.filters.height,
      COLORS.stage
    )
    this.root.addChild(filters)

    const heading = new Text({
      text: 'FILTERS',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 15,
        fill: COLORS.muted
      }
    })
    heading.position.set(Layout.filters.x + 10, Layout.filters.y + 7)
    this.root.addChild(heading)

    const filtersToShow: readonly CardFilter[] = ['All', ...CARD_TYPES]
    for (const [index, filter] of filtersToShow.entries()) {
      const count = this.cards.filter((card) =>
        filter === 'All' ? true : card.type === filter
      ).length
      const button = new UiButton(
        `${filter} (${count})`,
        FILTER_BUTTON_WIDTH,
        FILTER_BUTTON_HEIGHT,
        () => this.applyFilter(filter)
      )
      const column = index % FILTER_COLUMNS
      const row = Math.floor(index / FILTER_COLUMNS)
      button.position.set(
        Layout.filters.x + 10 + column * (FILTER_BUTTON_WIDTH + FILTER_BUTTON_GAP),
        Layout.filters.y + 33 + row * (FILTER_BUTTON_HEIGHT + 5)
      )
      button.setEnabled(filter === 'All' || count > 0)
      this.filterButtons.push(button)
      this.filterButtonByFilter.set(filter, button)
      this.root.addChild(button)
    }
  }

  private createList(): void {
    const listMask = new Graphics()
      .rect(0, 0, Layout.listViewport.width, Layout.listViewport.height)
      .fill({ color: 0xffffff })
    listMask.position.set(Layout.listViewport.x, Layout.listViewport.y)
    listMask.eventMode = 'none'
    this.root.addChild(listMask)

    this.listViewport = new Container()
    this.listViewport.position.set(Layout.listViewport.x, Layout.listViewport.y)
    this.listViewport.eventMode = 'static'
    this.listViewport.hitArea = new Rectangle(
      0,
      0,
      Layout.listViewport.width,
      Layout.listViewport.height
    )
    this.listViewport.on('wheel', this.handleListWheel)

    this.listContent = new Container()
    this.listViewport.addChild(this.listContent)
    this.listViewport.mask = listMask

    for (const [index, card] of this.cards.entries()) {
      const button = new CardListButton(
        card,
        Layout.listViewport.width,
        this.handleCardSelected
      )
      button.position.set(0, index * LIST_ROW_STEP)
      this.listButtons.push(button)
      this.listContent.addChild(button)
    }

    this.applyFilter('All')
    this.root.addChild(this.listViewport)
  }

  private createCardStage(): void {
    const stageBackground = new Graphics()
      .roundRect(
        Layout.cardStage.x,
        Layout.cardStage.y,
        Layout.cardStage.width,
        Layout.cardStage.height,
        8
      )
      .fill(COLORS.stage)
    stageBackground
      .roundRect(
        Layout.cardStage.x,
        Layout.cardStage.y,
        Layout.cardStage.width,
        Layout.cardStage.height,
        8
      )
      .stroke({ color: COLORS.panelBorder, width: 1, alpha: 0.75 })
    this.root.addChild(stageBackground)

    this.cardStage = new Container()
    this.cardStage.position.set(Layout.cardStage.x, Layout.cardStage.y)
    this.root.addChild(this.cardStage)
    this.createLayerViewer()
  }

  private createLayerViewer(): void {
    const panel = new Graphics()
    drawPanel(
      panel,
      Layout.layerViewer.x,
      Layout.layerViewer.y,
      Layout.layerViewer.width,
      Layout.layerViewer.height,
      COLORS.panel
    )
    this.root.addChild(panel)

    const heading = new Text({
      text: 'LAYER VIEWER',
      style: {
        fontFamily: 'Belwe',
        fontSize: 22,
        fill: COLORS.heading
      }
    })
    heading.position.set(Layout.layerViewer.x + 16, Layout.layerViewer.y + 12)
    this.root.addChild(heading)

    this.layerSummaryText = new Text({
      text: 'Select a card to inspect its layers',
      style: {
        fontFamily: 'Consolas',
        fontSize: 14,
        fill: COLORS.muted
      }
    })
    this.layerSummaryText.position.set(
      Layout.layerViewer.x + 16,
      Layout.layerViewer.y + 43
    )
    this.root.addChild(this.layerSummaryText)

    const actionY = Layout.layerViewer.y + 13
    const actionX = Layout.layerViewer.x + Layout.layerViewer.width - 142
    const allButton = new UiButton('ALL', 60, 24, () => this.setAllLayersVisible(true))
    allButton.position.set(actionX, actionY)
    this.root.addChild(allButton)

    const noneButton = new UiButton('NONE', 64, 24, () =>
      this.setAllLayersVisible(false)
    )
    noneButton.position.set(actionX + 66, actionY)
    this.root.addChild(noneButton)

    const layerMask = new Graphics()
      .rect(0, 0, Layout.layerViewport.width, Layout.layerViewport.height)
      .fill({ color: 0xffffff })
    layerMask.position.set(Layout.layerViewport.x, Layout.layerViewport.y)
    layerMask.eventMode = 'none'
    this.root.addChild(layerMask)

    this.layerViewport = new Container()
    this.layerViewport.position.set(Layout.layerViewport.x, Layout.layerViewport.y)
    this.layerViewport.eventMode = 'static'
    this.layerViewport.hitArea = new Rectangle(
      0,
      0,
      Layout.layerViewport.width,
      Layout.layerViewport.height
    )
    this.layerViewport.on('wheel', this.handleLayerWheel)

    this.layerContent = new Container()
    this.layerViewport.addChild(this.layerContent)
    this.layerViewport.mask = layerMask
    this.root.addChild(this.layerViewport)
  }

  private rebuildLayerViewer(view: CardView): void {
    const oldRows = this.layerContent.removeChildren()
    for (const row of oldRows) {
      row.destroy({ children: true })
    }

    this.layerRows.length = 0
    this.layerScrollOffset = 0
    this.layerContent.y = 0

    for (const [index, layer] of view.plan.layers.entries()) {
      const row = new LayerToggle(
        layer.id,
        layerLabel(layer),
        Layout.layerViewport.width,
        (visible) => {
          if (this.currentView !== view) return
          view.setLayerVisible(layer.id, visible)
          this.updateLayerSummary()
        }
      )
      row.position.set(0, index * LAYER_ROW_STEP)
      this.layerRows.push(row)
      this.layerContent.addChild(row)
    }

    this.updateLayerVisibility()
    this.updateLayerSummary()
  }

  private setAllLayersVisible(visible: boolean): void {
    const view = this.currentView
    if (!view) return

    for (const layer of view.plan.layers) {
      view.setLayerVisible(layer.id, visible)
    }
    for (const row of this.layerRows) {
      row.setChecked(visible)
    }
    this.updateLayerSummary()
  }

  private readonly handleLayerWheel = (event: FederatedWheelEvent): void => {
    const contentHeight = this.layerRows.length * LAYER_ROW_STEP
    const maxOffset = Math.max(0, contentHeight - Layout.layerViewport.height)
    this.layerScrollOffset = Math.max(
      -maxOffset,
      Math.min(0, this.layerScrollOffset - event.deltaY)
    )
    this.layerContent.y = this.layerScrollOffset
    this.updateLayerVisibility()
    event.stopPropagation()
  }

  private updateLayerVisibility(): void {
    for (const row of this.layerRows) {
      row.visible = false
    }
    for (const row of this.layerRows) {
      const rowTop = row.y + this.layerScrollOffset
      const rowBottom = rowTop + LAYER_ROW_HEIGHT
      row.visible = rowBottom > 0 && rowTop < Layout.layerViewport.height
    }
  }

  private updateLayerSummary(): void {
    const enabledLayers = this.layerRows.filter((row) => row.isChecked).length
    this.layerSummaryText.text = `${enabledLayers}/${this.layerRows.length} layers enabled`
  }

  private readonly handleCardSelected = (card: CardDefinition): void => {
    this.selectedCard = card
    this.selectButton(card)
    void this.renderCard(card)
  }

  private selectButton(card: CardDefinition): void {
    for (const button of this.listButtons) {
      button.setSelected(button.card.id === card.id)
    }
  }

  private applyFilter(filter: CardFilter): void {
    for (const [buttonFilter, button] of this.filterButtonByFilter) {
      button.setSelected(buttonFilter === filter)
    }

    this.filteredButtons =
      filter === 'All'
        ? [...this.listButtons]
        : this.listButtons.filter((button) => button.card.type === filter)

    for (const [index, button] of this.filteredButtons.entries()) {
      button.position.y = index * LIST_ROW_STEP
    }

    this.scrollOffset = 0
    this.listContent.y = 0
    this.listSummaryText.text =
      filter === 'All'
        ? `${this.cards.length} cards · scroll and click to render`
        : `${this.filteredButtons.length} ${filter.toLowerCase()} cards · scroll and click to render`
    this.updateListVisibility()
  }

  private readonly handleListWheel = (event: FederatedWheelEvent): void => {
    const contentHeight = this.filteredButtons.length * LIST_ROW_STEP
    const maxOffset = Math.max(0, contentHeight - Layout.listViewport.height)
    this.scrollOffset = Math.max(
      -maxOffset,
      Math.min(0, this.scrollOffset - event.deltaY)
    )
    this.listContent.y = this.scrollOffset
    this.updateListVisibility()
    event.stopPropagation()
  }

  private updateListVisibility(): void {
    for (const button of this.listButtons) {
      button.visible = false
    }
    for (const button of this.filteredButtons) {
      const rowTop = button.y + this.scrollOffset
      const rowBottom = rowTop + LIST_ROW_HEIGHT
      button.visible = rowBottom > 0 && rowTop < Layout.listViewport.height
    }
  }

  private async renderCard(card: CardDefinition): Promise<void> {
    const sequence = ++this.renderSequence
    this.selectedCardText.text = `${card.name} · ${card.type} · ${card.set}`
    this.statusText.text = 'Loading frame assets…'
    this.statusText.style.fill = COLORS.muted
    this.diagnosticsText.text = card.id

    try {
      const artwork = await this.resolver.loadArtwork(card.id)
      const view = await CardView.create(card, this.resolver, {
        artwork,
        premium: this.premium
      })

      if (this.disposed || sequence !== this.renderSequence) {
        view.destroy({ children: true })
        return
      }

      if (this.currentView) {
        this.cardStage.removeChild(this.currentView)
        this.currentView.destroy({ children: true })
      }

      this.currentView = view
      const cardAreaWidth = Layout.layerViewer.x - Layout.cardStage.x
      const scale = Math.min(
        0.95,
        (cardAreaWidth - 80) / view.plan.width,
        (Layout.cardStage.height - 40) / view.renderedHeight
      )
      view.scale.set(scale)
      view.position.set(
        (cardAreaWidth - view.plan.width * scale) / 2,
        (Layout.cardStage.height - view.renderedHeight * scale) / 2
      )
      this.cardStage.addChild(view)
      this.rebuildLayerViewer(view)

      this.statusText.text = `${view.plan.template} · ${this.premium ? 'premium' : 'standard'} · ${view.plan.layers.length} layers`
      this.diagnosticsText.text = [card.id, ...view.plan.diagnostics].join('  ·  ')
    } catch (error) {
      if (this.disposed || sequence !== this.renderSequence) return

      const message = error instanceof Error ? error.message : String(error)
      this.statusText.text = `Could not render card: ${message}`
      this.statusText.style.fill = COLORS.error
      this.diagnosticsText.text = card.id
      console.error(`[Card View] Failed to render ${card.id}:`, error)
    }
  }
}
