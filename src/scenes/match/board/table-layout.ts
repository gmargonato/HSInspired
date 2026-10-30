import { TOP_LEFT, placement } from '../../../visual-components/layout'

export const TABLE_LAYOUT = {
  localGoldenFrame: placement(
    { x: 691, y: 706 },
    { width: 592, height: 274 },
    {
      anchor: TOP_LEFT,
      scale: 1,
      note: 'Native-size gold overlay aligned to the lower board arch.'
    }
  ),
  remoteGoldenFrame: placement(
    { x: 675, y: 58 },
    { width: 620, height: 234 },
    {
      anchor: TOP_LEFT,
      scale: 1,
      note: 'Native-size gold overlay aligned to the upper board arch.'
    }
  )
} as const
