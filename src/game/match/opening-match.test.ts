import { describe, expect, it } from 'vitest'
import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { asPlayerId, type MatchSetup, type PlayerId } from './match-types'
import {
  createOpeningMatch,
  type OpeningAcceptedResult,
  type OpeningCommandResult,
  type OpeningMatchInstance
} from './opening-match'

const HUMAN_ID = asPlayerId('human-player')
const OPPONENT_ID = asPlayerId('opponent-player')

function accept(result: OpeningCommandResult): OpeningAcceptedResult {
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
  if (!result.accepted) throw new Error(result.message)
  return result
}

function deck(id: string, heroId: string): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: { basic_acidic_swamp_ooze: 30 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function startMatch(heroId: string, opponentHeroId = 'jaina'): OpeningMatchInstance {
  const setup: MatchSetup = {
    seed: 1,
    participants: [
      {
        participantId: HUMAN_ID,
        controllerKind: 'human',
        heroId: asHeroId(heroId),
        deckId: 'human-deck'
      },
      {
        participantId: OPPONENT_ID,
        controllerKind: 'ai',
        heroId: asHeroId(opponentHeroId),
        deckId: 'opponent-deck'
      }
    ]
  }
  const match = createOpeningMatch(
    setup,
    [deck('human-deck', heroId), deck('opponent-deck', opponentHeroId)],
    { next: () => 0.1 }
  )
  accept(
    match.dispatch({
      type: 'confirm-mulligan',
      participantId: HUMAN_ID,
      replaceInstanceIds: []
    })
  )
  accept(
    match.dispatch({
      type: 'confirm-mulligan',
      participantId: OPPONENT_ID,
      replaceInstanceIds: []
    })
  )
  setMana(match, HUMAN_ID)
  return match
}

function setMana(match: OpeningMatchInstance, participantId: PlayerId): void {
  accept(
    match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    })
  )
}

function usePower(match: OpeningMatchInstance, target?: object): OpeningAcceptedResult {
  return accept(
    match.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID,
      ...(target ? { target } : {})
    })
  )
}

function cycleBackToHuman(match: OpeningMatchInstance): void {
  accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
  accept(match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID }))
  setMana(match, HUMAN_ID)
}

