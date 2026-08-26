import {
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
  type FederatedWheelEvent
} from 'pixi.js'
import type { CardDefinition } from '../../../../game/content/cards'
import { CLASS_FRAME_DEFAULT_CONTROLS } from '../../../rendering/cards/class-frame-colors'
import type {
  ClassFrameAppearanceControls,
  ClassFrameBlendMode,
  ClassFrameLayerControls
} from '../../../rendering/cards/class-frame-colors'

const LIST_WIDTH = 390
const CONTROL_X = 410
const CONTROL_WIDTH = 220
const PANEL_HEIGHT = 1040
const LIST_TOP = 62
const LIST_HEIGHT = PANEL_HEIGHT - LIST_TOP - 12
const ROW_HEIGHT = 32
const ROW_WIDTH = LIST_WIDTH - 16
const SLIDER_WIDTH = CONTROL_WIDTH - 20
const PRIMARY_CONTROLS_TOP = 82
const ACCENT_CONTROLS_TOP = 505
const BLEND_MODES: readonly ClassFrameBlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'add'
]

type MaskChannel = 'primary' | 'accent'

interface InspectorMaskAppearance extends ClassFrameLayerControls {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
  readonly blendMode: ClassFrameBlendMode
}

interface InspectorFrameAppearance {
  readonly primary: InspectorMaskAppearance
  readonly accent: InspectorMaskAppearance
}

interface MaskControlSet {
  readonly modeButtonLabel: Text
  readonly hueSlider: SliderState
  readonly saturationSlider: SliderState
  readonly lightnessSlider: SliderState
}

interface SliderState {
  readonly min: number
  readonly max: number
  readonly width: number
  readonly track: Container
  readonly knob: Graphics
  readonly valueLabel: Text
  readonly formatValue: (value: number) => string
  readonly onChange: (value: number) => void
  value: number
}

export interface CardInspectorControlsOptions {
  readonly cards: readonly CardDefinition[]
  readonly initialCardId: string
  readonly onCardSelected: (card: CardDefinition) => void
  readonly onFrameAppearanceChanged: (appearance: ClassFrameAppearanceControls) => void
}

/** Development-only card list and independent primary/accent mask controls. */
export class CardInspectorControls extends Container {
  private readonly cards: readonly CardDefinition[]
  private readonly onCardSelected: (card: CardDefinition) => void
  private readonly onFrameAppearanceChanged: (
    appearance: ClassFrameAppearanceControls
  ) => void
  private readonly listViewport: Container
  private readonly listContent: Container
  private readonly selectionLabel: Text
  private readonly maskControls: Record<MaskChannel, MaskControlSet>
  private selectedIndex: number
  private scrollOffset = 0
  private maxScroll = 0
  private activeSlider: SliderState | null = null
  private frameAppearance: InspectorFrameAppearance = {
    primary: {
      ...CLASS_FRAME_DEFAULT_CONTROLS.primary,
      blendMode: 'normal'
    },
    accent: {
      ...CLASS_FRAME_DEFAULT_CONTROLS.accent,
      blendMode: 'normal'
    }
  }

