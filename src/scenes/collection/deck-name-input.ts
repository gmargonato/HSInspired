import type { Renderer } from 'pixi.js'
import { MAX_DECK_NAME_LENGTH } from '../../game-rules/decks'
import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'

export interface DeckNameInputOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly onMessage?: (message: string) => void
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
    input.addEventListener('beforeinput', this.handleBeforeInput)
    input.addEventListener('paste', this.handlePaste)
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
    this.input.removeEventListener('beforeinput', this.handleBeforeInput)
    this.input.removeEventListener('paste', this.handlePaste)
    this.input.remove()
    this.input = null
  }

  private readonly selectAll = (): void => this.input?.select()

  private checkInsertedText(text: string): void {
    const input = this.input
    if (!input) return
    const selectedLength = (input.selectionEnd ?? 0) - (input.selectionStart ?? 0)
    if (input.value.length - selectedLength + text.length > MAX_DECK_NAME_LENGTH) {
      this.options.onMessage?.(
        `Deck names can contain up to ${MAX_DECK_NAME_LENGTH} characters.`
      )
    }
  }

  private readonly handleBeforeInput = (event: InputEvent): void => {
    if (event.inputType.startsWith('insert') && event.data)
      this.checkInsertedText(event.data)
  }

  private readonly handlePaste = (event: ClipboardEvent): void => {
    this.checkInsertedText(event.clipboardData?.getData('text') ?? '')
  }

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
