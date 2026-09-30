import { describe, expect, it } from 'vitest'
import { asPlayerId, type MatchEndedEvent } from '../../../game-rules/match'
import { classifyArenaMatchResult, shouldRecordClassWin } from './match-win-tracking'
import {
  isPremiumEnabled,
  isCardPremium,
  setPremiumMode,
  setPremiumCardIds
} from '../../../visual-components/cards/premium-appearance'
import { MatchPremiumAppearance } from '../presentation/match-premium-appearance'
import { createMatchScenario } from '../../../game-rules/match/testing/match-scenario-builder'

const localId = asPlayerId('human-player')
const remoteId = asPlayerId('ai-player')

function matchEnded(
  winnerId: MatchEndedEvent['winnerId'],
  reason: MatchEndedEvent['reason'] = 'hero-health-depleted'
): MatchEndedEvent {
  return {
    type: 'match-ended',
    winnerId,
    loserId: winnerId === localId ? remoteId : winnerId === remoteId ? localId : null,
    reason
  }
}

describe('class win tracking', () => {
  it('keeps scoped overrides out of inherited appearance and preserves original ownership', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      () => false
    )
    const card = { instanceId: 'source', cardId: 'basic_fireball', ownerId: remoteId }
    try {
      setPremiumMode('remote')
      expect(isPremiumEnabled(appearance.sideFor(card))).toBe(true)
      expect(appearance.resolve(card)).toBe(false)
      expect(
        appearance.inherit(
          { instanceId: 'generated', cardId: 'basic_fireball' },
          card.instanceId,
          remoteId
        )
      ).toBe(false)
      expect(
        appearance.sideFor({ instanceId: card.instanceId, controllerId: localId })
      ).toBe('remote')
      setPremiumMode('local')
      expect(isPremiumEnabled()).toBe(true)
      expect(isPremiumEnabled(appearance.sideFor(card))).toBe(false)
      setPremiumCardIds(['basic_fireball'])
      setPremiumMode('unlocked')
      expect(isCardPremium('basic_fireball')).toBe(true)
      expect(isPremiumEnabled('local')).toBe(false)
      expect(isPremiumEnabled('remote')).toBe(false)
      expect(
        appearance.resolve({ instanceId: 'generated', cardId: 'basic_fireball' })
      ).toBe(false)
    } finally {
      setPremiumMode('unlocked')
      setPremiumCardIds([])
    }
  })

  it('grants premium Coin only to the owner of an entirely premium original deck', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium-card'
    )
    appearance.setStartingDeck(localId, { 'premium-card': 30 })
    appearance.setStartingDeck(remoteId, { 'premium-card': 30 })
    expect(
      appearance.resolve({
        instanceId: 'coin',
        cardId: 'basic_the_coin',
        ownerId: localId
      })
    ).toBe(true)
    expect(
      appearance.resolve({
        instanceId: 'remote-coin',
        cardId: 'basic_the_coin',
        ownerId: remoteId
      })
    ).toBe(false)
    expect(
      appearance.resolve({
        instanceId: 'coin',
        cardId: 'basic_the_coin',
        controllerId: remoteId
      })
    ).toBe(true)
    expect(
      appearance.inherit(
        { instanceId: 'extra-coin', cardId: 'basic_the_coin' },
        'normal-generator'
      )
    ).toBe(true)
    for (const cards of [{}, { 'premium-card': 29, normal: 1 }] as Readonly<
      Record<string, number>
    >[]) {
      const mixed = new MatchPremiumAppearance(
        () => localId,
        (id) => id === 'premium-card'
      )
      mixed.setStartingDeck(localId, cards)
      expect(mixed.resolve({ instanceId: 'coin', cardId: 'basic_the_coin' })).toBe(
        false
      )
    }
  })
  it('inherits opening-generated cards on both normal and post-mulligan initialization', () => {
    const id = 'one_night_in_karazhan_prince_malchezaar'
    const scenario = createMatchScenario({ cardId: id })
    const local = scenario.participants[0]
    const appearance = new MatchPremiumAppearance(
      () => local,
      (cardId) => cardId === id
    )
    appearance.rememberState(scenario.match.getState())
    scenario.confirmBothMulligans()
    const state = scenario.match.getState()
    appearance.observe(state.openingHistory ?? [])
    const resumed = new MatchPremiumAppearance(
      () => local,
      (cardId) => cardId === id
    )
    resumed.rememberState(state)
    const history = state.openingHistory!
    expect(history).toHaveLength(2)
    for (const event of history) {
      expect(event.outcomes).toHaveLength(5)
      for (const { target } of event.outcomes) {
        const card = { instanceId: target.id, cardId: target.cardId! }
        expect(appearance.resolve(card, target.participantId)).toBe(
          target.participantId === local
        )
        expect(resumed.resolve(card, target.participantId)).toBe(
          target.participantId === local
        )
      }
    }
  })
  it('records only naturally completed local victories', () => {
    expect(shouldRecordClassWin(matchEnded(localId), localId)).toBe(true)
    expect(shouldRecordClassWin(matchEnded(remoteId), localId)).toBe(false)
    expect(
      shouldRecordClassWin(matchEnded(null, 'simultaneous-hero-lethal'), localId)
    ).toBe(false)
    expect(shouldRecordClassWin(matchEnded(localId, 'dev-forced'), localId)).toBe(false)
  })

  it('classifies Arena outcomes and ignores development-forced endings', () => {
    expect(classifyArenaMatchResult(matchEnded(remoteId, 'concede'), localId)).toBe(
      'defeat'
    )
    expect(classifyArenaMatchResult(matchEnded(localId), localId)).toBe('win')
    expect(classifyArenaMatchResult(matchEnded(remoteId), localId)).toBe('defeat')
    expect(
      classifyArenaMatchResult(matchEnded(null, 'simultaneous-hero-lethal'), localId)
    ).toBe('draw')
    expect(classifyArenaMatchResult(matchEnded(localId, 'dev-forced'), localId)).toBe(
      null
    )
  })
})