  constructor(options: CardInspectorControlsOptions) {
    super()
    this.cards = options.cards
    this.onCardSelected = options.onCardSelected
    this.onFrameAppearanceChanged = options.onFrameAppearanceChanged
    this.selectedIndex = Math.max(
      0,
      this.cards.findIndex((card) => card.id === options.initialCardId)
    )
    this.position.set(20, 20)
    this.label = 'dev.card-inspector.controls'
    this.eventMode = 'static'

    this.addPanel(0, LIST_WIDTH, 'CARD LIST')
    this.addPanel(CONTROL_X, CONTROL_WIDTH, 'MASK CONTROLS')

    this.selectionLabel = new Text({
      text: '',
      style: { fontFamily: 'Arial', fontSize: 14, fill: 0xd8c49a }
    })
    this.selectionLabel.position.set(12, 39)
    this.addChild(this.selectionLabel)

    const listMask = new Graphics()
      .rect(0, 0, ROW_WIDTH, LIST_HEIGHT)
      .fill({ color: 0xffffff })
    listMask.position.set(8, LIST_TOP)
    listMask.eventMode = 'none'
    this.addChild(listMask)

    this.listViewport = new Container()
    this.listViewport.position.set(8, LIST_TOP)
    this.listViewport.hitArea = new Rectangle(0, 0, ROW_WIDTH, LIST_HEIGHT)
    this.listViewport.eventMode = 'static'
    this.listViewport.cursor = 'default'
    this.listViewport.mask = listMask
    this.listViewport.on('wheel', this.handleWheel)
    this.addChild(this.listViewport)

    this.listContent = new Container()
    this.listViewport.addChild(this.listContent)

    const controlsHint = new Text({
      text: 'Absolute HSL values; each mask is independently controlled.',
      style: {
        fontFamily: 'Arial',
        fontSize: 13,
        fill: 0xaab6cf,
        wordWrap: true,
        wordWrapWidth: CONTROL_WIDTH - 20
      }
    })
    controlsHint.position.set(CONTROL_X + 10, 39)
    this.addChild(controlsHint)

    this.maskControls = {
      primary: this.createMaskControls('primary', 'PRIMARY MASK', PRIMARY_CONTROLS_TOP),
      accent: this.createMaskControls('accent', 'ACCENT MASK', ACCENT_CONTROLS_TOP)
    }

    const resetButton = this.createActionButton(
      CONTROL_X + 10,
      920,
      CONTROL_WIDTH - 20,
      38,
      () => {
        this.frameAppearance = {
          primary: { ...CLASS_FRAME_DEFAULT_CONTROLS.primary, blendMode: 'normal' },
          accent: { ...CLASS_FRAME_DEFAULT_CONTROLS.accent, blendMode: 'normal' }
        }
        for (const channel of ['primary', 'accent'] as const) {
          const controls = this.maskControls[channel]
          this.setSliderValue(
            controls.hueSlider,
            CLASS_FRAME_DEFAULT_CONTROLS[channel].hue,
            false
          )
          this.setSliderValue(
            controls.saturationSlider,
            CLASS_FRAME_DEFAULT_CONTROLS[channel].saturation,
            false
          )
          this.setSliderValue(
            controls.lightnessSlider,
            CLASS_FRAME_DEFAULT_CONTROLS[channel].lightness,
            false
          )
          this.refreshModeButton(channel)
        }
        this.emitFrameAppearance()
      }
    )
    const resetLabel = new Text({
      text: 'Reset both masks',
      style: { fontFamily: 'Arial', fontSize: 15, fill: 0xffffff }
    })
    resetLabel.anchor.set(0.5)
    resetLabel.position.set((CONTROL_WIDTH - 20) / 2, 19)
    resetButton.addChild(resetLabel)

    const neutralHint = new Text({
      text: 'Neutral cards intentionally ignore the mask controls.',
      style: {
        fontFamily: 'Arial',
        fontSize: 13,
        fill: 0xaab6cf,
        wordWrap: true,
        wordWrapWidth: CONTROL_WIDTH - 20
      }
    })
    neutralHint.position.set(CONTROL_X + 10, 970)
    this.addChild(neutralHint)

    this.refreshRows()
  }

  private addPanel(x: number, width: number, title: string): void {
    const panel = new Graphics()
      .roundRect(x, 0, width, PANEL_HEIGHT, 10)
      .fill({ color: 0x121a2c, alpha: 0.94 })
      .stroke({ color: 0x4b5877, width: 2, alpha: 0.8 })
    panel.eventMode = 'none'
    this.addChild(panel)

    const heading = new Text({
      text: title,
      style: { fontFamily: 'Arial', fontSize: 18, fill: 0xffffff, fontWeight: 'bold' }
    })
    heading.position.set(x + 12, 12)
    this.addChild(heading)
  }

