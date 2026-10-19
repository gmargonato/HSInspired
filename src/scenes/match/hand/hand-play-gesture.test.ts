import { describe, expect, it, vi } from 'vitest'
import { Container, type Renderer } from 'pixi.js'
import { GameHandDrag } from './game-hand-drag'
import type { HandEntry } from './game-hand-entry'
import { layoutHand } from './hand-layout'

vi.mock('./hand-card-perspective-pool', () => ({
  HandCardPerspectivePool: class {
    acquire() {
      return {
        setTarget: vi.fn(),
        update: vi.fn(),
        flushSnapshot: vi.fn(),
        setOutlineEnabled: vi.fn()
      }
    }
    prepare() {}
    flush() {}
    release() {}
    invalidate() {}
    dispose() {}
  }
}))
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

describe('cosmetic hand drag lifecycle', () => {
  function setup() {
    const layer = new Container()
    const slot = Object.assign(new Container(), {
      card: new Container(),
      suppressPlayableOutline: vi.fn(),
      isPlayableOutlineEnabled: () => true,
      isTradeableOutlineEnabled: () => false,
      getPlayableOutlinePalette: () => 'green',
      getPlayableOutlinePreset: () => 'card',
      getPlayableOutlineTuning: () => undefined
    })
    const entry = {
      slot,
      restTransform: layoutHand(1)[0]!,
      displaced: false
    } as unknown as HandEntry
    const entries = [entry]
    const completions: (() => void)[] = []
    const context = {
      entryAt: (index: number) => entries[index],
      entryFor: (candidate: unknown) => entries.find((item) => item.slot === candidate),
      indexFor: (candidate: unknown) =>
        entries.findIndex((item) => item.slot === candidate),
      shouldReturnCosmetic: vi.fn(
        (pointer: { x: number; y: number }) => pointer.y < 820
      ),
      beginTargetGesture: vi.fn(),
      tryTarget: vi.fn(() => false),
      updateBoardPreview: vi.fn(),
      clearBoardPreview: vi.fn(),
      clearHover: vi.fn(),
      beginReflow: vi.fn(),
      syncMana: vi.fn(),
      onReturned: vi.fn(),
      returnToHand: vi.fn<(slot: HandEntry['slot']) => Promise<void>>(
        () => new Promise<void>((resolve) => completions.push(resolve))
      )
    }
    const drag = new GameHandDrag(
      layer,
      {} as Renderer,
      { kill: vi.fn(), to: vi.fn() },
      context
    )
    drag.begin(0, { x: 960, y: 1000 }, 1, 'cosmetic')
    return { drag, context, entries, entry, slot, completions }
  }

  it('allows movement without targeting or board preview, then returns at the boundary', async () => {
    const { drag, context, completions } = setup()
    drag.flushPointer({ x: 1020, y: 950 }, 1)
    drag.update(16)
    expect(drag.pointer).toEqual({ x: 1020, y: 950 })
    expect(context.beginTargetGesture).not.toHaveBeenCalled()
    expect(context.tryTarget).not.toHaveBeenCalled()
    expect(context.updateBoardPreview).not.toHaveBeenCalled()
    drag.flushPointer({ x: 1020, y: 800 }, 2)
    expect(drag.returning).toBe(false)
    drag.flushPointer({ x: 1020, y: 800 }, 1)
    expect(drag.returning).toBe(true)
    expect(context.returnToHand).toHaveBeenCalledOnce()
    completions[0]!()
    await Promise.resolve()
    expect(drag.index).toBeNull()
    expect(context.onReturned).not.toHaveBeenCalled()
    drag.dispose()
  })

  it('rechecks turn eligibility with a stationary pointer', () => {
    const { drag, context } = setup()
    context.shouldReturnCosmetic.mockReturnValue(true)
    drag.update(16)
    expect(drag.returning).toBe(true)
    expect(context.returnToHand).toHaveBeenCalledOnce()
    drag.dispose()
  })

  it('returns the original card even when its index changes during a return', async () => {
    const { drag, context, entries, entry, slot, completions } = setup()
    entries.unshift({ ...entry, slot: new Container() as HandEntry['slot'] })
    expect(drag.index).toBe(1)
    drag.end()
    expect(context.returnToHand.mock.calls[0]?.[0]).toBe(slot)
    entries.shift()
    completions[0]!()
    await Promise.resolve()
    expect(drag.index).toBeNull()
    expect(slot.suppressPlayableOutline).toHaveBeenLastCalledWith(false)
    drag.dispose()
  })

  it('does not let a removed card’s late return clear a new pickup', async () => {
    const { drag, entries, entry, slot, completions } = setup()
    drag.end()
    entries.pop()
    drag.invalidate(entry.slot)
    expect(drag.index).toBeNull()
    expect(drag.cosmetic).toBe(false)
    entries.push(entry)
    drag.begin(0, { x: 960, y: 1000 }, 1, 'cosmetic')
    completions[0]!()
    await Promise.resolve()
    expect(drag.index).toBe(0)
    expect(drag.returning).toBe(false)
    expect(slot.suppressPlayableOutline).toHaveBeenLastCalledWith(true)
    drag.dispose()
  })
})
