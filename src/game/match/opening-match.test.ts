import { describe, expect, it } from 'vitest'
import { selectAiHeroPowerBonus } from './ai-bonuses'
import { createMatchScenario } from './testing/match-scenario-builder'
import { createSeededRng } from './rng'
import { CARD_CATALOG, asCardId, asHeroId } from '../content/cards'
import { HERO_POWER_CATALOG } from '../content/hero-powers'
import type { Deck } from '../decks'
import { asPlayerId, type MatchSetup, type PlayerId } from './match-types'
import {
  getOpeningMatchPublicEvents,
  createOpeningMatch,
  createOpeningMatchFromCheckpoint,
  type OpeningAcceptedResult,
  type OpeningCommandResult,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type HistoryActionResolvedEvent
} from './opening-match'

const HUMAN_ID = asPlayerId('human-player')
const OPPONENT_ID = asPlayerId('opponent-player')

describe('opening Quests', () => {
  it.each([
    ['journey_to_ungoro_the_marsh_queen', 'basic_stonetusk_boar', 'rexxar'],
    ['journey_to_ungoro_the_caverns_below', 'basic_acidic_swamp_ooze', 'valeera']
  ])(
    "%s ignores draws and counts only its owner's plays",
    (questId, minionId, heroId) => {
      const scenario = createMatchScenario({
        cardId: questId,
        firstHeroId: heroId,
        secondHeroId: heroId,
        secondController: 'human'
      })
      scenario.confirmBothMulligans()
      const [firstId, secondId] = scenario.participants
      const checkpoint = scenario.match.getCheckpoint()
      const definition = CARD_CATALOG.require(minionId)
      const state = {
        ...checkpoint.state,
        players: checkpoint.state.players.map((player) =>
          player.participantId === secondId
            ? {
                ...player,
                deck: [
                  {
                    ...player.deck[0]!,
                    cardId: definition.id,
                    baseCost: definition.cost,
                    currentCost: definition.cost
                  },
                  ...player.deck.slice(1)
                ]
              }
            : player
        ) as unknown as typeof checkpoint.state.players
      }
      const match = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
      const progress = (participantId: PlayerId) =>
        match
          .getState()
          .players.find((player) => player.participantId === participantId)!.quest!
          .progress

      accept(match.dispatch({ type: 'end-turn', participantId: firstId }))
      expect(progress(firstId)).toBe(0)
      expect(progress(secondId)).toBe(0)

      accept(
        match.dispatch({
          type: 'dev-set-mana',
          participantId: secondId,
          available: 10,
          maximum: 10
        })
      )
      const card = match
        .getState()
        .players.find((player) => player.participantId === secondId)!
        .hand.findLast((entry) => entry.cardId === minionId)!
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: secondId,
          cardInstanceId: card.instanceId,
          position: 0
        })
      )
      expect(progress(firstId)).toBe(0)
      expect(progress(secondId)).toBe(1)
    }
  )

  it.each(['classic_counterspell', 'classic_spellbender'])(
    'does not advance the Paladin Quest when %s prevents the friendly spell',
    (secretId) => {
      const scenario = createMatchScenario({
        cardId: 'journey_to_ungoro_the_last_kaleidosaur',
        firstHeroId: 'uther',
        secondHeroId: 'jaina',
        secondController: 'human'
      })
      scenario.confirmBothMulligans()
      const [firstId, secondId] = scenario.participants
      const match = scenario.match
      accept(match.dispatch({ type: 'end-turn', participantId: firstId }))
      accept(
        match.dispatch({
          type: 'dev-add-card',
          participantId: secondId,
          cardId: secretId
        })
      )
      accept(
        match.dispatch({
          type: 'dev-set-mana',
          participantId: secondId,
          available: 10,
          maximum: 10
        })
      )
      const secret = match
        .getState()
        .players.find((player) => player.participantId === secondId)!
        .hand.findLast((card) => card.cardId === secretId)!
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: secondId,
          cardInstanceId: secret.instanceId
        })
      )
      accept(match.dispatch({ type: 'end-turn', participantId: secondId }))
      accept(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: firstId,
          cardId: 'basic_acidic_swamp_ooze'
        })
      )
      accept(
        match.dispatch({
          type: 'dev-add-card',
          participantId: firstId,
          cardId: 'basic_mark_of_the_wild'
        })
      )
      accept(
        match.dispatch({
          type: 'dev-set-mana',
          participantId: firstId,
          available: 10,
          maximum: 10
        })
      )
      const player = match
        .getState()
        .players.find((entry) => entry.participantId === firstId)!
      const spell = player.hand.findLast(
        (card) => card.cardId === 'basic_mark_of_the_wild'
      )!
      const minion = player.board[0]!
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: firstId,
          cardInstanceId: spell.instanceId,
          targets: [
            { kind: 'minion', participantId: firstId, instanceId: minion.instanceId }
          ]
        })
      )
      expect(
        match.getState().players.find((entry) => entry.participantId === firstId)!.quest
          ?.progress
      ).toBe(0)
    }
  )

  it('counts only the Taunt minions played by the Quest owner', () => {
    const questId = 'journey_to_ungoro_fire_plumes_heart'
    const tauntId = asCardId('basic_senjin_shieldmasta')
    const scenario = createMatchScenario({
      cardId: questId,
      firstHeroId: 'garrosh',
      secondHeroId: 'garrosh',
      secondController: 'human'
    })
    scenario.confirmBothMulligans()
    const [firstId, secondId] = scenario.participants
    const checkpoint = scenario.match.getCheckpoint()
    const state = {
      ...checkpoint.state,
      players: checkpoint.state.players.map((player) =>
        player.participantId === secondId
          ? {
              ...player,
              deck: [
                {
                  ...player.deck[0]!,
                  cardId: tauntId,
                  baseCost: 4,
                  currentCost: 4
                },
                ...player.deck.slice(1)
              ]
            }
          : player
      ) as unknown as typeof checkpoint.state.players
    }
    const match = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
    const questProgress = (participantId: typeof firstId) =>
      match.getState().players.find((player) => player.participantId === participantId)!
        .quest!.progress

    accept(match.dispatch({ type: 'end-turn', participantId: firstId }))
    expect(questProgress(firstId)).toBe(0)
    expect(questProgress(secondId)).toBe(0)

    accept(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: secondId,
        available: 10,
        maximum: 10
      })
    )
    const taunt = match
      .getState()
      .players.find((player) => player.participantId === secondId)!
      .hand.find((card) => card.cardId === tauntId)!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: secondId,
        cardInstanceId: taunt.instanceId,
        position: 0
      })
    )
    expect(questProgress(firstId)).toBe(0)
    expect(questProgress(secondId)).toBe(1)
  })

  it('starts outside the drawable deck, is public, and awards the reward after progress', () => {
    const questId = 'journey_to_ungoro_fire_plumes_heart'
    const scenario = createMatchScenario({
      cardId: questId,
      firstHeroId: 'garrosh',
      secondHeroId: 'garrosh'
    })
    const initial = scenario.match.getState()
    expect(initial.openingHistory).toBeUndefined()
    for (const player of initial.players) {
      expect(player.quest).toMatchObject({ cardId: questId, progress: 0, target: 7 })
      expect(
        [...player.deck, ...player.hand].some((card) => card.cardId === questId)
      ).toBe(false)
    }
    expect(initial.players[0].deck.length + initial.players[0].hand.length).toBe(29)
    const publicState = scenario.match.getPublicState!(scenario.participants[0])
    expect(publicState.players[1].quest?.cardId).toBe(questId)
    expect(publicState.players[1]).not.toHaveProperty('originalDeckCardIds')
    expect(publicState.players[1].deck[0]).not.toHaveProperty('startedInDeck')
    scenario.confirmBothMulligans()
    const revealed = scenario.match.getState()
    expect(revealed.openingHistory).toEqual(
      revealed.players.map((player) =>
        expect.objectContaining({
          entryId: `${player.participantId}:quest-opening`,
          action: 'trigger',
          source: expect.objectContaining({ cardId: questId }),
          outcomes: []
        })
      )
    )
    expect(revealed.players.every((player) => player.quest?.progress === 0)).toBe(true)
    const checkpoint = scenario.match.getCheckpoint()
    const activeId = checkpoint.state.activePlayerId!
    const state = {
      ...checkpoint.state,
      players: checkpoint.state.players.map((player) =>
        player.participantId === activeId
          ? { ...player, quest: { ...player.quest!, progress: 6 } }
          : player
      ) as unknown as typeof checkpoint.state.players
    }
    const match = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: activeId,
        cardId: 'basic_senjin_shieldmasta'
      })
    )
    accept(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: activeId,
        available: 10,
        maximum: 10
      })
    )
    const card = match
      .getState()
      .players.find((player) => player.participantId === activeId)!
      .hand.findLast((entry) => entry.cardId === 'basic_senjin_shieldmasta')!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId,
        position: 0
      })
    )
    const after = match
      .getState()
      .players.find((player) => player.participantId === activeId)!
    expect(after.quest).toBeNull()
    expect(
      after.hand.some((entry) => entry.cardId === 'journey_to_ungoro_sulfuras')
    ).toBe(true)
  })

  const completions = [
    ['journey_to_ungoro_jungle_giants', 'basic_boulderfist_ogre', 'malfurion'],
    ['journey_to_ungoro_the_marsh_queen', 'basic_stonetusk_boar', 'rexxar'],
    ['journey_to_ungoro_open_the_waygate', 'basic_the_coin', 'jaina'],
    ['journey_to_ungoro_the_last_kaleidosaur', 'basic_mark_of_the_wild', 'uther'],
    ['journey_to_ungoro_awaken_the_makers', 'classic_leper_gnome', 'anduin'],
    ['journey_to_ungoro_the_caverns_below', 'basic_acidic_swamp_ooze', 'valeera'],
    ['journey_to_ungoro_lakkari_sacrifice', 'basic_soulfire', 'guldan']
  ] as const
  for (const [questId, playedId, heroId] of completions) {
    it(`finishes ${questId} on its qualifying event`, () => {
      const scenario = createMatchScenario({
        cardId: questId,
        firstHeroId: heroId,
        secondHeroId: heroId
      })
      scenario.confirmBothMulligans()
      const checkpoint = scenario.match.getCheckpoint()
      const activeId = checkpoint.state.activePlayerId!
      const opponentId = scenario.participants.find((id) => id !== activeId)!
      const state = {
        ...checkpoint.state,
        players: checkpoint.state.players.map((player) =>
          player.participantId === activeId
            ? {
                ...player,
                quest: {
                  ...player.quest!,
                  progress: player.quest!.target - 1,
                  ...(questId.endsWith('the_caverns_below')
                    ? { playedNames: { 'Acidic Swamp Ooze': 3 } }
                    : {})
                }
              }
            : player
        ) as unknown as typeof checkpoint.state.players
      }
      const match = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
      let targets:
        | readonly {
            kind: 'minion' | 'hero'
            participantId: PlayerId
            instanceId?: string
          }[]
        | undefined
      if (questId.endsWith('the_last_kaleidosaur')) {
        accept(
          match.dispatch({
            type: 'dev-summon-minion',
            participantId: activeId,
            cardId: 'basic_acidic_swamp_ooze'
          })
        )
        const minion = match
          .getState()
          .players.find((player) => player.participantId === activeId)!.board[0]!
        targets = [
          { kind: 'minion', participantId: activeId, instanceId: minion.instanceId }
        ]
      }
      if (questId.endsWith('lakkari_sacrifice'))
        targets = [{ kind: 'hero', participantId: opponentId }]
      accept(
        match.dispatch({
          type: 'dev-add-card',
          participantId: activeId,
          cardId: playedId
        })
      )
      accept(
        match.dispatch({
          type: 'dev-set-mana',
          participantId: activeId,
          available: 10,
          maximum: 10
        })
      )
      const card = match
        .getState()
        .players.find((player) => player.participantId === activeId)!
        .hand.findLast((entry) => entry.cardId === playedId)!
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: activeId,
          cardInstanceId: card.instanceId,
          ...(CARD_CATALOG.require(playedId).type === 'Minion' ? { position: 0 } : {}),
          ...(targets ? { targets } : {})
        })
      )
      const after = match
        .getState()
        .players.find((player) => player.participantId === activeId)!
      expect(after.quest).toBeNull()
      const rewardId = state.players.find(
        (player) => player.participantId === activeId
      )!.quest!.rewardCardId
      expect(after.hand.some((entry) => entry.cardId === rewardId)).toBe(true)
    })
  }
})

