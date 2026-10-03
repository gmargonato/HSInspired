import { WINDFURY_DEFAULTS } from '../../desktop/contracts/ipc/windfury-tuning'
import {
  AURA_CATEGORIES,
  AURA_ELEMENT_LABELS,
  auraCategory,
  type AuraCategory,
  type AuraBackground
} from './aura-lab-elements'
import { OUTLINE_PRESET_NAMES } from '../../desktop/contracts/ipc/outline-tuning'
import { ShatterLab } from './shatter-lab'
import { GodRaysLab } from './god-rays-lab'
import {
  GOD_RAYS_DUST_DEFAULTS,
  type GodRaysDustTuning
} from '../../desktop/contracts/ipc/god-rays-dust-tuning'
import {
  GOD_RAYS_DEFAULTS,
  type GodRaysTuning
} from '../../desktop/contracts/ipc/god-rays-tuning'
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
  GAME_BOARD_BUNDLE_IDS,
  type CollectionAssets,
  type GameBoardAssets,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  type GameAssets,
  type MainMenuAssets,
  AssetScope,
  CardAssetResolver
} from '../../visual-components/assets'
import {
  AnimatedOutline,
  type OutlinePalette,
  type OutlinePaletteName,
  type OutlinePresetName as AuraPresetName,
  type OutlineTuning
} from '../../visual-components/effects/animated-outline'
import {
  getOutlineTuningConfig,
  type OutlineTuningConfig,
  updateOutlineTuningConfig
} from '../../visual-components/effects/outline-tuning'
import { OutlineLabShaderControls } from './outline-lab-shader-controls'
import { GhostAura } from '../../visual-components/effects/ghost-aura'
import {
  GHOST_MIST_DEFAULTS,
  type GhostAuraTuning,
  type GhostAuraPalette
} from '../../desktop/contracts/ipc/outline-tuning'
type OutlinePresetName = AuraPresetName | 'ghost' | 'shatter' | 'god-rays' | 'windfury'
function isAuraPreset(preset: OutlinePresetName): preset is AuraPresetName {
  return (
    preset !== 'ghost' &&
    preset !== 'shatter' &&
    preset !== 'god-rays' &&
    preset !== 'windfury'
  )
}
import { OutlineLabHand, clampHandCount } from './outline-lab-hand'
import { OutlineLabBoard } from './outline-lab-board'
import { OUTLINE_LAB_LAYOUT as LAYOUT, AURA_PREVIEW_LAYOUT } from './outline-lab-layout'
import { OUTLINE_LAB_PALETTES } from './outline-lab-palettes'
import type { CursorManager } from '../../visual-components/controls/cursor'
import {
  applyPlacement,
  applyAnchoredPlacement,
  placement,
  type LayoutPlacement
} from '../../visual-components/layout'

const CANVAS_WIDTH = LAYOUT.canvas.width
const CANVAS_HEIGHT = LAYOUT.canvas.height
const PREVIEW_PANEL = LAYOUT.preview
const CONTROLS_PANEL = LAYOUT.controls

