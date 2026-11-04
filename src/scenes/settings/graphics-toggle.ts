import { Container, Sprite, Text } from 'pixi.js'
import type { PreferencesApi } from '../../desktop/contracts/ipc/preferences'
import type { MenuSettingsAssets } from '../../visual-components/assets'
import { applyAnchoredPlacement } from '../../visual-components/layout'
import { SETTINGS_LAYOUT } from './settings-layout'
import { setShadowsEnabled } from '../../visual-components/effects/shadow-visibility'

/** Shadows apply application-wide; 3D controls apply to the next match. */
export class GraphicsToggle extends Container {
  private readonly checkbox: Sprite
  private enabled = true
  private saving = false

  constructor(
    private readonly assets: Pick<MenuSettingsAssets, 'checkboxOff' | 'checkboxOn'>,
    private readonly api: PreferencesApi,
    private readonly setting: 'enable3dElements' | 'enableShadows',
    private readonly onInteract: () => void,
    private readonly onError: (error: unknown) => void = console.error
  ) {
    super()
    this.label = `settings.${setting}`
    this.checkbox = new Sprite(assets.checkboxOn)
    this.checkbox.label = `${this.label}.checkbox`
    applyAnchoredPlacement(this.checkbox, SETTINGS_LAYOUT[setting].checkbox)
    const title = new Text({
      text: setting === 'enable3dElements' ? 'Enable 3D elements' : 'Enable shadows',
      style: { fontFamily: 'Franklin Gothic Condensed', fontSize: 36, fill: 0xf5e3b6 }
    })
    title.label = `${this.label}.title`
    applyAnchoredPlacement(title, SETTINGS_LAYOUT[setting].title)
    this.addChild(this.checkbox, title)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', () => void this.toggle())
  }

  async init(): Promise<void> {
    this.apply((await this.api.get())[this.setting])
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
      const saved = await this.api.set({ [this.setting]: !this.enabled })
      if (this.setting === 'enableShadows') {
        setShadowsEnabled(saved.enableShadows)
      }
      if (!this.destroyed) this.apply(saved[this.setting])
    } catch (error) {
      this.onError(error)
    } finally {
      this.saving = false
    }
  }
}
