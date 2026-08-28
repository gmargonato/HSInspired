import { describe, expect, it } from 'vitest'
import { asCardId } from '../../../game/content/cards'
import { asPlayerId } from '../../../game/match/match-types'
import type { CardBurnedEvent } from '../../../game/match'
import { MatchHistoryModel } from './match-history-model'

const local = asPlayerId('local')

describe('MatchHistoryModel', () => {
  it('keeps newest entries first and caps the rail', () => {
    const model = new MatchHistoryModel(2)
    model.record({
      type: 'history-action-resolved',
      participantId: local,
      action: 'card',
      source: {
        id: 'card-1',
        participantId: local,
        kind: 'card',
        cardId: asCardId('basic_fireball')
      },
      outcomes: []
    })
    model.record({
      type: 'history-action-resolved',
      participantId: local,
      action: 'combat',
      source: {
        id: 'hero-1',
        participantId: local,
        kind: 'hero',
        cardId: null
      },
      outcomes: []
    })
    model.record({
      type: 'history-action-resolved',
      participantId: local,
      action: 'hero-power',
      source: {
        id: 'hero-power-1',
        participantId: local,
        kind: 'hero',
        cardId: null
      },
      outcomes: []
    })

    expect(model.all()).toHaveLength(2)
    expect(model.all().map((entry) => entry.action)).toEqual(['hero-power', 'combat'])
  })

  it('records a burn with its burned-card snapshot', () => {
    const model = new MatchHistoryModel(2)
    const burn = {
      type: 'card-burned',
      participantId: local,
      card: { cardId: asCardId('basic_fireball') }
    } as CardBurnedEvent

    model.recordBurn(burn)

    expect(model.all()).toEqual([
      expect.objectContaining({
        kind: 'burn',
        action: 'burn',
        participantId: local,
        card: { cardId: asCardId('basic_fireball') }
      })
    ])
  })
})
