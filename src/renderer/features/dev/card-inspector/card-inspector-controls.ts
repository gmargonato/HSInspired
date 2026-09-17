import { Container, type Renderer } from 'pixi.js'
import { GAME_HEIGHT, GAME_WIDTH } from '../../../rendering/layout'
import {
  CLASS_FRAME_BLEND_MODES,
  type ClassFrameMaskChannel
} from '../../../rendering/cards/class-frame-colors'
import {
  CardInspectorModel,
  CARD_LAB_TEMPLATES,
  type CardLabTemplate,
  NUMERIC_CONTROL_SPECS,
  type NumericControlSpec
} from './card-inspector-model'

const CONTROL_BOUNDS = { x: 20, y: 60, width: 1010, height: 1000 } as const

interface FieldState {
  readonly channel: ClassFrameMaskChannel
  readonly spec: NumericControlSpec
  readonly range: HTMLInputElement
  readonly number: HTMLInputElement
}

export interface CardInspectorControlsOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly model: CardInspectorModel
  readonly onAppearanceChanged: () => void
  readonly onCommit: () => void
  readonly onSelectionChanged: () => void
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag)
  value.className = className
  if (text !== undefined) value.textContent = text
  return value
}

/** DOM-backed precision controls positioned over the fixed Pixi design canvas. */
export class CardInspectorControls extends Container {
  private readonly model: CardInspectorModel
  private readonly fields: FieldState[] = []
  private readonly classButtons = new Map<string, HTMLButtonElement>()
  private readonly templateButtons = new Map<CardLabTemplate, HTMLButtonElement>()
  private readonly premiumButtons = new Map<boolean, HTMLButtonElement>()
  private readonly channelPanels = new Map<ClassFrameMaskChannel, HTMLElement>()
  private readonly blendSelects = new Map<ClassFrameMaskChannel, HTMLSelectElement>()
  private readonly rootElement = element('section', 'card-color-lab')
  private readonly status = element('div', 'card-color-lab__status')
  private readonly previewNotice = element('p', 'card-color-lab__notice')
  private readonly columns = element('div', 'card-color-lab__columns')
  private readonly subtitle = element(
    'p',
    'card-color-lab__subtitle',
    'Autosaved · Colors shared between variants · Offsets apply to the selected variant and template across all classes'
  )
  private readonly resizeHandler = (): void => this.updatePosition()

  constructor(private readonly options: CardInspectorControlsOptions) {
    super()
    this.model = options.model
    this.label = 'dev.card-inspector.controls'
    this.build()
    options.parent.appendChild(this.rootElement)
    options.renderer.on('resize', this.resizeHandler)
    this.updatePosition()
    this.refresh()
  }

  refresh(): void {
    const singleMask = !this.model.hasSecondaryMask
    this.rootElement.classList.toggle('is-single-mask', singleMask)
    for (const [classId, button] of this.classButtons) {
      button.classList.toggle('is-selected', classId === this.model.selectedClass)
      button.disabled = !this.model.hasCardForClass(
        classId as typeof this.model.selectedClass
      )
    }
    for (const [template, button] of this.templateButtons) {
      button.classList.toggle('is-selected', template === this.model.selectedTemplate)
    }
    for (const [premium, button] of this.premiumButtons) {
      button.classList.toggle('is-selected', premium === this.model.selectedPremium)
      button.hidden = false
    }
    const hasMask = this.model.maskTemplate !== undefined
    this.rootElement.style.height = hasMask ? `${CONTROL_BOUNDS.height}px` : 'auto'
    this.subtitle.hidden = !hasMask
    this.status.hidden = !hasMask
    this.columns.hidden = !hasMask
    this.previewNotice.hidden = hasMask
    this.previewNotice.textContent =
      this.model.selectedTemplate === 'hero'
        ? 'Hero cards use dedicated standard and premium frames and have no editable class mask.'
        : 'Weapon cards have no editable class mask. Switch between Standard and Premium to preview both frames.'
    for (const [channel, panel] of this.channelPanels) {
      panel.hidden = singleMask && channel === 'secondary'
      this.blendSelects.get(channel)!.value = this.model.getLayer(channel).blendMode
    }
    for (const field of this.fields) this.refreshField(field)
  }

  setVisible(visible: boolean): void {
    this.rootElement.hidden = !visible
  }

  setStatus(message: string): void {
    this.status.textContent = message
  }

  dispose(): void {
    this.options.renderer.off('resize', this.resizeHandler)
    this.rootElement.remove()
  }

  private build(): void {
    const title = element('h1', 'card-color-lab__title', 'CARD LAB')
    this.rootElement.append(title, this.subtitle)

    const toolbar = element('div', 'card-color-lab__toolbar')
    const classPicker = element('div', 'card-color-lab__classes')
    for (const classId of this.model.classes) {
      const button = element('button', 'card-color-lab__button', classId)
      button.type = 'button'
      button.addEventListener('click', () => {
        this.model.selectedClass = classId as typeof this.model.selectedClass
        this.options.onSelectionChanged()
        this.refresh()
      })
      this.classButtons.set(classId, button)
      classPicker.appendChild(button)
    }

    const templatePicker = element('div', 'card-color-lab__templates')
    for (const template of CARD_LAB_TEMPLATES) {
      const button = element(
        'button',
        'card-color-lab__button',
        template[0].toUpperCase() + template.slice(1)
      )
      button.type = 'button'
      button.addEventListener('click', () => {
        this.model.selectedTemplate = template
        this.options.onSelectionChanged()
        this.refresh()
      })
      this.templateButtons.set(template, button)
      templatePicker.appendChild(button)
    }

    const premiumPicker = element('div', 'card-color-lab__templates')
    for (const premium of [false, true]) {
      const button = element(
        'button',
        'card-color-lab__button',
        premium ? 'Premium' : 'Standard'
      )
      button.type = 'button'
      button.addEventListener('click', () => {
        this.model.selectedPremium = premium
        this.options.onSelectionChanged()
        this.refresh()
      })
      this.premiumButtons.set(premium, button)
      premiumPicker.appendChild(button)
    }

    toolbar.append(classPicker, templatePicker, premiumPicker)
    this.rootElement.appendChild(toolbar)

    this.columns.append(
      this.createChannelPanel('primary', 'PRIMARY MASK'),
      this.createChannelPanel('secondary', 'SECONDARY MASK')
    )
    this.rootElement.append(this.columns, this.previewNotice, this.status)
    this.status.textContent = 'Saved production configuration.'
  }