describe("Un'Goro and Frozen Throne rewards", () => {
  function readyCard(cardId: string) {
    const scenario = createMatchScenario({
      firstController: 'human',
      secondController: 'human'
    })
    scenario.confirmBothMulligans()
    const match = scenario.match
    const activeId = match.getState().activePlayerId!
    accept(match.dispatch({ type: 'dev-add-card', participantId: activeId, cardId }))
    accept(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: activeId,
        available: 10,
        maximum: 10
      })
    )
    const card = match
      .getState()
      .players.find((player) => player.participantId === activeId)!
      .hand.findLast((entry) => entry.cardId === cardId)!
    return { match, scenario, activeId, card }
  }

  it("refills only the caster's original deck when Time Warp is cast", () => {
    const { match, activeId, card } = readyCard('journey_to_ungoro_time_warp')
    expect(CARD_CATALOG.require(card.cardId).rulesText).toBe('Refill your deck.')
    const opponentId = match
      .getState()
      .players.find((player) => player.participantId !== activeId)!.participantId
    const opponentDeckBefore = match
      .getState()
      .players.find((player) => player.participantId === opponentId)!.deck
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId
      })
    )
    expect(
      match.getState().players.find((player) => player.participantId === activeId)!.deck
        .length
    ).toBe(30)
    expect(
      match.getState().players.find((player) => player.participantId === opponentId)!
        .deck
    ).toEqual(opponentDeckBefore)
  })

  it('shuffles twenty Beasts from the full catalog for Queen Carnassa', () => {
    const { match, activeId, card } = readyCard('journey_to_ungoro_queen_carnassa')
    const before = match
      .getState()
      .players.find((player) => player.participantId === activeId)!.deck.length
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId,
        position: 0
      })
    )
    const deck = match
      .getState()
      .players.find((player) => player.participantId === activeId)!.deck
    expect(deck).toHaveLength(before + 20)
    expect(
      deck
        .filter((entry) => !entry.startedInDeck)
        .every((entry) => CARD_CATALOG.require(entry.cardId).subtype === 'Beast')
    ).toBe(true)
  })

  it('steals one actual card entity from the opponent deck with Death Grip', () => {
    const { match, scenario, activeId, card } = readyCard(
      'knights_of_the_frozen_throne_death_grip'
    )
    const opponentId = scenario.participants.find((id) => id !== activeId)!
    const before = match
      .getState()
      .players.find((player) => player.participantId === opponentId)!.deck
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId
      })
    )
    const after = match
      .getState()
      .players.find((player) => player.participantId === activeId)!
    expect(
      match.getState().players.find((player) => player.participantId === opponentId)!
        .deck
    ).toHaveLength(before.length - 1)
    expect(
      after.hand.some((entry) =>
        before.some((candidate) => candidate.instanceId === entry.instanceId)
      )
    ).toBe(true)
  })

  it('casts one Invocation only if an Elemental was played last turn', () => {
    const { match, activeId, card } = readyCard('journey_to_ungoro_kalimos_primal_lord')
    const inactive = createOpeningMatchFromCheckpoint(match.getCheckpoint())
    const inactiveResult = accept(
      inactive.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId,
        position: 0
      })
    )
    expect(
      inactiveResult.events.some((event) => event.type === 'random-spell-started')
    ).toBe(false)
    const checkpoint = match.getCheckpoint()
    const state = {
      ...checkpoint.state,
      players: checkpoint.state.players.map((player) =>
        player.participantId === activeId
          ? { ...player, elementalPlayedLastTurn: true }
          : player
      ) as unknown as typeof checkpoint.state.players
    }
    const replay = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
    const result = accept(
      replay.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId,
        position: 0
      })
    )
    expect(
      result.events.some(
        (event) =>
          event.type === 'random-spell-started' &&
          event.cardId.startsWith('journey_to_ungoro_invocation_of_')
      )
    ).toBe(true)
  })

  it("replaces Sulfuras owner's Hero Power with DIE, INSECT!", () => {
    const { match, activeId, card } = readyCard('journey_to_ungoro_sulfuras')
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId
      })
    )
    expect(
      match.getState().players.find((player) => player.participantId === activeId)
        ?.heroPower.id
    ).toBe('ragnaros-die-insects')
  })

  it('uses only collectible Demons when Nether Portal replaces the deck', () => {
    const { match, activeId, card } = readyCard('journey_to_ungoro_nether_portal')
    const before = match
      .getState()
      .players.find((player) => player.participantId === activeId)!.deck.length
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId
      })
    )
    const deck = match
      .getState()
      .players.find((player) => player.participantId === activeId)!.deck
    expect(deck).toHaveLength(before)
    expect(
      deck.every((entry) => CARD_CATALOG.require(entry.cardId).subtype === 'Demon')
    ).toBe(true)
    expect(
      deck.every((entry) => CARD_CATALOG.require(entry.cardId).collectible)
    ).toBe(true)
    expect(
      deck.every((entry) => entry.attack !== undefined && entry.health !== undefined)
    ).toBe(true)
  })

  it('offers five successive Adapt selections for Galvadon', () => {
    const { match, activeId, card } = readyCard('journey_to_ungoro_galvadon')
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId,
        position: 0
      })
    )
    for (let index = 0; index < 5; index += 1) {
      const choice = match.getState().pendingCardChoice!
      expect(choice.resolution).toMatchObject({ type: 'adapt', remaining: 5 - index })
      expect(choice.options).toHaveLength(3)
      accept(
        match.dispatch({
          type: 'choose-card-option',
          participantId: activeId,
          sourceCardInstanceId: choice.sourceCardInstanceId,
          choice: 0
        })
      )
    }
    expect(match.getState().pendingCardChoice).toBeUndefined()
  })

  it('grants a real Poisonous combat effect through Poison Spit', () => {
    const { match, scenario, activeId, card } = readyCard(
      'journey_to_ungoro_poison_spit'
    )
    const opponentId = scenario.participants.find((id) => id !== activeId)!
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: activeId,
        cardId: 'basic_stonetusk_boar'
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_boulderfist_ogre'
      })
    )
    const attacker = match
      .getState()
      .players.find((player) => player.participantId === activeId)!.board[0]!
    const defender = match
      .getState()
      .players.find((player) => player.participantId === opponentId)!.board[0]!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId,
        targets: [
          { kind: 'minion', participantId: activeId, instanceId: attacker.instanceId }
        ]
      })
    )
    accept(
      match.dispatch({
        type: 'attack-character',
        participantId: activeId,
        attacker: { kind: 'minion', instanceId: attacker.instanceId },
        defender: { kind: 'minion', instanceId: defender.instanceId }
      })
    )
    expect(
      match.getState().players.find((player) => player.participantId === opponentId)
        ?.board
    ).toHaveLength(0)
  })

  it('lets Shadowmourne damage both adjacent minions in one attack', () => {
    const { match, scenario, activeId, card } = readyCard(
      'knights_of_the_frozen_throne_scourgelord_garrosh'
    )
    const opponentId = scenario.participants.find((id) => id !== activeId)!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId
      })
    )
    expect(
      match.getState().players.find((player) => player.participantId === activeId)
        ?.weapon
    ).toMatchObject({
      cardId: 'knights_of_the_frozen_throne_shadowmourne',
      attack: 4,
      durability: 3
    })
    for (let index = 0; index < 3; index += 1)
      accept(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId: 'basic_acidic_swamp_ooze'
        })
      )
    const defender = match
      .getState()
      .players.find((player) => player.participantId === opponentId)!.board[1]!
    accept(
      match.dispatch({
        type: 'attack-character',
        participantId: activeId,
        attacker: { kind: 'hero' },
        defender: { kind: 'minion', instanceId: defender.instanceId }
      })
    )
    expect(
      match.getState().players.find((player) => player.participantId === opponentId)
        ?.board
    ).toHaveLength(0)
  })

  it("summons this Frostmourne entity's kills when it breaks", () => {
    const { match, scenario, activeId, card } = readyCard(
      'knights_of_the_frozen_throne_frostmourne'
    )
    const opponentId = scenario.participants.find((id) => id !== activeId)!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: activeId,
        cardInstanceId: card.instanceId
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    const checkpoint = match.getCheckpoint()
    const state = {
      ...checkpoint.state,
      players: checkpoint.state.players.map((player) =>
        player.participantId === activeId
          ? { ...player, weapon: { ...player.weapon!, durability: 1 } }
          : player
      ) as unknown as typeof checkpoint.state.players
    }
    const replay = createOpeningMatchFromCheckpoint({ ...checkpoint, state })
    const defender = replay
      .getState()
      .players.find((player) => player.participantId === opponentId)!.board[0]!
    accept(
      replay.dispatch({
        type: 'attack-character',
        participantId: activeId,
        attacker: { kind: 'hero' },
        defender: { kind: 'minion', instanceId: defender.instanceId }
      })
    )
    const after = replay
      .getState()
      .players.find((player) => player.participantId === activeId)!
    expect(after.weapon).toBeNull()
    expect(after.board.map((minion) => minion.cardId)).toContain(
      'basic_acidic_swamp_ooze'
    )
  })
})

