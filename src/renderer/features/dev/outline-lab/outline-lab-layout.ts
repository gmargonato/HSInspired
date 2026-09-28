import { WEAPON_CANVAS } from '../../../rendering/weapons/weapon-layout'
import { CENTER, TOP_LEFT, placement } from '../../../rendering/layout'
import { MINION_CANVAS } from '../../../rendering/minions/minion-layout'
import { HERO_CANVAS } from '../../../rendering/heroes/hero-layout'
import { HERO_POWER_ICON_CANVAS } from '../../../rendering/hero-powers/hero-power-layout'

export const OUTLINE_LAB_LAYOUT = {
  name: 'Shader Lab',
  canvas: { width: 1920, height: 1080 },
  preview: { x: 40, y: 105, width: 1120, height: 930 },
  controls: { x: 1180, y: 105, width: 700, height: 930 },
  header: { height: 88, titleX: 40, titleY: 29, titleSize: 26 },
  tabs: { x: 370, y: 20, width: 214, height: 52, gap: 12 },
  save: { x: 1680, y: 20, width: 190, height: 52 },
  panelTitleY: 122,
  tuningHeadingY: 162,
  tuningY: 198,
  tuningRowHeight: 112,
  colorControls: { x: 660, y: 170, width: 455 },
  palettes: {
    x: 755,
    width: 124,
    height: 34,
    gap: 8,
    swatchX: 14,
    swatchY: 17,
    swatchRadius: 7
  },
  // The match's y=1080 viewport edge maps to the preview's lower edge.
  hand: placement(
    { x: -360, y: -45 },
    { width: 1920, height: 1080 },
    { anchor: TOP_LEFT }
  ),
  count: { x: 62, y: 172, width: 220, height: 36 },
  // Hand-local coordinates, translated with the production hand into the preview.
  handDropZone: placement(
    { x: 600, y: 435 },
    { width: 720, height: 250 },
    { anchor: TOP_LEFT }
  ),
  status: { x: 62, y: 1048 },
  minion: placement({ x: 270, y: 620 }, MINION_CANVAS, { anchor: CENTER, scale: 1 }),
  shatterWeapon: placement({ x: 580, y: 610 }, WEAPON_CANVAS, {
    anchor: CENTER,
    scale: 1
  }),
  shatterHero: placement({ x: 910, y: 610 }, HERO_CANVAS, { anchor: CENTER, scale: 1 }),
  hero: placement({ x: 580, y: 610 }, HERO_CANVAS, { anchor: CENTER, scale: 1 }),
  power: placement({ x: 910, y: 610 }, HERO_POWER_ICON_CANVAS, {
    anchor: CENTER,
    scale: 1
  }),
  deck: placement(
    { x: 330, y: 590 },
    { width: 239, height: 107 },
    { anchor: CENTER, scale: 1 }
  ),
  // Static deck composition in deck-local coordinates; matches the production crop.
  deckPortrait: placement(
    { x: 0, y: 10 },
    { width: 210, height: 75 },
    { anchor: CENTER }
  ),
  deckPortraitCrop: placement(
    { x: 0, y: -2 },
    { width: 210, height: 75 },
    { anchor: CENTER }
  ),
  deckName: placement({ x: 0, y: 25 }, { width: 190, height: 24 }, { anchor: CENTER }),
  play: placement(
    { x: 830, y: 590 },
    { width: 199, height: 199 },
    { anchor: CENTER, scale: 0.92 }
  ),
  banner: placement(
    { x: 450, y: 590 },
    { width: 721, height: 223 },
    { anchor: CENTER }
  ),
  confirmMulligan: placement(
    { x: 990, y: 590 },
    { width: 235, height: 127 },
    { anchor: CENTER }
  ),
  captionY: 840
} as const

export function isInsideHandDropZone(pointer: {
  readonly x: number
  readonly y: number
}): boolean {
  const { position, size } = OUTLINE_LAB_LAYOUT.handDropZone
  return (
    pointer.x >= position.x &&
    pointer.x < position.x + size.width &&
    pointer.y >= position.y &&
    pointer.y < position.y + size.height
  )
}