  private createChannelPanel(
    channel: ClassFrameMaskChannel,
    title: string
  ): HTMLElement {
    const panel = element('section', 'card-color-lab__mask')
    const heading = element('h2', 'card-color-lab__mask-title', title)
    panel.appendChild(heading)

    const blendLabel = element('label', 'card-color-lab__blend-label', 'Blend mode')
    const blend = element('select', 'card-color-lab__blend')
    for (const mode of CLASS_FRAME_BLEND_MODES) {
      const option = document.createElement('option')
      option.value = mode
      option.textContent = mode
      blend.appendChild(option)
    }
    blend.addEventListener('change', () => {
      this.model.setBlendMode(
        channel,
        blend.value as (typeof CLASS_FRAME_BLEND_MODES)[number]
      )
      this.options.onAppearanceChanged()
      this.options.onCommit()
      this.refresh()
    })
    blendLabel.appendChild(blend)
    panel.appendChild(blendLabel)
    this.blendSelects.set(channel, blend)

    for (const spec of NUMERIC_CONTROL_SPECS) {
      panel.appendChild(this.createNumericField(channel, spec))
    }
    this.channelPanels.set(channel, panel)
    return panel
  }

  private createNumericField(
    channel: ClassFrameMaskChannel,
    spec: NumericControlSpec
  ): HTMLElement {
    const row = element('label', 'card-color-lab__field')
    const caption = element('span', 'card-color-lab__field-label', spec.label)
    const range = element('input', 'card-color-lab__range')
    range.type = 'range'
    range.min = String(spec.min * spec.displayScale)
    range.max = String(spec.max * spec.displayScale)
    range.step = '1'
    const number = element('input', 'card-color-lab__number')
    number.type = 'number'
    number.min = String(spec.min * spec.displayScale)
    number.max = String(spec.max * spec.displayScale)
    number.step = String(spec.step * spec.displayScale)
    number.setAttribute('aria-label', `${channel} ${spec.label}`)
    const suffix = element('span', 'card-color-lab__suffix', spec.suffix)
    const state = { channel, spec, range, number }
    this.fields.push(state)

    range.addEventListener('input', () => {
      this.model.setNumeric(channel, spec.key, Number(range.value) / spec.displayScale)
      this.options.onAppearanceChanged()
      this.refresh()
    })
    range.addEventListener('change', this.options.onCommit)
    number.addEventListener('focus', () => {
      number.dataset.previous = number.value
      number.select()
    })
    number.addEventListener('input', () => {
      if (number.value.trim() === '') return
      const value = Number(number.value)
      if (!Number.isFinite(value)) return
      this.model.setNumeric(channel, spec.key, value / spec.displayScale)
      this.options.onAppearanceChanged()
      this.refreshField(state)
    })
    number.addEventListener('blur', () => {
      this.refreshField(state)
      this.options.onCommit()
    })
    number.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') number.blur()
      if (event.key === 'Escape') {
        const previous = Number(number.dataset.previous)
        if (Number.isFinite(previous)) {
          this.model.setNumeric(channel, spec.key, previous / spec.displayScale)
          this.options.onAppearanceChanged()
        }
        number.blur()
      }
    })
    row.append(caption, range, number, suffix)
    return row
  }

  private refreshField(field: FieldState): void {
    const value = this.model.getNumeric(field.channel, field.spec.key)
    const displayed = String(Math.round(value * field.spec.displayScale))
    field.range.value = displayed
    field.number.value = displayed
  }

  private updatePosition(): void {
    const canvasBounds = this.options.canvas.getBoundingClientRect()
    const parentBounds = this.options.parent.getBoundingClientRect()
    const scale = Math.min(
      canvasBounds.width / GAME_WIDTH,
      canvasBounds.height / GAME_HEIGHT
    )
    const offsetX = (canvasBounds.width - GAME_WIDTH * scale) / 2
    const offsetY = (canvasBounds.height - GAME_HEIGHT * scale) / 2
    this.rootElement.style.left = `${canvasBounds.left - parentBounds.left + offsetX + CONTROL_BOUNDS.x * scale}px`
    this.rootElement.style.top = `${canvasBounds.top - parentBounds.top + offsetY + CONTROL_BOUNDS.y * scale}px`
    this.rootElement.style.width = `${CONTROL_BOUNDS.width}px`
    this.rootElement.style.height = this.model.maskTemplate
      ? `${CONTROL_BOUNDS.height}px`
      : 'auto'
    this.rootElement.style.transform = `scale(${scale})`
  }
}
