import { CENTER, placement } from '../../visual-components/layout'

export const ARENA_LAYOUT = {
  name: 'Arena',
  background: placement(
    { x: 960, y: 540 },
    { width: 1920, height: 1080 },
    { anchor: CENTER }
  ),
  heading: placement({ x: 814, y: 181 }, { width: 0, height: 0 }, { anchor: CENTER }),
  heroChoices: {
    centers: [540, 815, 1090] as const,
    y: 410,
    scale: 0.75,
    nameY: 580,
    classY: 605
  },
  cardChoices: {
    centers: [500, 805, 1110] as const,
    y: 420,
    scale: 0.4
  },
  selectedHero: placement(
    { x: 446, y: 862 },
    { width: 358, height: 410 },
    { anchor: CENTER, scale: 0.72 }
  ),
  retireButton: placement(
    { x: 449, y: 1030 },
    { width: 107, height: 47 },
    { anchor: CENTER }
  ),
  playButton: placement(
    { x: 1152, y: 870 },
    { width: 215, height: 215 },
    { anchor: CENTER }
  ),
  backButton: placement(
    { x: 1659, y: 1040 },
    { width: 107, height: 47 },
    { anchor: CENTER }
  ),
  deckList: {
    x: 1422,
    y: 115,
    width: 245,
    height: 870,
    rowHeight: 34,
    sliderX: 1720,
    sliderMinY: 105,
    sliderMaxY: 950
  },
  deckCount: placement(
    { x: 1480, y: 1037 },
    { width: 130, height: 34 },
    { anchor: CENTER }
  ),
  statistics: {
    key: placement(
      { x: 815, y: 290 },
      { width: 505, height: 195 },
      {
        anchor: CENTER,
        scale: 1,
        note: 'Shared key center; size describes key 0. Each key keeps its authored dimensions.'
      }
    ),
    wins: placement(
      { x: 815, y: 430 },
      { width: 0, height: 0 },
      { anchor: CENTER, note: 'Win count centered inside the gold medallion.' }
    ),
    defeats: [
      placement({ x: 712, y: 597 }, { width: 74, height: 70 }, { anchor: CENTER }),
      placement({ x: 814, y: 597 }, { width: 74, height: 70 }, { anchor: CENTER }),
      placement({ x: 917, y: 597 }, { width: 74, height: 70 }, { anchor: CENTER })
    ]
  },
  manaCurve: {
    centers: [688, 724, 759, 794, 829, 864, 900, 936] as const,
    baselineY: 946,
    maxHeight: 154,
    width: 26
  },
  retireDialog: {
    confirm: placement(
      { x: 825, y: 635 },
      { width: 232, height: 67 },
      { anchor: CENTER }
    ),
    cancel: placement(
      { x: 1090, y: 635 },
      { width: 230, height: 65 },
      { anchor: CENTER }
    )
  }
} as const
