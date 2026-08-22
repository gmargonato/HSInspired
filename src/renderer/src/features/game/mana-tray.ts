import { Sprite, Texture, type ColorMatrixFilter } from 'pixi.js'
import { MAX_MANA, type PlayerMana } from '../../../../game/match'
import { createManaHighlightFilter } from '../../rendering/filters/highlight'
import {
  applyAnchoredPlacement,
  type LayoutPlacement,
  type LayoutPoint
} from '../../rendering/layout'
import { Actor } from '../../ui/components/Actor'

/**
 * Spread parameters for the local mana crystal tray. Only these values are
 * tuned here; the per-crystal math lives in `ManaTray`. Mirrors the fanned
 * hand/remote-hand spreads in `game-scene-layout.ts`.
 */
export interface ManaTrayLayout {
  /** Center of the first (leftmost) crystal, on the 1920x1080 canvas. */
  readonly firstCrystalCenter: LayoutPoint
  /** Center-to-center spacing between crystals. */
  readonly gap: number
  /** Native crystal size with a uniform scale, local to each crystal. */
  readonly crystal: LayoutPlacement
}

/** Visual state of a single tray crystal. */
export type ManaCrystalPhase = 'full' | 'consumed'

export interface ManaCrystalState {
  /** 'full' while spendable this turn; 'consumed' once spent. */
  readonly phase: ManaCrystalPhase
  /** True while this crystal counts toward a selected hand card's cost. */
  readonly highlighted: boolean
}

/**
 * Derives the tray's per-crystal states from the engine mana, plus the cost of
 * the hand card currently hovered/dragged (or null for none). Full crystals
 * cover `available`; the tail up to `maximum` is consumed; crystals beyond
 * `maximum` are simply absent. The highlight covers the first `highlightCost`
 * full crystals, capped by availability and by the ten-crystal maximum.
 */
export function resolveManaCrystalStates(
  mana: PlayerMana,
  highlightCost: number | null = null
): ManaCrystalState[] {
  const maximum = Math.max(0, Math.min(MAX_MANA, Math.trunc(mana.maximum) || 0))
  const available = Math.max(0, Math.min(maximum, Math.trunc(mana.available) || 0))
  const highlightCount =
    highlightCost === null
      ? 0
      : Math.max(0, Math.min(available, Math.trunc(highlightCost) || 0))

  return Array.from({ length: maximum }, (_, index) => ({
    phase: index < available ? 'full' : 'consumed',
    highlighted: index < highlightCount
  }))
}

/** Opacity of a consumed (spent) crystal. */
const MANA_TRAY_CONSUMED_ALPHA = 0.35
/** Scale multiplier for the brief pop a crystal makes when it becomes full. */
const MANA_TRAY_POP_SCALE = 1.5
const MANA_TRAY_POP_DURATION = 0.5

/**
 * The local player's mana crystal tray: one pooled `Sprite` per crystal slot
 * up to the ten-crystal maximum. `sync` is the single entry point — it
 * reconciles visibility, full/consumed alpha, the collection-style highlight
 * filter, and the "refreshed" pop whenever a crystal turns full.
 */
export class ManaTray extends Actor {
  private readonly crystals: Sprite[]
  private readonly highlightFilter: ColorMatrixFilter
  private previousStates: ManaCrystalState[] = []

  constructor(
    texture: Texture,
    private readonly layout: ManaTrayLayout
  ) {
    super()
    this.label = 'mana-tray'
    this.eventMode = 'none'
    this.highlightFilter = createManaHighlightFilter()
    this.crystals = Array.from({ length: MAX_MANA }, (_, index) => {
      const crystal = new Sprite(texture)
      applyAnchoredPlacement(crystal, layout.crystal)
      crystal.position.set(
        layout.firstCrystalCenter.x + index * layout.gap,
        layout.firstCrystalCenter.y
      )
      crystal.visible = false
      crystal.alpha = 0
      crystal.eventMode = 'none'
      crystal.label = `mana-crystal:${index}`
      this.addChild(crystal)
      return crystal
    })
  }

  /** Applies a full tray state; crystals beyond the returned states hide. */
  sync(states: readonly ManaCrystalState[]): void {
    this.crystals.forEach((crystal, index) => {
      const state = states[index]
      if (!state) {
        crystal.visible = false
        return
      }
      crystal.visible = true
      crystal.alpha = state.phase === 'full' ? 1 : MANA_TRAY_CONSUMED_ALPHA
      crystal.filters = state.highlighted ? [this.highlightFilter] : null
      if (state.phase === 'full' && this.previousStates[index]?.phase !== 'full') {
        this.popCrystal(crystal)
      }
    })
    this.previousStates = [...states]
  }

  /** Quick scale pop so a freshly refreshed crystal reads as "new". */
  private popCrystal(crystal: Sprite): void {
    const base = this.layout.crystal.scale?.x ?? 1
    this.killTweensOf(crystal.scale)
    this.tweenFromTo(
      crystal.scale,
      { x: base * MANA_TRAY_POP_SCALE, y: base * MANA_TRAY_POP_SCALE },
      {
        x: base,
        y: base,
        duration: MANA_TRAY_POP_DURATION,
        ease: 'power2.out'
      }
    )
  }
}
