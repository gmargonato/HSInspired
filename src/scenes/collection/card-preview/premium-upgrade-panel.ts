import { Container, Rectangle, Sprite, Text, type FederatedPointerEvent } from 'pixi.js'
import type { CardDefinition } from '../../../game-rules/content/cards'
import { premiumUpgradeCost } from '../../../game-rules/progression/arcane-dust'
import type { ProgressionStore } from '../../../application/contracts/progression-store'
import type { CardPreviewAssets } from '../../../visual-components/assets'
import {
  applyAnchoredPlacement,
  applyPlacement,
  type LayoutPlacement
} from '../../../visual-components/layout'
import { CARD_PREVIEW_LAYOUT as LAYOUT } from './card-preview-layout'

export class PremiumUpgradePanel extends Container {
  private readonly upgradeButton: Sprite
  private readonly refundButton: Sprite
  private readonly costText: Text
  private readonly refundText: Text
  private readonly balanceText: Text
  private readonly unsubscribe: () => void
  private pending = false
  private errorMessage = ''

  constructor(
    private readonly card: CardDefinition,
    assets: CardPreviewAssets,
    private readonly store: ProgressionStore,
    private readonly onChange?: (action: 'upgrade' | 'refund') => Promise<void>
  ) {
    super()
    this.label = 'card-preview.upgrade-panel'
    applyPlacement(this, LAYOUT.upgradePanel)
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 422, 250)
    this.on('pointertap', (event: FederatedPointerEvent) => event.stopPropagation())
    const base = new Sprite(assets.upgradeWindow)
    base.label = 'card-preview.upgrade-base'
    applyAnchoredPlacement(base, LAYOUT.upgradeBase)
    this.addChild(base)
    this.refundButton = new Sprite(assets.disenchantButton)
    this.upgradeButton = new Sprite(assets.upgradeButton)
    this.refundButton.label = 'card-preview.disenchant-button'
    this.upgradeButton.label = 'card-preview.upgrade-button'
    applyAnchoredPlacement(this.refundButton, LAYOUT.disenchantButton)
    applyAnchoredPlacement(this.upgradeButton, LAYOUT.upgradeButton)
    this.addChild(this.refundButton, this.upgradeButton)
    this.costText = this.createText('upgrade-cost', LAYOUT.upgradeValue)
    this.refundText = this.createText('refund-value', LAYOUT.refundValue)
    this.costText.style.align = 'right'
    this.refundText.style.align = 'right'
    this.balanceText = this.createText('dust-balance', LAYOUT.dustBalance)
    this.upgradeButton.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      if (event.button === 0) void this.change('upgrade')
    })
    this.refundButton.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      if (event.button === 0) void this.change('refund')
    })
    this.unsubscribe = store.subscribe(() => this.refresh())
    this.refresh()
  }

  private createText(label: string, placement: LayoutPlacement, fontSize = 28): Text {
    const text = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fill: 0xffffff,
        align: 'center',
        stroke: { color: 0x000000, width: 3 }
      }
    })
    text.label = `card-preview.${label}`
    text.eventMode = 'none'
    applyAnchoredPlacement(text, placement)
    this.addChild(text)
    return text
  }

  private refresh(): void {
    if (this.destroyed) return
    const { dust, premiumPurchases } = this.store.getSnapshot()
    const price = premiumUpgradeCost(this.card)
    const paid = premiumPurchases[this.card.id]
    const eligible = price !== null
    this.upgradeButton.visible = eligible
    this.refundButton.visible = eligible || paid !== undefined
    this.costText.text = price === null ? '—' : `-${price}`
    this.refundText.text =
      paid !== undefined ? `+${paid}` : price === null ? '—' : `+${price}`
    this.balanceText.text = this.errorMessage || String(dust)
    this.balanceText.style.fontSize = this.errorMessage ? 18 : 28
    this.setEnabled(
      this.upgradeButton,
      eligible && paid === undefined && dust >= price! && !this.pending
    )
    this.setEnabled(this.refundButton, paid !== undefined && !this.pending)
  }

  private setEnabled(button: Sprite, enabled: boolean): void {
    button.tint = enabled ? 0xffffff : 0x666666
    button.eventMode = enabled ? 'static' : 'none'
    button.cursor = enabled ? 'pointer' : 'default'
  }

  private async change(action: 'upgrade' | 'refund'): Promise<void> {
    if (this.pending) return
    this.pending = true
    this.errorMessage = ''
    this.refresh()
    try {
      if (this.onChange) await this.onChange(action)
      else await this.store[action](this.card.id)
    } catch (error) {
      this.errorMessage = 'Could not save. Try again.'
      console.error('Could not save the premium card change.', error)
    } finally {
      this.pending = false
      this.refresh()
    }
  }

  override destroy(): void {
    this.unsubscribe()
    super.destroy({ children: true })
  }
}
