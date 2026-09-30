import { Container, Sprite, Text, type Texture } from 'pixi.js'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import {
  DAMAGE_INDICATOR_CANVAS,
  DAMAGE_INDICATOR_LAYOUT
} from './damage-indicator-layout'

export function formatDamageAmount(amount: number): string {
  return `-${amount}`
}

/** Non-interactive burst and amount shown over a character that took damage. */
export class DamageIndicatorView extends Container {
  constructor(texture: Texture, amount: number) {
    super()
    this.label = 'game.damage-indicator'
    this.eventMode = 'none'
    this.pivot.set(
      DAMAGE_INDICATOR_CANVAS.width / 2,
      DAMAGE_INDICATOR_CANVAS.height / 2
    )

    const burst = new Sprite(texture)
    applyAnchoredPlacement(burst, DAMAGE_INDICATOR_LAYOUT.burst)
    burst.label = 'game.damage-indicator.burst'
    burst.eventMode = 'none'
    this.addChild(burst)

    const label = new Text({
      text: formatDamageAmount(amount),
      style: DAMAGE_INDICATOR_LAYOUT.textStyle,
      anchor: 0.5
    })
    applyAnchoredPlacement(label, DAMAGE_INDICATOR_LAYOUT.amount)
    label.rotation = DAMAGE_INDICATOR_LAYOUT.amountRotation
    label.label = 'game.damage-indicator.amount'
    label.eventMode = 'none'
    this.addChild(label)
  }
}
