import { Container, Sprite, Text } from 'pixi.js'
import type { PreferencesApi } from '../../desktop/contracts/ipc/preferences'
import type { MenuSettingsAssets } from '../../visual-components/assets'
import { applyAnchoredPlacement } from '../../visual-components/layout'
import { SETTINGS_LAYOUT } from './settings-layout'

/** Saves the startup bonus preference without changing an existing match. */
export class AiCheatsToggle extends Container {
  private readonly checkbox: Sprite
  private enabled = true
  private saving = false

  constructor(
    private readonly assets: Pick<MenuSettingsAssets, 'checkboxOff' | 'checkboxOn'>,
    private readonly api: PreferencesApi,
    private readonly onInteract: () => void,
    private readonly onError: (error: unknown) => void = console.error
  ) {
    super()
    this.label = 'settings.ai-cheats'
    this.checkbox = new Sprite(assets.checkboxOn)
    this.checkbox.label = 'settings.ai-cheats-checkbox'
    applyAnchoredPlacement(this.checkbox, SETTINGS_LAYOUT.aiCheats.checkbox)
    const title = new Text({
      text: 'AI Cheats',
      style: { fontFamily: 'Franklin Gothic Condensed', fontSize: 36, fill: 0xf5e3b6 }
    })
    title.label = 'settings.ai-cheats-title'
    applyAnchoredPlacement(title, SETTINGS_LAYOUT.aiCheats.title)
    this.addChild(this.checkbox, title)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', () => void this.toggle())
  }

  async init(): Promise<void> {
    this.apply((await this.api.get()).aiCheatsEnabled)
  }

  private apply(enabled: boolean): void {
    this.enabled = enabled
    this.checkbox.texture = enabled ? this.assets.checkboxOn : this.assets.checkboxOff
  }

  private async toggle(): Promise<void> {
    if (this.saving) return
    this.onInteract()
    this.saving = true
    try {
      const saved = await this.api.set({ aiCheatsEnabled: !this.enabled })
      if (!this.destroyed) this.apply(saved.aiCheatsEnabled)
    } catch (error) {
      this.onError(error)
    } finally {
      this.saving = false
    }
  }
}
