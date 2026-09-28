import { ShatterLab } from './shatter-lab'
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type Renderer,
  type FederatedPointerEvent
} from 'pixi.js'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  type GameAssets,
  AssetScope,
  CardAssetResolver
} from '../../../ui/asset-registry'
import {
  AnimatedOutline,
  type OutlinePalette,
  type OutlinePaletteName,
  type OutlinePresetName as AuraPresetName,
  type OutlineTuning
} from '../../../rendering/effects/animated-outline'
import {
  getOutlineTuningConfig,
  type OutlineTuningConfig,
  updateOutlineTuningConfig
} from '../../../rendering/effects/outline-tuning'
import { OutlineLabShaderControls } from './outline-lab-shader-controls'
import { GhostAura } from '../../../rendering/effects/ghost-aura'
import {
  GHOST_MIST_DEFAULTS,
  type GhostAuraTuning,
  type GhostAuraPalette
} from '../../../../shared/ipc/outline-tuning'
type OutlinePresetName = AuraPresetName | 'ghost' | 'shatter'
import { OutlineLabHand, clampHandCount } from './outline-lab-hand'
import { OutlineLabBoard } from './outline-lab-board'
import { OUTLINE_LAB_LAYOUT as LAYOUT } from './outline-lab-layout'
import { OUTLINE_LAB_PALETTES } from './outline-lab-palettes'
import type { CursorManager } from '../../../ui/components/cursor'
import {
  applyPlacement,
  applyAnchoredPlacement,
  placement,
  type LayoutPlacement
} from '../../../rendering/layout'

const CANVAS_WIDTH = LAYOUT.canvas.width
const CANVAS_HEIGHT = LAYOUT.canvas.height
const PREVIEW_PANEL = LAYOUT.preview
const CONTROLS_PANEL = LAYOUT.controls

const PRESETS: readonly OutlinePresetName[] = [
  'card',
  'bonus-card',
  'board',
  'button',
  'ghost',
  'shatter'
]
const PRESET_LABELS: Record<OutlinePresetName, string> = {
  card: 'Card',
  'bonus-card': 'Bonus Card',
  board: 'Board',
  button: 'Button',
  ghost: 'Ghost Aura Shader',
  shatter: 'Shatter Shader'
}
const PALETTES: readonly OutlinePaletteName[] = [
  'green',
  'orange',
  'purple',
  'blue',
  'red',
  'white'
]
interface ButtonState {
  readonly root: Container
  readonly background: Graphics
  readonly label: Text
  readonly width: number
  readonly height: number
}

function cloneTunings(
  tunings: OutlineTuningConfig['aura']['presets']
): Record<AuraPresetName, OutlineTuning> {
  return {
    card: { ...tunings.card },
    'bonus-card': { ...tunings['bonus-card'] },
    board: { ...tunings.board },
    button: { ...tunings.button }
  }
}

function clonePalettes(
  palettes: OutlineTuningConfig['aura']['palettes']
): Record<OutlinePaletteName, OutlinePalette> {
  return {
    blue: { ...palettes.blue },
    green: { ...palettes.green },
    orange: { ...palettes.orange },
    purple: { ...palettes.purple },
    red: { ...palettes.red },
    white: { ...palettes.white }
  }
}

