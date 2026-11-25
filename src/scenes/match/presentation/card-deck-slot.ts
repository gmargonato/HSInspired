import { CARD_MOTION_LAYOUT } from './card-motion-layout'

type Point = { x: number; y: number }

/** A board opening, independent of the cropped artwork used to paint its stack. */
export interface CardDeckSlot {
  mouth: Point
  outward: Point
  scale: number
}

export function cardDeckSlot(anchor: Point, scale = 1, rotation = 0): CardDeckSlot {
  const outward = { x: Math.cos(rotation), y: Math.sin(rotation) }
  const offset = CARD_MOTION_LAYOUT.slot.mouthOffset
  return {
    mouth: {
      x: anchor.x + (offset.x * outward.x - offset.y * outward.y) * scale,
      y: anchor.y + (offset.x * outward.y + offset.y * outward.x) * scale
    },
    outward,
    scale
  }
}

export function slotPoint(slot: CardDeckSlot, depth: number, across = 0): Point {
  return {
    x: slot.mouth.x + slot.outward.x * depth - slot.outward.y * across,
    y: slot.mouth.y + slot.outward.y * depth + slot.outward.x * across
  }
}
