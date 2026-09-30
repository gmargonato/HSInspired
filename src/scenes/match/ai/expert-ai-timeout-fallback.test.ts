import { describe, expect, it } from 'vitest'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game-rules/match'
import { GameBoardSession } from '../game-board-session'
import { selectExpertTimeoutFallbackAction } from './expert-ai-timeout-fallback'

function createSession(
  options: Parameters<typeof createAiFixture>[0]
): GameBoardSession {
  const fixture = createAiFixture(options)
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
}

function legalCommands(session: GameBoardSession) {
  return enumerateLegalCommands(
    {
      getState: () => session.getState(),
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}

function playCoin(session: GameBoardSession): void {
  const participantId = session.remoteParticipantId
  const coin = session
    .findPlayer(session.getState(), participantId)
    .hand.find((card) => card.cardId === 'basic_the_coin')
  if (!coin) throw new Error('Expected The Coin in the AI hand.')
  const result = session.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: coin.instanceId
  })
  if (!result.accepted) throw new Error(result.message)
}

describe('Expert timeout fallback', () => {
  it('ends the turn instead of using Hunter hero power after first-turn Coin', () => {
    const session = createSession({
      seed: 0xfab0,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      opponentHealth: 30,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    playCoin(session)
    expect(session.getState().history?.cardsPlayedThisTurn).toContain('basic_the_coin')

    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command.type).toBe('end-turn')
  })

  it('allows Mage hero power when it kills an opposing minion after Coin', () => {
    const session = createSession({
      seed: 0xfab4,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      opponentBoard: [{ cardId: 'basic_murloc_scout' }],
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    playCoin(session)

    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command).toMatchObject({
      type: 'use-hero-power',
      target: { kind: 'minion', participantId: session.localParticipantId }
    })
  })

  it('allows a non-Mage Coin hero power when it immediately wins the match', () => {
    const session = createSession({
      seed: 0xfab5,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiHand: ['basic_the_coin'],
      aiMana: 1,
      aiMaximumMana: 1,
      turnNumber: 2,
      opponentHealth: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze']
    })
    playCoin(session)

    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command).toMatchObject({ type: 'use-hero-power' })
    if (action?.command.type !== 'use-hero-power')
      throw new Error('Expected Hunter Steady Shot to take immediate lethal.')
    const result = session.match.dispatch(action.command)
    expect(result.accepted).toBe(true)
    expect(session.getState().winnerId).toBe(session.remoteParticipantId)
  })

  it('uses a playable minion instead of passing with an empty board', () => {
    const session = createSession({
      seed: 0xfab1,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_stonetusk_boar'],
      aiMana: 1,
      aiMaximumMana: 1,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const legal = legalCommands(session)

    const action = selectExpertTimeoutFallbackAction(session, legal)

    expect(legal.some((command) => command.type === 'end-turn')).toBe(true)
    expect(action?.command.type).toBe('play-card')
    if (action?.command.type !== 'play-card')
      throw new Error('Expected the fallback to develop Stonetusk Boar.')
    const command = action.command
    const card = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((entry) => entry.instanceId === command.cardInstanceId)
    expect(card?.cardId).toBe('basic_stonetusk_boar')
  })

  it('plays a Taunt minion to address visible lethal pressure', () => {
    const session = createSession({
      seed: 0xfab2,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_senjin_shieldmasta'],
      aiMana: 4,
      aiMaximumMana: 4,
      aiHealth: 8,
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', ready: true },
        { cardId: 'basic_boulderfist_ogre', ready: true }
      ],
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))

    expect(action?.command.type).toBe('play-card')
    if (action?.command.type !== 'play-card')
      throw new Error('Expected a defensive Taunt play.')
    const command = action.command
    const card = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((entry) => entry.instanceId === command.cardInstanceId)
    expect(card?.cardId).toBe('basic_senjin_shieldmasta')
  })

  it('takes an available face lethal before spending resources', () => {
    const session = createSession({
      seed: 0xfab3,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHand: ['basic_river_crocolisk'],
      aiBoard: [{ cardId: 'basic_stonetusk_boar', ready: true }],
      opponentHealth: 1,
      aiMana: 2,
      aiMaximumMana: 2,
      aiDeck: ['basic_acidic_swamp_ooze'],
      opponentDeck: ['basic_acidic_swamp_ooze'],
      aiHeroPowerAvailable: false
    })
    const action = selectExpertTimeoutFallbackAction(session, legalCommands(session))
    expect(action?.command).toMatchObject({
      type: 'attack-character',
      attacker: { kind: 'minion' },
      defender: { kind: 'hero' }
    })
  })
})
