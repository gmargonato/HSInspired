import { Sprite, Texture } from 'pixi.js'
import { MAX_MANA, type PlayerMana } from '../../../game/match'
import {
  applyAnchoredPlacement,
  type LayoutPlacement,
  type LayoutPoint
} from '../../rendering/layout'
import { Actor } from '../../ui/components/actor'

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
  readonly overloadCrystal: LayoutPlacement
  readonly pendingRowOffsetY: number
}

/** Visual state of a single tray crystal. */
export type ManaCrystalPhase = 'full' | 'consumed' | 'locked'

export interface ManaCrystalState {
  /** Spendable, spent, or locked by this turn's overload. */
  readonly phase: ManaCrystalPhase
  /** True while this crystal counts toward a selected hand card's cost. */
  readonly highlighted: boolean
}

/**
 * Derives the tray's per-crystal states from the engine mana, plus the cost of
 * the hand card currently hovered/dragged (or null for none). Full crystals
 * cover `available`; locked crystals occupy the rightmost slots, with consumed
 * crystals between them and the full crystals. Crystals beyond
 * `maximum` are simply absent. The highlight covers the right-most
 * `highlightCost` full crystals, capped by availability and by the ten-crystal
 * maximum.
 */
export function resolveManaCrystalStates(
  mana: PlayerMana,
  highlightCost: number | null = null
): ManaCrystalState[] {
  const maximum = Math.max(0, Math.min(MAX_MANA, Math.trunc(mana.maximum) || 0))
  const locked = Math.max(
    0,
    Math.min(maximum, Math.trunc(mana.overloadLocked ?? 0) || 0)
  )
  const available = Math.max(
    0,
    Math.min(maximum - locked, Math.trunc(mana.available) || 0)
  )
  const highlightCount =
    highlightCost === null
      ? 0
      : Math.max(0, Math.min(available, Math.trunc(highlightCost) || 0))

  return Array.from({ length: maximum }, (_, index) => ({
    phase:
      index >= maximum - locked ? 'locked' : index < available ? 'full' : 'consumed',
    highlighted: index >= available - highlightCount && index < available
  }))
}

/** Scale multiplier for the brief pop a crystal makes when it becomes full. */
const MANA_TRAY_POP_SCALE = 1.5
const MANA_TRAY_POP_DURATION = 0.5

/**
 * The local player's mana crystal tray: one pooled `Sprite` per crystal slot
 * up to the ten-crystal maximum. `sync` is the single entry point — it
 * reconciles visibility, state textures, and the "refreshed" pop whenever a
 * crystal turns full.
 */
export class ManaTray extends Actor {
  private readonly crystals: Sprite[]
  private readonly pendingCrystals: Sprite[]
  private previousStates: ManaCrystalState[] = []

  constructor(
    private readonly availableTexture: Texture,
    private readonly spentTexture: Texture,
    private readonly highlightedTexture: Texture,
    private readonly overloadTexture: Texture,
    private readonly layout: ManaTrayLayout
  ) {
    super()
    this.label = 'game.mana-tray'
    this.eventMode = 'none'
    this.crystals = Array.from({ length: MAX_MANA }, (_, index) => {
      const crystal = new Sprite(availableTexture)
      applyAnchoredPlacement(crystal, layout.crystal)
      crystal.position.set(
        layout.firstCrystalCenter.x + index * layout.gap,
        layout.firstCrystalCenter.y
      )
      crystal.visible = false
      crystal.alpha = 0
      crystal.eventMode = 'none'
      crystal.label = `game.mana-crystal-${index}`
      this.addChild(crystal)
      return crystal
    })
    this.pendingCrystals = Array.from({ length: MAX_MANA }, (_, index) => {
      const crystal = new Sprite(overloadTexture)
      applyAnchoredPlacement(crystal, layout.overloadCrystal)
      crystal.visible = false
      crystal.eventMode = 'none'
      crystal.label = `game.mana-pending-${index}`
      this.addChild(crystal)
      return crystal
    })
  }

  /** Applies a full tray state; crystals beyond the returned states hide. */
  sync(states: readonly ManaCrystalState[], overloadNextTurn = 0): void {
    this.crystals.forEach((crystal, index) => {
      const state = states[index]
      if (!state) {
        this.killTweensOf(crystal.scale)
        crystal.visible = false
        crystal.tint = 0xffffff
        return
      }
      crystal.visible = true
      crystal.alpha = 1
      crystal.tint = 0xffffff
      const placement =
        state.phase === 'locked' ? this.layout.overloadCrystal : this.layout.crystal
      crystal.texture =
        state.phase === 'locked'
          ? this.overloadTexture
          : state.phase === 'consumed'
            ? this.spentTexture
            : state.highlighted
              ? this.highlightedTexture
              : this.availableTexture
      if (state.phase !== this.previousStates[index]?.phase) {
        this.killTweensOf(crystal.scale)
        crystal.anchor.set(placement.anchor.x, placement.anchor.y)
        crystal.scale.set(placement.scale?.x ?? 1, placement.scale?.y ?? 1)
      }
      if (state.phase === 'full' && this.previousStates[index]?.phase !== 'full') {
        this.popCrystal(crystal)
      }
    })
    const pendingCount = Math.max(
      0,
      Math.min(MAX_MANA, Math.trunc(overloadNextTurn) || 0)
    )
    const rightmostSlot = Math.max(0, Math.min(MAX_MANA, states.length) - 1)
    this.pendingCrystals.forEach((crystal, index) => {
      crystal.visible = index < pendingCount
      crystal.position.set(
        this.layout.firstCrystalCenter.x + (rightmostSlot - index) * this.layout.gap,
        this.layout.firstCrystalCenter.y + this.layout.pendingRowOffsetY
      )
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
