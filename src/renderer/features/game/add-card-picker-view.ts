import {
  CARD_CATALOG,
  CARD_CLASSES,
  formatExpansionName,
  type CardDefinition,
  type CardId
} from '../../../game/content/cards'
import { EXPANSION_CATALOG } from '../../../game/content/expansions'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'
import type { LayoutPlacement } from '../../rendering/layout'
import {
  ADD_CARD_PICKER_LAYOUT,
  ADD_CARD_PICKER_ROW_LAYOUT
} from './add-card-picker-layout'
import {
  ALL_ADD_CARD_FILTER_VALUE,
  filterAddCardCards,
  type AddCardPickerFilters
} from './add-card-picker-model'

export interface AddCardPickerViewOptions {
  readonly canvas: HTMLCanvasElement
  readonly parent: HTMLElement
  readonly onSelect: (cardId: CardId) => Promise<void>
}

export interface AddCardPickerOpenOptions {
  readonly title: string
  readonly successMessage: string
  readonly cards?: readonly CardDefinition[]
}

type StatusKind = 'info' | 'error'

/** CSS/HTML card picker presented above the active match canvas. */
export class AddCardPickerView {
  private readonly root: HTMLDivElement
  private readonly backdrop: HTMLDivElement
  private readonly panel: HTMLDivElement
  private readonly title: HTMLHeadingElement
  private readonly closeButton: HTMLButtonElement
  private readonly searchInput: HTMLInputElement
  private readonly classFilter: HTMLSelectElement
  private readonly expansionFilter: HTMLSelectElement
  private readonly collectibleFilter: HTMLInputElement
  private readonly status: HTMLDivElement
  private readonly resultCount: HTMLDivElement
  private readonly resultsViewport: HTMLDivElement
  private readonly cards: readonly CardDefinition[]
  private visibleCards: readonly CardDefinition[]
  private successMessage = 'Card added.'
  private filters: AddCardPickerFilters = {
    query: '',
    cardClass: ALL_ADD_CARD_FILTER_VALUE,
    expansionId: ALL_ADD_CARD_FILTER_VALUE,
    collectibleOnly: false
  }
  private isOpen = false
  private isSubmitting = false
  private disposed = false

  constructor(
    private readonly options: AddCardPickerViewOptions,
    cards: readonly CardDefinition[] = CARD_CATALOG.all
  ) {
    this.cards = cards
    this.visibleCards = cards
    this.root = document.createElement('div')
    this.root.className = 'add-card-picker'
    this.root.setAttribute('aria-hidden', 'true')

    this.backdrop = document.createElement('div')
    this.backdrop.className = 'add-card-picker__backdrop'
    this.backdrop.addEventListener('click', this.handleBackdropClick)

    this.panel = document.createElement('div')
    this.panel.className = 'add-card-picker__panel'
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')

    this.title = document.createElement('h2')
    this.title.className = 'add-card-picker__title'
    this.title.id = 'add-card-picker-title'
    this.title.textContent = 'Add Card to Hand'
    this.panel.setAttribute('aria-labelledby', this.title.id)

    this.closeButton = document.createElement('button')
    this.closeButton.type = 'button'
    this.closeButton.className = 'add-card-picker__close'
    this.closeButton.setAttribute('aria-label', 'Close card picker')
    this.closeButton.textContent = '×'
    this.closeButton.addEventListener('click', this.handleCloseClick)

    this.searchInput = document.createElement('input')
    this.searchInput.type = 'search'
    this.searchInput.className = 'add-card-picker__search'
    this.searchInput.placeholder = 'Search card names…'
    this.searchInput.autocomplete = 'off'
    this.searchInput.spellcheck = false
    this.searchInput.setAttribute('aria-label', 'Search card names')
    this.searchInput.addEventListener('input', this.handleSearchInput)

    this.classFilter = this.createSelect('Filter by class')
    this.classFilter.addEventListener('change', this.handleClassFilterChange)
    this.appendOption(this.classFilter, 'All classes', ALL_ADD_CARD_FILTER_VALUE)
    for (const cardClass of CARD_CLASSES) {
      this.appendOption(this.classFilter, cardClass, cardClass)
    }

    this.expansionFilter = this.createSelect('Filter by expansion')
    this.expansionFilter.addEventListener('change', this.handleExpansionFilterChange)
    this.appendOption(this.expansionFilter, 'All expansions', ALL_ADD_CARD_FILTER_VALUE)
    for (const expansion of EXPANSION_CATALOG.all) {
      this.appendOption(this.expansionFilter, expansion.displayName, expansion.id)
    }

    const collectibleLabel = document.createElement('label')
    collectibleLabel.className = 'add-card-picker__collectible-label'
    this.collectibleFilter = document.createElement('input')
    this.collectibleFilter.type = 'checkbox'
    this.collectibleFilter.addEventListener(
      'change',
      this.handleCollectibleFilterChange
    )
    collectibleLabel.append(this.collectibleFilter, ' Collectible only')

    this.status = document.createElement('div')
    this.status.className = 'add-card-picker__status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')