describe('AI startup bonuses', () => {
  function fixedRng(value: number) {
    return {
      next: () => value,
      snapshot: () => 0,
      restore: (_snapshot: unknown) => undefined
    }
  }

  function createAiMatch(
    roll: number,
    aiHeroId = 'jaina',
    humanHeroId = 'jaina'
  ): OpeningMatchInstance {
    const setup: MatchSetup = {
      seed: 1,
      startingParticipantId: HUMAN_ID,
      participants: [
        {
          participantId: HUMAN_ID,
          controllerKind: 'human',
          heroId: asHeroId(humanHeroId),
          deckId: 'human-deck'
        },
        {
          participantId: OPPONENT_ID,
          controllerKind: 'ai',
          heroId: asHeroId(aiHeroId),
          deckId: 'opponent-deck'
        }
      ]
    }
    return createOpeningMatch(
      setup,
      [deck('human-deck', humanHeroId), deck('opponent-deck', aiHeroId)],
      fixedRng(roll)
    )
  }

  it.each([
    [0.1, 'none'],
    [1 / 3, 'upgraded'],
    [0.6, 'upgraded'],
    [2 / 3, 'cost-one'],
    [0.9, 'cost-one']
  ] as const)('maps roll %s to the expected startup bonus', (roll, expected) => {
    const participants: MatchSetup['participants'] = [
      {
        participantId: HUMAN_ID,
        controllerKind: 'human',
        heroId: asHeroId('jaina'),
        deckId: 'human-deck'
      },
      {
        participantId: OPPONENT_ID,
        controllerKind: 'ai',
        heroId: asHeroId('jaina'),
        deckId: 'opponent-deck'
      }
    ]
    expect(selectAiHeroPowerBonus(participants, fixedRng(roll))).toBe(expected)
  })

  it('selects the same bonus for the same match seed', () => {
    const participants: MatchSetup['participants'] = [
      {
        participantId: HUMAN_ID,
        controllerKind: 'human',
        heroId: asHeroId('jaina'),
        deckId: 'human-deck'
      },
      {
        participantId: OPPONENT_ID,
        controllerKind: 'ai',
        heroId: asHeroId('jaina'),
        deckId: 'opponent-deck'
      }
    ]

    expect(selectAiHeroPowerBonus(participants, createSeededRng(42))).toBe(
      selectAiHeroPowerBonus(participants, createSeededRng(42))
    )
  })

  it.each([
    [0.1, 'mage-fireblast', 2, undefined],
    [0.4, 'mage-fireblast-rank-2', 2, undefined],
    [0.7, 'mage-fireblast', 1, 1]
  ] as const)(
    'applies exactly one startup bonus for roll %s',
    (roll, expectedPowerId, expectedCost, expectedOverride) => {
      const match = createAiMatch(roll)
      const ai = match.getState().players.find((p) => p.participantId === OPPONENT_ID)!

      expect(ai.heroPower.id).toBe(expectedPowerId)
      expect(ai.heroPower.cost).toBe(expectedCost)
      expect(ai.heroPowerCostOverride).toBe(expectedOverride)
      expect(ai.mana.maximum).toBe(0)
      expect(ai.hero.health).toBe(30)
    }
  )

  it('keeps the cost-one bonus after derived state recalculation', () => {
    const match = createAiMatch(0.7)
    match.getLegality!(OPPONENT_ID)
    const ai = match.getState().players.find((p) => p.participantId === OPPONENT_ID)!

    expect(ai.heroPower.cost).toBe(1)
    expect(ai.heroPower.baseCost).toBe(1)
    expect(ai.heroPowerCostOverride).toBe(1)
  })

  it('does not modify a human player with the AI startup bonus', () => {
    const state = createAiMatch(0.7, 'jaina', 'ragnaros').getState()
    const human = state.players.find((p) => p.participantId === HUMAN_ID)!

    expect(human.hero.health).toBe(8)
    expect(human.mana.maximum).toBe(0)
    expect(human.heroPower.cost).toBe(2)
  })

  it('keeps later AI turns free of the removed turn-time bonuses', () => {
    const match = createAiMatch(0.1)
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
    const before = match.getState().players.find((p) => p.participantId === OPPONENT_ID)!

    for (let turn = 0; turn < 6; turn++) {
      const activePlayerId = match.getState().activePlayerId!
      accept(match.dispatch({ type: 'end-turn', participantId: activePlayerId }))
      expect(match.getState().pendingCardChoice).toBeUndefined()
    }

    const after = match.getState().players.find((p) => p.participantId === OPPONENT_ID)!
    expect(after.secrets).toEqual(before.secrets)
  })
})

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
        controllerKind: 'human',
        heroId: asHeroId(opponentHeroId),
        deckId: 'opponent-deck'
      }
    ]
  }
  const match = createOpeningMatch(
    setup,
    [deck('human-deck', heroId), deck('opponent-deck', opponentHeroId)],
    { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
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

describe('mulligan confirmation', () => {
  it('replaces one participant hand before the other participant confirms', () => {
    const match = createOpeningMatch(
      {
        seed: 1,
        participants: [
          {
            participantId: HUMAN_ID,
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: OPPONENT_ID,
            controllerKind: 'ai',
            heroId: asHeroId('rexxar'),
            deckId: 'opponent-deck'
          }
        ]
      },
      [deck('human-deck', 'jaina'), deck('opponent-deck', 'rexxar')],
      { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
    )
    const returnedCard = match.getState().players[0].hand[0]!

    const result = accept(
      match.dispatch({
        type: 'confirm-mulligan',
        participantId: HUMAN_ID,
        replaceInstanceIds: [returnedCard.instanceId]
      })
    )

    expect(result.events[0]).toMatchObject({
      type: 'mulligan-resolved',
      participantId: HUMAN_ID,
      returnedCards: [{ instanceId: returnedCard.instanceId }]
    })
    expect(result.state.phase).toBe('mulligan')
    expect(result.state.players[0].mulliganConfirmed).toBe(true)
    expect(result.state.players[0].hand).not.toContainEqual(
      expect.objectContaining({ instanceId: returnedCard.instanceId })
    )
    expect(result.state.players[1].mulliganConfirmed).toBe(false)
  })

  it('honors an explicit first-player seat override', () => {
    const match = createOpeningMatch(
      {
        seed: 1,
        startingParticipantId: OPPONENT_ID,
        participants: [
          {
            participantId: HUMAN_ID,
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: OPPONENT_ID,
            controllerKind: 'human',
            heroId: asHeroId('rexxar'),
            deckId: 'opponent-deck'
          }
        ]
      },
      [deck('human-deck', 'jaina'), deck('opponent-deck', 'rexxar')],
      { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
    )

    expect(match.getState()).toMatchObject({
      playerOneId: OPPONENT_ID,
      playerTwoId: HUMAN_ID,
      phase: 'mulligan'
    })
  })

  it('can skip mulligan while keeping both dealt hands and starting the turn', () => {
    const match = createOpeningMatch(
      {
        seed: 1,
        skipMulligan: true,
        participants: [
          {
            participantId: HUMAN_ID,
            controllerKind: 'human',
            heroId: asHeroId('jaina'),
            deckId: 'human-deck'
          },
          {
            participantId: OPPONENT_ID,
            controllerKind: 'human',
            heroId: asHeroId('rexxar'),
            deckId: 'opponent-deck'
          }
        ]
      },
      [deck('human-deck', 'jaina'), deck('opponent-deck', 'rexxar')],
      { next: () => 0.1, snapshot: () => 0, restore: () => undefined }
    )
    const state = match.getState()
    const playerOne = state.players[0]!
    const playerTwo = state.players[1]!

    expect(state.phase).toBe('turns')
    expect(state.activePlayerId).toBe(state.playerOneId)
    expect(playerOne.mulliganConfirmed).toBe(true)
    expect(playerTwo.mulliganConfirmed).toBe(true)
    expect(playerOne.hand).toHaveLength(4)
    expect(playerTwo.hand).toHaveLength(5)
    expect(playerOne.mana).toMatchObject({ available: 1, maximum: 1 })
    expect(playerOne.heroPower.available).toBe(true)
    expect(
      match.dispatch({
        type: 'confirm-mulligan',
        participantId: HUMAN_ID,
        replaceInstanceIds: []
      })
    ).toMatchObject({ accepted: false, code: 'wrong-phase' })
  })
})

describe('retired command boundary', () => {
  it('rejects legacy play and attack command names without changing state', () => {
    const match = startMatch('jaina')
    const before = match.getState()
    const legacyCommands: readonly unknown[] = [
      {
        type: 'play-minion',
        participantId: HUMAN_ID,
        cardInstanceId: 'missing',
        position: 0
      },
      {
        type: 'play-weapon',
        participantId: HUMAN_ID,
        cardInstanceId: 'missing'
      },
      { type: 'play-hero', participantId: HUMAN_ID, cardInstanceId: 'missing' },
      {
        type: 'attack-minion',
        participantId: HUMAN_ID,
        attackerInstanceId: 'missing',
        defenderInstanceId: 'missing'
      }
    ]
    for (const command of legacyCommands) {
      expect(match.dispatch(command)).toMatchObject({
        accepted: false,
        code: 'invalid-command'
      })
      expect(match.getState()).toEqual(before)
    }
  })
})

describe('non-mutating command preview', () => {
  it('returns the same result as dispatch without changing the live match', () => {
    const match = startMatch('rexxar')
    const command = { type: 'use-hero-power' as const, participantId: HUMAN_ID }
    const before = match.getState()

    const preview = match.preview(command)

    expect(match.getState()).toEqual(before)
    const dispatched = match.dispatch(command)
    expect(dispatched).toEqual(preview)
  })

  it('isolates multi-command sequences and mutable analysis forks', () => {
    const match = startMatch('rexxar')
    const before = match.getState()
    const commands = [
      { type: 'use-hero-power' as const, participantId: HUMAN_ID },
      { type: 'end-turn' as const, participantId: HUMAN_ID }
    ]

    const preview = match.previewSequence(commands)
    expect(preview.accepted).toBe(true)
    expect(match.getState()).toEqual(before)

    const analyzed = match.analyze((fork) => {
      for (const command of commands) expect(fork.dispatch(command).accepted).toBe(true)
      return fork.getState()
    })
    expect(analyzed).toEqual(preview.state)
    expect(match.getState()).toEqual(before)

    for (const command of commands) expect(match.dispatch(command).accepted).toBe(true)
    expect(match.getState()).toEqual(preview.state)
  })
})

describe('effect trace retention', () => {
  it('keeps effect traces out of normal matches', () => {
    const match = startMatch('rexxar')
    usePower(match)
    expect(match.getState()).not.toHaveProperty('effectTrace')
    expect(match.getEffectTrace?.()).toEqual([])
  })
})

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
    expect(missingTarget).toMatchObject({
      accepted: false,
      code: 'invalid-target'
    })
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
    const result = usePower(match, {
      kind: 'hero',
      participantId: OPPONENT_ID
    })
    expect(match.getState().players[1].hero.health).toBe(30)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'character-healed',
        amount: 0,
        attemptedAmount: 2
      })
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'history-action-resolved',
        action: 'hero-power',
        source: expect.objectContaining({
          heroPowerId: 'priest-lesser-heal',
          baseCost: 2,
          currentCost: 2
        })
      })
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
        replacedWeapon: expect.objectContaining({
          cardId: 'basic_wicked_knife'
        })
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
    const result = usePower(match)
    const after = match.getState().players[0]
    expect(after.hand).toHaveLength(before.hand.length + 1)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(after.hero.health).toBe(28)
    expect(
      result.events
        .filter(
          (event) =>
            event.type === 'hero-power-used' ||
            event.type === 'character-damaged' ||
            event.type === 'card-drawn'
        )
        .map((event) => event.type)
    ).toEqual(['hero-power-used', 'character-damaged', 'card-drawn'])
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
      'character-damaged',
      'fatigue',
      'character-damaged',
      'history-action-resolved',
      'history-action-resolved'
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
    const attackResult = accept(
      match.dispatch({
        type: 'attack-character',
        participantId: OPPONENT_ID,
        attacker: { kind: 'minion', instanceId: attacker!.instanceId },
        defender: { kind: 'hero' }
      })
    )
    expect(match.getState().players[0].hero).toMatchObject({
      health: 30,
      armor: 1
    })
    const history = attackResult.events.find(
      (
        event
      ): event is Extract<OpeningMatchEvent, { type: 'history-action-resolved' }> =>
        event.type === 'history-action-resolved'
    )
    expect(history).toMatchObject({
      action: 'combat',
      source: {
        kind: 'minion',
        cardId: 'basic_acidic_swamp_ooze',
        participantId: OPPONENT_ID
      },
      outcomes: [
        {
          kind: 'damage',
          amount: 3,
          target: {
            kind: 'hero',
            participantId: HUMAN_ID,
            heroId: 'garrosh'
          }
        }
      ]
    })
  })
})

