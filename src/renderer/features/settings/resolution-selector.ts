import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent
} from 'pixi.js'
import type {
  WindowResolution,
  WindowResolutionSettings,
  WindowSettingsApi
} from '../../../shared/ipc/window-settings'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import type { SettingsAssets } from '../../ui/asset-registry'
import { Button } from '../../ui/components/button'
import { SETTINGS_LAYOUT } from './settings-layout'

const OPTION_HEIGHT = SETTINGS_LAYOUT.resolutionOption.size.height

type ResolutionOption = {
  readonly resolution: WindowResolution
  readonly row: Container
  readonly background: Graphics
}

function formatResolution(resolution: WindowResolution): string {
  return `${resolution.width}x${resolution.height}`
}

/** Pixi-only selector for the Electron window's 16:9 content-size presets. */
export class ResolutionSelector extends Container {
  private readonly dismissLayer = new Graphics()
  private readonly optionsLayer = new Container()
  private readonly valueLabel: Text
  private readonly arrowButton: Button
  private readonly options: ResolutionOption[] = []
  private selectedResolution: WindowResolution | null = null
  private open = false
  private applying = false

  constructor(
    assets: Pick<SettingsAssets, 'resolutionField' | 'resolutionButton'>,
    private readonly api: WindowSettingsApi,
    private readonly onError: (error: unknown) => void = console.error
  ) {
    super()
    this.label = 'settings.resolution-selector'

    this.dismissLayer.label = 'settings.resolution-dismiss'
    this.dismissLayer.rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0 })
    this.dismissLayer.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.dismissLayer.eventMode = 'static'
    this.dismissLayer.visible = false
    this.dismissLayer.on('pointertap', this.dismissOptions)
    this.addChild(this.dismissLayer)

    const title = new Text({
      text: 'Resolution',
      style: {
        fontFamily: 'Belwe',
        fontSize: 42,
        fill: 0xffffff
      }
    })
    title.label = 'settings.resolution-title'
    title.eventMode = 'none'
    applyAnchoredPlacement(title, SETTINGS_LAYOUT.resolutionTitle)
    this.addChild(title)

    const field = new Sprite(assets.resolutionField)
    field.label = 'settings.resolution-field'
    field.eventMode = 'none'
    applyAnchoredPlacement(field, SETTINGS_LAYOUT.resolutionField)
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
    this.valueLabel.label = 'settings.resolution-value'
    this.valueLabel.eventMode = 'none'
    applyAnchoredPlacement(this.valueLabel, SETTINGS_LAYOUT.resolutionValue)
    this.addChild(this.valueLabel)

    this.arrowButton = new Button(assets.resolutionButton, {
      pressedScale: 0.94,
      hoverBrightness: 1.2,
      pressedBrightness: 0.9,
      sinkPx: 1,
      onClick: () => this.toggleOptions(),
      onError: this.onError
    })
    this.arrowButton.label = 'settings.resolution-button'
    applyPlacement(this.arrowButton, SETTINGS_LAYOUT.resolutionButton)
    this.arrowButton.setBaseY(this.arrowButton.y)
    this.addChild(this.arrowButton)

    this.optionsLayer.label = 'settings.resolution-options'
    this.optionsLayer.visible = false
    applyPlacement(this.optionsLayer, SETTINGS_LAYOUT.resolutionOptions)
    this.addChild(this.optionsLayer)
  }

  async init(): Promise<void> {
    this.applySettings(await this.api.get())
  }

  dispose(): void {
    this.closeOptions()
    this.dismissLayer.off('pointertap', this.dismissOptions)
  }

  private toggleOptions(): void {
    if (this.applying) return
    if (this.open) this.closeOptions()
    else this.openOptions()
  }

  private openOptions(): void {
    if (this.open || this.applying || this.options.length === 0) return
    this.open = true
    this.dismissLayer.visible = true
    this.optionsLayer.visible = true
    window.addEventListener('keydown', this.handleKeyDown, true)
  }

  private closeOptions(): void {
    if (!this.open) return
    this.open = false
    this.dismissLayer.visible = false
    this.optionsLayer.visible = false
    window.removeEventListener('keydown', this.handleKeyDown, true)
  }

  private readonly dismissOptions = (): void => this.closeOptions()

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.open) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.closeOptions()
  }

  private applySettings(settings: WindowResolutionSettings): void {
    this.selectedResolution = settings.selectedResolution
    this.valueLabel.text = formatResolution(settings.selectedResolution)
    this.rebuildOptions(settings.availableResolutions)
  }

  private rebuildOptions(resolutions: readonly WindowResolution[]): void {
    this.optionsLayer
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }))
    this.options.length = 0

    const height = resolutions.length * OPTION_HEIGHT
    const panel = new Graphics()
    panel.label = 'settings.resolution-options-panel'
    panel.roundRect(0, 0, SETTINGS_LAYOUT.resolutionOptions.size.width, height, 5)
    panel.fill({ color: 0x201b18, alpha: 0.98 })
    panel.stroke({ color: 0x8b7654, width: 3, alpha: 1 })
    panel.eventMode = 'none'
    this.optionsLayer.addChild(panel)

    for (const [index, resolution] of resolutions.entries()) {
      const row = new Container()
      row.label = `settings.resolution-option-${resolution.width}x${resolution.height}`
      row.position.set(0, index * OPTION_HEIGHT)
      row.hitArea = new Rectangle(
        0,
        0,
        SETTINGS_LAYOUT.resolutionOptions.size.width,
        OPTION_HEIGHT
      )
      row.eventMode = 'static'

      const background = new Graphics()
      background.label = `settings.resolution-option-background-${resolution.width}x${resolution.height}`
      background.eventMode = 'none'
      row.addChild(background)

      const label = new Text({
        text: formatResolution(resolution),
        style: {
          fontFamily: 'Belwe',
          fontSize: 26,
          fill: 0xf5e3b6
        }
      })
      label.label = `settings.resolution-option-label-${resolution.width}x${resolution.height}`
      label.eventMode = 'none'
      label.anchor.set(0, 0.5)
      label.position.set(
        SETTINGS_LAYOUT.resolutionOption.position.x,
        SETTINGS_LAYOUT.resolutionOption.position.y
      )
      row.addChild(label)

      const option: ResolutionOption = { resolution, row, background }
      this.drawOption(option, this.isSelected(resolution), false)
      row.on('pointerover', () =>
        this.drawOption(option, this.isSelected(resolution), true)
      )
      row.on('pointerout', () =>
        this.drawOption(option, this.isSelected(resolution), false)
      )
      row.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        void this.selectResolution(resolution)
      })
      this.options.push(option)
      this.optionsLayer.addChild(row)
    }
  }

  private drawOption(
    option: ResolutionOption,
    selected: boolean,
    hovered: boolean
  ): void {
    const color = hovered ? 0x9b835d : selected ? 0x5b5043 : 0x2b2521
    option.background.clear()
    option.background
      .rect(2, 1, SETTINGS_LAYOUT.resolutionOptions.size.width - 4, OPTION_HEIGHT - 2)
      .fill({ color, alpha: hovered || selected ? 1 : 0.88 })
  }

  private isSelected(resolution: WindowResolution): boolean {
    return (
      this.selectedResolution?.width === resolution.width &&
      this.selectedResolution.height === resolution.height
    )
  }

  private async selectResolution(resolution: WindowResolution): Promise<void> {
    if (this.applying || this.isSelected(resolution)) {
      this.closeOptions()
      return
    }

    this.applying = true
    this.arrowButton.setEnabled(false)
    this.closeOptions()
    try {
      this.applySettings(await this.api.setResolution(resolution))
    } catch (error) {
      this.onError(error)
    } finally {
      this.applying = false
      this.arrowButton.setEnabled(true)
    }
  }
}
