import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import { asPlayerId } from '../../../game/match/match-types'
import {
  getOpeningMatchPublicEvents,
  type CardBurnedEvent,
  type HistoryActionResolvedEvent
} from '../../../game/match'
import { MatchHistoryModel } from './match-history-model'

const local = asPlayerId('local')
const remote = asPlayerId('remote')

function played(cardId: string, participantId = remote): HistoryActionResolvedEvent {
  return {
    type: 'history-action-resolved',
    action: 'card',
    participantId,
    source: {
      id: 'played-card',
      participantId,
      kind: 'card',
      cardId: asCardId(cardId),
      baseCost: 2,
      currentCost: 1
    },
    outcomes: []
  }
}

describe('MatchHistoryModel', () => {
  it('conceals every opponent Secret from raw engine events and public events', () => {
    const secrets = CARD_CATALOG.all.filter((card) => card.keywords.includes('secret'))
    expect(secrets.length).toBeGreaterThan(0)
    for (const secret of secrets) {
      const event = played(secret.id)
      const projected = getOpeningMatchPublicEvents(
        [event],
        local
      )[0] as HistoryActionResolvedEvent
      for (const input of [event, projected]) {
        const model = new MatchHistoryModel(local)
        const entry = model.record(input)
        expect(entry).toMatchObject({ source: { cardId: null, concealedAs: 'secret' } })
        if (entry.kind !== 'action') throw new Error('Expected action')
        expect(entry.source).not.toHaveProperty('baseCost')
        expect(entry.source).not.toHaveProperty('currentCost')
      }
      expect(event.source.cardId).toBe(secret.id)
    }
  })

  it.each([
    'classic_freezing_trap',
    'basic_fireball',
    'basic_acidic_swamp_ooze',
    'basic_fiery_war_axe'
  ])('shows own played %s', (cardId) => {
    expect(new MatchHistoryModel(local).record(played(cardId, local))).toMatchObject({
      source: { cardId }
    })
  })

  it.each(['basic_fireball', 'basic_acidic_swamp_ooze', 'basic_fiery_war_axe'])(
    'shows ordinary opponent play %s',
    (cardId) => {
      expect(new MatchHistoryModel(local).record(played(cardId))).toMatchObject({
        source: { cardId }
      })
    }
  )

  it('allows a public Secret trigger without rewriting its concealed play', () => {
    const model = new MatchHistoryModel(local)
    const event = played('classic_freezing_trap')
    model.record(event)
    model.record({ ...event, action: 'trigger' })
    expect(model.all()[0]).toMatchObject({
      source: { cardId: 'classic_freezing_trap' }
    })
    expect(model.all()[1]).toMatchObject({
      source: { cardId: null, concealedAs: 'secret' }
    })
  })

  it('hides opponent hand outcomes including other effects on the same card', () => {
    const event = played('basic_fireball')
    const target = {
      id: 'created',
      participantId: remote,
      kind: 'card' as const,
      cardId: asCardId('classic_freezing_trap'),
      baseCost: 2,
      currentCost: 1
    }
    const input: HistoryActionResolvedEvent = {
      ...event,
      outcomes: [
        { kind: 'create-hand', target },
        { kind: 'buff', target },
        { kind: 'draw', target: { ...target, id: 'drawn' } },
        { kind: 'create-hand', target: { ...target, id: 'own', participantId: local } },
        { kind: 'summon-board', target: { ...target, id: 'summoned', kind: 'minion' } }
      ]
    }
    const entry = new MatchHistoryModel(local).record(input)
    if (entry.kind !== 'action') throw new Error('Expected action')
    expect(
      entry.outcomes
        .slice(0, 3)
        .every(
          ({ target }) =>
            target.cardId === null &&
            target.baseCost === undefined &&
            target.currentCost === undefined
        )
    ).toBe(true)
    expect(entry.outcomes.slice(3).every(({ target }) => target.cardId !== null)).toBe(
      true
    )
    expect(input.outcomes[0]!.target.cardId).toBe('classic_freezing_trap')
  })

  it('shows an opponent burned Secret because burns are public', () => {
    const event = {
      type: 'card-burned',
      participantId: remote,
      card: { cardId: asCardId('classic_freezing_trap') }
    } as CardBurnedEvent
    expect(new MatchHistoryModel(local).recordBurn(event)).toMatchObject({
      card: { cardId: 'classic_freezing_trap' }
    })
  })

  it('keeps newest entries first and caps the rail', () => {
    const model = new MatchHistoryModel(local, 2)
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
    const model = new MatchHistoryModel(local, 2)
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
