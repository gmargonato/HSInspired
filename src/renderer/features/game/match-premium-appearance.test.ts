import { describe, expect, it } from 'vitest'
import {
  asCardId,
  asHeroId,
  asHeroPowerId,
  type CardId
} from '../../../game/content/cards'
import { asPlayerId, type OpeningMatchEvent } from '../../../game/match'
import { MatchPremiumAppearance } from './match-premium-appearance'

const localId = asPlayerId('human-player')
const remoteId = asPlayerId('ai-player')
const GOLDEN_MONKEY = asCardId('league_of_explorers_golden_monkey')

function effectEvent(
  action: string,
  sourceCardId: CardId | null,
  data: Record<string, unknown>,
  sourceInstanceId = 'source'
): OpeningMatchEvent {
  return {
    type: 'effect-resolved',
    revision: 1,
    sourceInstanceId,
    sourceCardId,
    controllerId: localId,
    action,
    actionPath: 'test',
    data
  }
}

function heroPowerReplaced(
  sourceCardId: CardId | null,
  sourceInstanceId?: string
): OpeningMatchEvent {
  return {
    type: 'hero-power-replaced',
    participantId: localId,
    previousHeroPowerId: asHeroPowerId('basic_mage_fireblast'),
    heroPowerId: asHeroPowerId('mage_fireblast_rank_2'),
    ...(sourceInstanceId ? { sourceInstanceId } : {}),
    ...(sourceCardId ? { sourceCardId } : {})
  }
}

describe('premium generation through transforms', () => {
  it('does not grant premium when a non-premium Golden Monkey transforms a mixed hand', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'reno'
    )
    appearance.resolve({ instanceId: 'hand-premium', cardId: 'reno', ownerId: localId })
    expect(appearance.resolve({ instanceId: 'hand-premium', cardId: 'reno' })).toBe(
      true
    )
    appearance.resolve({ instanceId: 'hand-normal', cardId: 'execute', ownerId: localId })
    appearance.observe([
      effectEvent('transform-random', GOLDEN_MONKEY, {
        target: 'hand-premium',
        previousCardId: 'reno',
        cardId: 'legendary_gruul'
      }),
      effectEvent('transform-random', GOLDEN_MONKEY, {
        target: 'hand-normal',
        cardId: 'legendary_the_beast'
      })
    ])
    expect(
      appearance.resolve({
        instanceId: 'hand-premium',
        cardId: 'legendary_gruul',
        ownerId: localId
      })
    ).toBe(false)
    expect(
      appearance.resolve({
        instanceId: 'hand-normal',
        cardId: 'legendary_the_beast',
        ownerId: localId
      })
    ).toBe(false)
  })

  it('grants premium to every target of a premium Golden Monkey', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'league_of_explorers_golden_monkey'
    )
    appearance.resolve({
      instanceId: 'monkey',
      cardId: 'league_of_explorers_golden_monkey',
      ownerId: localId
    })
    appearance.observe([
      effectEvent(
        'transform-random',
        GOLDEN_MONKEY,
        { target: 'hand-card', cardId: 'legendary_gruul' },
        'monkey'
      )
    ])
    expect(
      appearance.resolve({
        instanceId: 'hand-card',
        cardId: 'legendary_gruul',
        ownerId: localId
      })
    ).toBe(true)
  })

  it('falls back to the purchased identity for an untracked premium Golden Monkey', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'league_of_explorers_golden_monkey'
    )
    appearance.observe([
      effectEvent('transform-random', GOLDEN_MONKEY, {
        target: 'hand-card',
        cardId: 'legendary_gruul'
      })
    ])
    expect(
      appearance.resolve({
        instanceId: 'hand-card',
        cardId: 'legendary_gruul',
        ownerId: localId
      })
    ).toBe(true)
  })

  it('never grants premium for a remote Golden Monkey', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'league_of_explorers_golden_monkey'
    )
    appearance.observe([
      {
        type: 'effect-resolved',
        revision: 1,
        sourceInstanceId: 'remote-monkey',
        sourceCardId: GOLDEN_MONKEY,
        controllerId: remoteId,
        action: 'transform-random',
        actionPath: 'test',
        data: { target: 'remote-hand-card', cardId: 'legendary_gruul' }
      }
    ])
    expect(
      appearance.resolve({
        instanceId: 'remote-hand-card',
        cardId: 'legendary_gruul',
        ownerId: remoteId
      })
    ).toBe(false)
  })

  it('produces fresh cards: transforms do not inherit prior premium', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium-source'
    )
    appearance.resolve({
      instanceId: 'golden',
      cardId: 'premium-source',
      ownerId: localId
    })
    expect(appearance.resolve({ instanceId: 'golden', cardId: 'premium-source' })).toBe(
      true
    )
    appearance.resolve({ instanceId: 'plain', cardId: 'execute', ownerId: localId })
    const transform = effectEvent('transform', asCardId('polymorph'), {
      target: 'golden',
      cardId: 'sheep-token'
    })
    appearance.observe([transform])
    expect(
      appearance.resolve({
        instanceId: 'golden',
        cardId: 'sheep-token',
        ownerId: localId
      })
    ).toBe(false)
    expect(
      appearance.resolve({ instanceId: 'plain', cardId: 'execute', ownerId: localId })
    ).toBe(false)
  })

  it('ignores owned premium copies of the rolled card after a transform', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'legendary_gruul'
    )
    appearance.observe([
      effectEvent('transform-random', GOLDEN_MONKEY, {
        target: 'hand-card',
        cardId: 'legendary_gruul'
      })
    ])
    expect(
      appearance.resolve({
        instanceId: 'hand-card',
        cardId: 'legendary_gruul',
        ownerId: localId
      })
    ).toBe(false)
  })

  it('inherits premium from a premium transform source', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium-source'
    )
    appearance.resolve({
      instanceId: 'premium-transformer',
      cardId: 'premium-source',
      ownerId: localId
    })
    appearance.observe([
      effectEvent(
        'transform-random',
        asCardId('premium-source'),
        { target: 'hand-card', cardId: 'legendary_gruul' },
        'premium-transformer'
      )
    ])
    expect(
      appearance.resolve({
        instanceId: 'hand-card',
        cardId: 'legendary_gruul',
        ownerId: localId
      })
    ).toBe(true)
  })
})

