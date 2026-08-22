/**
 * Self-describing layout contract shared by every scene and feature view.
 *
 * The goal of this module is to make a position number understandable on its
 * own. A bare `{ x: 0, y: -145 }` means nothing until you also know:
 *   1. which reference frame it lives in (a container at some screen point),
 *   2. where the element's anchor is (its (0,0)..(1,1) pivot),
 *   3. how large the element actually is,
 *   4. whether it is scaled.
 *
 * `LayoutPlacement` bundles all four. Scenes keep a single `*_LAYOUT` module
 * next to the feature that owns it, and every placement is declared there with
 * an anchor and size so future humans (and AI agents) can read and tune the
 * geometry without reading the surrounding animation or input logic.
 *
 * Editing rules (see AGENTS.md):
 *   - Positions are expressed on the 1920x1080 design canvas at 1x scale,
 *     unless a layout module explicitly documents a local reference frame.
 *   - `anchor` is normalized (0..1) exactly like Pixi's `Sprite.anchor`.
 *   - `size` is the element's display size at scale 1 (usually the authored
 *     asset size from the asset registry). Final width and height are
 *     multiplied by `scale.x` and `scale.y` respectively.
 */

import type { Container, ObservablePoint } from 'pixi.js'

/** A position on the 1920x1080 design canvas (or a documented local frame). */
export interface LayoutPoint {
  readonly x: number
  readonly y: number
}

/** Display size in design pixels at scale 1. */
export interface LayoutSize {
  readonly width: number
  readonly height: number
}

/** Pixi scale on each axis. Equal values represent a uniform scale. */
export type LayoutScale = LayoutPoint

/**
 * Normalized anchor, exactly like Pixi `Sprite.anchor`:
 * (0,0) top-left, (0.5,0.5) center, (0.5,0) top-center, (0.5,1) bottom-center.
 */
export type LayoutAnchor = LayoutPoint

/**
 * Everything needed to place one element. Every field is required so a
 * placement never silently inherits an anchor or size from somewhere else.
 */
export interface LayoutPlacement {
  /** Where the element's anchor point sits, in the layout's declared frame. */
  readonly position: LayoutPoint
  /** Which point of the element's bounds the `position` refers to. */
  readonly anchor: LayoutPoint
  /** Display size at scale 1 (usually the authored asset size). */
  readonly size: LayoutSize
  /** Optional x/y scale applied on top of `size`. Omit for (1,1). */
  readonly scale?: LayoutScale
  /** Human hint explaining what the element is or how it is aligned. */
  readonly note?: string
}

export const TOP_LEFT: LayoutPoint = { x: 0, y: 0 }
export const TOP_CENTER: LayoutPoint = { x: 0.5, y: 0 }
export const CENTER: LayoutPoint = { x: 0.5, y: 0.5 }
export const BOTTOM_CENTER: LayoutPoint = { x: 0.5, y: 1 }

interface PlacementOptions {
  readonly anchor?: LayoutPoint
  /** A number is normalized to equal x/y values in the returned placement. */
  readonly scale?: number | LayoutScale
  readonly note?: string
}

/** Concise, consistent constructor for layout entries. */
export function placement(
  position: LayoutPoint,
  size: LayoutSize,
  options: PlacementOptions = {}
): LayoutPlacement {
  const scale =
    typeof options.scale === 'number'
      ? { x: options.scale, y: options.scale }
      : options.scale

  return {
    position,
    size,
    anchor: options.anchor ?? TOP_LEFT,
    ...(scale === undefined ? {} : { scale }),
    ...(options.note === undefined ? {} : { note: options.note })
  }
}

/**
 * Applies a placement's position and x/y scale to a Pixi container.
 * Anchor is deliberately left to the caller because `Sprite` exposes one while
 * a bare `Container` does not; see `applyAnchor`.
 */
export function applyPlacement(target: Container, value: LayoutPlacement): Container {
  target.position.set(value.position.x, value.position.y)
  target.scale.set(value.scale?.x ?? 1, value.scale?.y ?? 1)
  return target
}

/** Applies a placement's anchor to a Pixi `ObservablePoint` (e.g. a Sprite). */
export function applyAnchor(point: ObservablePoint, value: LayoutPlacement): void {
  point.set(value.anchor.x, value.anchor.y)
}

/** Applies position, anchor, and scale atomically to a Sprite/Text-like object. */
export function applyAnchoredPlacement<
  Target extends Container & { readonly anchor: ObservablePoint }
>(target: Target, value: LayoutPlacement): Target {
  applyPlacement(target, value)
  applyAnchor(target.anchor, value)
  return target
}