describe('classic hero powers', () => {
  it('Shapeshift grants temporary Attack and persistent Armor', () => {
    const match = startMatch('malfurion')
    usePower(match)
    let human = match.getState().players[0]
    expect(human.hero).toMatchObject({ attack: 1, armor: 1 })

    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    human = match.getState().players[0]
    expect(human.hero).toMatchObject({ attack: 0, armor: 1 })
  })

  it('Steady Shot damages the enemy hero', () => {
    const match = startMatch('rexxar')
    const result = usePower(match)
    expect(match.getState().players[1].hero.health).toBe(28)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'character-damaged', amount: 2 })
    )
  })

  it('Fireblast requires a valid target and can destroy a minion', () => {
    const match = startMatch('jaina')
    const missingTarget = match.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID
    })
    expect(missingTarget).toMatchObject({ accepted: false, code: 'invalid-target' })
    expect(match.getState().players[0].mana.available).toBe(10)

    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_silver_hand_recruit'
      })
    )
    const target = match.getState().players[1].board[0]
    expect(target).toBeDefined()
    const result = usePower(match, {
      kind: 'minion',
      participantId: OPPONENT_ID,
      instanceId: target!.instanceId
    })
    expect(match.getState().players[1].board).toHaveLength(0)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'character-damaged', destroyed: true })
    )
  })

  it('Reinforce summons a Recruit and rejects a full board before spending mana', () => {
    const match = startMatch('uther')
    usePower(match)
    expect(match.getState().players[0].board[0]?.cardId).toBe(
      'basic_silver_hand_recruit'
    )

    const fullMatch = startMatch('uther')
    for (let index = 0; index < 7; index += 1) {
      accept(
        fullMatch.dispatch({
          type: 'dev-summon-minion',
          participantId: HUMAN_ID,
          cardId: 'basic_silver_hand_recruit'
        })
      )
    }
    const rejected = fullMatch.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID
    })
    expect(rejected).toMatchObject({ accepted: false, code: 'board-full' })
    expect(fullMatch.getState().players[0].mana.available).toBe(10)
    expect(fullMatch.getState().players[0].heroPower.available).toBe(true)
  })

  it('Lesser Heal targets either side and caps Health at maximum', () => {
    const match = startMatch('anduin')
    const result = usePower(match, { kind: 'hero', participantId: OPPONENT_ID })
    expect(match.getState().players[1].hero.health).toBe(30)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'character-healed', amount: 0 })
    )
  })

  it('Dagger Mastery equips a 1/2 Wicked Knife and replaces the old weapon', () => {
    const match = startMatch('valeera')
    usePower(match)
    const firstWeapon = match.getState().players[0].weapon
    expect(firstWeapon).toMatchObject({
      cardId: 'basic_wicked_knife',
      attack: 1,
      durability: 2
    })
    cycleBackToHuman(match)
    const result = usePower(match)
    expect(match.getState().players[0].weapon?.instanceId).not.toBe(
      firstWeapon?.instanceId
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'weapon-equipped',
        replacedWeapon: expect.objectContaining({ cardId: 'basic_wicked_knife' })
      })
    )
  })

  it('Totemic Call deterministically summons each missing basic Totem once', () => {
    const match = startMatch('thrall')
    for (let use = 0; use < 4; use += 1) {
      usePower(match)
      if (use < 3) cycleBackToHuman(match)
    }
    const totems = match.getState().players[0].board.map((minion) => minion.cardId)
    expect(new Set(totems).size).toBe(4)

    cycleBackToHuman(match)
    const rejected = match.dispatch({
      type: 'use-hero-power',
      participantId: HUMAN_ID
    })
    expect(rejected).toMatchObject({
      accepted: false,
      code: 'hero-power-unavailable'
    })
  })

  it('Life Tap draws and damages its owner', () => {
    const match = startMatch('guldan')
    const before = match.getState().players[0]
    usePower(match)
    const after = match.getState().players[0]
    expect(after.hand).toHaveLength(before.hand.length + 1)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(after.hero.health).toBe(28)
  })

  it('Life Tap burns its draw when the hand is full', () => {
    const match = startMatch('guldan')
    while (match.getState().players[0].hand.length < 10) {
      accept(
        match.dispatch({
          type: 'dev-add-card',
          participantId: HUMAN_ID,
          cardId: 'basic_acidic_swamp_ooze'
        })
      )
    }
    const before = match.getState().players[0]
    const result = usePower(match)
    const after = match.getState().players[0]
    expect(after.hand).toHaveLength(10)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'card-burned' })
    )
  })

  it('Life Tap and turn draws share escalating fatigue', () => {
    const match = startMatch('guldan')
    for (let cycle = 0; cycle < 26; cycle += 1) cycleBackToHuman(match)
    expect(match.getState().players[0].deck).toHaveLength(0)

    const result = usePower(match)
    const human = match.getState().players[0]
    expect(human.fatigueDamage).toBe(2)
    expect(human.hero.health).toBe(27)
    expect(result.events.map((event) => event.type)).toEqual([
      'hero-power-used',
      'fatigue',
      'character-damaged',
      'character-damaged'
    ])
    cycleBackToHuman(match)
    expect(match.getState().players[0]).toMatchObject({
      fatigueDamage: 3,
      hero: { health: 25 }
    })
  })

  it('Armor Up accumulates Armor that absorbs combat damage first', () => {
    const match = startMatch('garrosh')
    usePower(match)
    cycleBackToHuman(match)
    usePower(match)
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    const attacker = match.getState().players[1].board[0]
    expect(attacker).toBeDefined()
    accept(
      match.dispatch({
        type: 'attack-character',
        participantId: OPPONENT_ID,
        attacker: { kind: 'minion', instanceId: attacker!.instanceId },
        defender: { kind: 'hero' }
      })
    )
    expect(match.getState().players[0].hero).toMatchObject({ health: 30, armor: 1 })
  })
})

describe('Hero cards', () => {
  it('Jaraxxus preserves Health, gains Armor, replaces the hero power, and equips Blood Fury', () => {
    const match = startMatch('guldan')
    usePower(match)
    cycleBackToHuman(match)
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'classic_lord_jaraxxus'
      })
    )
    const jaraxxus = match
      .getState()
      .players[0].hand.find((card) => card.cardId === 'classic_lord_jaraxxus')
    expect(jaraxxus).toBeDefined()

    const result = accept(
      match.dispatch({
        type: 'play-hero',
        participantId: HUMAN_ID,
        cardInstanceId: jaraxxus!.instanceId
      })
    )
    const player = match.getState().players[0]
    expect(player.heroId).toBe('jaraxxus')
    expect(player.hero).toMatchObject({ health: 28, maxHealth: 30, armor: 5 })
    expect(player.heroPower).toMatchObject({ id: 'jaraxxus-inferno', available: true })
    expect(player.weapon).toMatchObject({
      cardId: 'classic_blood_fury',
      attack: 3,
      durability: 8
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'hero-replaced', armorGained: 5 })
    )
  })
})