describe('premium hero powers', () => {
  it('follows the premium minion that replaced the power', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium_justicar'
    )
    appearance.resolve({
      instanceId: 'justicar',
      cardId: 'premium_justicar',
      ownerId: localId
    })
    appearance.observe([
      heroPowerReplaced(asCardId('premium_justicar'), 'justicar')
    ])
    expect(appearance.heroPowerPremium(localId)).toBe(true)

    appearance.resolve({
      instanceId: 'plain-justicar',
      cardId: 'justicar',
      ownerId: localId
    })
    appearance.observe([heroPowerReplaced(asCardId('justicar'), 'plain-justicar')])
    expect(appearance.heroPowerPremium(localId)).toBe(false)
  })

  it('falls back to the purchased identity when the instance is untracked', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium_justicar'
    )
    appearance.observe([heroPowerReplaced(asCardId('premium_justicar'), 'unknown')])
    expect(appearance.heroPowerPremium(localId)).toBe(true)
  })

  it('never grants premium for a remote player replacement', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium_justicar'
    )
    appearance.observe([
      {
        type: 'hero-power-replaced',
        participantId: remoteId,
        previousHeroPowerId: asHeroPowerId('basic_mage_fireblast'),
        heroPowerId: asHeroPowerId('mage_fireblast_rank_2'),
        sourceInstanceId: 'remote-justicar',
        sourceCardId: asCardId('premium_justicar')
      }
    ])
    expect(appearance.heroPowerPremium(remoteId)).toBe(false)
  })

  it('marks the power premium when a premium hero card replaces the hero', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium_jaraxxus'
    )
    appearance.resolve({
      instanceId: 'jaraxxus',
      cardId: 'premium_jaraxxus',
      ownerId: localId
    })
    appearance.observe([
      {
        type: 'hero-replaced',
        participantId: localId,
        previousHeroId: asHeroId('warlock-guldan'),
        heroId: asHeroId('lord-jaraxxus'),
        armorGained: 5,
        sourceInstanceId: 'jaraxxus',
        sourceCardId: asCardId('premium_jaraxxus')
      }
    ])
    expect(appearance.heroPowerPremium(localId)).toBe(true)
  })

  it('exposes tracked instance premium for discovery sources', () => {
    const appearance = new MatchPremiumAppearance(
      () => localId,
      (id) => id === 'premium_finley'
    )
    appearance.resolve({
      instanceId: 'finley',
      cardId: 'premium_finley',
      ownerId: localId
    })
    expect(appearance.instancePremium('finley')).toBe(true)
    expect(appearance.instancePremium('unknown')).toBe(false)
  })
})
