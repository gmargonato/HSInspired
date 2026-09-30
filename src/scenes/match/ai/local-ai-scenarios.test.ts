import { describe, expect, it, vi } from 'vitest'
import { asCardId, CARD_CATALOG } from '../../../game-rules/content/cards'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import type { TurnMatchCommand } from '../../../game-rules/match'
import { createMatchScenario } from '../../../game-rules/match/testing/match-scenario-builder'
import type {
  AiDecisionApi,
  AiDecisionRequest,
  AiDecisionResponse
} from '../../../desktop/contracts/ipc/ai'
import { AiRequestError } from '../../../desktop/contracts/ipc/ai'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import { AiTurnController } from './ai-turn-controller'
import { GameBoardSession } from '../game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'

function dispatch(session: GameBoardSession, command: TurnMatchCommand): void {
  const result = session.match.dispatch(command)
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
}

function startAiTurn(
  seed: number,
  configure: (session: GameBoardSession) => void,
  options: {
    readonly firstHeroId?: string
    readonly secondHeroId?: string
  } = {}
): GameBoardSession {
  const scenario = createMatchScenario({ seed, ...options })
  const session = new GameBoardSession({ setup: scenario.setup, decks: scenario.decks })
  dispatch(session, {
    type: 'confirm-mulligan',
    participantId: session.localParticipantId,
    replaceInstanceIds: []
  })
  dispatch(session, {
    type: 'confirm-mulligan',
    participantId: session.remoteParticipantId,
    replaceInstanceIds: []
  })
  configure(session)
  const active = session.getState().activePlayerId
  if (active === session.localParticipantId) {
    dispatch(session, {
      type: 'end-turn',
      participantId: session.localParticipantId
    })
  } else {
    dispatch(session, {
      type: 'end-turn',
      participantId: session.remoteParticipantId
    })
    dispatch(session, {
      type: 'end-turn',
      participantId: session.localParticipantId
    })
  }
  expect(session.getState().activePlayerId).toBe(session.remoteParticipantId)
  return session
}

function addCard(session: GameBoardSession, cardId: string): string {
  dispatch(session, {
    type: 'dev-add-card',
    participantId: session.remoteParticipantId,
    cardId: asCardId(cardId)
  })
  return session
    .findPlayer(session.getState(), session.remoteParticipantId)
    .hand.find((card) => card.cardId === cardId && card.instanceId.includes(':dev:'))!
    .instanceId
}

function clearHand(
  session: GameBoardSession,
  participantId = session.remoteParticipantId
): void {
  dispatch(session, {
    type: 'dev-clear-zone',
    participantId,
    zone: 'hand'
  })
}

function setMana(session: GameBoardSession, available: number): void {
  dispatch(session, {
    type: 'dev-set-mana',
    participantId: session.remoteParticipantId,
    available,
    maximum: available
  })
}

function cardInHand(
  session: GameBoardSession,
  cardId: string,
  instanceId: string
): void {
  const card = session
    .findPlayer(session.getState(), session.remoteParticipantId)
    .hand.find((entry) => entry.instanceId === instanceId)
  expect(card?.cardId).toBe(cardId)
}

function legal(session: GameBoardSession): readonly TurnMatchCommand[] {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}

async function choose(session: GameBoardSession) {
  const commands = legal(session)
  const actions = aiActions(session, commands)
  const request: AiDecisionRequest = {
    matchId: `scenario-${session.getState().revision}`,
    requestId: `scenario-request-${session.getState().revision}`,
    expectedRevision: session.getState().revision,
    phase: 'action',
    allowInspection: false,
    messages: [{ role: 'user', content: '{}' }],
    actionIds: actions.map((action) => action.id)
  }
  const decision = await new LocalAiDecisionApi(session).decide(request)
  if (!('actionId' in decision.choice))
    throw new Error('Scenario expected an action choice.')
  const actionId = decision.choice.actionId
  const selected = actions.find((action) => action.id === actionId)
  if (!selected) throw new Error(`Unknown selected action ${actionId}.`)
  return { command: selected.command, decision, actions }
}

