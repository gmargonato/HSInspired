import { placement, TOP_LEFT } from '../../rendering/layout'

/** Local coordinates measured from the hover tray's top-left corner. */
export const DECK_INFO_LAYOUT = {
  name: 'Deck and hand hover tray',
  gap: 8,
  background: placement(
    { x: 0, y: 0 },
    { width: 246, height: 131 },
    { anchor: TOP_LEFT, scale: 1 }
  ),
  heading: placement({ x: 27, y: 19 }, { width: 200, height: 24 }),
  body: placement({ x: 27, y: 45 }, { width: 200, height: 67 }),
  remoteHeading: placement({ x: 27, y: 13 }, { width: 200, height: 24 }),
  remoteBody: placement({ x: 27, y: 39 }, { width: 200, height: 67 }),
  headingFontSize: 20,
  bodyFontSize: 18,
  bodyLineHeight: 21
} as const
