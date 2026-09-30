import type { Renderer } from 'pixi.js'
import { MAX_DECK_NAME_LENGTH } from '../../game-rules/decks'
import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'

export interface DeckNameInputOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

/** DOM text input precisely overlaid on the locked Collection deck frame. */
export class DeckNameInput {
  private input: HTMLInputElement | null = null
  private readonly resizeHandler = (): void => this.updatePosition()

  constructor(private readonly options: DeckNameInputOptions) {}

  mount(): void {
    if (this.input) return
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'collection-deck-name-input'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.maxLength = MAX_DECK_NAME_LENGTH
    input.setAttribute('aria-label', 'Deck name')
    input.addEventListener('click', this.selectAll)
    this.options.parent.appendChild(input)
    this.input = input
    this.options.renderer.on('resize', this.resizeHandler)
    this.setEnabled(false)
    this.updatePosition()
  }

  get value(): string {
    return this.input?.value ?? ''
  }

  setValue(value: string): void {
    if (this.input) this.input.value = value.slice(0, MAX_DECK_NAME_LENGTH)
  }

  focus(): void {
    this.input?.focus()
    this.input?.select()
  }

  setEnabled(enabled: boolean): void {
    if (!this.input) return
    this.input.disabled = !enabled
    this.input.style.visibility = enabled ? 'visible' : 'hidden'
  }

  dispose(): void {
    if (!this.input) return
    this.options.renderer.off('resize', this.resizeHandler)
    this.input.removeEventListener('click', this.selectAll)
    this.input.remove()
    this.input = null
  }

  private readonly selectAll = (): void => this.input?.select()

  private updatePosition(): void {
    const input = this.input
    if (!input) return
    const canvasBounds = this.options.canvas.getBoundingClientRect()
    const parentBounds = this.options.parent.getBoundingClientRect()
    const scale = Math.min(
      canvasBounds.width / GAME_WIDTH,
      canvasBounds.height / GAME_HEIGHT
    )
    const offsetX = (canvasBounds.width - GAME_WIDTH * scale) / 2
    const offsetY = (canvasBounds.height - GAME_HEIGHT * scale) / 2
    const bounds = this.options.bounds
    input.style.left = `${canvasBounds.left - parentBounds.left + offsetX + bounds.x * scale}px`
    input.style.top = `${canvasBounds.top - parentBounds.top + offsetY + bounds.y * scale}px`
    input.style.width = `${bounds.width * scale}px`
    input.style.height = `${bounds.height * scale}px`
    input.style.fontSize = `${24 * scale}px`
  }
}
