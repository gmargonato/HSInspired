import { CENTER, placement } from '../../rendering/layout'

/** Local design space for one transient damage burst. */
export const DAMAGE_INDICATOR_CANVAS = { width: 159, height: 163 } as const

export const DAMAGE_INDICATOR_LAYOUT = {
  name: 'Damage indicator',
  burst: placement(
    {
      x: DAMAGE_INDICATOR_CANVAS.width / 2,
      y: DAMAGE_INDICATOR_CANVAS.height / 2
    },
    DAMAGE_INDICATOR_CANVAS,
    {
      anchor: CENTER,
      note: 'Upright authored damage burst behind the damage amount.'
    }
  ),
  amount: placement(
    {
      x: DAMAGE_INDICATOR_CANVAS.width / 2,
      y: DAMAGE_INDICATOR_CANVAS.height / 2 - 8
    },
    { width: 118, height: 72 },
    {
      anchor: CENTER,
      note: 'Counterclockwise Belwe damage amount centered over the burst.'
    }
  ),
  amountRotation: -10 * (Math.PI / 180),
  textStyle: {
    fontFamily: 'Belwe',
    fontSize: 56,
    fill: 0xffffff,
    stroke: { color: 0x17120f, width: 8 },
    align: 'center' as const
  }
} as const
