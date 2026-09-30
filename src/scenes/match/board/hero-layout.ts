import { CENTER, placement } from '../../../visual-components/layout'

/** Local design space for one board hero portrait. */
export const HERO_CANVAS = { width: 345, height: 433 } as const

/** Fixed geometry for the feature-agnostic hero render stack. */
export const HERO_LAYOUT = {
  name: 'Board hero',
  frame: placement(
    { x: HERO_CANVAS.width / 2, y: HERO_CANVAS.height / 2 },
    { width: HERO_CANVAS.width, height: HERO_CANVAS.height },
    {
      anchor: CENTER,
      note: 'Existing hero portrait frame.'
    }
  ),
  frozen: placement(
    { x: HERO_CANVAS.width / 2, y: HERO_CANVAS.height / 2 },
    { width: HERO_CANVAS.width, height: HERO_CANVAS.height },
    {
      anchor: CENTER,
      scale: 2,
      note: 'Frozen overlay above the portrait frame and below hero stat badges.'
    }
  ),
  immune: placement(
    { x: HERO_CANVAS.width / 2, y: HERO_CANVAS.height / 2 },
    { width: 240, height: 239 },
    {
      anchor: CENTER,
      scale: 2,
      note: 'Immune overlay centered with Frozen above the portrait frame and below hero stat badges.'
    }
  ),
  attackBadge: placement(
    { x: 50, y: 360 },
    { width: 44, height: 51 },
    {
      anchor: CENTER,
      scale: 2,
      note: 'Effective hero Attack; hidden while zero.'
    }
  ),
  healthBadge: placement(
    { x: 307, y: 360 },
    { width: 38, height: 54 },
    {
      anchor: CENTER,
      scale: 2,
      note: 'Current hero Health, enlarged into the lower-right corner.'
    }
  ),
  armorBadge: placement(
    { x: 307, y: 260 },
    { width: 163, height: 200 },
    {
      anchor: CENTER,
      scale: 0.55,
      note: 'Current hero Armor, enlarged and raised well above the health position while Armor is present.'
    }
  ),
  statText: {
    fontFamily: 'Belwe',
    fontSize: 30,
    fill: 0xffffff,
    stroke: { color: 0x17120f, width: 5 },
    align: 'center' as const
  },
  armorLabelFontSize: 120,
  attackOutline: {
    ...placement(
      { x: HERO_CANVAS.width / 2, y: HERO_CANVAS.height / 2 },
      { width: 302, height: 386 },
      {
        anchor: CENTER,
        note: 'Exterior glow silhouette for a hero that can attack.'
      }
    )
  },
  selectionScale: 1.08
} as const
