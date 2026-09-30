import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'
import { CENTER, placement } from '../../../visual-components/layout'

export const CARD_REVEAL_LAYOUT = {
  name: 'Card reveal',
  remote: placement({ x: 1500, y: 310 }, CARD_CANVAS, { anchor: CENTER, scale: 0.35 }),
  local: placement({ x: 1500, y: 690 }, CARD_CANVAS, { anchor: CENTER, scale: 0.35 }),
  hold: 0.5,
  pulseScale: 1.1,
  pulseHalfDuration: 0.12
} as const
