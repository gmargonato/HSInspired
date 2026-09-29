import { Container, Text } from 'pixi.js'
import type { PreferencesApi } from '../../../shared/ipc/preferences'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import type { MenuSettingsAssets } from '../../ui/asset-registry'
import { Button } from '../../ui/components/button'
import { SETTINGS_LAYOUT } from './settings-layout'

/** Future-match preference; an active Expert keeps its captured setting. */
export class ExpertDeckStrategyToggle extends Container {
  private enabled = true
  private applying = false
  private disposed = false
  private readonly button: Button
  private readonly value: Text

  constructor(
    assets: Pick<MenuSettingsAssets, 'resolutionField'>,
    private readonly api: PreferencesApi,
    private readonly onError: (error: unknown) => void = console.error,
    private readonly onToggle: () => void = () => undefined
  ) {
    super()
    this.label = 'settings.expert-deck-strategy'
    const title = new Text({
      text: 'Expert deck strategy',
      style: { fontFamily: 'Belwe', fontSize: 26, fill: 0xffffff }
    })
    title.label = 'settings.expert-deck-strategy-title'
    title.eventMode = 'none'
    applyAnchoredPlacement(title, SETTINGS_LAYOUT.expertDeckStrategyTitle)
    this.addChild(title)

    this.button = new Button(assets.resolutionField, {
      hoverBrightness: 1.1,
      sinkPx: 1,
      onClick: () => this.toggle(),
      onError
    })
    this.button.label = 'settings.expert-deck-strategy-button'
    applyPlacement(this.button, SETTINGS_LAYOUT.expertDeckStrategyField)
    this.button.setBaseY(this.button.y)
    this.button.setEnabled(false)
    this.addChild(this.button)

    this.value = new Text({
      text: '',
      style: { fontFamily: 'Belwe', fontSize: 28, fill: 0x120d09 }
    })
    this.value.label = 'settings.expert-deck-strategy-value'
    this.value.eventMode = 'none'
    applyAnchoredPlacement(this.value, SETTINGS_LAYOUT.expertDeckStrategyValue)
    this.addChild(this.value)

    const hint = new Text({
      text: 'Applies to new constructed matches.',
      style: { fontFamily: 'Belwe', fontSize: 16, fill: 0xf5e3b6 }
    })
    hint.label = 'settings.expert-deck-strategy-hint'
    hint.eventMode = 'none'
    applyAnchoredPlacement(hint, SETTINGS_LAYOUT.expertDeckStrategyHint)
    this.addChild(hint)
  }

  async init(): Promise<void> {
    const preferences = await this.api.get()
    if (this.destroyed || this.disposed) return
    this.apply(preferences.expertDeckStrategyEnabled !== false)
    this.button.setEnabled(true)
  }

  dispose(): void {
    this.disposed = true
    this.button.setEnabled(false)
  }

  private apply(enabled: boolean): void {
    this.enabled = enabled
    this.value.text = enabled ? 'Enabled' : 'Disabled'
  }

  private async toggle(): Promise<void> {
    if (this.applying || this.disposed) return
    this.onToggle()
    this.applying = true
    this.button.setEnabled(false)
    try {
      const preferences = await this.api.set({
        expertDeckStrategyEnabled: !this.enabled
      })
      if (!this.destroyed && !this.disposed)
        this.apply(preferences.expertDeckStrategyEnabled !== false)
    } catch (error) {
      this.onError(error)
    } finally {
      this.applying = false
      if (!this.destroyed && !this.disposed) this.button.setEnabled(true)
    }
  }
}
