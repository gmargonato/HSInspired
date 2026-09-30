import { CENTER, placement } from '../../../visual-components/layout'

/** Authored dimensions of assets/images/match/fatigue.png. */
export const FATIGUE_CANVAS = { width: 420, height: 727 } as const

/** Full-scene fatigue presentation geometry on the canonical 1920x1080 canvas. */
export const FATIGUE_LAYOUT = {
  name: 'Fatigue draw failure',
  presentation: {
    local: placement(
      { x: 1650, y: 700 },
      { width: FATIGUE_CANVAS.width, height: FATIGUE_CANVAS.height },
      {
        scale: 0.7,
        note: 'Position and scale for the local player fatigue presentation.'
      }
    ),
    remote: placement(
      { x: 1650, y: 300 },
      { width: FATIGUE_CANVAS.width, height: FATIGUE_CANVAS.height },
      {
        scale: 0.7,
        note: 'Position and scale for the remote player fatigue presentation.'
      }
    )
  },
  frame: placement(
    { x: 0, y: 0 },
    { width: FATIGUE_CANVAS.width, height: FATIGUE_CANVAS.height },
    {
      anchor: CENTER,
      note: 'Fatigue card centered inside the presentation container.'
    }
  ),
  message: placement(
    { x: 0, y: 125 },
    { width: 255, height: 88 },
    {
      anchor: CENTER,
      note: 'Two-line damage message below the card center, in local coordinates.'
    }
  )
} as const