describe('combat rules', () => {
  it('does not let an equipped defending hero retaliate against a minion', () => {
    const match = startMatch('valeera')
    usePower(match)
    const weaponBefore = match.getState().players[0].weapon
    expect(weaponBefore).toMatchObject({ attack: 1, durability: 2 })
    if (!weaponBefore) throw new Error('Expected Dagger Mastery to equip a weapon.')

    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_stonetusk_boar'
      })
    )
    const attackerBefore = match.getState().players[1].board[0]
    expect(attackerBefore).toBeDefined()
    if (!attackerBefore) throw new Error('Expected the attacking minion on the board.')

    const result = accept(
      match.dispatch({
        type: 'attack-character',
        participantId: OPPONENT_ID,
        attacker: { kind: 'minion', instanceId: attackerBefore.instanceId },
        defender: { kind: 'hero' }
      })
    )
    const state = match.getState()
    const attackerAfter = state.players[1].board.find(
      (minion) => minion.instanceId === attackerBefore.instanceId
    )

    expect(state.players[0].hero.health).toBe(29)
    expect(attackerAfter?.health).toBe(attackerBefore.health)
    expect(state.players[0].weapon).toMatchObject({
      instanceId: weaponBefore.instanceId,
      durability: weaponBefore.durability
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'combat-started',
        defender: expect.objectContaining({ attack: 0 })
      })
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'character-combat-resolved',
        attacker: expect.objectContaining({
          healthBefore: attackerBefore.health,
          healthAfter: attackerBefore.health
        }),
        defender: expect.objectContaining({ attack: 0 })
      })
    )
  })
})

