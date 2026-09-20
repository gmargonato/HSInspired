import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent
} from 'pixi.js'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  AssetScope,
  CardAssetResolver
} from '../../../ui/asset-registry'
import {
  AnimatedOutline,
  type OutlinePaletteName,
  type OutlinePresetName,
  type OutlineTuning
} from '../../../rendering/effects/animated-outline'
import {
  getOutlineTuningConfig,
  updateOutlineTuningConfig
} from '../../../rendering/effects/outline-tuning'

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080
const PREVIEW_PANEL = { x: 40, y: 185, width: 1120, height: 850 } as const
const CONTROLS_PANEL = { x: 1180, y: 185, width: 700, height: 850 } as const
const SLIDER_WIDTH = 205
const TUNING_ROW_HEIGHT = 112
const GEOMETRY_COLUMN_COUNT = 6

const PRESETS: readonly OutlinePresetName[] = [
  'card',
  'bonus-card',
  'board',
  'button',
  'ghost'
]
const PRESET_LABELS: Record<OutlinePresetName, string> = {
  card: 'Card',
  'bonus-card': 'Bonus Card',
  board: 'Board',
  button: 'Button',
  ghost: 'Ghost'
}
const PALETTES: readonly OutlinePaletteName[] = [
  'green',
  'orange',
  'purple',
  'blue',
  'red',
  'white'
]
const PALETTE_COLORS: Record<OutlinePaletteName, number> = {
  green: 0x6cff46,
  orange: 0xffff0a,
  purple: 0xc56cff,
  blue: 0x6cffff,
  red: 0xff8a52,
  white: 0xf5f5f5
}

type TuningKey = keyof OutlineTuning

interface TuningControlSpec {
  readonly key: TuningKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

const CONTROL_SPECS = [
  { key: 'ribbonWidth', label: 'Ribbon width', min: 0, max: 20, step: 1 },
  { key: 'edgeSoftness', label: 'Edge softness', min: 0, max: 10, step: 1 },
  { key: 'rimWidth', label: 'Rim width', min: 0, max: 15, step: 1 },
  { key: 'glowWidth', label: 'Glow width', min: 0, max: 30, step: 1 },
  { key: 'glowStrength', label: 'Glow strength', min: 0, max: 4, step: 1 },
  { key: 'innerEdgeWidth', label: 'Inner edge', min: 0, max: 8, step: 1 },
  {
    key: 'highlightStrength',
    label: 'Highlight strength',
    min: 0,
    max: 5,
    step: 1
  },
  { key: 'hotspotScale', label: 'Hotspot scale', min: 1, max: 120, step: 1 },
  {
    key: 'hotspotDensity',
    label: 'Hotspot density',
    min: 0,
    max: 4,
    step: 1
  },
  { key: 'edgeWobble', label: 'Edge wobble', min: 0, max: 16, step: 1 },
  { key: 'motionSpeed', label: 'Motion speed', min: 0, max: 3, step: 1 },
  { key: 'pulseRate', label: 'Pulse rate', min: 0, max: 3, step: 1 },
  { key: 'contourVariation', label: 'Contour variation', min: 0, max: 10, step: 1 }
] as const satisfies readonly TuningControlSpec[]

interface ButtonState {
  readonly root: Container
  readonly background: Graphics
  readonly label: Text
  readonly width: number
  readonly height: number
}

interface SliderState {
  readonly spec: TuningControlSpec
  readonly track: Container
  readonly knob: Graphics
  readonly valueLabel: Text
  value: number
}

function cloneTunings(): Record<OutlinePresetName, OutlineTuning> {
  const tunings = getOutlineTuningConfig().presets
  return {
    card: { ...tunings.card },
    'bonus-card': { ...tunings['bonus-card'] },
    board: { ...tunings.board },
    button: { ...tunings.button },
    ghost: { ...tunings.ghost }
  }
}

function addLabel(
  parent: Container,
  text: string,
  x: number,
  y: number,
  size = 22,
  color = 0xfff3dc
): Text {
  const label = new Text({
    text,
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fill: color,
      dropShadow: {
        color: 0x000000,
        alpha: 0.42,
        blur: 2,
        distance: 1
      }
    }
  })
  label.position.set(x, y)
  label.eventMode = 'none'
  parent.addChild(label)
  return label
}