    this.resultCount = document.createElement('div')
    this.resultCount.className = 'add-card-picker__count'

    this.resultsViewport = document.createElement('div')
    this.resultsViewport.className = 'add-card-picker__results'
    this.resultsViewport.setAttribute('role', 'listbox')
    this.resultsViewport.setAttribute('aria-label', 'Matching cards')

    this.panel.append(
      this.title,
      this.closeButton,
      this.searchInput,
      this.classFilter,
      this.expansionFilter,
      collectibleLabel,
      this.status,
      this.resultCount,
      this.resultsViewport
    )
    this.root.append(this.backdrop, this.panel)
    this.options.parent.appendChild(this.root)

    this.setVisible(false)
  }

  get visible(): boolean {
    return this.isOpen
  }

  open(options: AddCardPickerOpenOptions): void {
    if (this.disposed) return

    this.title.textContent = options.title
    this.successMessage = options.successMessage
    this.visibleCards = options.cards ?? this.cards

    if (this.isOpen) {
      this.setStatus('', 'info')
      this.renderResults()
      this.updateLayout()
      this.searchInput.focus()
      return
    }

    this.isOpen = true
    this.root.setAttribute('aria-hidden', 'false')
    this.setVisible(true)
    this.setStatus('', 'info')
    this.renderResults()
    this.updateLayout()
    window.addEventListener('resize', this.handleResize)
    window.addEventListener('keydown', this.handleKeyDown, true)
    this.searchInput.focus()
  }

  close(): void {
    if (this.isSubmitting) return
    this.closeInternal()
  }

  setStatus(message: string, kind: StatusKind = 'info'): void {
    this.status.textContent = message
    this.status.classList.toggle('is-error', kind === 'error')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.isSubmitting = false
    this.closeInternal()
    this.backdrop.removeEventListener('click', this.handleBackdropClick)
    this.closeButton.removeEventListener('click', this.handleCloseClick)
    this.searchInput.removeEventListener('input', this.handleSearchInput)
    this.classFilter.removeEventListener('change', this.handleClassFilterChange)
    this.expansionFilter.removeEventListener('change', this.handleExpansionFilterChange)
    this.collectibleFilter.removeEventListener(
      'change',
      this.handleCollectibleFilterChange
    )
    this.root.remove()
  }

  private setVisible(visible: boolean): void {
    this.root.hidden = !visible
    this.root.style.display = visible ? 'block' : 'none'
  }

  private closeInternal(): void {
    if (!this.isOpen) return

    this.isOpen = false
    this.root.setAttribute('aria-hidden', 'true')
    this.setVisible(false)
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('keydown', this.handleKeyDown, true)
  }

  private createSelect(label: string): HTMLSelectElement {
    const select = document.createElement('select')
    select.className = 'add-card-picker__select'
    select.setAttribute('aria-label', label)
    return select
  }

  private appendOption(select: HTMLSelectElement, label: string, value: string): void {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.appendChild(option)
  }

  private renderResults(): void {
    const cards = filterAddCardCards(this.visibleCards, this.filters)
    this.resultCount.textContent = `${cards.length} card${cards.length === 1 ? '' : 's'}`
    this.resultsViewport.replaceChildren()

    if (cards.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'add-card-picker__empty'
      empty.textContent = 'No cards match the current filters.'
      this.resultsViewport.appendChild(empty)
      return
    }

    for (const [index, card] of cards.entries()) {
      this.resultsViewport.appendChild(this.createCardRow(card, index, cards.length))
    }
  }

  private createCardRow(
    card: CardDefinition,
    index: number,
    resultCount: number
  ): HTMLButtonElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'add-card-picker__row'
    row.setAttribute('role', 'option')
    row.dataset.cardId = card.id
    row.style.height = `${ADD_CARD_PICKER_ROW_LAYOUT.height}px`
    row.style.marginBottom =
      index === resultCount - 1 ? '0px' : `${ADD_CARD_PICKER_ROW_LAYOUT.gap}px`

    const cost = document.createElement('span')
    cost.className = 'add-card-picker__cost'
    cost.textContent = String(card.cost)
    cost.setAttribute('aria-label', `${card.cost} mana`)

    const name = document.createElement('span')
    name.className = 'add-card-picker__card-name'
    name.textContent = card.name

    const metadata = document.createElement('span')
    metadata.className = 'add-card-picker__metadata'
    metadata.textContent = `${card.cardClass} · ${formatExpansionName(card.expansionId)} · ${card.type}${card.collectible ? '' : ' · Non-collectible'}`

    row.append(cost, name, metadata)
    row.addEventListener('click', () => void this.handleCardSelect(card.id))
    return row
  }

  private async handleCardSelect(cardId: CardId): Promise<void> {
    if (!this.isOpen || this.isSubmitting) return

    this.isSubmitting = true
    this.updateSubmissionState()
    this.setStatus('Adding card…', 'info')

    try {
      await this.options.onSelect(cardId)
      this.isSubmitting = false
      this.updateSubmissionState()
      this.setStatus(this.successMessage, 'info')
      this.searchInput.focus()
    } catch (error) {
      this.isSubmitting = false
      this.updateSubmissionState()
      this.setStatus(errorMessage(error), 'error')
    }
  }

  private updateSubmissionState(): void {
    this.searchInput.disabled = this.isSubmitting
    this.classFilter.disabled = this.isSubmitting
    this.expansionFilter.disabled = this.isSubmitting
    this.collectibleFilter.disabled = this.isSubmitting
    this.closeButton.disabled = this.isSubmitting

    const rows = this.resultsViewport.querySelectorAll<HTMLButtonElement>('button')
    for (const row of rows) row.disabled = this.isSubmitting
  }

  private updateLayout(): void {
    const viewport = resolveDesignViewport(this.options.canvas, this.options.parent)
    if (!viewport) return

    const { scale } = viewport
    this.root.style.left = `${viewport.left}px`
    this.root.style.top = `${viewport.top}px`
    this.root.style.width = `${ADD_CARD_PICKER_LAYOUT.overlay.size.width * scale}px`
    this.root.style.height = `${ADD_CARD_PICKER_LAYOUT.overlay.size.height * scale}px`
    this.root.style.setProperty('--add-card-picker-scale', String(scale))
    this.root.style.setProperty(
      '--add-card-picker-row-cost-width',
      `${ADD_CARD_PICKER_ROW_LAYOUT.costWidth * scale}px`
    )
    this.root.style.setProperty(
      '--add-card-picker-row-metadata-width',
      `${ADD_CARD_PICKER_ROW_LAYOUT.metadataWidth * scale}px`
    )

    applyDomPlacement(this.panel, ADD_CARD_PICKER_LAYOUT.panel, scale)
    applyDomPlacement(this.title, ADD_CARD_PICKER_LAYOUT.title, scale)
    applyDomPlacement(this.closeButton, ADD_CARD_PICKER_LAYOUT.closeButton, scale)
    applyDomPlacement(this.searchInput, ADD_CARD_PICKER_LAYOUT.searchInput, scale)
    applyDomPlacement(this.classFilter, ADD_CARD_PICKER_LAYOUT.classFilter, scale)
    applyDomPlacement(
      this.expansionFilter,
      ADD_CARD_PICKER_LAYOUT.expansionFilter,
      scale
    )
    const collectibleLabel = this.collectibleFilter.parentElement
    if (collectibleLabel) {
      applyDomPlacement(
        collectibleLabel,
        ADD_CARD_PICKER_LAYOUT.collectibleFilter,
        scale
      )
    }
    applyDomPlacement(this.status, ADD_CARD_PICKER_LAYOUT.status, scale)
    applyDomPlacement(this.resultCount, ADD_CARD_PICKER_LAYOUT.resultCount, scale)
    applyDomPlacement(
      this.resultsViewport,
      ADD_CARD_PICKER_LAYOUT.resultsViewport,
      scale
    )

    const rows = this.resultsViewport.querySelectorAll<HTMLButtonElement>('button')
    for (const row of rows) {
      row.style.height = `${ADD_CARD_PICKER_ROW_LAYOUT.height * scale}px`
      row.style.marginBottom = `${ADD_CARD_PICKER_ROW_LAYOUT.gap * scale}px`
    }
    const lastRow = rows.item(rows.length - 1)
    if (lastRow) lastRow.style.marginBottom = '0px'
  }

  private readonly handleResize = (): void => this.updateLayout()

  private readonly handleBackdropClick = (): void => this.close()

  private readonly handleCloseClick = (): void => this.close()

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.repeat) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.close()
  }

  private readonly handleSearchInput = (): void => {
    this.filters = { ...this.filters, query: this.searchInput.value }
    this.renderResults()
    this.updateLayout()
  }

  private readonly handleClassFilterChange = (): void => {
    this.filters = { ...this.filters, cardClass: this.classFilter.value }
    this.renderResults()
    this.updateLayout()
  }

  private readonly handleExpansionFilterChange = (): void => {
    this.filters = { ...this.filters, expansionId: this.expansionFilter.value }
    this.renderResults()
    this.updateLayout()
  }

  private readonly handleCollectibleFilterChange = (): void => {
    this.filters = {
      ...this.filters,
      collectibleOnly: this.collectibleFilter.checked
    }
    this.renderResults()
    this.updateLayout()
  }
}