  private createMaskControls(
    channel: MaskChannel,
    title: string,
    top: number
  ): MaskControlSet {
    const sectionLabel = new Text({
      text: title,
      style: { fontFamily: 'Arial', fontSize: 14, fill: 0xf1d36a, fontWeight: 'bold' }
    })
    sectionLabel.position.set(CONTROL_X + 10, top)
    this.addChild(sectionLabel)

    const modeButtonLabel = new Text({
      text: '',
      style: { fontFamily: 'Arial', fontSize: 16, fill: 0xffffff, align: 'center' }
    })
    const modeButton = this.createActionButton(
      CONTROL_X + 10,
      top + 32,
      CONTROL_WIDTH - 20,
      42,
      () => {
        const currentIndex = BLEND_MODES.indexOf(
          this.frameAppearance[channel].blendMode
        )
        const nextMode =
          BLEND_MODES[(currentIndex + 1) % BLEND_MODES.length] ?? 'normal'
        this.updateMaskAppearance(channel, { blendMode: nextMode })
        this.refreshModeButton(channel)
      }
    )
    modeButton.addChild(modeButtonLabel)
    modeButtonLabel.anchor.set(0.5)
    modeButtonLabel.position.set((CONTROL_WIDTH - 20) / 2, 21)

    const hueSlider = this.createSlider(
      'Hue',
      top + 110,
      0,
      360,
      CLASS_FRAME_DEFAULT_CONTROLS[channel].hue,
      (value) => this.updateMaskAppearance(channel, { hue: value }),
      (value) => `${Math.round(value)}°`
    )
    const saturationSlider = this.createSlider(
      'Saturation',
      top + 210,
      0,
      1,
      CLASS_FRAME_DEFAULT_CONTROLS[channel].saturation,
      (value) => this.updateMaskAppearance(channel, { saturation: value }),
      (value) => `${Math.round(value * 100)}%`
    )
    const lightnessSlider = this.createSlider(
      'Lightness',
      top + 310,
      0,
      1,
      CLASS_FRAME_DEFAULT_CONTROLS[channel].lightness,
      (value) => this.updateMaskAppearance(channel, { lightness: value }),
      (value) => `${Math.round(value * 100)}%`
    )

    const controls = { modeButtonLabel, hueSlider, saturationSlider, lightnessSlider }
    this.refreshModeButton(channel, controls.modeButtonLabel)
    return controls
  }

