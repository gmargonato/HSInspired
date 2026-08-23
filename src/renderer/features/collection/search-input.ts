import { GAME_HEIGHT, GAME_WIDTH } from '../../app/config'
import type { Renderer } from 'pixi.js'

export interface CollectionSearchInputBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CollectionSearchInputOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly bounds: CollectionSearchInputBounds
  readonly onInput: (value: string) => void
}

/** DOM adapter for the collection search control over the Pixi canvas. */
export class CollectionSearchInput {
  private input: HTMLInputElement | null = null
  private readonly resizeHandler = (): void => this.updatePosition()

  constructor(private readonly options: CollectionSearchInputOptions) {}

  mount(initialValue = ''): void {
    if (this.input) return

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'collection-search-input'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('aria-label', 'Search cards')
    input.value = initialValue
    input.addEventListener('input', this.handleInput)
    this.options.parent.appendChild(input)

    this.input = input
    this.options.renderer.on('resize', this.resizeHandler)
    this.updatePosition()
  }

  get value(): string {
    return this.input?.value ?? ''
  }

  setValue(value: string): void {
    if (this.input) this.input.value = value
  }

  focus(): void {
    this.input?.focus()
  }

  setVisible(visible: boolean): void {
    if (this.input) this.input.style.visibility = visible ? 'visible' : 'hidden'
  }

  setEnabled(enabled: boolean): void {
    if (!this.input) return
    this.input.disabled = !enabled
    this.setVisible(enabled)
  }

  dispose(): void {
    const input = this.input
    if (!input) return

    this.options.renderer.off('resize', this.resizeHandler)
    input.removeEventListener('input', this.handleInput)
    input.remove()
    this.input = null
  }

  private readonly handleInput = (): void => {
    this.options.onInput(this.value)
  }

  private updatePosition(): void {
    const input = this.input
    const canvas = this.options.canvas
    const parent = this.options.parent
    if (!input) return

    const canvasBounds = canvas.getBoundingClientRect()
    const parentBounds = parent.getBoundingClientRect()
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