describe('match history', () => {
  function latestHistory(result: OpeningAcceptedResult): HistoryActionResolvedEvent {
    const history = result.events.find(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved'
    )
    expect(history).toBeDefined()
    if (!history) throw new Error('Expected a history action event.')
    return history
  }

  it('captures effect-runtime spell targets for Fireball and Ice Lance', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'basic_fireball'
      })
    )
    const fireball = match
      .getState()
      .players[0]!.hand.find((card) => card.cardId === 'basic_fireball')
    expect(fireball).toBeDefined()
    const fireballHistory = latestHistory(
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: HUMAN_ID,
          cardInstanceId: fireball!.instanceId,
          targets: [{ kind: 'hero', participantId: OPPONENT_ID }]
        })
      )
    )
    expect(fireballHistory.outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'damage',
        amount: 6,
        target: expect.objectContaining({
          kind: 'hero',
          participantId: OPPONENT_ID,
          heroId: 'garrosh'
        })
      })
    )

    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'classic_ice_lance'
      })
    )
    const iceLance = match
      .getState()
      .players[0]!.hand.find((card) => card.cardId === 'classic_ice_lance')
    expect(iceLance).toBeDefined()
    const iceLanceHistory = latestHistory(
      accept(
        match.dispatch({
          type: 'play-card',
          participantId: HUMAN_ID,
          cardInstanceId: iceLance!.instanceId,
          targets: [{ kind: 'hero', participantId: OPPONENT_ID }]
        })
      )
    )
    expect(iceLanceHistory.outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'freeze',
        target: expect.objectContaining({
          kind: 'hero',
          participantId: OPPONENT_ID
        })
      })
    )
  })

  it('records Baron Geddon and Doomsayer turn triggers', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'classic_baron_geddon'
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    const geddonTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: HUMAN_ID })
    )
    const geddonHistory = geddonTurn.events.find(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved' &&
        event.source.cardId === 'classic_baron_geddon'
    )
    expect(geddonHistory?.action).toBe('trigger')
    expect(geddonHistory?.outcomes).toContainEqual(
      expect.objectContaining({ kind: 'damage', amount: 2 })
    )

    const geddonOpponentTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID })
    )
    expect(
      geddonOpponentTurn.events.some(
        (event) =>
          event.type === 'history-action-resolved' &&
          event.source.cardId === 'classic_baron_geddon'
      )
    ).toBe(false)

    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'classic_doomsayer'
      })
    )
    const doomsayerOpponentTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: HUMAN_ID })
    )
    expect(
      doomsayerOpponentTurn.events.some(
        (event) =>
          event.type === 'history-action-resolved' &&
          event.source.cardId === 'classic_doomsayer'
      )
    ).toBe(false)
    const doomsayerTurn = accept(
      match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID })
    )
    const doomsayerHistory = doomsayerTurn.events.find(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved' &&
        event.source.cardId === 'classic_doomsayer'
    )
    expect(doomsayerHistory?.action).toBe('trigger')
    expect(doomsayerHistory?.outcomes).toContainEqual(
      expect.objectContaining({ kind: 'destroy' })
    )
  })

  it('keeps explicitly global turn triggers active on either turn', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'classic_gruul'
      })
    )

    accept(match.dispatch({ type: 'end-turn', participantId: HUMAN_ID }))
    expect(match.getState().players[0].board[0]?.attack).toBe(8)

    accept(match.dispatch({ type: 'end-turn', participantId: OPPONENT_ID }))
    expect(match.getState().players[0].board[0]?.attack).toBe(9)
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
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: jaraxxus!.instanceId
      })
    )
    const player = match.getState().players[0]
    expect(player.heroId).toBe('jaraxxus')
    expect(player.hero).toMatchObject({ health: 28, maxHealth: 30, armor: 5 })
    expect(player.heroPower).toMatchObject({
      id: 'jaraxxus-inferno',
      available: true
    })
    expect(player.weapon).toMatchObject({
      cardId: 'classic_blood_fury',
      attack: 3,
      durability: 8
    })
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'hero-replaced', armorGained: 5 })
    )
  })

  it('Deathstalker Rexxar replaces the hero power with Build-A-Beast Discover', () => {
    const match = startMatch('rexxar')
    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'knights_of_the_frozen_throne_deathstalker_rexxar'
      })
    )
    const rexxar = match
      .getState()
      .players[0].hand.find(
        (card) => card.cardId === 'knights_of_the_frozen_throne_deathstalker_rexxar'
      )!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: rexxar.instanceId
      })
    )

    const heroPower = HERO_POWER_CATALOG.require(
      'knights_of_the_frozen_throne_build_a_beast'
    )
    expect(heroPower).toMatchObject({
      displayName: 'Build-A-Beast',
      rulesText: 'Discover a Beast',
      cost: 2,
      targeting: 'none',
      presentationAssetKey: 'hero-power-build-a-beast'
    })
    expect(match.getState().players[0].heroPower).toMatchObject({
      id: heroPower.id,
      cost: 2,
      targetType: 'none',
      available: true
    })

    const result = usePower(match)
    const pending = match.getState().pendingDiscover
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'discover-started', participantId: HUMAN_ID })
    )
    expect(pending?.participantId).toBe(HUMAN_ID)
    expect(pending?.candidates).toHaveLength(3)
    expect(new Set(pending?.candidates.map((card) => card.cardId))).toHaveLength(3)
    expect(
      pending?.candidates.every((card) => {
        const definition = CARD_CATALOG.require(card.cardId)
        return definition.type === 'Minion' && definition.subtype === 'Beast'
      })
    ).toBe(true)

    const selected = pending!.candidates[0]!
    accept(
      match.dispatch({
        type: 'choose-discover-card',
        participantId: HUMAN_ID,
        cardInstanceId: selected.instanceId
      })
    )
    expect(match.getState().pendingDiscover).toBeUndefined()
    expect(match.getState().players[0].hand).toContainEqual(
      expect.objectContaining({
        instanceId: selected.instanceId,
        cardId: selected.cardId
      })
    )
  })

  it('Scourgelord Garrosh replaces the hero power with Bladestorm', () => {
    const match = startMatch('garrosh')
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: HUMAN_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    accept(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: OPPONENT_ID,
        cardId: 'basic_acidic_swamp_ooze'
      })
    )
    const friendlyMinion = match.getState().players[0].board[0]!
    const enemyMinion = match.getState().players[1].board[0]!

    accept(
      match.dispatch({
        type: 'dev-add-card',
        participantId: HUMAN_ID,
        cardId: 'knights_of_the_frozen_throne_scourgelord_garrosh'
      })
    )
    const garrosh = match
      .getState()
      .players[0].hand.find(
        (card) => card.cardId === 'knights_of_the_frozen_throne_scourgelord_garrosh'
      )!
    accept(
      match.dispatch({
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: garrosh.instanceId
      })
    )

    const heroPower = HERO_POWER_CATALOG.require(
      'knights_of_the_frozen_throne_bladestorm'
    )
    expect(heroPower).toMatchObject({
      displayName: 'Bladestorm',
      rulesText: 'Deal 1 damage to all minions.',
      cost: 2,
      targeting: 'none',
      presentationAssetKey: 'hero-power-bladestorm'
    })
    expect(match.getState().players[0].heroPower).toMatchObject({
      id: heroPower.id,
      cost: 2,
      targetType: 'none',
      available: true
    })

    const result = usePower(match)
    const state = match.getState()
    const damageEvents = result.events.filter(
      (event): event is Extract<OpeningMatchEvent, { type: 'effect-resolved' }> =>
        event.type === 'effect-resolved' &&
        event.action === 'damage' &&
        event.actionPath.startsWith('hero-power.damage-all-minions.')
    )
    expect(damageEvents).toHaveLength(2)
    expect(damageEvents.map((event) => event.data?.healthAfter)).toEqual([1, 1])
    expect(state.players[0].board).toContainEqual(
      expect.objectContaining({ instanceId: friendlyMinion.instanceId, health: 1 })
    )
    expect(state.players[1].board).toContainEqual(
      expect.objectContaining({ instanceId: enemyMinion.instanceId, health: 1 })
    )
    expect(state.players[0].hero).toMatchObject({ health: 30 })
    expect(state.players[1].hero).toMatchObject({ health: 30 })
  })
})

