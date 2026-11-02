import { Graphics } from 'pixi.js'
import { END_TURN_OUTLINE_LAYOUT as layout } from './end-turn-outline-layout'

export const END_TURN_OUTLINE_SHAPE_KEY = 'end-turn:resting-mesh-v1'

/** A cached 2D contour; never samples the live Three atlas. */
export function createEndTurnOutlineProxy(): Graphics {
  const shape = new Graphics()
    .moveTo(-layout.halfWidth, layout.upperSide)
    .quadraticCurveTo(
      -layout.halfWidth,
      layout.upperShoulder,
      -layout.shoulderX,
      layout.upperShoulder
    )
    .quadraticCurveTo(-layout.archControlX, layout.top, 0, layout.top)
    .quadraticCurveTo(
      layout.archControlX,
      layout.top,
      layout.shoulderX,
      layout.upperShoulder
    )
    .quadraticCurveTo(
      layout.halfWidth,
      layout.upperShoulder,
      layout.halfWidth,
      layout.upperSide
    )
    .lineTo(layout.halfWidth, layout.lowerSide)
    .quadraticCurveTo(
      layout.halfWidth,
      layout.lowerShoulder,
      layout.shoulderX,
      layout.lowerShoulder
    )
    .quadraticCurveTo(layout.archControlX, layout.bottom, 0, layout.bottom)
    .quadraticCurveTo(
      -layout.archControlX,
      layout.bottom,
      -layout.shoulderX,
      layout.lowerShoulder
    )
    .quadraticCurveTo(
      -layout.halfWidth,
      layout.lowerShoulder,
      -layout.halfWidth,
      layout.lowerSide
    )
    .closePath()
    .fill(0xffffff)
  shape.eventMode = 'none'
  return shape
}
