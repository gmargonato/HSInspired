import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent
} from 'pixi.js'
import type {
  AiDifficulty,
  PreferencesApi
} from '../../desktop/contracts/ipc/preferences'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import type { MenuSettingsAssets } from '../../visual-components/assets'
import { Button } from '../../visual-components/controls/button'
import { SETTINGS_LAYOUT } from './settings-layout'

const DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'expert']
const OPTION_HEIGHT = SETTINGS_LAYOUT.aiDifficultyOption.size.height

type DifficultyOption = {
  readonly difficulty: AiDifficulty
  readonly background: Graphics
}

function difficultyLabel(difficulty: AiDifficulty): string {
  return difficulty === 'easy' ? 'Easy' : 'Expert'
}

/** Saves the difficulty for future matches without changing the current match. */
export class AiDifficultySelector extends Container {
  private readonly dismissLayer = new Graphics()
  private readonly optionsLayer = new Container()
  private readonly valueLabel: Text
  private readonly arrowButton: Button
  private readonly options: DifficultyOption[] = []
  private selectedDifficulty: AiDifficulty | null = null
  private open = false
  private applying = false

  constructor(
    assets: Pick<MenuSettingsAssets, 'resolutionField' | 'resolutionButton'>,
    private readonly api: PreferencesApi,
    private readonly onError: (error: unknown) => void = console.error,
    private readonly onOpen: () => void = () => undefined
  ) {
    super()
    this.label = 'settings.ai-difficulty-selector'

    this.dismissLayer.label = 'settings.ai-difficulty-dismiss'
    this.dismissLayer.rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0 })
    this.dismissLayer.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.dismissLayer.eventMode = 'static'
    this.dismissLayer.visible = false
    this.dismissLayer.on('pointertap', this.dismissOptions)
    this.addChild(this.dismissLayer)

    const title = new Text({
      text: 'Difficulty',
      style: { fontFamily: 'Franklin Gothic Condensed', fontSize: 36, fill: 0xf5e3b6 }
    })
    title.label = 'settings.ai-difficulty-title'
    title.eventMode = 'none'
    applyAnchoredPlacement(title, SETTINGS_LAYOUT.aiDifficultyTitle)
    this.addChild(title)

    const field = new Sprite(assets.resolutionField)
    field.label = 'settings.ai-difficulty-field'
    field.eventMode = 'none'
    applyAnchoredPlacement(field, SETTINGS_LAYOUT.aiDifficultyField)
    this.addChild(field)

    this.valueLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 28,
        fill: 0x120d09,
        align: 'center'
      }
    })
    this.valueLabel.label = 'settings.ai-difficulty-value'
    this.valueLabel.eventMode = 'none'
    applyAnchoredPlacement(this.valueLabel, SETTINGS_LAYOUT.aiDifficultyValue)
    this.addChild(this.valueLabel)

    this.arrowButton = new Button(assets.resolutionButton, {
      pressedScale: 0.94,
      hoverBrightness: 1.2,
      pressedBrightness: 0.9,
      sinkPx: 1,
      onClick: () => this.toggleOptions(),
      onError: this.onError
    })
    this.arrowButton.label = 'settings.ai-difficulty-button'
    applyPlacement(this.arrowButton, SETTINGS_LAYOUT.aiDifficultyButton)
    this.arrowButton.setBaseY(this.arrowButton.y)
    this.addChild(this.arrowButton)

    this.optionsLayer.label = 'settings.ai-difficulty-options'
    this.optionsLayer.visible = false
    applyPlacement(this.optionsLayer, SETTINGS_LAYOUT.aiDifficultyOptions)
    this.addChild(this.optionsLayer)
    this.buildOptions()
  }

  async init(): Promise<void> {
    this.applyDifficulty((await this.api.get()).aiDifficulty)
  }

  dispose(): void {
    this.closeOptions()
    this.dismissLayer.off('pointertap', this.dismissOptions)
  }

  closeOptions(): void {
    if (!this.open) return
    this.zIndex = 0
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
    this.zIndex = 10
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
    panel.label = 'settings.ai-difficulty-options-panel'
    panel.roundRect(
      0,
      0,
      SETTINGS_LAYOUT.aiDifficultyOptions.size.width,
      DIFFICULTIES.length * OPTION_HEIGHT,
      5
    )
    panel.fill({ color: 0x201b18, alpha: 0.98 })
    panel.stroke({ color: 0x8b7654, width: 3, alpha: 1 })
    panel.eventMode = 'none'
    this.optionsLayer.addChild(panel)

    for (const [index, difficulty] of DIFFICULTIES.entries()) {
      const row = new Container()
      row.label = `settings.ai-difficulty-option-${difficulty}`
      row.position.set(0, index * OPTION_HEIGHT)
      row.hitArea = new Rectangle(
        0,
        0,
        SETTINGS_LAYOUT.aiDifficultyOptions.size.width,
        OPTION_HEIGHT
      )
      row.eventMode = 'static'

      const background = new Graphics()
      background.label = `settings.ai-difficulty-option-background-${difficulty}`
      background.eventMode = 'none'
      row.addChild(background)

      const label = new Text({
        text: difficultyLabel(difficulty),
        style: { fontFamily: 'Franklin Gothic Condensed', fontSize: 26, fill: 0xf5e3b6 }
      })
      label.label = `settings.ai-difficulty-option-label-${difficulty}`
      label.eventMode = 'none'
      label.anchor.set(0, 0.5)
      label.position.set(
        SETTINGS_LAYOUT.aiDifficultyOption.position.x,
        SETTINGS_LAYOUT.aiDifficultyOption.position.y
      )
      row.addChild(label)

      const option: DifficultyOption = { difficulty, background }
      this.options.push(option)
      this.drawOption(option, false)
      row.on('pointerover', () => this.drawOption(option, true))
      row.on('pointerout', () => this.drawOption(option, false))
      row.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        void this.selectDifficulty(difficulty)
      })
      this.optionsLayer.addChild(row)
    }
  }

  private drawOption(option: DifficultyOption, hovered: boolean): void {
    const selected = this.selectedDifficulty === option.difficulty
    const color = hovered ? 0x9b835d : selected ? 0x5b5043 : 0x2b2521
    option.background.clear()
    option.background
      .rect(2, 1, SETTINGS_LAYOUT.aiDifficultyOptions.size.width - 4, OPTION_HEIGHT - 2)
      .fill({ color, alpha: hovered || selected ? 1 : 0.88 })
  }

  private applyDifficulty(difficulty: AiDifficulty): void {
    this.selectedDifficulty = difficulty
    this.valueLabel.text = difficultyLabel(difficulty)
    for (const option of this.options) this.drawOption(option, false)
  }

  private async selectDifficulty(difficulty: AiDifficulty): Promise<void> {
    if (this.applying || this.selectedDifficulty === difficulty) {
      this.closeOptions()
      return
    }
    this.applying = true
    this.arrowButton.setEnabled(false)
    this.closeOptions()
    try {
      this.applyDifficulty(
        (await this.api.set({ aiDifficulty: difficulty })).aiDifficulty
      )
    } catch (error) {
      this.onError(error)
    } finally {
      this.applying = false
      this.arrowButton.setEnabled(true)
    }
  }
}