describe('hardware local AI tactical scenarios', () => {
  it('takes a ready minion lethal instead of ending the turn', async () => {
    const session = startAiTurn(0x501, (current) => {
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.remoteParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 1,
        maximum: 1
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('attack-character')
    if (selected.type === 'attack-character')
      expect(selected.defender).toMatchObject({ kind: 'hero' })
  })

  it('uses a lethal direct-damage spell when it wins immediately', async () => {
    const session = startAiTurn(0x502, (current) => {
      addCard(current, 'basic_fireball')
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 4,
        maximum: 4
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.localParticipantId,
        health: 6
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') {
      expect(selected.cardInstanceId).toContain(':dev:')
      expect(selected.targets).toEqual([
        { kind: 'hero', participantId: session.localParticipantId }
      ])
    }
  })

  it('removes a visible lethal threat instead of passing with mana', async () => {
    const session = startAiTurn(0x503, (current) => {
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_core_hound')
      })
      addCard(current, 'basic_assassinate')
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 5,
        maximum: 5
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 9
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') {
      const card = session
        .findPlayer(session.getState(), session.remoteParticipantId)
        .hand.find((entry) => entry.instanceId === selected.cardInstanceId)
      expect(card?.cardId).toBe('basic_assassinate')
    }
  })

  it('trades into a visible attacker when face damage would be lethal', async () => {
    const session = startAiTurn(0x504, (current) => {
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.remoteParticipantId,
        cardId: asCardId('basic_boulderfist_ogre')
      })
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_core_hound')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 9
      })
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 1,
        maximum: 1
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('attack-character')
    if (selected.type === 'attack-character')
      expect(selected.defender).toMatchObject({ kind: 'minion' })
  })

  it('spends available mana on a strong board development play', async () => {
    const session = startAiTurn(0x505, (current) => {
      addCard(current, 'basic_boulderfist_ogre')
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 6,
        maximum: 6
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
  })

  it('uses an available hero power when no better card action exists', async () => {
    const session = startAiTurn(0x506, (current) => {
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 2,
        maximum: 2
      })
      dispatch(current, {
        type: 'dev-set-hero-power',
        participantId: current.remoteParticipantId,
        available: true
      })
      dispatch(current, {
        type: 'dev-clear-zone',
        participantId: current.remoteParticipantId,
        zone: 'hand'
      })
    })
    clearHand(session)
    const selected = (await choose(session)).command
    expect(selected.type).toBe('use-hero-power')
  })

  it('chooses a fair discover candidate after playing the discover card', async () => {
    const session = startAiTurn(0x507, (current) => {
      dispatch(current, {
        type: 'dev-clear-zone',
        participantId: current.remoteParticipantId,
        zone: 'hand'
      })
      addCard(current, 'league_of_explorers_raven_idol')
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 1,
        maximum: 1
      })
    })
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    dispatch(session, {
      type: 'dev-clear-zone',
      participantId: session.remoteParticipantId,
      zone: 'hand'
    })
    addCard(session, 'league_of_explorers_raven_idol')
    dispatch(session, {
      type: 'dev-set-mana',
      participantId: session.remoteParticipantId,
      available: 1,
      maximum: 1
    })
    const first = await choose(session)
    expect(first.command.type).toBe('play-card')
    dispatch(session, first.command)
    expect(session.getState().pendingDiscover?.participantId).toBe(
      session.remoteParticipantId
    )
    const second = await choose(session)
    expect(second.command.type).toBe('choose-discover-card')
    const secondCommand = second.command
    if (secondCommand.type === 'choose-discover-card') {
      expect(
        session
          .getState()
          .pendingDiscover?.candidates.some(
            (card) => card.instanceId === secondCommand.cardInstanceId
          )
      ).toBe(true)
    }
  })

  it('chooses the high-impact branch of a Choose One spell', async () => {
    const session = startAiTurn(0x508, (current) => {
      dispatch(current, {
        type: 'dev-clear-zone',
        participantId: current.remoteParticipantId,
        zone: 'hand'
      })
      addCard(current, 'classic_wrath')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_frostwolf_grunt')
      })
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 2,
        maximum: 2
      })
      dispatch(current, {
        type: 'dev-set-hero-power',
        participantId: current.remoteParticipantId,
        available: false
      })
    })
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    dispatch(session, {
      type: 'dev-clear-zone',
      participantId: session.remoteParticipantId,
      zone: 'hand'
    })
    addCard(session, 'classic_wrath')
    dispatch(session, {
      type: 'dev-set-mana',
      participantId: session.remoteParticipantId,
      available: 2,
      maximum: 2
    })
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') expect(selected.choice).toBe(0)
  })

  it('heals through a visible lethal race when that is the best legal defense', async () => {
    const session = startAiTurn(0x509, (current) => {
      addCard(current, 'basic_healing_touch')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 8
      })
      dispatch(current, {
        type: 'dev-set-mana',
        participantId: current.remoteParticipantId,
        available: 3,
        maximum: 3
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card')
      expect(selected.targets).toEqual([
        { kind: 'hero', participantId: session.remoteParticipantId }
      ])
  })

  it('keeps a playable early curve card while replacing slow mulligan cards', async () => {
    const scenario = createMatchScenario({
      seed: 0x50a,
      cardId: asCardId('basic_mind_control')
    })
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    dispatch(session, {
      type: 'confirm-mulligan',
      participantId: session.localParticipantId,
      replaceInstanceIds: []
    })
    const hand = session.findPlayer(
      session.getState(),
      session.remoteParticipantId
    ).hand
    const response = await new LocalAiDecisionApi(session).decide({
      matchId: 'mulligan-scenario',
      requestId: 'mulligan-scenario-request',
      expectedRevision: session.getState().revision,
      phase: 'mulligan',
      messages: [{ role: 'user', content: '{}' }],
      actionIds: hand.map((card) => card.instanceId)
    })
    expect('replace' in response.choice).toBe(true)
    if ('replace' in response.choice) {
      expect(response.choice.replace.length).toBeGreaterThan(0)
      expect(
        response.choice.replace.every(
          (instanceId) =>
            hand.find((card) => card.instanceId === instanceId)?.cardId !==
            'basic_the_coin'
        )
      ).toBe(true)
    }
  })

  it('does not spend a required lethal turn on a random line', async () => {
    const session = startAiTurn(0x50b, (current) => {
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.remoteParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.localParticipantId,
        health: 6
      })
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('attack-character')
  })

  it('does not treat hidden opponent cards as fair information', () => {
    const scenario = createMatchScenario({ seed: 0x50c })
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    const observation = session.getAiObservation()
    const opponent = observation.players.find((player) => player.role === 'opponent')!
    expect(opponent.hand).toHaveLength(0)
    expect(opponent.handSize).toBeGreaterThan(0)
    expect(
      CARD_CATALOG.get(observation.selfOriginalDeck.cards[0]!.cardId)
    ).toBeDefined()
  })

  it('uses a taunt blocker when the opposing board has visible hero lethal', async () => {
    const session = startAiTurn(0x50d, (current) => {
      clearHand(current)
      addCard(current, 'basic_frostwolf_grunt')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 5
      })
      setMana(current, 2)
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card')
      cardInHand(session, 'basic_frostwolf_grunt', selected.cardInstanceId)
  })

  it('freezes the highest visible attacker instead of passing through lethal', async () => {
    const session = startAiTurn(0x50e, (current) => {
      clearHand(current)
      addCard(current, 'basic_frostbolt')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 5
      })
      setMana(current, 2)
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') {
      cardInHand(session, 'basic_frostbolt', selected.cardInstanceId)
      expect(selected.targets?.[0]).toMatchObject({
        kind: 'minion',
        participantId: session.localParticipantId,
        instanceId: expect.any(String)
      })
    }
  })

  it('clears a wide enemy board with area damage when no friendly board is at risk', async () => {
    const session = startAiTurn(0x50f, (current) => {
      clearHand(current)
      addCard(current, 'basic_hellfire')
      for (let index = 0; index < 3; index += 1) {
        dispatch(current, {
          type: 'dev-summon-minion',
          participantId: current.localParticipantId,
          cardId: asCardId('basic_boulderfist_ogre')
        })
      }
      setMana(current, 4)
    })
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card')
      cardInHand(session, 'basic_hellfire', selected.cardInstanceId)
  })

  it('uses conditional removal only when the condition is actually legal', async () => {
    const session = startAiTurn(0x510, (current) => {
      clearHand(current)
      addCard(current, 'basic_execute')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_core_hound')
      })
      setMana(current, 1)
    })
    clearHand(session)
    addCard(session, 'basic_execute')
    const selected = (await choose(session)).command
    expect(selected.type).not.toBe('play-card')
  })

  it('selects a two-action lethal setup instead of ending with a winning continuation', async () => {
    const session = startAiTurn(0x511, (current) => {
      clearHand(current)
      addCard(current, 'basic_fireball')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.remoteParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.localParticipantId,
        health: 18
      })
      setMana(current, 4)
    })
    const selected = (await choose(session)).command
    expect(['attack-character', 'play-card']).toContain(selected.type)
    expect(selected.type).not.toBe('end-turn')
  })

  it('chooses card draw when the board is empty and the hand has room', async () => {
    const session = startAiTurn(0x512, (current) => {
      clearHand(current)
      addCard(current, 'basic_arcane_intellect')
      setMana(current, 3)
    })
    clearHand(session)
    addCard(session, 'basic_arcane_intellect')
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card')
      cardInHand(session, 'basic_arcane_intellect', selected.cardInstanceId)
  })

  it('does not play a minion into a full board when no other action is useful', async () => {
    const session = startAiTurn(0x513, (current) => {
      clearHand(current)
      addCard(current, 'basic_boulderfist_ogre')
      for (let index = 0; index < 7; index += 1) {
        dispatch(current, {
          type: 'dev-summon-minion',
          participantId: current.remoteParticipantId,
          cardId: asCardId('basic_goldshire_footman')
        })
      }
      dispatch(current, {
        type: 'dev-clear-zone',
        participantId: current.localParticipantId,
        zone: 'board'
      })
      setMana(current, 6)
    })
    const selected = (await choose(session)).command
    if (selected.type === 'play-card')
      expect(selected.cardInstanceId).not.toContain(':dev:')
  })

  it('keeps an all-playable opening hand instead of replacing the curve', async () => {
    const scenario = createMatchScenario({
      seed: 0x514,
      cardId: asCardId('basic_goldshire_footman')
    })
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    dispatch(session, {
      type: 'confirm-mulligan',
      participantId: session.localParticipantId,
      replaceInstanceIds: []
    })
    const hand = session.findPlayer(
      session.getState(),
      session.remoteParticipantId
    ).hand
    const response = await new LocalAiDecisionApi(session).decide({
      matchId: 'all-playable-mulligan',
      requestId: 'all-playable-mulligan-request',
      expectedRevision: session.getState().revision,
      phase: 'mulligan',
      messages: [{ role: 'user', content: '{}' }],
      actionIds: hand.map((card) => card.instanceId)
    })
    expect('replace' in response.choice).toBe(true)
    if ('replace' in response.choice) expect(response.choice.replace).toEqual([])
  })

  it('targets a threatening minion with direct damage when the enemy hero is safe', async () => {
    const session = startAiTurn(0x515, (current) => {
      clearHand(current)
      addCard(current, 'basic_fireball')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_core_hound')
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 5
      })
      dispatch(current, {
        type: 'dev-set-hero-power',
        participantId: current.remoteParticipantId,
        available: false
      })
      setMana(current, 4)
    })
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') {
      cardInHand(session, 'basic_fireball', selected.cardInstanceId)
      expect(selected.targets?.[0]).toMatchObject({
        kind: 'minion',
        participantId: session.localParticipantId
      })
    }
  })

  it('removes the highest-value visible target instead of a cheap minion', async () => {
    const session = startAiTurn(0x516, (current) => {
      clearHand(current)
      addCard(current, 'basic_assassinate')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_boulderfist_ogre')
      })
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_goldshire_footman')
      })
      setMana(current, 5)
    })
    const highValue = session
      .findPlayer(session.getState(), session.localParticipantId)
      .board.find((card) => card.cardId === 'basic_boulderfist_ogre')!
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') {
      cardInHand(session, 'basic_assassinate', selected.cardInstanceId)
      expect(selected.targets).toContainEqual({
        kind: 'minion',
        participantId: session.localParticipantId,
        instanceId: highValue.instanceId
      })
    }
  })

  it('uses a targeted Mage hero power for lethal face damage', async () => {
    const session = startAiTurn(
      0x517,
      (current) => {
        clearHand(current)
        dispatch(current, {
          type: 'dev-set-hero-power',
          participantId: current.remoteParticipantId,
          available: true
        })
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.localParticipantId,
          health: 1
        })
        setMana(current, 2)
      },
      { secondHeroId: 'jaina' }
    )
    clearHand(session)
    const selected = (await choose(session)).command
    expect(selected.type).toBe('use-hero-power')
    if (selected.type === 'use-hero-power')
      expect(selected.target).toMatchObject({
        kind: 'hero',
        participantId: session.localParticipantId
      })
  })

  it('uses a targeted Mage hero power to remove a one-health minion', async () => {
    const session = startAiTurn(
      0x518,
      (current) => {
        clearHand(current)
        dispatch(current, {
          type: 'dev-set-hero-power',
          participantId: current.remoteParticipantId,
          available: true
        })
        dispatch(current, {
          type: 'dev-summon-minion',
          participantId: current.localParticipantId,
          cardId: asCardId('basic_murloc_scout')
        })
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.localParticipantId,
          health: 30
        })
        setMana(current, 2)
      },
      { secondHeroId: 'jaina' }
    )
    clearHand(session)
    const selected = (await choose(session)).command
    expect(selected.type).toBe('use-hero-power')
    if (selected.type === 'use-hero-power')
      expect(selected.target).toMatchObject({
        kind: 'minion',
        participantId: session.localParticipantId
      })
  })

  it('does not point Priest healing at an opposing minion', async () => {
    const session = startAiTurn(
      0x51a,
      (current) => {
        clearHand(current)
        dispatch(current, {
          type: 'dev-summon-minion',
          participantId: current.localParticipantId,
          cardId: asCardId('naxxramas_webspinner')
        })
      },
      { firstHeroId: 'jaina', secondHeroId: 'anduin' }
    )
    clearHand(session)
    setMana(session, 8)
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: true
    })

    const selected = (await choose(session)).command
    if (selected.type === 'use-hero-power')
      expect(selected.target?.participantId).toBe(session.remoteParticipantId)
    else expect(selected.type).toBe('end-turn')
  })

  it('ends the turn after repeated invalid AI responses instead of looping', async () => {
    const session = startAiTurn(
      0x51b,
      (current) => {
        clearHand(current)
        dispatch(current, {
          type: 'dev-summon-minion',
          participantId: current.localParticipantId,
          cardId: asCardId('naxxramas_webspinner')
        })
      },
      { firstHeroId: 'jaina', secondHeroId: 'anduin' }
    )
    clearHand(session)
    setMana(session, 8)
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: true
    })
    const badAction = aiActions(session, legal(session)).find(
      (action) =>
        action.command.type === 'use-hero-power' &&
        action.command.target?.kind === 'minion' &&
        action.command.target.participantId === session.localParticipantId
    )
    expect(badAction).toBeDefined()
    if (!badAction) throw new Error('Expected an opposing healing target.')
    const badIntent = aiActionIntent(badAction.command, session.localParticipantId)
    let requestCount = 0
    const api: AiDecisionApi = {
      settings: async () => ({
        enabled: true,
        provider: 'none',
        modelId: 'recovery-test',
        reasoningEffort: 'none',
        maxCompletionTokens: 1000
      }),
      cancel: async () => {},
      decide: async (request): Promise<AiDecisionResponse> => {
        requestCount += 1
        const choice =
          request.phase === 'plan'
            ? {
                plan: {
                  objective: 'Test invalid target recovery.',
                  winCheck: 'The controller must validate the target.',
                  lossRisk: 'Do not heal the opponent.',
                  candidates: [
                    {
                      sequence: ['Use the Priest hero power.'],
                      budget: '2 mana.',
                      endPosition: 'The current board remains visible.',
                      opponentReply: 'The opponent receives no healing.'
                    }
                  ],
                  preferred: 0,
                  firstActionId: badAction.id,
                  checks: []
                }
              }
            : {
                actionId: badAction.id,
                intent: badIntent,
                expectedResult: 'The opposing minion is healed.',
                planUpdate: null
              }
        return {
          matchId: request.matchId,
          requestId: request.requestId,
          expectedRevision: request.expectedRevision,
          modelId: 'recovery-test',
          durationMs: 0,
          finishReason: 'stop',
          reason: 'Repeat the invalid target.',
          choice
        }
      }
    }
    const abandoned = vi.fn()
    const controller = new AiTurnController({
      api,
      session,
      onAbandoned: abandoned,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })
    try {
      const decision = await controller.chooseTurnAction()
      expect(decision?.source).toBe('safe-fallback')
      expect(decision?.command.type).toBe('end-turn')
      expect(requestCount).toBeLessThanOrEqual(6)
      expect(abandoned).not.toHaveBeenCalled()
      const result = session.match.dispatch(decision!.command)
      expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    } finally {
      controller.dispose()
    }
  })

  it('uses a deterministic current legal action when Hardware Expert exhausts its budget', async () => {
    const session = startAiTurn(
      0x51c,
      (current) => {
        clearHand(current)
        setMana(current, 2)
        dispatch(current, {
          type: 'dev-set-hero-power',
          participantId: current.remoteParticipantId,
          available: true
        })
      },
      { firstHeroId: 'jaina', secondHeroId: 'garrosh' }
    )
    expect(
      legal(session).filter((command) => command.type === 'end-turn')
    ).toHaveLength(1)
    expect(legal(session).length).toBeGreaterThan(1)

    const api: AiDecisionApi = {
      settings: async () => ({
        enabled: true,
        provider: 'none',
        modelId: 'hardware-local-v2',
        reasoningEffort: 'none',
        maxCompletionTokens: 1
      }),
      cancel: async () => {},
      decide: async () => {
        throw new AiRequestError('Expert turn budget exhausted.', {
          failureKind: 'timeout',
          budgetMs: 10_000
        })
      }
    }
    const controller = new AiTurnController({
      api,
      session,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })

    try {
      const decision = await controller.chooseTurnAction()
      expect(decision?.source).toBe('safe-fallback')
      expect(decision?.command.type).not.toBe('end-turn')
      expect(legal(session)).toContainEqual(decision?.command)
      dispatch(session, decision!.command)
    } finally {
      controller.dispose()
    }
  })

  it('buffs a friendly minion when the buff creates the strongest current board', async () => {
    const session = startAiTurn(0x519, (current) => {
      clearHand(current)
      addCard(current, 'basic_mark_of_the_wild')
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.remoteParticipantId,
        cardId: asCardId('basic_boulderfist_ogre')
      })
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('basic_senjin_shieldmasta')
      })
      dispatch(current, {
        type: 'dev-set-hero-power',
        participantId: current.remoteParticipantId,
        available: false
      })
      setMana(current, 2)
    })
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card') {
      cardInHand(session, 'basic_mark_of_the_wild', selected.cardInstanceId)
      expect(selected.targets?.[0]).toMatchObject({
        kind: 'minion',
        participantId: session.remoteParticipantId
      })
    }
  })

  it('does not draw into fatigue when the deck is empty and no pressure requires it', async () => {
    const session = startAiTurn(0x51a, (current) => {
      clearHand(current)
      addCard(current, 'basic_arcane_intellect')
      dispatch(current, {
        type: 'dev-modify-deck',
        participantId: current.remoteParticipantId,
        action: 'destroy'
      })
      dispatch(current, {
        type: 'dev-set-hero',
        participantId: current.remoteParticipantId,
        health: 30
      })
      setMana(current, 3)
    })
    const selected = (await choose(session)).command
    expect(selected.type).not.toBe('play-card')
  })

  it('ends the turn when no legal action has positive value', async () => {
    const session = startAiTurn(0x51b, (current) => {
      clearHand(current)
      dispatch(current, {
        type: 'dev-set-hero-power',
        participantId: current.remoteParticipantId,
        available: false
      })
      setMana(current, 0)
    })
    const selected = (await choose(session)).command
    expect(selected.type).toBe('end-turn')
  })

  it('respects a ready enemy weapon as visible lethal pressure', async () => {
    const session = startAiTurn(
      0x51c,
      (current) => {
        dispatch(current, {
          type: 'dev-set-hero-power',
          participantId: current.localParticipantId,
          available: true
        })
        dispatch(current, {
          type: 'dev-set-mana',
          participantId: current.localParticipantId,
          available: 2,
          maximum: 2
        })
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.localParticipantId,
          health: 1
        })
        dispatch(current, {
          type: 'use-hero-power',
          participantId: current.localParticipantId
        })
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.remoteParticipantId,
          health: 1
        })
        dispatch(current, {
          type: 'dev-set-hero-power',
          participantId: current.remoteParticipantId,
          available: false
        })
        setMana(current, 2)
      },
      { firstHeroId: 'valeera' }
    )
    clearHand(session)
    addCard(session, 'basic_frostwolf_grunt')
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    setMana(session, 2)
    const selected = (await choose(session)).command
    expect(selected.type).toBe('play-card')
    if (selected.type === 'play-card')
      cardInHand(session, 'basic_frostwolf_grunt', selected.cardInstanceId)
  })

  it('allows a damage spell that restores only its own hero', async () => {
    const session = startAiTurn(0x51d, (current) => {
      dispatch(current, {
        type: 'dev-summon-minion',
        participantId: current.localParticipantId,
        cardId: asCardId('whispers_of_the_old_gods_the_ancient_one')
      })
    })
    clearHand(session)
    addCard(session, 'classic_holy_fire')
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: session.remoteParticipantId,
      available: false
    })
    setMana(session, 6)

    const api = new LocalAiDecisionApi(session)
    const controller = new AiTurnController({
      api,
      session,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    })
    try {
      const decision = await controller.chooseTurnAction()
      expect(decision).not.toBeNull()
      expect(decision?.source).toBe('model')
      expect(decision?.command.type).toBe('play-card')
      if (decision?.command.type === 'play-card')
        cardInHand(session, 'classic_holy_fire', decision.command.cardInstanceId)
    } finally {
      controller.dispose()
    }
  })
})
