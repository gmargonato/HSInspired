import { Container, Sprite, Text, type Texture } from 'pixi.js'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { HEAL_INDICATOR_CANVAS, HEAL_INDICATOR_LAYOUT } from './heal-indicator-layout'

export function formatHealAmount(amount: number): string {
  return `+${amount}`
}

/** Non-interactive burst and amount shown over a character that recovered Health. */
export class HealIndicatorView extends Container {
  constructor(texture: Texture, amount: number) {
    super()
    this.label = 'game.heal-indicator'
    this.eventMode = 'none'
    this.pivot.set(HEAL_INDICATOR_CANVAS.width / 2, HEAL_INDICATOR_CANVAS.height / 2)

    const burst = new Sprite(texture)
    applyAnchoredPlacement(burst, HEAL_INDICATOR_LAYOUT.burst)
    burst.label = 'game.heal-indicator.burst'
    burst.eventMode = 'none'
    this.addChild(burst)

    const label = new Text({
      text: formatHealAmount(amount),
      style: HEAL_INDICATOR_LAYOUT.textStyle,
      anchor: 0.5
    })
    applyAnchoredPlacement(label, HEAL_INDICATOR_LAYOUT.amount)
    label.rotation = HEAL_INDICATOR_LAYOUT.amountRotation
    label.label = 'game.heal-indicator.amount'
    label.eventMode = 'none'
    this.addChild(label)
  }
}
