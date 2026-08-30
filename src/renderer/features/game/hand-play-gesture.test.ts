import { describe, expect, it } from 'vitest'
import {
  OneShotPointerTapGuard,
  allowsDragTargetingFromHand,
  isHandOwnedSlot,
  requiresClickConfirmedMinionPlacement
} from './hand-play-gesture'

describe('targeted minion hand-play gesture', () => {
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