const PRESETS: readonly OutlinePresetName[] = [
  ...OUTLINE_PRESET_NAMES,
  'ghost',
  'shatter',
  'god-rays',
  'windfury'
]
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
  return Object.fromEntries(
    OUTLINE_PRESET_NAMES.map((name) => [name, { ...tunings[name] }])
  ) as Record<AuraPresetName, OutlineTuning>
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
  private windfuryTuning = { ...this.initialConfig.windfury }
  private godRaysTuning: GodRaysTuning = structuredClone(this.initialConfig.godRays)
  private godRaysDustTuning: GodRaysDustTuning = { ...this.initialConfig.godRaysDust }
  private readonly presetTabs = new Map<AuraCategory, ButtonState>()
  private readonly paletteButtons = new Map<OutlinePaletteName, ButtonState>()
  private readonly paletteSwatches = new Map<OutlinePaletteName, Graphics>()
  private readonly selectedPalettes = Object.fromEntries(
    PRESETS.map((name) => [
      name,
      name === 'shatter' || name === 'god-rays' || name === 'windfury'
        ? 'purple'
        : OUTLINE_LAB_PALETTES[name][0].palette
    ])
  ) as Record<OutlinePresetName, OutlinePaletteName>
  private readonly backgrounds = new Map<AuraPresetName, Sprite>()
  private readonly backgroundChoices = new Map<AuraPresetName, AuraBackground>()
  private readonly sceneTextures = new Map<AuraPresetName, Texture>()
  private collectionAssets!: CollectionAssets
  private selectedPreset: OutlinePresetName = 'card'
  private shaderControls: OutlineLabShaderControls | null = null
  private saveButton!: ButtonState
  private revision = 0
  private savedRevision = 0
  private saveInFlight = false
  private disposed = false
  private statusLabel!: Text
  private shatter: ShatterLab | null = null
  private godRays: GodRaysLab | null = null
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
      this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game),
      this.assetScope.acquire<CollectionAssets>(ASSET_BUNDLE_IDS.collection),
      this.assetScope.acquire<GameBoardAssets>(GAME_BOARD_BUNDLE_IDS[0]),
      this.assetScope.acquire<MainMenuAssets>(ASSET_BUNDLE_IDS.mainMenu)
    ])
    const [
      deckResult,
      selectionResult,
      gameResult,
      collectionResult,
      boardResult,
      menuResult
    ] = results
    if (deckResult.status === 'rejected') throw deckResult.reason
    if (selectionResult.status === 'rejected') throw selectionResult.reason
    if (gameResult.status === 'rejected') throw gameResult.reason
    if (collectionResult.status === 'rejected') throw collectionResult.reason
    if (boardResult.status === 'rejected') throw boardResult.reason
    if (menuResult.status === 'rejected') throw menuResult.reason
    this.collectionAssets = collectionResult.value
    for (const preset of OUTLINE_PRESET_NAMES) {
      this.sceneTextures.set(
        preset,
        preset === 'expansion-toggle'
          ? collectionResult.value.background
          : preset === 'deck-frame' || preset === 'play-button'
            ? selectionResult.value.panel
            : boardResult.value.board
      )
    }
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
    this.godRays = new GodRaysLab(
      menuResult.value,
      this.godRaysTuning,
      this.godRaysDustTuning
    )
    applyPlacement(this.godRays, LAYOUT.godRaysPreview)
    this.createPreviewGroup('god-rays').addChild(this.godRays)
    this.createHandControls()
    this.createPreviewGroup('windfury')
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
    else this.refreshPreviewAppearance(this.selectedPreset)
  }

  update(deltaMS: number): void {
    if (this.disposed || !this.controlsVisible) return
    if (this.selectedPreset === 'shatter' && this.shatter) {
      this.shatter.update(deltaMS)
      this.shaderControls?.setShatterProgress(this.shatter.progress)
    }
    if (this.selectedPreset === 'god-rays') this.godRays?.update(deltaMS)
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
      'Save all changes',
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
    for (const [index, category] of (
      Object.keys(AURA_CATEGORIES) as AuraCategory[]
    ).entries()) {
      const tab = this.createButton(
        tabs.x + index * (tabs.width + tabs.gap),
        tabs.y,
        tabs.width,
        tabs.height,
        category,
        () => this.selectPreset(AURA_CATEGORIES[category][0])
      )
      this.presetTabs.set(category, tab)
    }
  }

  private createPaletteControls(): void {
    addLabel(this, 'Shared palette', 630, LAYOUT.panelTitleY, 16, 0x9db5d1)
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

    const boardGroup = this.createPreviewGroup('minion')
    for (const preset of ['hero', 'hero-power', 'weapon'] as const)
      this.createPreviewGroup(preset)
    this.board = new OutlineLabBoard(this.options.renderer)
    boardGroup.addChild(this.board)
    await this.board.mount(gameAssets, deckAssets, this.resolver)
    if (this.disposed) return
    const buttonGroup = this.createPreviewGroup('deck-frame')
    const deck = new Container()
    deck.label = 'outline-lab.button.deck'
    deck.eventMode = 'none'
    deck.interactiveChildren = false
    applyPlacement(deck, LAYOUT.auraDeck)

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
    this.registerOutline(outlineTarget, 'deck-frame')
    buttonGroup.addChild(deck)
    this.addOutlinedTexture(
      this.createPreviewGroup('play-button'),
      selectionAssets.playButton,
      'play-button',
      LAYOUT.auraPlay,
      'Play button'
    )

    for (const [preset, texture, layout] of [
      ['end-turn', gameAssets.endTurn, AURA_PREVIEW_LAYOUT.endTurn],
      [
        'expansion-toggle',
        this.collectionAssets.expansionToggle,
        AURA_PREVIEW_LAYOUT.expansionToggle
      ],
      ['secret', gameAssets.secret, AURA_PREVIEW_LAYOUT.badge],
      ['quest', gameAssets.quest, AURA_PREVIEW_LAYOUT.badge]
    ] as const)
      this.addOutlinedTexture(
        this.createPreviewGroup(preset),
        texture,
        preset,
        layout,
        AURA_ELEMENT_LABELS[preset]
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
    this.refreshPreviewAppearance('minion')
  }

  private createPreviewGroup(preset: OutlinePresetName): Container {
    const group = new Container()
    group.visible = false
    group.label = `outline-lab.preview.${preset}`
    if (isAuraPreset(preset)) {
      const background = new Sprite(this.sceneTextures.get(preset))
      background.label = 'outline-lab.background.' + preset
      background.eventMode = 'none'
      group.addChild(background)
      this.backgrounds.set(preset, background)
      this.refreshBackground(preset)
    }
    this.previewGroups.set(preset, group)
    this.addChild(group)
    // Clip the bottom of the resting hand just as the match viewport does.
    const mask = new Graphics()
      .rect(
        PREVIEW_PANEL.x + 2,
        PREVIEW_PANEL.y + (preset === 'god-rays' ? 64 : 220),
        PREVIEW_PANEL.width - 4,
        PREVIEW_PANEL.height - (preset === 'god-rays' ? 66 : 222)
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
    if (preset === 'shatter' || preset === 'god-rays' || preset === 'windfury') return
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
    this.board?.setWindfuryPreview(false, this.windfuryTuning)
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
    if (this.board) {
      const boardElement =
        preset === 'minion' ||
        preset === 'hero' ||
        preset === 'hero-power' ||
        preset === 'weapon' ||
        preset === 'windfury'
      this.board.visible = boardElement
      if (boardElement) {
        this.previewGroups.get(preset)?.addChild(this.board)
        if (preset === 'windfury')
          this.board.setWindfuryPreview(true, this.windfuryTuning)
        else this.board.selectElement(preset)
      }
    }
    this.refreshPreviewAppearance(preset)
    this.refreshPresetTabs()
    this.refreshPaletteButtons()
    this.refreshColorControls()
  }

  private selectPalette(palette: OutlinePaletteName): void {
    if (!isAuraPreset(this.selectedPreset)) return
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
      if (preset === 'shatter' || preset === 'god-rays' || preset === 'windfury')
        continue
      if (!OUTLINE_LAB_PALETTES[preset].some((option) => option.palette === palette))
        continue
      this.refreshPreviewAppearance(preset)
    }
    this.markDirty()
  }

  private refreshColorControls(): void {
    if (this.selectedPreset === 'windfury') {
      this.shaderControls?.showWindfury(
        this.windfuryTuning,
        (key, value) => {
          this.windfuryTuning = { ...this.windfuryTuning, [key]: value }
          this.board?.setWindfuryPreview(true, this.windfuryTuning)
          this.markDirty()
        },
        () => {
          this.windfuryTuning = { ...WINDFURY_DEFAULTS }
          this.board?.setWindfuryPreview(true, this.windfuryTuning)
          this.markDirty()
          this.refreshColorControls()
        }
      )
      return
    }
    if (this.selectedPreset === 'god-rays') {
      this.shaderControls?.showGodRays(
        this.godRaysTuning,
        (key, value) => {
          const channels = ['red', 'green', 'blue', 'opacity']
          const channel = channels.indexOf(key)
          if (channel >= 0) {
            const color: [number, number, number, number] = [
              ...this.godRaysTuning.color
            ]
            color[channel] = value as number
            this.godRaysTuning = { ...this.godRaysTuning, color }
          } else {
            this.godRaysTuning = { ...this.godRaysTuning, [key]: value }
          }
          this.godRays?.setTuning(this.godRaysTuning)
          this.markDirty()
        },
        () => {
          this.godRaysTuning = structuredClone(GOD_RAYS_DEFAULTS)
          this.godRays?.setTuning(this.godRaysTuning)
          this.markDirty()
          this.refreshColorControls()
        },
        this.godRaysDustTuning,
        (key, value) => {
          this.godRaysDustTuning = {
            ...this.godRaysDustTuning,
            [key]:
              key === 'blendMode'
                ? value === 1
                  ? 'add'
                  : 'screen'
                : key === 'decayChance'
                  ? Number(value) / 100
                  : value
          }
          this.godRays?.setDustTuning(this.godRaysDustTuning)
          this.markDirty()
        },
        () => {
          this.godRaysDustTuning = { ...GOD_RAYS_DUST_DEFAULTS }
          this.godRays?.setDustTuning(this.godRaysDustTuning)
          this.markDirty()
          this.refreshColorControls()
        }
      )
      return
    }
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
        },
        {
          preset,
          palette,
          background: this.backgroundChoices.get(preset) ?? 'context',
          onElement: (value) => this.selectPreset(value),
          onState: (value) => this.selectPalette(value),
          onBackground: (value) => {
            this.backgroundChoices.set(preset, value)
            this.refreshBackground(preset)
          }
        }
      )
    }
  }

  private refreshBackground(preset: AuraPresetName): void {
    const background = this.backgrounds.get(preset)
    if (!background) return
    const choice = this.backgroundChoices.get(preset) ?? 'context'
    const viewport = AURA_PREVIEW_LAYOUT.viewport
    background.texture =
      choice === 'context' ? this.sceneTextures.get(preset)! : Texture.WHITE
    background.tint =
      choice === 'light' ? 0xeeeeee : choice === 'dark' ? 0x17283d : 0xffffff
    if (choice !== 'context') {
      applyAnchoredPlacement(background, viewport)
      background.width = viewport.size.width
      background.height = viewport.size.height
    } else {
      const source = AURA_PREVIEW_LAYOUT.sourceCenters[preset]
      const center = AURA_PREVIEW_LAYOUT.center
      // Keep the selected scene point behind the element, clamping only at image edges.
      const x = Math.min(
        viewport.position.x,
        Math.max(viewport.position.x + viewport.size.width - 1920, center.x - source.x)
      )
      const y = Math.min(
        viewport.position.y,
        Math.max(viewport.position.y + viewport.size.height - 1080, center.y - source.y)
      )
      applyAnchoredPlacement(
        background,
        placement({ x, y }, { width: 1920, height: 1080 })
      )
      background.width = 1920
      background.height = 1080
    }
  }

  private refreshHandAppearance(): void {
    const preset = this.selectedPreset === 'bonus-card' ? 'bonus-card' : 'card'
    this.hand?.setAppearance(
      preset === 'bonus-card',
      this.paletteDrafts[this.selectedPalettes[preset]],
      this.drafts[preset],
      this.paletteDrafts.blue
    )
  }

  private refreshPreviewAppearance(preset: OutlinePresetName): void {
    if (preset === 'shatter' || preset === 'god-rays' || preset === 'windfury') return
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
    if (preset === this.selectedPreset) {
      this.board?.setAppearance(
        preset,
        palette,
        tuning,
        this.paletteDrafts.white,
        this.selectedPalettes[preset] === 'white'
      )
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
    const preset = this.selectedPreset
    const aura = isAuraPreset(preset)
    for (const [category, tab] of this.presetTabs) {
      tab.root.visible = aura
      this.drawButton(tab, aura && auraCategory(preset) === category)
    }
  }

  private refreshPaletteButtons(): void {
    const selected = this.selectedPalettes[this.selectedPreset]
    const options =
      this.selectedPreset === 'shatter' ||
      this.selectedPreset === 'god-rays' ||
      this.selectedPreset === 'windfury'
        ? []
        : OUTLINE_LAB_PALETTES[this.selectedPreset]
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
      version: 14,
      windfury: { ...this.windfuryTuning },
      godRaysDust: { ...this.godRaysDustTuning },
      godRays: structuredClone(this.godRaysTuning),
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