export interface OutlineLabOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly cursor?: CursorManager | null
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
  applyPlacement(
    label,
    placement({ x, y }, { width: label.width, height: label.height })
  )
  label.label = `outline-lab.label.${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
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
  panel.label = `outline-lab.panel.${bounds.x}`
  parent.addChild(panel)
}

/** Development-only live editor for the persisted production outline presets. */
export class OutlineLab extends Container {
  private readonly assetScope = new AssetScope()
  private readonly resolver = new CardAssetResolver()
  private readonly initialConfig = getOutlineTuningConfig()
  private readonly drafts = cloneTunings(this.initialConfig.aura.presets)
  private readonly paletteDrafts = clonePalettes(this.initialConfig.aura.palettes)
  private readonly previewGroups = new Map<OutlinePresetName, Container>()
  private readonly outlines = new Map<AuraPresetName, AnimatedOutline[]>()
  private readonly ghostOutlines: GhostAura[] = []
  private ghostTuning = { ...this.initialConfig.ghost.tuning }
  private ghostPalette = { ...this.initialConfig.ghost.palette }
  private readonly presetTabs = new Map<OutlinePresetName, ButtonState>()
  private readonly paletteButtons = new Map<OutlinePaletteName, ButtonState>()
  private readonly paletteSwatches = new Map<OutlinePaletteName, Graphics>()
  private readonly selectedPalettes: Record<OutlinePresetName, OutlinePaletteName> = {
    card: 'green',
    'bonus-card': 'orange',
    board: 'green',
    button: 'blue',
    ghost: 'purple',
    shatter: 'purple'
  }
  private selectedPreset: OutlinePresetName = 'card'
  private shaderControls: OutlineLabShaderControls | null = null
  private saveButton!: ButtonState
  private revision = 0
  private savedRevision = 0
  private saveInFlight = false
  private disposed = false
  private statusLabel!: Text
  private shatter: ShatterLab | null = null
  private hand: OutlineLabHand | null = null
  private board: OutlineLabBoard | null = null
  private handCount = 5
  private readonly handControls = new Container()
  private handCountLabel!: Text
  private countMinus!: ButtonState
  private countPlus!: ButtonState
  private controlsVisible = true
  private countRevision = 0

  constructor(private readonly options: OutlineLabOptions) {
    super()
  }

  async mount(): Promise<void> {
    const results = await Promise.allSettled([
      this.assetScope.acquire<DeckPresentationAssets>(
        ASSET_BUNDLE_IDS.deckPresentation
      ),
      this.assetScope.acquire<DeckSelectionAssets>(ASSET_BUNDLE_IDS.deckSelection),
      this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game)
    ])
    const [deckResult, selectionResult, gameResult] = results
    if (deckResult.status === 'rejected') throw deckResult.reason
    if (selectionResult.status === 'rejected') throw selectionResult.reason
    if (gameResult.status === 'rejected') throw gameResult.reason
    const [deckAssets, selectionAssets, gameAssets] = [
      deckResult.value,
      selectionResult.value,
      gameResult.value
    ] as const
    if (this.disposed) {
      await this.assetScope.releaseAll()
      return
    }

    this.createChrome()
    this.createPresetTabs()
    this.createPaletteControls()
    this.shaderControls = new OutlineLabShaderControls({
      ...this.options,
      onShaderChange: (shader) => this.selectPreset(shader === 'aura' ? 'card' : shader)
    })
    await this.createPreviewGroups(gameAssets, deckAssets, selectionAssets)
    if (this.disposed) return
    this.createHandControls()
    this.selectPreset('card')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.shatter?.dispose()
    this.shaderControls?.dispose()
    for (const outline of this.ghostOutlines) outline.dispose()
    this.hand?.dispose()
    this.board?.dispose()
    for (const outlines of this.outlines.values()) {
      for (const outline of outlines) outline.dispose()
    }
    this.outlines.clear()
    void this.assetScope.releaseAll()
    this.destroy({ children: true })
  }

  setControlsVisible(visible: boolean): void {
    this.controlsVisible = visible
    this.shaderControls?.setVisible(visible)
    if (visible) this.hand?.resume()
    else this.hand?.pause()
    if (!visible) this.board?.clearHover()
  }

  update(deltaMS: number): void {
    if (this.disposed || !this.controlsVisible) return
    if (this.selectedPreset === 'shatter' && this.shatter) {
      this.shatter.update(deltaMS)
      this.shaderControls?.setShatterProgress(this.shatter.progress)
    }
    this.hand?.update(deltaMS)
    this.board?.update(deltaMS)
  }

  private createChrome(): void {
    const background = new Graphics()
      .rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      .fill(0x0f1c2d)
    background.eventMode = 'none'
    background.label = 'outline-lab.background'
    this.addChild(background)

    const header = new Graphics()
      .rect(0, 0, CANVAS_WIDTH, LAYOUT.header.height)
      .fill(0x294967)
    header.eventMode = 'none'
    header.label = 'outline-lab.header'
    this.addChild(header)

    addLabel(
      this,
      'SHADER LAB',
      LAYOUT.header.titleX,
      LAYOUT.header.titleY,
      LAYOUT.header.titleSize
    )
    addPanel(this, PREVIEW_PANEL)
    addPanel(this, CONTROLS_PANEL)

    addLabel(this, 'LIVE PREVIEW', 62, LAYOUT.panelTitleY, 19, 0xf1d36a)
    addLabel(this, 'TUNING', 1202, LAYOUT.panelTitleY, 19, 0xf1d36a)

    const save = LAYOUT.save
    this.saveButton = this.createButton(
      save.x,
      save.y,
      save.width,
      save.height,
      'Save',
      () => {
        void this.save()
      }
    )
    this.refreshSaveButton()

    this.statusLabel = addLabel(
      this,
      'No unsaved changes.',
      LAYOUT.status.x,
      LAYOUT.status.y,
      16,
      0x9db5d1
    )
  }

  private createPresetTabs(): void {
    const tabs = LAYOUT.tabs
    for (const [index, preset] of PRESETS.filter(
      (preset) => preset !== 'ghost' && preset !== 'shatter'
    ).entries()) {
      const tab = this.createButton(
        tabs.x + index * (tabs.width + tabs.gap),
        tabs.y,
        tabs.width,
        tabs.height,
        PRESET_LABELS[preset],
        () => this.selectPreset(preset)
      )
      this.presetTabs.set(preset, tab)
    }
  }

  private createPaletteControls(): void {
    addLabel(this, 'Palette', 685, LAYOUT.panelTitleY, 16, 0x9db5d1)
    const layout = LAYOUT.palettes
    for (const palette of PALETTES) {
      const button = this.createButton(
        layout.x,
        LAYOUT.panelTitleY - 5,
        layout.width,
        layout.height,
        palette,
        () => this.selectPalette(palette)
      )
      button.label.x += 10
      button.root.visible = false
      const swatch = new Graphics()
        .circle(layout.swatchX, layout.swatchY, layout.swatchRadius)
        .fill(this.paletteDrafts[palette].baseColor)
        .stroke({ color: 0xffffff, width: 1, alpha: 0.7 })
      swatch.eventMode = 'none'
      button.root.addChild(swatch)
      this.paletteButtons.set(palette, button)
      this.paletteSwatches.set(palette, swatch)
    }
  }

  private async createPreviewGroups(
    gameAssets: GameAssets,
    deckAssets: DeckPresentationAssets,
    selectionAssets: DeckSelectionAssets
  ): Promise<void> {
    const cardGroup = this.createPreviewGroup('card')
    this.createPreviewGroup('bonus-card')
    this.hand = new OutlineLabHand(
      this.options.renderer,
      this.options.canvas,
      gameAssets,
      this.resolver,
      this.options.cursor
    )
    cardGroup.addChild(this.hand)
    this.refreshHandAppearance()
    await this.hand.setCount(this.handCount)
    if (this.disposed) return

    const boardGroup = this.createPreviewGroup('board')
    this.board = new OutlineLabBoard(this.options.renderer)
    boardGroup.addChild(this.board)
    await this.board.mount(gameAssets, deckAssets, this.resolver)
    if (this.disposed) return
    for (const [text, x] of [
      ['Minion', LAYOUT.minion.position.x],
      ['Jaina Proudmoore', LAYOUT.hero.position.x],
      ['Hero power · click to flip', LAYOUT.power.position.x]
    ] as const) {
      addLabel(boardGroup, text, x, LAYOUT.captionY, 18, 0xd7e2ef).anchor.set(0.5, 0)
    }

    const buttonGroup = this.createPreviewGroup('button')
    const deck = new Container()
    deck.label = 'outline-lab.button.deck'
    deck.eventMode = 'none'
    deck.interactiveChildren = false
    applyPlacement(deck, LAYOUT.deck)

    const portrait = new Sprite(deckAssets.jainaDeckPortrait)
    portrait.label = 'outline-lab.button.deck-portrait'
    portrait.eventMode = 'none'
    applyAnchoredPlacement(portrait, LAYOUT.deckPortrait)
    portrait.scale.set(
      Math.max(
        LAYOUT.deckPortrait.size.width / portrait.texture.width,
        LAYOUT.deckPortrait.size.height / portrait.texture.height
      )
    )
    const crop = LAYOUT.deckPortraitCrop
    const mask = new Graphics()
      .rect(
        -crop.size.width * crop.anchor.x,
        -crop.size.height * crop.anchor.y,
        crop.size.width,
        crop.size.height
      )
      .fill(0xffffff)
    mask.label = 'outline-lab.button.deck-portrait-mask'
    mask.eventMode = 'none'
    applyPlacement(mask, crop)
    portrait.mask = mask
    deck.addChild(portrait, mask)

    const frame = new Sprite(deckAssets.deckButtonFrame)
    frame.label = 'outline-lab.button.deck-frame'
    frame.anchor.set(0.5)
    frame.eventMode = 'none'
    deck.addChild(frame)
    const name = new Text({
      text: 'Mage Deck',
      style: {
        fontFamily: 'Belwe',
        fontSize: 24,
        fill: 0xffffff,
        align: 'center'
      }
    })
    name.label = 'outline-lab.button.deck-name'
    name.eventMode = 'none'
    applyAnchoredPlacement(name, LAYOUT.deckName)
    if (name.width > LAYOUT.deckName.size.width)
      name.scale.set(LAYOUT.deckName.size.width / name.width)
    deck.addChild(name)

    const outlineTarget = new Sprite(deckAssets.deckButtonFrame)
    outlineTarget.label = 'outline-lab.button.deck-outline'
    outlineTarget.anchor.set(0.5)
    outlineTarget.eventMode = 'none'
    deck.addChildAt(outlineTarget, 0)
    this.registerOutline(outlineTarget, 'button')
    buttonGroup.addChild(deck)
    this.addOutlinedTexture(
      buttonGroup,
      selectionAssets.playButton,
      'button',
      LAYOUT.play,
      'Play button'
    )

    this.ghostAssets = gameAssets
    const ghostGroup = this.createPreviewGroup('ghost')
    this.addOutlinedTexture(
      ghostGroup,
      gameAssets.mulliganAnnouncement,
      'ghost',
      LAYOUT.banner,
      'Mulligan announcement'
    )
    this.addOutlinedTexture(
      ghostGroup,
      gameAssets.confirmMulliganButton,
      'ghost',
      LAYOUT.confirmMulligan,
      'Confirm mulligan'
    )
    const shatterGroup = this.createPreviewGroup('shatter')
    this.shatter = new ShatterLab(this.options.renderer)
    shatterGroup.addChild(this.shatter)
    await this.shatter.mount(gameAssets, deckAssets, this.resolver)
    this.refreshPreviewAppearance('board')
  }

  private createPreviewGroup(preset: OutlinePresetName): Container {
    const group = new Container()
    group.visible = false
    group.label = `outline-lab.preview.${preset}`
    this.previewGroups.set(preset, group)
    this.addChild(group)
    // Clip the bottom of the resting hand just as the match viewport does.
    const mask = new Graphics()
      .rect(
        PREVIEW_PANEL.x + 2,
        PREVIEW_PANEL.y + 220,
        PREVIEW_PANEL.width - 4,
        PREVIEW_PANEL.height - 222
      )
      .fill(0xffffff)
    mask.eventMode = 'none'
    mask.label = `outline-lab.preview.${preset}.mask`
    this.addChild(mask)
    group.mask = mask
    return group
  }

  private addOutlinedTexture(
    group: Container,
    texture: Texture,
    preset: OutlinePresetName,
    value: LayoutPlacement,
    label: string
  ): void {
    const target = new Sprite(texture)
    applyAnchoredPlacement(target, value)
    target.eventMode = 'none'
    target.label = `outline-lab.${preset}.${label}.target`
    group.addChild(target)
    this.registerOutline(target, preset)

    if (preset !== 'ghost') {
      const body = new Sprite(texture)
      applyAnchoredPlacement(body, value)
      body.eventMode = 'none'
      body.label = `outline-lab.${preset}.${label}.body`
      group.addChild(body)
    }
    const caption = addLabel(
      group,
      label,
      value.position.x,
      LAYOUT.captionY,
      18,
      0xd7e2ef
    )
    caption.anchor.set(0.5, 0)
  }

  private ghostAssets!: GameAssets

  private registerOutline(target: Container, preset: OutlinePresetName): void {
    if (preset === 'shatter') return
    if (preset === 'ghost') {
      const outline = new GhostAura(target, {
        noise: this.ghostAssets.burnNoise,
        dissolve: this.ghostAssets.ghostDissolve,
        spotlight: this.ghostAssets.ghostSpotlight
      })
      outline.setTuning(this.ghostTuning)
      outline.setPalette(this.ghostPalette)
      this.ghostOutlines.push(outline)
    } else {
      const outline = new AnimatedOutline(target, {
        preset,
        palette: this.paletteDrafts[this.selectedPalettes[preset]]
      })
      outline.setTuning(this.drafts[preset])
      const outlines = this.outlines.get(preset) ?? []
      outlines.push(outline)
      this.outlines.set(preset, outlines)
    }
  }

  private selectPreset(preset: OutlinePresetName): void {
    this.hand?.cancel()
    this.board?.clearHover()
    this.shatter?.restore()
    this.saveButton.root.visible = true
    this.selectedPreset = preset
    for (const [candidate, group] of this.previewGroups) {
      group.visible = candidate === preset
    }
    const isHand = preset === 'card' || preset === 'bonus-card'
    this.handControls.visible = isHand
    if (this.hand) {
      this.hand.visible = isHand
      if (isHand) this.previewGroups.get(preset)?.addChild(this.hand)
    }
    if (this.board) this.board.visible = preset === 'board'
    this.refreshPreviewAppearance(preset)
    this.refreshPresetTabs()
    this.refreshPaletteButtons()
    this.refreshColorControls()
  }

  private selectPalette(palette: OutlinePaletteName): void {
    if (this.selectedPreset === 'ghost' || this.selectedPreset === 'shatter') return
    if (
      !OUTLINE_LAB_PALETTES[this.selectedPreset].some(
        (option) => option.palette === palette
      )
    )
      return
    this.selectedPalettes[this.selectedPreset] = palette
    this.refreshPreviewAppearance(this.selectedPreset)
    this.refreshPaletteButtons()
    this.refreshColorControls()
  }

  private updateSelectedColor(key: keyof OutlinePalette, color: number): void {
    const palette = this.selectedPalettes[this.selectedPreset]
    if (this.paletteDrafts[palette][key] === color) return
    this.paletteDrafts[palette] = { ...this.paletteDrafts[palette], [key]: color }
    if (key === 'baseColor') {
      this.paletteSwatches
        .get(palette)
        ?.clear()
        .circle(
          LAYOUT.palettes.swatchX,
          LAYOUT.palettes.swatchY,
          LAYOUT.palettes.swatchRadius
        )
        .fill(color)
        .stroke({ color: 0xffffff, width: 1, alpha: 0.7 })
    }
    for (const preset of PRESETS) {
      if (preset === 'shatter') continue
      if (!OUTLINE_LAB_PALETTES[preset].some((option) => option.palette === palette))
        continue
      this.refreshPreviewAppearance(preset)
    }
    this.markDirty()
  }

  private refreshColorControls(): void {
    if (this.selectedPreset === 'shatter') {
      const preview = this.shatter
      if (!preview) return
      this.shaderControls?.showShatter(
        preview.tuning,
        preview.progress,
        (key, value) => {
          preview.set(key, value as number)
          if (key !== 'progress') this.markDirty()
        },
        [
          { label: 'Play shatter', run: () => preview.play() },
          {
            label: 'Restore assets',
            run: () => {
              preview.restore()
              this.refreshColorControls()
            }
          },
          {
            label: 'Reset Shatter',
            run: () => {
              preview.reset()
              this.markDirty()
              this.refreshColorControls()
            }
          }
        ]
      )
      return
    }
    if (this.selectedPreset === 'ghost') {
      this.shaderControls?.showGhost(
        this.ghostTuning,
        this.ghostPalette,
        (key, value, color) => {
          if (color)
            this.ghostPalette = {
              ...this.ghostPalette,
              [key]: value
            } as GhostAuraPalette
          else
            this.ghostTuning = { ...this.ghostTuning, [key]: value } as GhostAuraTuning
          this.refreshPreviewAppearance('ghost')
          this.markDirty()
        },
        [
          {
            label: 'Play disappearance',
            run: () => {
              for (const effect of this.ghostOutlines) {
                effect.restore()
                effect.disappear()
              }
            }
          },
          {
            label: 'Restore asset',
            run: () => {
              for (const effect of this.ghostOutlines) effect.restore()
            }
          },
          {
            label: 'Reset Ghost',
            run: () => {
              this.ghostTuning = { ...GHOST_MIST_DEFAULTS.tuning }
              this.ghostPalette = { ...GHOST_MIST_DEFAULTS.palette }
              for (const effect of this.ghostOutlines) effect.restore()
              this.refreshPreviewAppearance('ghost')
              this.refreshColorControls()
              this.markDirty()
            }
          }
        ]
      )
    } else {
      const preset = this.selectedPreset
      const palette = this.selectedPalettes[preset]
      this.shaderControls?.showAura(
        this.drafts[preset],
        this.paletteDrafts[palette],
        (key, value, color) => {
          if (color)
            this.updateSelectedColor(key as keyof OutlinePalette, value as number)
          else {
            this.drafts[preset] = { ...this.drafts[preset], [key]: value }
            this.refreshPreviewAppearance(preset)
            this.markDirty()
          }
        }
      )
    }
  }

  private refreshHandAppearance(): void {
    const preset = this.selectedPreset === 'bonus-card' ? 'bonus-card' : 'card'
    this.hand?.setAppearance(
      preset === 'bonus-card',
      this.paletteDrafts[preset === 'bonus-card' ? 'orange' : 'green'],
      this.drafts[preset],
      this.paletteDrafts.blue
    )
  }

  private refreshPreviewAppearance(preset: OutlinePresetName): void {
    if (preset === 'shatter') return
    if (preset === 'ghost') {
      for (const outline of this.ghostOutlines) {
        outline.setTuning(this.ghostTuning)
        outline.setPalette(this.ghostPalette)
      }
      return
    }
    const palette = this.paletteDrafts[this.selectedPalettes[preset]]
    const tuning = this.drafts[preset]
    for (const outline of this.outlines.get(preset) ?? []) {
      outline.setPalette(palette)
      outline.setTuning(tuning)
    }
    if (preset === 'board') {
      // Selecting the white editor must not replace the ready outline: hover layers it on top.
      const base =
        this.selectedPalettes.board === 'red'
          ? this.paletteDrafts.red
          : this.paletteDrafts.green
      this.board?.setAppearance(base, tuning, this.paletteDrafts.white)
    }
    if (
      preset === this.selectedPreset &&
      (preset === 'card' || preset === 'bonus-card')
    )
      this.refreshHandAppearance()
  }

  private createHandControls(): void {
    this.handControls.label = 'outline-lab.hand-controls'
    this.addChild(this.handControls)
    const { x, y, height } = LAYOUT.count
    this.handCountLabel = addLabel(this.handControls, '', x + 48, y + 8, 18)
    this.countMinus = this.createButton(x, y, 36, height, '−', () =>
      this.changeHandCount(-1)
    )
    this.countPlus = this.createButton(x + 177, y, 36, height, '+', () =>
      this.changeHandCount(1)
    )
    this.handControls.addChild(this.countMinus.root, this.countPlus.root)
    addLabel(
      this.handControls,
      'Hover to inspect · drag and release to return',
      x,
      y + 55,
      17,
      0x9db5d1
    )
    this.refreshHandCount()
  }

  private refreshHandCount(): void {
    this.handCountLabel.text = `Cards: ${this.handCount}`
    for (const [button, enabled] of [
      [this.countMinus, this.handCount > 1],
      [this.countPlus, this.handCount < 10]
    ] as const) {
      button.root.eventMode = enabled ? 'static' : 'none'
      button.root.alpha = enabled ? 1 : 0.45
    }
  }

  private changeHandCount(delta: number): void {
    this.handCount = clampHandCount(this.handCount + delta)
    this.refreshHandCount()
    const revision = ++this.countRevision
    void this.hand?.setCount(this.handCount).catch((error: unknown) => {
      if (this.disposed || revision !== this.countRevision) return
      console.error('[OutlineLab] Failed to create hand.', error)
      this.statusLabel.text = 'Unable to load hand. Change the count to retry.'
    })
  }

  private refreshPresetTabs(): void {
    for (const preset of PRESETS) {
      const tab = this.presetTabs.get(preset)
      if (!tab) continue
      tab.root.visible =
        this.selectedPreset !== 'ghost' && this.selectedPreset !== 'shatter'
      tab.label.text = PRESET_LABELS[preset]
      this.drawButton(tab, preset === this.selectedPreset)
    }
  }

  private refreshPaletteButtons(): void {
    const selected = this.selectedPalettes[this.selectedPreset]
    const options =
      this.selectedPreset === 'shatter' ? [] : OUTLINE_LAB_PALETTES[this.selectedPreset]
    for (const [palette, button] of this.paletteButtons) {
      const index = options.findIndex((option) => option.palette === palette)
      button.root.visible =
        index >= 0 &&
        this.selectedPreset !== 'ghost' &&
        this.selectedPreset !== 'shatter'
      if (index < 0) continue
      button.root.x =
        LAYOUT.palettes.x + index * (LAYOUT.palettes.width + LAYOUT.palettes.gap)
      button.label.text = options[index].label
      this.drawButton(button, palette === selected)
    }
  }

  private markDirty(): void {
    this.revision += 1
    this.statusLabel.text = 'Unsaved changes.'
    this.refreshSaveButton()
  }

  private refreshSaveButton(): void {
    const enabled = this.revision !== this.savedRevision && !this.saveInFlight
    this.saveButton.root.eventMode = enabled ? 'static' : 'none'
    this.saveButton.root.alpha = enabled ? 1 : 0.5
  }

  private async save(): Promise<void> {
    if (this.saveInFlight || this.revision === this.savedRevision) return
    const save = window.api.outlineTuning?.save
    if (!save) {
      this.statusLabel.text =
        'Unable to save: development outline tuning API is unavailable.'
      return
    }

    const savedRevision = this.revision
    const snapshot: OutlineTuningConfig = {
      version: 10,
      shatter: { ...(this.shatter?.tuning ?? this.initialConfig.shatter) },
      aura: {
        presets: cloneTunings(this.drafts),
        palettes: clonePalettes(this.paletteDrafts)
      },
      ghost: { tuning: { ...this.ghostTuning }, palette: { ...this.ghostPalette } }
    }
    this.saveInFlight = true
    this.statusLabel.text = 'Saving production configuration…'
    this.refreshSaveButton()
    try {
      await save(snapshot)
      updateOutlineTuningConfig(snapshot)
      this.savedRevision = savedRevision
      if (!this.disposed) {
        this.statusLabel.text =
          this.revision === savedRevision
            ? 'Saved production configuration.'
            : 'Saved earlier edits. New changes are unsaved.'
      }
    } catch (error) {
      console.error('[OutlineLab] Failed to save production configuration.', error)
      if (!this.disposed)
        this.statusLabel.text = 'Save failed. Changes remain unsaved; retry Save.'
    } finally {
      this.saveInFlight = false
      if (!this.disposed) this.refreshSaveButton()
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
    applyPlacement(root, placement({ x, y }, { width, height }))
    root.label = `outline-lab.button.${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${x}.${y}`
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