interface DesignViewport {
  readonly left: number
  readonly top: number
  readonly scale: number
}

function resolveDesignViewport(
  canvas: HTMLCanvasElement,
  parent: HTMLElement
): DesignViewport | null {
  const canvasBounds = canvas.getBoundingClientRect()
  const parentBounds = parent.getBoundingClientRect()
  if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return null

  const scale = Math.min(
    canvasBounds.width / GAME_WIDTH,
    canvasBounds.height / GAME_HEIGHT
  )
  const offsetX = (canvasBounds.width - GAME_WIDTH * scale) / 2
  const offsetY = (canvasBounds.height - GAME_HEIGHT * scale) / 2

  return {
    left: canvasBounds.left - parentBounds.left + offsetX,
    top: canvasBounds.top - parentBounds.top + offsetY,
    scale
  }
}

function applyDomPlacement(
  element: HTMLElement,
  placement: LayoutPlacement,
  viewportScale: number
): void {
  const elementScaleX = placement.scale?.x ?? 1
  const elementScaleY = placement.scale?.y ?? 1
  const width = placement.size.width * elementScaleX
  const height = placement.size.height * elementScaleY

  element.style.left = `${(placement.position.x - width * placement.anchor.x) * viewportScale}px`
  element.style.top = `${(placement.position.y - height * placement.anchor.y) * viewportScale}px`
  element.style.width = `${width * viewportScale}px`
  element.style.height = `${height * viewportScale}px`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