describe('public match projections', () => {
  it('masks private card identities while preserving the viewer hand', () => {
    const match = startMatch('jaina')
    const publicState = match.getPublicState!(HUMAN_ID)
    const ownPlayer = publicState.players.find(
      (player) => player.participantId === HUMAN_ID
    )!
    const opponentPlayer = publicState.players.find(
      (player) => player.participantId === OPPONENT_ID
    )!

    expect(ownPlayer.deck.every((card) => card.cardId === null)).toBe(true)
    expect(opponentPlayer.deck.every((card) => card.cardId === null)).toBe(true)
    expect(ownPlayer.hand.every((card) => card.cardId !== null)).toBe(true)
    expect(opponentPlayer.hand.every((card) => card.cardId === null)).toBe(true)
    expect(ownPlayer.hand[0]).not.toHaveProperty('knownTo')
  })

  it('masks opponent card-bearing events but reveals the viewer event', () => {
    const match = startMatch('jaina')
    const card = match.getState().players[1].hand[0]!
    const opponentEvent = {
      type: 'card-drawn' as const,
      participantId: OPPONENT_ID,
      card
    }
    const ownEvent = { ...opponentEvent, participantId: HUMAN_ID }
    const projected = match.getPublicEvents!(HUMAN_ID, [
      opponentEvent,
      ownEvent
    ] as OpeningMatchEvent[])

    expect(projected[0]).toMatchObject({ card: { cardId: null } })
    expect(projected[1]).toMatchObject({ card: { cardId: card.cardId } })
  })

  it('reveals a burned opponent card to every viewer', () => {
    const match = startMatch('jaina')
    const card = match.getState().players[1].hand[0]!
    const projected = match.getPublicEvents!(HUMAN_ID, [
      {
        type: 'card-burned',
        participantId: OPPONENT_ID,
        card
      }
    ] as OpeningMatchEvent[])

    expect(projected[0]).toMatchObject({ card: { cardId: card.cardId } })
  })

  it('masks opponent effect source and nested card payload identities', () => {
    const match = startMatch('jaina')
    const effectEvent: OpeningMatchEvent = {
      type: 'effect-resolved',
      revision: 1,
      sourceInstanceId: `${OPPONENT_ID}:secret:1`,
      sourceCardId: asCardId('basic_fireball'),
      controllerId: OPPONENT_ID,
      action: 'add-to-hand',
      actionPath: '.effects[0].actions[0]',
      data: {
        cardId: 'basic_fireball',
        nested: { cardId: 'basic_fireball' },
        card: { instanceId: 'hidden-card', cardId: asCardId('basic_fireball') }
      }
    }
    const projected = match.getPublicEvents!(HUMAN_ID, [effectEvent])
    expect(projected[0]).toMatchObject({
      sourceCardId: null,
      data: {
        cardId: null,
        nested: { cardId: null },
        card: { cardId: null }
      }
    })
  })
})

