import { describe, expect, it } from 'vitest'
import {
  ContentValidationError,
  validateCardRecord,
  validateCardSet
} from './card-validator'

const validMinion = {
  id: 'test_minion',
  name: 'Test Minion',
  rarity: 'Common',
  cardClass: 'Neutral',
  type: 'Minion',
  subtype: 'General',
  cost: 2,
  attack: 2,
  health: 2,
  rulesText: 'Battlecry: Draw a card.'
} as const

describe('card content validation', () => {
  it('normalizes type-specific fields into the discriminated union', () => {
    const card = validateCardRecord(validMinion, 'basic')
    expect(card).toMatchObject({
      type: 'Minion',
      attack: 2,
      health: 2,
      subtype: null,
      collectible: true,
      deckLegal: true
    })
  })

  it('rejects missing rules text and invalid type-specific stats', () => {
    expect(() =>
      validateCardRecord({ ...validMinion, rulesText: undefined }, 'basic')
    ).toThrow(ContentValidationError)
    expect(() =>
      validateCardRecord(
        { ...validMinion, type: 'Spell', attack: 1, health: 1 },
        'basic'
      )
    ).toThrow(/card\.attack: is not valid/u)
  })

  it('rejects duplicate identifiers within one authored set', () => {
    expect(() =>
      validateCardSet([validMinion, validMinion], 'basic', 'fixture')
    ).toThrow(/duplicate id/u)
  })
})
