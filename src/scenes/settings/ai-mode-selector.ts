import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent
} from 'pixi.js'
import type { AiMode, PreferencesApi } from '../../desktop/contracts/ipc/preferences'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import type { MenuSettingsAssets } from '../../visual-components/assets'
import { Button } from '../../visual-components/controls/button'
import { SETTINGS_LAYOUT } from './settings-layout'

const MODES: readonly AiMode[] = ['hardware', 'hardware-v2', 'api']
const OPTION_HEIGHT = SETTINGS_LAYOUT.aiModeOption.size.height

type ModeOption = {
  readonly mode: AiMode
  readonly background: Graphics
}

function modeLabel(mode: AiMode): string {
  if (mode === 'hardware') return 'Easy'
  if (mode === 'hardware-v2') return 'Expert'
  return 'API'
}

/** Saves the future AI routing preference without changing the current AI service. */
export class AiModeSelector extends Container {
  private readonly dismissLayer = new Graphics()
  private readonly optionsLayer = new Container()
  private readonly valueLabel: Text
  private readonly arrowButton: Button
  private readonly options: ModeOption[] = []
  private selectedMode: AiMode | null = null
  private open = false
  private applying = false

  constructor(
    assets: Pick<MenuSettingsAssets, 'resolutionField' | 'resolutionButton'>,
    private readonly api: PreferencesApi,
    private readonly onError: (error: unknown) => void = console.error,
    private readonly onOpen: () => void = () => undefined
  ) {
    super()
    this.label = 'settings.ai-mode-selector'

    this.dismissLayer.label = 'settings.ai-mode-dismiss'
    this.dismissLayer.rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0 })
    this.dismissLayer.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.dismissLayer.eventMode = 'static'
    this.dismissLayer.visible = false
    this.dismissLayer.on('pointertap', this.dismissOptions)
    this.addChild(this.dismissLayer)

    const title = new Text({
      text: 'AI Settings',
      style: { fontFamily: 'Belwe', fontSize: 42, fill: 0xffffff }
    })
    title.label = 'settings.ai-mode-title'
    title.eventMode = 'none'
    applyAnchoredPlacement(title, SETTINGS_LAYOUT.aiModeTitle)
    this.addChild(title)

    const field = new Sprite(assets.resolutionField)
    field.label = 'settings.ai-mode-field'
    field.eventMode = 'none'
    applyAnchoredPlacement(field, SETTINGS_LAYOUT.aiModeField)
    this.addChild(field)

    this.valueLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 28,
        fill: 0x120d09,
        align: 'center'
      }
    })
    this.valueLabel.label = 'settings.ai-mode-value'
    this.valueLabel.eventMode = 'none'
    applyAnchoredPlacement(this.valueLabel, SETTINGS_LAYOUT.aiModeValue)
    this.addChild(this.valueLabel)

    this.arrowButton = new Button(assets.resolutionButton, {
      pressedScale: 0.94,
      hoverBrightness: 1.2,
      pressedBrightness: 0.9,
      sinkPx: 1,
      onClick: () => this.toggleOptions(),
      onError: this.onError
    })
    this.arrowButton.label = 'settings.ai-mode-button'
    applyPlacement(this.arrowButton, SETTINGS_LAYOUT.aiModeButton)
    this.arrowButton.setBaseY(this.arrowButton.y)
    this.addChild(this.arrowButton)

    this.optionsLayer.label = 'settings.ai-mode-options'
    this.optionsLayer.visible = false
    applyPlacement(this.optionsLayer, SETTINGS_LAYOUT.aiModeOptions)
    this.addChild(this.optionsLayer)
    this.buildOptions()
  }

  async init(): Promise<void> {
    this.applyMode((await this.api.get()).aiMode)
  }

  dispose(): void {
    this.closeOptions()
    this.dismissLayer.off('pointertap', this.dismissOptions)
  }

  closeOptions(): void {
    if (!this.open) return
    this.open = false
    this.dismissLayer.visible = false
    this.optionsLayer.visible = false
    window.removeEventListener('keydown', this.handleKeyDown, true)
  }

  private toggleOptions(): void {
    if (this.applying) return
    if (this.open) {
      this.closeOptions()
      return
    }
    this.onOpen()
    this.open = true
    this.dismissLayer.visible = true
    this.optionsLayer.visible = true
    window.addEventListener('keydown', this.handleKeyDown, true)
  }

  private readonly dismissOptions = (): void => this.closeOptions()

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.open) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.closeOptions()
  }

  private buildOptions(): void {
    const panel = new Graphics()
    panel.label = 'settings.ai-mode-options-panel'
    panel.roundRect(
      0,
      0,
      SETTINGS_LAYOUT.aiModeOptions.size.width,
      MODES.length * OPTION_HEIGHT,
      5
    )
    panel.fill({ color: 0x201b18, alpha: 0.98 })
    panel.stroke({ color: 0x8b7654, width: 3, alpha: 1 })
    panel.eventMode = 'none'
    this.optionsLayer.addChild(panel)

    for (const [index, mode] of MODES.entries()) {
      const row = new Container()
      row.label = `settings.ai-mode-option-${mode}`
      row.position.set(0, index * OPTION_HEIGHT)
      row.hitArea = new Rectangle(
        0,
        0,
        SETTINGS_LAYOUT.aiModeOptions.size.width,
        OPTION_HEIGHT
      )
      row.eventMode = 'static'

      const background = new Graphics()
      background.label = `settings.ai-mode-option-background-${mode}`
      background.eventMode = 'none'
      row.addChild(background)

      const label = new Text({
        text: modeLabel(mode),
        style: { fontFamily: 'Belwe', fontSize: 26, fill: 0xf5e3b6 }
      })
      label.label = `settings.ai-mode-option-label-${mode}`
      label.eventMode = 'none'
      label.anchor.set(0, 0.5)
      label.position.set(
        SETTINGS_LAYOUT.aiModeOption.position.x,
        SETTINGS_LAYOUT.aiModeOption.position.y
      )
      row.addChild(label)

      const option: ModeOption = { mode, background }
      this.options.push(option)
      this.drawOption(option, false)
      row.on('pointerover', () => this.drawOption(option, true))
      row.on('pointerout', () => this.drawOption(option, false))
      row.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        void this.selectMode(mode)
      })
      this.optionsLayer.addChild(row)
    }
  }

  private drawOption(option: ModeOption, hovered: boolean): void {
    const selected = this.selectedMode === option.mode
    const color = hovered ? 0x9b835d : selected ? 0x5b5043 : 0x2b2521
    option.background.clear()
    option.background
      .rect(2, 1, SETTINGS_LAYOUT.aiModeOptions.size.width - 4, OPTION_HEIGHT - 2)
      .fill({ color, alpha: hovered || selected ? 1 : 0.88 })
  }

  private applyMode(mode: AiMode): void {
    this.selectedMode = mode
    this.valueLabel.text = modeLabel(mode)
    for (const option of this.options) this.drawOption(option, false)
  }

  private async selectMode(mode: AiMode): Promise<void> {
    if (this.applying || this.selectedMode === mode) {
      this.closeOptions()
      return
    }
    this.applying = true
    this.arrowButton.setEnabled(false)
    this.closeOptions()
    try {
      this.applyMode((await this.api.set({ aiMode: mode })).aiMode)
    } catch (error) {
      this.onError(error)
    } finally {
      this.applying = false
      this.arrowButton.setEnabled(true)
    }
  }
}