function addPanel(
  parent: Container,
  bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
): void {
  const panel = new Graphics()
    .roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 18)
    .fill({ color: 0x17283d, alpha: 0.98 })
    .stroke({ color: 0xb08a5c, width: 2, alpha: 0.92 })
  panel.eventMode = 'none'
  parent.addChild(panel)
}

function snapped(value: number, spec: TuningControlSpec): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, value))
  return Number((Math.round(clamped / spec.step) * spec.step).toFixed(4))
}

function formatValue(value: number, step: number): string {
  const decimals = step.toString().split('.')[1]?.length ?? 0
  return value.toFixed(decimals)
}

/** Development-only live editor for the persisted production outline presets. */
export class OutlineLab extends Container {
  private readonly assetScope = new AssetScope()
  private readonly resolver = new CardAssetResolver()
  private readonly drafts = cloneTunings()
  private readonly previewGroups = new Map<OutlinePresetName, Container>()
  private readonly outlines = new Map<OutlinePresetName, AnimatedOutline[]>()
  private readonly presetTabs = new Map<OutlinePresetName, ButtonState>()
  private readonly paletteButtons = new Map<OutlinePaletteName, ButtonState>()
  private readonly sliders = new Map<TuningKey, SliderState>()
  private readonly selectedPalettes: Record<OutlinePresetName, OutlinePaletteName> = {
    card: 'green',
    'bonus-card': 'orange',
    board: 'green',
    button: 'blue',
    ghost: 'purple'
  }
  private selectedPreset: OutlinePresetName = 'card'
  private activeSlider: SliderState | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveRequested = false
  private saveInFlight = false
  private disposed = false
  private statusLabel!: Text

  async mount(): Promise<void> {
    const [deckAssets, selectionAssets] = await Promise.all([
      this.assetScope.acquire<DeckPresentationAssets>(
        ASSET_BUNDLE_IDS.deckPresentation
      ),
      this.assetScope.acquire<DeckSelectionAssets>(ASSET_BUNDLE_IDS.deckSelection)
    ])
    const [minionFrame, spellFrame] = await Promise.all([
      this.resolver.load('card.frame.minion'),
      this.resolver.load('card.frame.spell')
    ])

    this.createChrome()
    this.createPresetTabs()
    this.createPaletteControls()
    this.createTuningControls()
    this.createPreviewGroups(minionFrame, spellFrame, deckAssets, selectionAssets)
    this.selectPreset('card')
  }

  dispose(): void {
    this.flushSave()
    this.disposed = true
    for (const outlines of this.outlines.values()) {
      for (const outline of outlines) outline.dispose()
    }
    this.outlines.clear()
    void this.assetScope.releaseAll()
    this.destroy({ children: true })
  }

  private createChrome(): void {
    const background = new Graphics()
      .rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      .fill(0x0f1c2d)
    background.eventMode = 'none'
    this.addChild(background)

    const header = new Graphics().rect(0, 0, CANVAS_WIDTH, 92).fill(0x294967)
    header.eventMode = 'none'
    this.addChild(header)

    addLabel(this, 'OUTLINE SHADER LAB', 40, 24, 34)
    addLabel(
      this,
      'Production outline tuning — changes save automatically.',
      430,
      35,
      19,
      0xc9d6e7
    )
    addPanel(this, PREVIEW_PANEL)
    addPanel(this, CONTROLS_PANEL)

    addLabel(this, 'LIVE PREVIEW', 62, 202, 19, 0xf1d36a)
    addLabel(this, 'TUNING', 1202, 202, 19, 0xf1d36a)
    addLabel(this, 'GEOMETRY / GLOW', 1202, 242, 16, 0x9db5d1)
    addLabel(this, 'DETAIL / MOTION', 1532, 242, 16, 0x9db5d1)

    this.statusLabel = addLabel(
      this,
      'Saved production configuration.',
      62,
      992,
      16,
      0x9db5d1
    )
  }

  private createPresetTabs(): void {
    const tabWidth = 214
    for (const [index, preset] of PRESETS.entries()) {
      const tab = this.createButton(
        40 + index * (tabWidth + 12),
        108,
        tabWidth,
        54,
        PRESET_LABELS[preset],
        () => this.selectPreset(preset)
      )
      this.presetTabs.set(preset, tab)
    }
  }

