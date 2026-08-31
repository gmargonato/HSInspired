export interface HandPlayInputRequirement {
  readonly targetSelectors: readonly unknown[]
  readonly choiceCount: number
  readonly choiceTiming?: 'before-play' | 'after-placement'
}

export type HandCardTargetingOrigin = 'card' | 'local-hero' | 'minion-preview'

/** Targeted spells always aim from the local hero, independent of click or drag input. */
export function resolveHandCardArrowOrigin(
  cardType: string,
  origin: HandCardTargetingOrigin
): HandCardTargetingOrigin {
  return cardType === 'Spell' && origin === 'card' ? 'local-hero' : origin
}

/** A hand hover transform may only own a slot that is currently in the hand layer. */
export function isHandOwnedSlot<T>(
  slot: { readonly parent: T | null },
  handLayer: T
): boolean {
  return slot.parent === handLayer
}

/**
 * Minions that still need play input use two distinct clicks: one to select
 * the card and one to confirm its board position. Releasing a held selection
 * must not silently become the confirmation click.
 */
export function requiresClickConfirmedMinionPlacement(
  cardType: string,
  input: HandPlayInputRequirement
): boolean {
  return (
    cardType === 'Minion' &&
    (input.targetSelectors.length > 0 ||
      (input.choiceCount > 0 && input.choiceTiming !== 'after-placement'))
  )
}

/** Targeted non-minions may be aimed and released in one continuous gesture. */
export function allowsDragTargetingFromHand(
  cardType: string,
  input: HandPlayInputRequirement
): boolean {
  return cardType !== 'Minion' && input.targetSelectors.length > 0
}

/** Prevents the tap synthesized by a placement click from becoming a target click. */
export class OneShotPointerTapGuard {
  private pointerId: number | null = null

  arm(pointerId: number): void {
    this.pointerId = pointerId
  }

  matches(pointerId: number): boolean {
    return this.pointerId === pointerId
  }

  consume(pointerId: number): boolean {
    if (!this.matches(pointerId)) return false
    this.pointerId = null
    return true
  }

  release(pointerId: number): void {
    if (this.matches(pointerId)) this.pointerId = null
  }

  clear(): void {
    this.pointerId = null
  }
}
