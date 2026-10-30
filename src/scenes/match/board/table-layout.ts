import { TOP_LEFT, placement } from '../../../visual-components/layout'

export const TABLE_LAYOUT = {
  localGoldenFrame: placement(
    { x: 670, y: 707 },
    { width: 629, height: 273 },
    {
      anchor: TOP_LEFT,
      scale: 1,
      note: 'Native-size gold overlay aligned to the lower board arch.'
    }
  ),
  remoteGoldenFrame: placement(
    { x: 662, y: 58 },
    { width: 637, height: 234 },
    {
      anchor: TOP_LEFT,
      scale: 1,
      note: 'Native-size gold overlay aligned to the upper board arch.'
    }
  )
} as const
