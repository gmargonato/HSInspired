import { describe, expect, it } from 'vitest'
import { createAiFixture } from '../../../game/match/testing/ai-scenario-builder'
import { enumerateLegalCommands } from '../../../game/match'
import { GameBoardSession } from './game-board-session'
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

describe('Expert timeout fallback', () => {
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
