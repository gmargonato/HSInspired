export interface HandPlayInputRequirement {
  readonly targetSelectors: readonly unknown[]
  readonly choiceCount: number
  readonly choiceTiming?: 'before-play' | 'after-placement'
}

export type HandCardTargetingOrigin = 'card' | 'local-hero' | 'minion-preview'

export type PendingCardInputStage = 'choice' | 'target' | 'ready'

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
  return cardType === 'Minion' && pendingCardInputStage(input, undefined) !== 'ready'
}

/**
 * Targeted non-minions may be aimed and released in one continuous gesture.
 * Pre-play choices must be confirmed first so targeting reflects the selected branch.
 */
export function allowsDragTargetingFromHand(
  cardType: string,
  input: HandPlayInputRequirement
): boolean {
  return cardType !== 'Minion' && pendingCardInputStage(input, undefined) === 'target'
}

/** Target presentation starts only after any card choice has been resolved. */
export function isCardTargetSelectionActive(
  input: HandPlayInputRequirement,
  choice: number | undefined,
  selectedTargetCount = 0
): boolean {
  return pendingCardInputStage(input, choice, selectedTargetCount) === 'target'
}

/**
 * Canonical renderer progression for input collected before a card is played.
 * A choice always precedes its branch-specific targets; the play is ready only
 * after both requirements have been satisfied.
 */
export function pendingCardInputStage(
  input: HandPlayInputRequirement,
  choice: number | undefined,
  selectedTargetCount = 0
): PendingCardInputStage {
  if (
    input.choiceCount > 0 &&
    input.choiceTiming !== 'after-placement' &&
    choice === undefined
  )
    return 'choice'
  if (selectedTargetCount < input.targetSelectors.length) return 'target'
  return 'ready'
}

/**
 * A staged minion play cannot commit until its visual preview has finished.
 * Targets may be collected during the preview; its completion callback retries
 * the commit once the presentation can be safely promoted to the live board.
 */
export function canCommitPendingCardPlay(
  input: HandPlayInputRequirement,
  choice: number | undefined,
  selectedTargetCount: number,
  minionPreviewReady = true
): boolean {
  return (
    minionPreviewReady &&
    pendingCardInputStage(input, choice, selectedTargetCount) === 'ready'
  )
}

/** Blocks newly mounted modal controls until the pointer that opened them is released. */
export class PointerReleaseInputGate {
  private pointerId: number | null = null

  get blocked(): boolean {
    return this.pointerId !== null
  }

  block(pointerId: number): void {
    this.pointerId = pointerId
  }

  release(pointerId: number): void {
    if (this.pointerId === pointerId) this.pointerId = null
  }

  clear(): void {
    this.pointerId = null
  }
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
