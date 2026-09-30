import { describe, expect, it } from 'vitest'
import {
  OneShotPointerTapGuard,
  PointerReleaseInputGate,
  allowsDragTargetingFromHand,
  canCommitPendingCardPlay,
  isCardTargetSelectionActive,
  isHandOwnedSlot,
  pendingCardInputStage,
  resolveHandCardArrowOrigin,
  requiresClickConfirmedMinionPlacement
} from './hand-play-gesture'

describe('hand-play gesture', () => {
  it('requires a separate placement click for a targeted minion', () => {
    expect(
      requiresClickConfirmedMinionPlacement('Minion', {
        targetSelectors: [{}],
        choiceCount: 0
      })
    ).toBe(true)
  })

  it('requires a separate placement click when a minion must choose its play input', () => {
    expect(
      requiresClickConfirmedMinionPlacement('Minion', {
        targetSelectors: [],
        choiceCount: 2
      })
    ).toBe(true)
  })

  it('allows a self-transform Choice minion to enter play before selecting its form', () => {
    expect(
      requiresClickConfirmedMinionPlacement('Minion', {
        targetSelectors: [],
        choiceCount: 2,
        choiceTiming: 'after-placement'
      })
    ).toBe(false)
  })

  it('keeps release-to-play for ordinary minions and non-minion cards', () => {
    expect(
      requiresClickConfirmedMinionPlacement('Minion', {
        targetSelectors: [],
        choiceCount: 0
      })
    ).toBe(false)
    expect(
      requiresClickConfirmedMinionPlacement('Spell', {
        targetSelectors: [{}],
        choiceCount: 0
      })
    ).toBe(false)
  })

  it('allows drag targeting for targeted non-minions but not minions', () => {
    const targeted = { targetSelectors: [{}], choiceCount: 0 }

    expect(allowsDragTargetingFromHand('Spell', targeted)).toBe(true)
    expect(allowsDragTargetingFromHand('Weapon', targeted)).toBe(true)
    expect(allowsDragTargetingFromHand('Hero', targeted)).toBe(true)
    expect(allowsDragTargetingFromHand('Minion', targeted)).toBe(false)
    expect(
      allowsDragTargetingFromHand('Spell', {
        targetSelectors: [],
        choiceCount: 0
      })
    ).toBe(false)
  })

  it('waits for a pre-play choice before enabling drag targeting', () => {
    const unresolvedChoice = {
      targetSelectors: [{}],
      choiceCount: 2,
      choiceTiming: 'before-play' as const
    }

    expect(allowsDragTargetingFromHand('Spell', unresolvedChoice)).toBe(false)
  })

  it('starts target presentation only after resolving a targeted choice', () => {
    const targetedChoice = { targetSelectors: [{}], choiceCount: 2 }

    expect(isCardTargetSelectionActive(targetedChoice, undefined)).toBe(false)
    expect(isCardTargetSelectionActive(targetedChoice, 0)).toBe(true)
    expect(
      isCardTargetSelectionActive({ targetSelectors: [], choiceCount: 2 }, 1)
    ).toBe(false)
  })

  it('uses one ordered progression for choice, target, and ready states', () => {
    const livingRootsBeforeChoice = { targetSelectors: [{}], choiceCount: 2 }
    const livingRootsDamageChoice = { targetSelectors: [{}], choiceCount: 2 }
    const livingRootsSummonChoice = { targetSelectors: [], choiceCount: 2 }
    const darkbomb = { targetSelectors: [{}], choiceCount: 0 }
    const druidOfTheFlame = {
      targetSelectors: [],
      choiceCount: 2,
      choiceTiming: 'after-placement' as const
    }

    expect(pendingCardInputStage(livingRootsBeforeChoice, undefined)).toBe('choice')
    expect(pendingCardInputStage(livingRootsDamageChoice, 0)).toBe('target')
    expect(pendingCardInputStage(livingRootsDamageChoice, 0, 1)).toBe('ready')
    expect(pendingCardInputStage(livingRootsSummonChoice, 1)).toBe('ready')
    expect(pendingCardInputStage(darkbomb, undefined)).toBe('target')
    expect(pendingCardInputStage(darkbomb, undefined, 1)).toBe('ready')
    expect(pendingCardInputStage(druidOfTheFlame, undefined)).toBe('ready')
  })

  it('waits for a staged minion preview before committing collected targets', () => {
    const targetedMinion = { targetSelectors: [{}], choiceCount: 0 }

    expect(canCommitPendingCardPlay(targetedMinion, undefined, 1, false)).toBe(false)
    expect(canCommitPendingCardPlay(targetedMinion, undefined, 1, true)).toBe(true)
    expect(canCommitPendingCardPlay(targetedMinion, undefined, 0, true)).toBe(false)
  })

  it('blocks modal input until the opening pointer is released', () => {
    const gate = new PointerReleaseInputGate()
    gate.block(7)

    expect(gate.blocked).toBe(true)
    gate.release(8)
    expect(gate.blocked).toBe(true)
    gate.release(7)
    expect(gate.blocked).toBe(false)
  })

  it('always renders targeted spells from the local hero', () => {
    expect(resolveHandCardArrowOrigin('Spell', 'card')).toBe('local-hero')
    expect(resolveHandCardArrowOrigin('Spell', 'local-hero')).toBe('local-hero')
  })

  it('preserves non-spell and minion-preview targeting origins', () => {
    expect(resolveHandCardArrowOrigin('Weapon', 'card')).toBe('card')
    expect(resolveHandCardArrowOrigin('Weapon', 'local-hero')).toBe('local-hero')
    expect(resolveHandCardArrowOrigin('Minion', 'minion-preview')).toBe(
      'minion-preview'
    )
  })

  it('suppresses only the tap produced by the armed placement pointer', () => {
    const guard = new OneShotPointerTapGuard()
    guard.arm(7)

    expect(guard.consume(8)).toBe(false)
    expect(guard.consume(7)).toBe(true)
    expect(guard.consume(7)).toBe(false)
  })

  it('releases an unconsumed placement tap without affecting another pointer', () => {
    const guard = new OneShotPointerTapGuard()
    guard.arm(7)
    guard.release(8)
    expect(guard.matches(7)).toBe(true)

    guard.release(7)
    expect(guard.matches(7)).toBe(false)
  })

  it('keeps hover ownership with the hand layer', () => {
    const handLayer = {}
    const summonLayer = {}

    expect(isHandOwnedSlot({ parent: handLayer }, handLayer)).toBe(true)
    expect(isHandOwnedSlot({ parent: summonLayer }, handLayer)).toBe(false)
    expect(isHandOwnedSlot({ parent: null }, handLayer)).toBe(false)
  })
})
