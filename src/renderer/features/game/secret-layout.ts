import { CENTER, placement } from '../../rendering/layout'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'

/** Authored dimensions of the temporary Secret presentation assets. */
export const SECRET_CANVAS = { width: 112, height: 112 } as const

/** One facedown Secret badge is centered over each hero. */
export const SECRET_LAYOUT = {
  name: 'Secrets',
  badges: {
    local: placement({ x: 985, y: 737 }, SECRET_CANVAS, {
      anchor: CENTER,
      scale: 1,
      note: 'Centered 20px below the local hero top edge.'
    }),
    remote: placement({ x: 985, y: 288 }, SECRET_CANVAS, {
      anchor: CENTER,
      scale: 1,
      note: 'Centered over the remote hero bottom edge, below the remote hand.'
    })
  },
  count: placement(
    { x: 0, y: -5 },
    { width: 56, height: 56 },
    {
      anchor: CENTER,
      note: 'Belwe Secret count centered on its badge in the badge local frame.'
    }
  ),
  countTextStyle: {
    fontFamily: 'Belwe',
    fontSize: 50,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 5 },
    align: 'center' as const
  },
  reveal: placement(
    { x: 960, y: 540 },
    { width: 1920, height: 1080 },
    {
      anchor: CENTER,
      scale: 1,
      note: 'Full-screen Secret reveal art at its authored 1x size.'
    }
  ),
  revealCard: placement({ x: 960, y: 620 }, CARD_CANVAS, {
    anchor: CENTER,
    scale: 0.4,
    note: 'Revealed Secret card displayed below the raised banner.'
  })
} as const
