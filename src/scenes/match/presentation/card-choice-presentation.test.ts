import { describe, expect, it } from 'vitest'
import { describeCardChoices } from './card-choice-presentation'

describe('card choice presentation', () => {
  it('keeps labels aligned with legal zero-based choices', () => {
    expect(
      describeCardChoices({
        legalChoices: [2, 4],
        choiceLabels: ['Draw cards', 'Restore health']
      })
    ).toEqual([
      { choice: 2, label: 'Draw cards' },
      { choice: 4, label: 'Restore health' }
    ])
  })

  it('falls back to a stable label when content has no display label', () => {
    expect(describeCardChoices({ legalChoices: [0, 1] })).toEqual([
      { choice: 0, label: 'Choice 1' },
      { choice: 1, label: 'Choice 2' }
    ])
  })
})