  private createPaletteControls(): void {
    addLabel(this, 'Palette', 735, 202, 16, 0x9db5d1)
    for (const [index, palette] of PALETTES.entries()) {
      const button = this.createButton(805 + index * 64, 197, 54, 34, '', () =>
        this.selectPalette(palette)
      )
      const swatch = new Graphics()
        .circle(27, 17, 9)
        .fill(PALETTE_COLORS[palette])
        .stroke({ color: 0xffffff, width: 1, alpha: 0.7 })
      swatch.eventMode = 'none'
      button.root.addChild(swatch)
      this.paletteButtons.set(palette, button)
    }
  }

  private createTuningControls(): void {
    for (const [index, spec] of CONTROL_SPECS.entries()) {
      const column = index < GEOMETRY_COLUMN_COUNT ? 0 : 1
      const row =
        column === 0 ? index : index - GEOMETRY_COLUMN_COUNT
      this.createSlider(
        spec,
        1202 + column * 330,
        278 + row * TUNING_ROW_HEIGHT
      )
    }
  }

  private createSlider(spec: TuningControlSpec, x: number, y: number): void {
    addLabel(this, spec.label, x, y, 15, 0xffffff)
    const valueLabel = addLabel(this, '', x + 292, y, 15, 0xd8c49a)
    valueLabel.anchor.set(1, 0)

    const track = new Container()
    track.position.set(x, y + 37)
    track.hitArea = new Rectangle(0, -10, SLIDER_WIDTH, 28)
    track.eventMode = 'static'
    track.cursor = 'pointer'
    track.label = `outline-lab.control.${spec.key}`

    const trackBackground = new Graphics()
      .roundRect(0, 0, SLIDER_WIDTH, 8, 4)
      .fill(0x080e18)
      .stroke({ color: 0x637398, width: 1, alpha: 0.9 })
    trackBackground.eventMode = 'none'
    track.addChild(trackBackground)

    const knob = new Graphics()
      .circle(0, 4, 9)
      .fill(0xf1d36a)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.7 })
    knob.eventMode = 'none'
    track.addChild(knob)
    this.addChild(track)

    const slider: SliderState = {
      spec,
      track,
      knob,
      valueLabel,
      value: this.drafts[this.selectedPreset][spec.key]
    }
    this.sliders.set(spec.key, slider)

    track.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      this.activeSlider = slider
      this.updateSliderFromPointer(slider, event)
      event.stopPropagation()
    })
    track.on('globalpointermove', (event: FederatedPointerEvent) => {
      if (this.activeSlider === slider) this.updateSliderFromPointer(slider, event)
    })
    track.on('pointerup', () => this.endSliderDrag(slider))
    track.on('pointerupoutside', () => this.endSliderDrag(slider))
    track.on('pointercancel', () => this.endSliderDrag(slider))

    this.createButton(x + 220, y + 30, 30, 30, '−', () =>
      this.adjustSlider(slider, -spec.step)
    )
    this.createButton(x + 260, y + 30, 30, 30, '+', () =>
      this.adjustSlider(slider, spec.step)
    )
  }

  private createPreviewGroups(
    minionFrame: Texture,
    spellFrame: Texture,
    deckAssets: DeckPresentationAssets,
    selectionAssets: DeckSelectionAssets
  ): void {
    const cardGroup = this.createPreviewGroup('card')
    this.addOutlinedTexture(
      cardGroup,
      minionFrame,
      'card',
      330,
      610,
      0.52,
      'Full-size card'
    )
    this.addOutlinedTexture(
      cardGroup,
      spellFrame,
      'card',
      800,
      595,
      0.32,
      'Hand-size card'
    )

    const bonusGroup = this.createPreviewGroup('bonus-card')
    this.addOutlinedTexture(
      bonusGroup,
      minionFrame,
      'bonus-card',
      330,
      610,
      0.52,
      'Enhanced card'
    )
    this.addOutlinedTexture(
      bonusGroup,
      spellFrame,
      'bonus-card',
      800,
      595,
      0.32,
      'Selected enhanced card'
    )

    const boardGroup = this.createPreviewGroup('board')
    this.addOutlinedProxy(boardGroup, 'board', 260, 610, 'Minion', (graphics) => {
      graphics.ellipse(0, 0, 92, 126).fill(0xffffff)
    })
    this.addOutlinedProxy(boardGroup, 'board', 570, 590, 'Hero', (graphics) => {
      graphics.ellipse(0, 0, 125, 155).fill(0xffffff)
    })
    this.addOutlinedProxy(boardGroup, 'board', 900, 590, 'Hero power', (graphics) => {
      graphics.circle(0, 0, 105).fill(0xffffff)
    })

    const buttonGroup = this.createPreviewGroup('button')
    this.addOutlinedTexture(
      buttonGroup,
      deckAssets.deckButtonFrame,
      'button',
      330,
      575,
      1.65,
      'Deck frame'
    )
    this.addOutlinedTexture(
      buttonGroup,
      selectionAssets.playButton,
      'button',
      800,
      575,
      0.92,
      'Play button'
    )

    const ghostGroup = this.createPreviewGroup('ghost')
    this.addOutlinedTexture(
      ghostGroup,
      deckAssets.deckButtonFrame,
      'ghost',
      330,
      575,
      1.65,
      'Deck frame'
    )
    this.addOutlinedTexture(
      ghostGroup,
      selectionAssets.playButton,
      'ghost',
      800,
      575,
      0.92,
      'Play button'
    )
  }

  private createPreviewGroup(preset: OutlinePresetName): Container {
    const group = new Container()
    group.visible = false
    group.label = `outline-lab.preview.${preset}`
    this.previewGroups.set(preset, group)
    this.addChild(group)
    return group
  }

  private addOutlinedTexture(
    group: Container,
    texture: Texture,
    preset: OutlinePresetName,
    x: number,
    y: number,
    scale: number,
    label: string
  ): void {
    const target = new Sprite(texture)
    target.anchor.set(0.5)
    target.position.set(x, y)
    target.scale.set(scale)
    target.eventMode = 'none'
    target.label = `outline-lab.${preset}.${label}.target`
    group.addChild(target)
    this.registerOutline(target, preset)

    const body = new Sprite(texture)
    body.anchor.set(0.5)
    body.position.set(x, y)
    body.scale.set(scale)
    body.eventMode = 'none'
    body.label = `outline-lab.${preset}.${label}.body`
    group.addChild(body)
    const labelY = Math.min(920, y + texture.height * scale * 0.5 + 24)
    const caption = addLabel(group, label, x, labelY, 18, 0xd7e2ef)
    caption.anchor.set(0.5, 0)
  }

  private addOutlinedProxy(
    group: Container,
    preset: OutlinePresetName,
    x: number,
    y: number,
    label: string,
    draw: (graphics: Graphics) => void
  ): void {
    const target = new Graphics()
    draw(target)
    target.position.set(x, y)
    target.eventMode = 'none'
    target.label = `outline-lab.${preset}.${label}.target`
    group.addChild(target)
    this.registerOutline(target, preset)

    const body = new Graphics()
    draw(body)
    body.tint = 0x405b78
    body.scale.set(0.88)
    body.position.set(x, y)
    body.eventMode = 'none'
    body.label = `outline-lab.${preset}.${label}.body`
    group.addChild(body)
    const caption = addLabel(group, label, x, 800, 18, 0xd7e2ef)
    caption.anchor.set(0.5, 0)
  }

  private registerOutline(target: Container, preset: OutlinePresetName): void {
    const outline = new AnimatedOutline(target, {
      palette: this.selectedPalettes[preset],
      preset
    })
    outline.setTuning(this.drafts[preset])
    const outlines = this.outlines.get(preset) ?? []
    outlines.push(outline)
    this.outlines.set(preset, outlines)
  }

  private selectPreset(preset: OutlinePresetName): void {
    this.selectedPreset = preset
    for (const [candidate, group] of this.previewGroups) {
      group.visible = candidate === preset
    }
    for (const slider of this.sliders.values()) {
      this.setSliderValue(slider, this.drafts[preset][slider.spec.key], false)
    }
    this.refreshPresetTabs()
    this.refreshPaletteButtons()
    this.statusLabel.text = `${PRESET_LABELS[preset]} production values loaded. Changes save automatically.`
  }

  private selectPalette(palette: OutlinePaletteName): void {
    this.selectedPalettes[this.selectedPreset] = palette
    for (const outline of this.outlines.get(this.selectedPreset) ?? []) {
      outline.setPalette(palette)
    }
    this.refreshPaletteButtons()
  }

  private updateSliderFromPointer(
    slider: SliderState,
    event: FederatedPointerEvent
  ): void {
    const local = slider.track.toLocal(event.global)
    const ratio = Math.min(1, Math.max(0, local.x / SLIDER_WIDTH))
    this.setSliderValue(
      slider,
      slider.spec.min + ratio * (slider.spec.max - slider.spec.min)
    )
  }

  private adjustSlider(slider: SliderState, amount: number): void {
    this.setSliderValue(slider, slider.value + amount)
  }

  private setSliderValue(slider: SliderState, value: number, notify = true): void {
    slider.value = snapped(value, slider.spec)
    const ratio = (slider.value - slider.spec.min) / (slider.spec.max - slider.spec.min)
    slider.knob.position.x = ratio * SLIDER_WIDTH
    slider.valueLabel.text = formatValue(slider.value, slider.spec.step)
    if (notify) this.updateSelectedTuning(slider.spec.key, slider.value)
  }

  private updateSelectedTuning(key: TuningKey, value: number): void {
    const preset = this.selectedPreset
    this.drafts[preset] = { ...this.drafts[preset], [key]: value }
    for (const outline of this.outlines.get(preset) ?? []) {
      outline.setTuning(this.drafts[preset])
    }
    updateOutlineTuningConfig({ version: 1, presets: this.drafts })
    this.scheduleSave()
  }

  private endSliderDrag(slider: SliderState): void {
    if (this.activeSlider === slider) this.activeSlider = null
    this.flushSave()
  }

  private refreshPresetTabs(): void {
    for (const preset of PRESETS) {
      const tab = this.presetTabs.get(preset)
      if (!tab) continue
      tab.label.text = PRESET_LABELS[preset]
      this.drawButton(tab, preset === this.selectedPreset)
    }
  }

  private refreshPaletteButtons(): void {
    const selected = this.selectedPalettes[this.selectedPreset]
    for (const [palette, button] of this.paletteButtons) {
      this.drawButton(button, palette === selected)
    }
  }

  private scheduleSave(): void {
    this.saveRequested = true
    this.statusLabel.text = 'Saving production configuration…'
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flushSave(), 200)
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.saveRequested || this.saveInFlight) return
    void this.drainSaves()
  }

  private async drainSaves(): Promise<void> {
    const save = window.api.outlineTuning?.save
    if (!save) {
      this.statusLabel.text =
        'Unable to save: development outline tuning API is unavailable.'
      return
    }

    this.saveInFlight = true
    try {
      while (this.saveRequested) {
        this.saveRequested = false
        try {
          await save(getOutlineTuningConfig())
        } catch (error) {
          this.saveRequested = true
          console.error('[OutlineLab] Failed to save production configuration.', error)
          if (!this.disposed) {
            this.statusLabel.text =
              'Save failed. The current values remain live; edit again to retry.'
          }
          return
        }
      }
      if (!this.disposed) this.statusLabel.text = 'Saved production configuration.'
    } finally {
      this.saveInFlight = false
    }
  }

  private createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    onClick: (event: FederatedPointerEvent) => void
  ): ButtonState {
    const root = new Container()
    root.position.set(x, y)
    root.hitArea = new Rectangle(0, 0, width, height)
    root.eventMode = 'static'
    root.cursor = 'pointer'

    const background = new Graphics()
    background.eventMode = 'none'
    root.addChild(background)

    const label = addLabel(root, text, width / 2, height / 2, 16, 0xffffff)
    label.anchor.set(0.5)

    root.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      onClick(event)
    })
    const state = { root, background, label, width, height }
    this.drawButton(state, false)
    this.addChild(root)
    return state
  }

  private drawButton(button: ButtonState, active: boolean): void {
    button.background
      .clear()
      .roundRect(0, 0, button.width, button.height, 7)
      .fill({ color: active ? 0x416c97 : 0x243b59, alpha: 0.98 })
      .stroke({
        color: active ? 0xf1d36a : 0x6682a5,
        width: active ? 2 : 1,
        alpha: 0.95
      })
  }
}