describe('history snapshots and causal entries', () => {
  function play(
    match: OpeningMatchInstance,
    cardId: string,
    targets?: readonly object[]
  ): OpeningAcceptedResult {
    accept(match.dispatch({ type: 'dev-add-card', participantId: HUMAN_ID, cardId }))
    setMana(match, HUMAN_ID)
    const card = match
      .getState()
      .players[0].hand.findLast((card) => card.cardId === cardId)!
    return accept(
      match.dispatch({
        type: 'play-card',
        participantId: HUMAN_ID,
        cardInstanceId: card.instanceId,
        targets,
        ...(CARD_CATALOG.require(asCardId(cardId)).type === 'Minion'
          ? { position: 0 }
          : {})
      })
    )
  }
  function summon(
    match: OpeningMatchInstance,
    cardId: string,
    participantId = OPPONENT_ID
  ): string {
    accept(match.dispatch({ type: 'dev-summon-minion', participantId, cardId }))
    return match
      .getState()
      .players.find((p) => p.participantId === participantId)!
      .board.at(-1)!.instanceId
  }
  function histories(
    result: OpeningAcceptedResult
  ): readonly HistoryActionResolvedEvent[] {
    return result.events.filter(
      (event): event is HistoryActionResolvedEvent =>
        event.type === 'history-action-resolved'
    )
  }
  it('records Elise shuffling the Map and Dream returning Elise', () => {
    const match = startMatch('jaina')
    const elise = play(match, 'league_of_explorers_elise_starseeker')
    expect(histories(elise)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'shuffle-deck',
        target: expect.objectContaining({
          zone: 'deck',
          cardId: 'league_of_explorers_map_to_the_golden_monkey'
        })
      })
    )
    const id = elise.state.players[0].board[0].instanceId
    const dream = play(match, 'classic_dream', [
      { kind: 'minion', participantId: HUMAN_ID, instanceId: id }
    ])
    expect(histories(dream)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'return-hand',
        target: expect.objectContaining({
          zone: 'hand',
          cardId: 'league_of_explorers_elise_starseeker'
        })
      })
    )
  })
  it('separates a weapon deathrattle and reactive draw from combat', () => {
    let match = startMatch('garrosh')
    play(match, 'naxxramas_deaths_bite')
    summon(match, 'classic_acolyte_of_pain', HUMAN_ID)
    const target = summon(match, 'naxxramas_loatheb')
    const checkpoint = match.getCheckpoint!()
    const state = checkpoint.state
    match = createOpeningMatchFromCheckpoint({
      ...checkpoint,
      state: {
        ...state,
        players: [
          {
            ...state.players[0],
            weapon: { ...state.players[0].weapon!, durability: 1 }
          },
          state.players[1]
        ]
      }
    })
    const result = accept(
      match.dispatch({
        type: 'attack-character',
        participantId: HUMAN_ID,
        attacker: { kind: 'hero' },
        defender: { kind: 'minion', instanceId: target }
      })
    )
    const entries = histories(result)
    expect(entries.map((entry) => entry.action)).toEqual([
      'combat',
      'trigger',
      'trigger'
    ])
    expect(entries[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'damage',
        amount: 4,
        target: expect.objectContaining({ id: target, health: 1 })
      })
    )
    expect(entries[1].source.cardId).toBe('naxxramas_deaths_bite')
    expect(entries[1].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'death',
        target: expect.objectContaining({ id: target, health: 0 })
      })
    )
    expect(entries[2].source.cardId).toBe('classic_acolyte_of_pain')
    expect(entries[2].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'draw',
        target: expect.objectContaining({
          cardId: 'basic_acidic_swamp_ooze',
          zone: 'hand'
        })
      })
    )
  })
  it('records armor absorption and immunity without inventing health damage', () => {
    const match = startMatch('jaina', 'garrosh')
    accept(
      match.dispatch({ type: 'dev-set-hero', participantId: OPPONENT_ID, armor: 10 })
    )
    const result = play(match, 'basic_fireball', [
      { kind: 'hero', participantId: OPPONENT_ID }
    ])
    expect(histories(result)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'damage',
        amount: 6,
        armorDamage: 6,
        healthDamage: 0,
        target: expect.objectContaining({ health: 30, armor: 4 })
      })
    )
  })
  it('keeps effective attack, health and spell damage frozen after silence', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'basic_ogre_magi', HUMAN_ID)
    const fireball = play(match, 'basic_fireball', [
      { kind: 'hero', participantId: OPPONENT_ID }
    ])
    const old = histories(fireball)[0]
    expect(old.source.rulesText).toContain('7')
    const silenced = play(match, 'classic_silence', [
      { kind: 'minion', participantId: HUMAN_ID, instanceId: id }
    ])
    expect(histories(silenced)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'silence',
        target: expect.objectContaining({ silenced: true, spellDamage: 0 })
      })
    )
    expect(old.source.rulesText).toContain('7')
    expect(histories(fireball)[0]).toEqual(old)
  })
  it('shows new grants after silence without restoring native abilities', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'basic_ogre_magi', HUMAN_ID)
    const target = { kind: 'minion', participantId: HUMAN_ID, instanceId: id }
    play(match, 'classic_silence', [target])
    const buff = play(match, 'basic_mark_of_the_wild', [target])
    const snapshot = histories(buff)[0].outcomes.findLast(
      (outcome) => outcome.target.id === id
    )!.target
    expect(snapshot).toMatchObject({
      attack: 6,
      health: 6,
      maxHealth: 6,
      silenced: true,
      spellDamage: 0
    })
    expect(snapshot.keywords).toContain('taunt')
    expect(snapshot.abilities).toContain('taunt')
  })
  it('records collateral aura changes under the played aura source', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'basic_ogre_magi', HUMAN_ID)
    const result = play(match, 'basic_stormwind_champion')
    expect(histories(result)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'state',
        target: expect.objectContaining({ id, attack: 5, health: 5, maxHealth: 5 })
      })
    )
  })
  it('reports both losing a shield and the next damage hit', () => {
    const match = startMatch('jaina')
    const id = summon(match, 'classic_argent_squire')
    const shield = play(match, 'basic_fireball', [
      { kind: 'minion', participantId: OPPONENT_ID, instanceId: id }
    ])
    expect(histories(shield)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'shield-lost',
        target: expect.objectContaining({ divineShield: false, health: 1 })
      })
    )
    const lethal = play(match, 'basic_fireball', [
      { kind: 'minion', participantId: OPPONENT_ID, instanceId: id }
    ])
    expect(histories(lethal)[0].outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'death',
        target: expect.objectContaining({ health: 0 })
      })
    )
  })
  it('keeps local Life Tap draws visible and private facts outside public events', () => {
    const match = startMatch('guldan')
    const result = usePower(match)
    const entry = histories(result)[0]
    expect(entry.outcomes).toContainEqual(
      expect.objectContaining({
        kind: 'draw',
        target: expect.objectContaining({ cardId: 'basic_acidic_swamp_ooze' })
      })
    )
    const projected = getOpeningMatchPublicEvents(result.events, OPPONENT_ID)
    expect(projected.some((event) => event.type === 'history-effect-recorded')).toBe(
      false
    )
    const history = projected.find(
      (event) => event.type === 'history-action-resolved'
    ) as HistoryActionResolvedEvent
    expect(
      history.outcomes.find((outcome) => outcome.kind === 'draw')?.target.cardId
    ).toBeNull()
  })
})
