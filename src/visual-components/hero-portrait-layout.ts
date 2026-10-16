import { placement, TOP_LEFT } from './layout'

// Preserve the old PNG's coordinate system. Its former shadow margin stays clear.
export const HERO_PORTRAIT_CANVAS = { width: 358, height: 410 } as const
export const HERO_PORTRAIT_LAYOUT = {
  name: 'Shared hero portrait',
  surface: placement({ x: 0, y: 0 }, HERO_PORTRAIT_CANVAS, { anchor: TOP_LEFT }),
  frame: placement({ x: 16, y: 16 }, { width: 326, height: 378 }, { anchor: TOP_LEFT })
} as const

// Authored crops retain their native pixel size; never stretch art to fit a frame.
const crop = (x: number, y: number, width: number, height: number) =>
  placement({ x, y }, { width, height }, { anchor: TOP_LEFT })
export const HERO_ARTWORK_PLACEMENTS = {
  'hero-placeholder': crop(0, 0, 345, 433),
  'hero-malfurion': crop(49, 58, 278, 304),
  'hero-malfurion-pestilent': crop(49, 58, 278, 304),
  'hero-rexxar': crop(42, 58, 278, 304),
  'hero-rexxar-deathstalker': crop(42, 58, 278, 304),
  'hero-jaina': crop(35, 56, 278, 304),
  'hero-jaina-frost-lich': crop(35, 56, 278, 304),
  'hero-uther': crop(35, 58, 279, 305),
  'hero-uther-ebon-blade': crop(35, 58, 279, 305),
  'hero-anduin': crop(40, 56, 279, 304),
  'hero-anduin-shadowreaper': crop(40, 56, 279, 304),
  'hero-valeera': crop(39, 58, 279, 305),
  'hero-valeera-hollow': crop(39, 58, 279, 305),
  'hero-thrall': crop(45, 58, 278, 305),
  'hero-thrall-deathseer': crop(45, 58, 278, 305),
  'hero-guldan': crop(31, 57, 278, 305),
  'hero-guldan-bloodreaver': crop(31, 57, 278, 305),
  'hero-garrosh': crop(48, 56, 278, 305),
  'hero-garrosh-scourgelord': crop(48, 56, 278, 305),
  'hero-jaraxxus': crop(53, 58, 253, 301),
  'hero-ragnaros': crop(52, 57, 253, 301)
} as const