  private createActionButton(
    x: number,
    y: number,
    width: number,
    height: number,
    onClick: () => void
  ): Container {
    const button = new Container()
    button.position.set(x, y)
    button.hitArea = new Rectangle(0, 0, width, height)
    button.eventMode = 'static'
    button.cursor = 'pointer'
    const background = new Graphics()
      .roundRect(0, 0, width, height, 6)
      .fill({ color: 0x2a416b, alpha: 0.95 })
      .stroke({ color: 0x6f8fc9, width: 1, alpha: 0.9 })
    background.eventMode = 'none'
    button.addChild(background)
    button.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      onClick()
    })
    this.addChild(button)
    return button
  }

  private createSlider(
    label: string,
    y: number,
    min: number,
    max: number,
    initial: number,
    onChange: (value: number) => void,
    formatValue: (value: number) => string
  ): SliderState {
    const title = new Text({
      text: label,
      style: { fontFamily: 'Arial', fontSize: 15, fill: 0xffffff }
    })
    title.position.set(CONTROL_X + 10, y)
    this.addChild(title)

    const valueLabel = new Text({
      text: formatValue(initial),
      style: { fontFamily: 'Arial', fontSize: 15, fill: 0xd8c49a, align: 'right' }
    })
    valueLabel.anchor.set(1, 0)
    valueLabel.position.set(CONTROL_X + CONTROL_WIDTH - 10, y)
    this.addChild(valueLabel)

    const track = new Container()
    track.position.set(CONTROL_X + 10, y + 30)
    track.hitArea = new Rectangle(0, -10, SLIDER_WIDTH, 24)
    track.eventMode = 'static'
    track.cursor = 'pointer'

    const trackBackground = new Graphics()
      .roundRect(0, 0, SLIDER_WIDTH, 8, 4)
      .fill({ color: 0x0b1020 })
      .stroke({ color: 0x637398, width: 1, alpha: 0.9 })
    trackBackground.eventMode = 'none'
    track.addChild(trackBackground)

    const knob = new Graphics().circle(0, 4, 8).fill({ color: 0xf1d36a })
    knob.eventMode = 'none'
    track.addChild(knob)
    this.addChild(track)

    const slider: SliderState = {
      min,
      max,
      width: SLIDER_WIDTH,
      track,
      knob,
      valueLabel,
      formatValue,
      onChange,
      value: initial
    }
    track.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      this.activeSlider = slider
      this.updateSliderFromEvent(slider, event)
      event.stopPropagation()
    })
    track.on('globalpointermove', (event: FederatedPointerEvent) => {
      if (this.activeSlider !== slider) return
      this.updateSliderFromEvent(slider, event)
    })
    track.on('pointerup', () => this.endSliderDrag(slider))
    track.on('pointerupoutside', () => this.endSliderDrag(slider))
    track.on('pointercancel', () => this.endSliderDrag(slider))
    this.updateSliderVisual(slider)
    return slider
  }

  private updateMaskAppearance(
    channel: MaskChannel,
    changes: Partial<InspectorMaskAppearance>
  ): void {
    const nextMask = { ...this.frameAppearance[channel], ...changes }
    this.frameAppearance =
      channel === 'primary'
        ? { ...this.frameAppearance, primary: nextMask }
        : { ...this.frameAppearance, accent: nextMask }
    this.emitFrameAppearance()
  }

  private updateSliderFromEvent(
    slider: SliderState,
    event: FederatedPointerEvent
  ): void {
    const local = slider.track.toLocal(event.global)
    const ratio = Math.min(1, Math.max(0, local.x / slider.width))
    this.setSliderValue(slider, slider.min + ratio * (slider.max - slider.min))
  }

  private setSliderValue(slider: SliderState, value: number, notify = true): void {
    slider.value = Math.min(slider.max, Math.max(slider.min, value))
    this.updateSliderVisual(slider)
    if (notify) slider.onChange(slider.value)
  }

  private updateSliderVisual(slider: SliderState): void {
    const ratio = (slider.value - slider.min) / (slider.max - slider.min)
    slider.knob.position.x = ratio * slider.width
    slider.valueLabel.text = slider.formatValue(slider.value)
  }

  private endSliderDrag(slider: SliderState): void {
    if (this.activeSlider === slider) this.activeSlider = null
  }

  private refreshModeButton(channel: MaskChannel, labelOverride?: Text): void {
    const label = labelOverride ?? this.maskControls[channel]?.modeButtonLabel
    if (!label) return
    label.text = `Blend: ${this.frameAppearance[channel].blendMode.toUpperCase()}`
  }

  private emitFrameAppearance(): void {
    this.onFrameAppearanceChanged({
      primary: { ...this.frameAppearance.primary },
      accent: { ...this.frameAppearance.accent }
    })
  }

  private refreshRows(): void {
    for (const child of this.listContent.removeChildren()) {
      child.destroy({ children: true })
    }

    this.maxScroll = Math.max(0, this.cards.length * ROW_HEIGHT - LIST_HEIGHT)
    this.scrollOffset = Math.min(this.scrollOffset, this.maxScroll)
    this.listContent.position.y = -this.scrollOffset

    const firstIndex = Math.max(0, Math.floor(this.scrollOffset / ROW_HEIGHT) - 1)
    const lastIndex = Math.min(
      this.cards.length,
      Math.ceil((this.scrollOffset + LIST_HEIGHT) / ROW_HEIGHT) + 1
    )
    for (let index = firstIndex; index < lastIndex; index += 1) {
      const card = this.cards[index]
      if (!card) continue
      this.listContent.addChild(this.createCardRow(card, index))
    }

    const selected = this.cards[this.selectedIndex]
    this.selectionLabel.text = selected
      ? `${selected.name} · ${selected.cardClass} · ${this.selectedIndex + 1}/${this.cards.length}`
      : 'No cards'
  }

  private createCardRow(card: CardDefinition, index: number): Container {
    const row = new Container()
    row.position.set(0, index * ROW_HEIGHT)
    row.hitArea = new Rectangle(0, 0, ROW_WIDTH, ROW_HEIGHT - 2)
    row.eventMode = 'static'
    row.cursor = 'pointer'
    row.label = `dev.card-inspector.row.${card.id}`

    const background = new Graphics()
      .roundRect(0, 0, ROW_WIDTH, ROW_HEIGHT - 3, 4)
      .fill({
        color: index === this.selectedIndex ? 0x355c93 : 0x202d48,
        alpha: index === this.selectedIndex ? 1 : 0.86
      })
    background.eventMode = 'none'
    row.addChild(background)

    const label = new Text({
      text: `${card.name} · ${card.cardClass} · ${card.type}`,
      style: {
        fontFamily: 'Arial',
        fontSize: 13,
        fill: index === this.selectedIndex ? 0xffffff : 0xd0d8e8
      }
    })
    label.position.set(8, 7)
    row.addChild(label)

    row.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      this.selectCard(index)
    })
    return row
  }

  private selectCard(index: number): void {
    const card = this.cards[index]
    if (!card) return
    this.selectedIndex = index
    this.ensureSelectedVisible()
    this.refreshRows()
    this.onCardSelected(card)
  }

  private ensureSelectedVisible(): void {
    const top = this.selectedIndex * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < this.scrollOffset) this.scrollOffset = top
    else if (bottom > this.scrollOffset + LIST_HEIGHT) {
      this.scrollOffset = bottom - LIST_HEIGHT
    }
  }

  private readonly handleWheel = (event: FederatedWheelEvent): void => {
    if (this.maxScroll === 0) return
    this.scrollOffset = Math.min(
      this.maxScroll,
      Math.max(0, this.scrollOffset + event.deltaY)
    )
    this.refreshRows()
    event.stopPropagation()
  }
}
