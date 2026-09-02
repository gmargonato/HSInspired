import { CENTER, placement } from '../../rendering/layout'
import { DAMAGE_INDICATOR_LAYOUT } from './damage-indicator-layout'

/** Local design space for one transient healing burst. */
export const HEAL_INDICATOR_CANVAS = { width: 192, height: 197 } as const

export const HEAL_INDICATOR_LAYOUT = {
  name: 'Heal indicator',
  burst: placement(
    {
      x: HEAL_INDICATOR_CANVAS.width / 2,
      y: HEAL_INDICATOR_CANVAS.height / 2
    },
    HEAL_INDICATOR_CANVAS,
    {
      anchor: CENTER,
      note: 'Upright authored healing burst behind the restored amount.'
    }
  ),
  amount: placement(
    {
      x: HEAL_INDICATOR_CANVAS.width / 2,
      y: HEAL_INDICATOR_CANVAS.height / 2 - 8
    },
    { width: 118, height: 72 },
    {
      anchor: CENTER,
      note: 'Counterclockwise Belwe healing amount centered over the burst.'
    }
  ),
  amountRotation: DAMAGE_INDICATOR_LAYOUT.amountRotation,
  textStyle: DAMAGE_INDICATOR_LAYOUT.textStyle
} as const
