import { Container, Sprite, Texture } from 'pixi.js'
import { MAX_MANA, type PlayerMana } from '../../../game-rules/match'
import {
  applyAnchoredPlacement,
  type LayoutPlacement,
  type LayoutPoint
} from '../../../visual-components/layout'
import { Actor } from '../../../visual-components/lifecycle/actor'

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
  readonly glow: LayoutPlacement
  readonly glowFade: { readonly inDuration: number; readonly outDuration: number }
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
 * crystals between them and the full crystals. Temporary mana adds slots for
 * the turn, capped at ten crystals total. The highlight covers the right-most
 * `highlightCost` full crystals, capped by availability and by the ten-crystal
 * maximum.
 */
export function resolveManaCrystalStates(
  mana: PlayerMana,
  highlightCost: number | null = null
): ManaCrystalState[] {
  const permanent = Math.max(0, Math.min(MAX_MANA, Math.trunc(mana.maximum) || 0))
  const temporary = Math.max(0, Math.trunc(mana.temporary ?? 0) || 0)
  const maximum = Math.min(MAX_MANA, permanent + temporary)
  const locked = Math.max(
    0,
    Math.min(permanent, Math.trunc(mana.overloadLocked ?? 0) || 0)
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

/** Cosmetic timings in seconds; gameplay never waits for these transitions. */
const MANA_TRAY_ANIMATION = {
  spendDuration: 0.18,
  refillDuration: 0.24,
  refillPulseScale: 1.12,
  refillPulseDuration: 0.28,
  insertDuration: 0.4,
  insertOvershoot: 1.08,
  removeDuration: 0.18,
  closeGapDuration: 0.3,
  overloadDuration: 0.2,
  pendingDuration: 0.18
} as const

interface CrystalSlot {
  readonly root: Container
  readonly entrance: Container
  readonly pulse: Container
  readonly normal: Container
  readonly available: Sprite
  readonly locked: Sprite
  readonly glow: Sprite
  phase: ManaCrystalPhase | undefined
  highlighted: boolean
}

interface PendingCrystal {
  readonly sprite: Sprite
  shown: boolean
  targetX: number | undefined
}

/** Pooled, layered crystals with independently interruptible motion and fades. */
export class ManaTray extends Actor {
  private readonly slots: CrystalSlot[]
  private readonly activeSlots: CrystalSlot[] = []
  private readonly pendingCrystals: PendingCrystal[]
  private initialized = false

  constructor(
    availableTexture: Texture,
    spentTexture: Texture,
    glowTexture: Texture,
    overloadTexture: Texture,
    private readonly layout: ManaTrayLayout
  ) {
    super()
    this.label = 'game.mana-tray'
    this.eventMode = 'none'
    this.slots = Array.from({ length: MAX_MANA }, (_, index) => {
      const root = new Container()
      root.label = `game.mana-pooled-${index}`
      root.visible = false
      root.eventMode = 'none'
      const entrance = new Container()
      entrance.label = 'game.mana-entrance'
      const pulse = new Container()
      pulse.label = 'game.mana-pulse'
      const normal = new Container()
      normal.label = 'game.mana-normal'
      const spent = new Sprite(spentTexture)
      applyAnchoredPlacement(spent, layout.crystal)
      spent.label = 'game.mana-spent'
      const available = new Sprite(availableTexture)
      applyAnchoredPlacement(available, layout.crystal)
      available.label = 'game.mana-available'
      const locked = new Sprite(overloadTexture)
      applyAnchoredPlacement(locked, layout.overloadCrystal)
      // Current overload artwork shares the row center; the offset is for pending markers.
      locked.position.set(0, 0)
      locked.label = 'game.mana-locked'
      const glow = new Sprite(glowTexture)
      applyAnchoredPlacement(glow, layout.glow)
      // Preserve the old crystal container's scale on the cost-preview glow.
      glow.position.set(
        glow.x * (layout.crystal.scale?.x ?? 1),
        glow.y * (layout.crystal.scale?.y ?? 1)
      )
      glow.scale.set(
        glow.scale.x * (layout.crystal.scale?.x ?? 1),
        glow.scale.y * (layout.crystal.scale?.y ?? 1)
      )
      glow.label = 'game.mana-glow'
      glow.blendMode = 'screen'
      glow.alpha = 0
      glow.visible = false
      normal.addChild(spent, available)
      pulse.addChild(normal, locked, glow)
      entrance.addChild(pulse)
      root.addChild(entrance)
      this.addChild(root)
      return {
        root,
        entrance,
        pulse,
        normal,
        available,
        locked,
        glow,
        phase: undefined,
        highlighted: false
      }
    })
    this.pendingCrystals = Array.from({ length: MAX_MANA }, (_, index) => {
      const sprite = new Sprite(overloadTexture)
      applyAnchoredPlacement(sprite, layout.overloadCrystal)
      sprite.label = `game.mana-pending-${index}`
      sprite.visible = false
      sprite.alpha = 0
      sprite.eventMode = 'none'
      this.addChild(sprite)
      return { sprite, shown: false, targetX: undefined }
    })
  }

  sync(
    states: readonly ManaCrystalState[],
    overloadNextTurn = 0,
    turnStarted = false
  ): void {
    const count = Math.min(MAX_MANA, states.length)
    const previousCount = this.activeSlots.length
    const countChanged = count !== previousCount
    if (count < previousCount) {
      for (const slot of this.activeSlots.splice(0, previousCount - count)) {
        this.retireSlot(slot)
      }
    }
    const incoming = new Set<CrystalSlot>()
    if (count > previousCount) {
      // Prefer hidden slots; interrupt a retirement only when the pool is full.
      const free = this.slots.filter((slot) => !this.activeSlots.includes(slot))
      free.sort((a, b) => Number(a.root.visible) - Number(b.root.visible))
      const added = free.slice(0, count - previousCount)
      for (const slot of added) {
        this.resetSlot(slot)
        incoming.add(slot)
      }
      this.activeSlots.unshift(...added)
    }
    if (this.initialized && turnStarted) {
      for (const slot of incoming) {
        const index = this.activeSlots.indexOf(slot)
        if (states[index].phase === 'full') {
          this.setPhase(slot, 'consumed', 0, true)
        }
      }
    }
    const refillStartDelay =
      this.initialized && turnStarted && incoming.size > 0
        ? MANA_TRAY_ANIMATION.insertDuration
        : 0
    const spending = this.activeSlots
      .filter(
        (slot, index) => slot.phase === 'full' && states[index].phase === 'consumed'
      )
      .reverse()
    const refilling = this.activeSlots.filter(
      (slot, index) =>
        slot.phase !== undefined &&
        slot.phase !== 'full' &&
        states[index].phase === 'full'
    )
    this.activeSlots.forEach((slot, index) => {
      slot.root.label = `game.mana-crystal-${index}`
      if (countChanged) this.setChildIndex(slot.root, index)
      const x = this.layout.firstCrystalCenter.x + index * this.layout.gap
      if (incoming.has(slot) || !this.initialized) {
        slot.root.position.set(x, this.layout.firstCrystalCenter.y)
        slot.root.visible = true
        if (this.initialized) this.insertSlot(slot)
      } else if (countChanged) {
        this.killTweensOf(slot.root.position)
        this.tweenTo(slot.root.position, {
          x,
          duration:
            count > previousCount
              ? MANA_TRAY_ANIMATION.insertDuration
              : MANA_TRAY_ANIMATION.closeGapDuration,
          ease: 'power2.out'
        })
      }
      const spendIndex = spending.indexOf(slot)
      const refillIndex = refilling.indexOf(slot)
      const delay =
        spendIndex >= 0
          ? spendIndex * MANA_TRAY_ANIMATION.spendDuration
          : refillIndex >= 0
            ? refillStartDelay + refillIndex * MANA_TRAY_ANIMATION.refillDuration
            : 0
      this.setPhase(
        slot,
        states[index].phase,
        delay,
        !this.initialized || (incoming.has(slot) && refillIndex < 0)
      )
      this.setGlowHighlight(
        slot,
        states[index].phase === 'full' && states[index].highlighted,
        !this.initialized
      )
    })
    this.syncPending(count, overloadNextTurn)
    this.initialized = true
  }

  private resetSlot(slot: CrystalSlot): void {
    this.cancelSlotAnimations(slot)
    slot.root.alpha = 1
    slot.entrance.scale.set(1)
    slot.pulse.scale.set(1)
    slot.glow.alpha = 0
    slot.glow.visible = false
    slot.highlighted = false
    slot.phase = undefined
  }

  private cancelSlotAnimations(slot: CrystalSlot): void {
    for (const target of [
      slot.root,
      slot.root.position,
      slot.entrance.scale,
      slot.pulse.scale,
      slot.normal,
      slot.available,
      slot.locked,
      slot.glow
    ]) {
      this.killTweensOf(target)
    }
  }

  private insertSlot(slot: CrystalSlot): void {
    slot.entrance.scale.set(0)
    this.tweenTo(slot.entrance.scale, {
      x: MANA_TRAY_ANIMATION.insertOvershoot,
      y: MANA_TRAY_ANIMATION.insertOvershoot,
      duration: MANA_TRAY_ANIMATION.insertDuration * 0.7,
      ease: 'power2.out',
      onComplete: () => {
        this.tweenTo(slot.entrance.scale, {
          x: 1,
          y: 1,
          duration: MANA_TRAY_ANIMATION.insertDuration * 0.3,
          ease: 'sine.inOut'
        })
      }
    })
  }

  private retireSlot(slot: CrystalSlot): void {
    slot.root.label = `game.mana-retiring-${this.slots.indexOf(slot)}`
    // Cancel delayed fills and entrance callbacks before starting the exit.
    this.cancelSlotAnimations(slot)
    slot.phase = undefined
    slot.highlighted = false
    slot.glow.alpha = 0
    slot.glow.visible = false
    this.tweenTo(slot.root, {
      alpha: 0,
      duration: MANA_TRAY_ANIMATION.removeDuration,
      ease: 'sine.inOut',
      onComplete: () => {
        slot.root.visible = false
      }
    })
    this.tweenTo(slot.entrance.scale, {
      x: 0,
      y: 0,
      duration: MANA_TRAY_ANIMATION.removeDuration,
      ease: 'power2.in'
    })
  }

  private setPhase(
    slot: CrystalSlot,
    phase: ManaCrystalPhase,
    delay: number,
    immediate: boolean
  ): void {
    if (slot.phase === phase) return
    const previous = slot.phase
    slot.phase = phase
    for (const target of [slot.normal, slot.available, slot.locked, slot.pulse.scale]) {
      this.killTweensOf(target)
    }
    const normalAlpha = phase === 'locked' ? 0 : 1
    const availableAlpha = phase === 'full' ? 1 : 0
    if (immediate) {
      slot.normal.alpha = normalAlpha
      slot.locked.alpha = 1 - normalAlpha
      slot.available.alpha = availableAlpha
      slot.pulse.scale.set(1)
      return
    }
    const overloadChange = previous === 'locked' || phase === 'locked'
    const duration = overloadChange
      ? MANA_TRAY_ANIMATION.overloadDuration
      : phase === 'full'
        ? MANA_TRAY_ANIMATION.refillDuration
        : MANA_TRAY_ANIMATION.spendDuration
    this.tweenTo(slot.normal, {
      alpha: normalAlpha,
      duration: MANA_TRAY_ANIMATION.overloadDuration,
      ease: 'sine.inOut'
    })
    this.tweenTo(slot.locked, {
      alpha: 1 - normalAlpha,
      duration: MANA_TRAY_ANIMATION.overloadDuration,
      ease: 'sine.inOut'
    })
    this.tweenTo(slot.available, {
      alpha: availableAlpha,
      duration,
      delay,
      ease: 'sine.inOut'
    })
    if (phase === 'full') {
      this.tweenTo(slot.pulse.scale, {
        x: MANA_TRAY_ANIMATION.refillPulseScale,
        y: MANA_TRAY_ANIMATION.refillPulseScale,
        duration: MANA_TRAY_ANIMATION.refillPulseDuration * 0.35,
        delay,
        ease: 'sine.out',
        onComplete: () => {
          this.tweenTo(slot.pulse.scale, {
            x: 1,
            y: 1,
            duration: MANA_TRAY_ANIMATION.refillPulseDuration * 0.65,
            ease: 'sine.inOut'
          })
        }
      })
    } else {
      this.tweenTo(slot.pulse.scale, {
        x: 1,
        y: 1,
        duration: MANA_TRAY_ANIMATION.spendDuration,
        ease: 'sine.out'
      })
    }
  }

  /** Repeated preview syncs leave in-flight fades and mana transitions alone. */
  private setGlowHighlight(
    slot: CrystalSlot,
    highlighted: boolean,
    immediate = false
  ): void {
    if (immediate) {
      slot.highlighted = highlighted
      slot.glow.alpha = highlighted ? 1 : 0
      slot.glow.visible = highlighted
      return
    }
    if (slot.highlighted === highlighted) return
    slot.highlighted = highlighted
    this.killTweensOf(slot.glow)
    slot.glow.visible = true
    this.tweenTo(slot.glow, {
      alpha: highlighted ? 1 : 0,
      duration: highlighted
        ? this.layout.glowFade.inDuration
        : this.layout.glowFade.outDuration,
      ease: 'sine.inOut',
      onComplete: () => {
        if (!highlighted) slot.glow.visible = false
      }
    })
  }

  private syncPending(count: number, overloadNextTurn: number): void {
    const pendingCount = Math.max(
      0,
      Math.min(MAX_MANA, Math.trunc(overloadNextTurn) || 0)
    )
    this.pendingCrystals.forEach((pending, index) => {
      const { sprite } = pending
      const shown = index < pendingCount
      const x =
        this.layout.firstCrystalCenter.x +
        (Math.max(0, count - 1) - index) * this.layout.gap
      const y = this.layout.firstCrystalCenter.y + this.layout.pendingRowOffsetY
      if (!this.initialized) {
        sprite.position.set(x, y)
        sprite.alpha = shown ? 1 : 0
        sprite.visible = shown
      } else {
        if (shown !== pending.shown) {
          this.killTweensOf(sprite)
          sprite.visible = true
          this.tweenTo(sprite, {
            alpha: shown ? 1 : 0,
            duration: MANA_TRAY_ANIMATION.pendingDuration,
            ease: 'sine.inOut',
            onComplete: () => {
              if (!shown) sprite.visible = false
            }
          })
        }
        if (x !== pending.targetX) {
          this.killTweensOf(sprite.position)
          if (!pending.shown && shown) sprite.position.set(x, y)
          else
            this.tweenTo(sprite.position, {
              x,
              y,
              duration: MANA_TRAY_ANIMATION.closeGapDuration,
              ease: 'power2.out'
            })
        }
      }
      pending.shown = shown
      pending.targetX = x
    })
  }
}
