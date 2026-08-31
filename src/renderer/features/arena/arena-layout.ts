import { CENTER, placement } from '../../rendering/layout'

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
    y: 390,
    scale: 0.64,
    nameY: 555,
    classY: 584
  },
  cardChoices: {
    centers: [500, 805, 1110] as const,
    y: 420,
    scale: 0.43
  },
  selectedHero: placement(
    { x: 446, y: 862 },
    { width: 358, height: 410 },
    { anchor: CENTER, scale: 0.72 }
  ),
  retireButton: placement(
    { x: 449, y: 1035 },
    { width: 107, height: 47 },
    { anchor: CENTER }
  ),
  playButton: placement(
    { x: 1135, y: 865 },
    { width: 215, height: 215 },
    { anchor: CENTER }
  ),
  backButton: placement(
    { x: 1655, y: 1035 },
    { width: 107, height: 47 },
    { anchor: CENTER }
  ),
  deckList: {
    x: 1422,
    y: 115,
    width: 272,
    height: 856,
    rowHeight: 34,
    sliderX: 1710,
    sliderMinY: 130,
    sliderMaxY: 875
  },
  deckCount: placement(
    { x: 1480, y: 1037 },
    { width: 130, height: 34 },
    { anchor: CENTER }
  ),
  statistics: {
    x: 805,
    labelsY: 360,
    valuesY: 490,
    columns: [570, 805, 1040] as const
  },
  manaCurve: {
    centers: [688, 724, 759, 794, 829, 864, 900, 936] as const,
    baselineY: 946,
    maxHeight: 154,
    width: 26
  },
  retireDialog: {
    confirm: placement(
      { x: 825, y: 665 },
      { width: 232, height: 67 },
      { anchor: CENTER }
    ),
    cancel: placement(
      { x: 1090, y: 665 },
      { width: 230, height: 65 },
      { anchor: CENTER }
    )
  }
} as const
