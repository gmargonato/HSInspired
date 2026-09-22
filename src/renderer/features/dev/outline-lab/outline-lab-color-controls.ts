import type { Renderer } from 'pixi.js'
import { OUTLINE_LAB_LAYOUT } from './outline-lab-layout'
import type {
  OutlinePalette,
  OutlinePaletteName
} from '../../../rendering/effects/outline-tuning'

type ColorKey = keyof OutlinePalette

const COLOR_FIELDS: readonly { key: ColorKey; label: string }[] = [
  { key: 'baseColor', label: 'Base' },
  { key: 'outerColor', label: 'Outer' },
  { key: 'glowColor', label: 'Glow' },
  { key: 'highlightColor', label: 'Highlight' }
]

const BOUNDS = OUTLINE_LAB_LAYOUT.colorControls

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export interface OutlineLabColorControlsOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly onColorChange: (key: ColorKey, color: number) => void
}

/** Native color pickers positioned over the Shader Lab's fixed Pixi canvas. */
export class OutlineLabColorControls {
  private readonly root = document.createElement('section')
  private readonly title = document.createElement('div')
  private readonly fields = new Map<
    ColorKey,
    { picker: HTMLInputElement; hex: HTMLInputElement }
  >()
  private readonly resizeHandler = (): void => this.updatePosition()

  constructor(private readonly options: OutlineLabColorControlsOptions) {
    this.root.className = 'outline-lab-colors'
    this.root.setAttribute('aria-label', 'Outline palette colors')
    this.title.className = 'outline-lab-colors__title'
    this.root.appendChild(this.title)

    const grid = document.createElement('div')
    grid.className = 'outline-lab-colors__grid'
    for (const { key, label } of COLOR_FIELDS) {
      const row = document.createElement('div')
      row.className = 'outline-lab-colors__row'
      const caption = document.createElement('span')
      caption.textContent = label
      const picker = document.createElement('input')
      picker.type = 'color'
      picker.setAttribute('aria-label', `${label} color`)
      const hex = document.createElement('input')
      hex.type = 'text'
      hex.maxLength = 7
      hex.spellcheck = false
      hex.setAttribute('aria-label', `${label} hex color`)

      picker.addEventListener('input', () => {
        hex.value = picker.value.toUpperCase()
        hex.setCustomValidity('')
        options.onColorChange(key, Number.parseInt(picker.value.slice(1), 16))
      })
      hex.addEventListener('change', () => {
        const candidate = hex.value.trim()
        if (!/^#?[0-9a-fA-F]{6}$/.test(candidate)) {
          hex.setCustomValidity('Enter a six-digit hex color.')
          hex.reportValidity()
          return
        }
        const color = Number.parseInt(candidate.replace(/^#/, ''), 16)
        hex.setCustomValidity('')
        hex.value = toHex(color).toUpperCase()
        picker.value = toHex(color)
        options.onColorChange(key, color)
      })
      hex.addEventListener('input', () => hex.setCustomValidity(''))
      hex.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') hex.blur()
      })

      row.append(caption, picker, hex)
      grid.appendChild(row)
      this.fields.set(key, { picker, hex })
    }
    this.root.appendChild(grid)
    options.parent.appendChild(this.root)
    options.renderer.on('resize', this.resizeHandler)
    this.updatePosition()
  }

  setPalette(name: OutlinePaletteName, palette: OutlinePalette): void {
    this.title.textContent = `${name.toUpperCase()} PALETTE COLORS`
    for (const { key } of COLOR_FIELDS) {
      const field = this.fields.get(key)!
      field.picker.value = toHex(palette[key])
      field.hex.value = toHex(palette[key]).toUpperCase()
      field.hex.setCustomValidity('')
    }
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
  }

  dispose(): void {
    this.options.renderer.off('resize', this.resizeHandler)
    this.root.remove()
  }

  private updatePosition(): void {
    const canvasBounds = this.options.canvas.getBoundingClientRect()
    const parentBounds = this.options.parent.getBoundingClientRect()
    const scale = Math.min(canvasBounds.width / 1920, canvasBounds.height / 1080)
    const offsetX = (canvasBounds.width - 1920 * scale) / 2
    const offsetY = (canvasBounds.height - 1080 * scale) / 2
    this.root.style.left = `${canvasBounds.left - parentBounds.left + offsetX + BOUNDS.x * scale}px`
    this.root.style.top = `${canvasBounds.top - parentBounds.top + offsetY + BOUNDS.y * scale}px`
    this.root.style.width = `${BOUNDS.width}px`
    this.root.style.transform = `scale(${scale})`
  }
}
