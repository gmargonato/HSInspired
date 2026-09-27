import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../content/cards'
import { zombeastId, zombeastPool, zombeastPoolCards } from '../../content/cards/zombeast'
import {
  createOpeningMatchFromCheckpoint,
  type OpeningMatchInstance
} from '../opening-match'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

describe('Build-a-Beast', () => {
  it('classifies existing Beasts and keeps recipes outside unrelated card pools', () => {
    expect(
      zombeastPool(CARD_CATALOG.require('goblins_vs_gnomes_king_of_beasts'))
    ).toBeUndefined()
    expect(
      zombeastPool(CARD_CATALOG.require('classic_savannah_highmane'))
    ).toBeUndefined()
    expect(
      zombeastPool(CARD_CATALOG.require('league_of_explorers_pit_snake'))
    ).toBeUndefined()
    expect(
      zombeastPool(CARD_CATALOG.require('whispers_of_the_old_gods_silithid_swarmer'))
    ).toBe('first')
    const first = zombeastPoolCards(CARD_CATALOG.all, 'first')
    const second = zombeastPoolCards(CARD_CATALOG.all, 'second')
    expect(first.length).toBeGreaterThan(3)
    expect(second.length).toBeGreaterThan(3)
    for (const left of first)
      for (const right of second) {
        const beast = CARD_CATALOG.require(zombeastId(left.id, right.id))
        expect(beast).toMatchObject({
          name: 'Zombeast',
          cardClass: 'Hunter',
          cost: left.cost + right.cost,
          attack: left.attack + right.attack,
          health: left.health + right.health,
          tribes: ['Undead', 'Beast'],
          collectible: false,
          deckLegal: false
        })
        expect(beast.cost).toBeLessThanOrEqual(10)
      }
    expect(CARD_CATALOG.all.some((card) => card.id.startsWith('zombeast:'))).toBe(false)
  })

  it('preserves base stats through silence, copying and bounce, but replaces them on transform', () => {
    const scenario = ready({ seed: 801 })
    const [own] = activePlayers(scenario)
    const id = zombeastId('basic_timber_wolf', 'basic_ironfur_grizzly')
    const definition = CARD_CATALOG.require(id)
    const target = summon(scenario, own, id)
    const other = summon(scenario, own, 'basic_river_crocolisk')
    expect(
      player(scenario, own).board.find((card) => card.instanceId === other.instanceId)
        ?.attack
    ).toBe(
      (CARD_CATALOG.require('basic_river_crocolisk') as { attack: number }).attack + 1
    )
    const targets = [
      { kind: 'minion', participantId: own, instanceId: target.instanceId }
    ]
    setMana(scenario, own)
    addCard(scenario, own, 'classic_silence')
    play(scenario, own, 'classic_silence', { targets })
    expect(
      player(scenario, own).board.find((card) => card.instanceId === target.instanceId)
    ).toMatchObject({
      silenced: true,
      baseAttack: (definition as { attack: number }).attack,
      baseHealth: (definition as { health: number }).health
    })
    expect(
      player(scenario, own).board.find((card) => card.instanceId === other.instanceId)
        ?.attack
    ).toBe((CARD_CATALOG.require('basic_river_crocolisk') as { attack: number }).attack)
    addCard(scenario, own, 'classic_youthful_brewmaster')
    play(scenario, own, 'classic_youthful_brewmaster', { targets })
    expect(player(scenario, own).hand.some((card) => card.cardId === id)).toBe(true)
    setMana(scenario, own)
    play(scenario, own, id)
    const replayed = player(scenario, own).board.find((card) => card.cardId === id)!
    expect(replayed.silenced).toBe(false)
    const replayedTargets = [
      { kind: 'minion', participantId: own, instanceId: replayed.instanceId }
    ]
    setMana(scenario, own)
    addCard(scenario, own, 'classic_faceless_manipulator')
    play(scenario, own, 'classic_faceless_manipulator', { targets: replayedTargets })
    expect(
      player(scenario, own).board.filter((card) => card.cardId === id)
    ).toHaveLength(2)
    addCard(scenario, own, 'basic_polymorph')
    play(scenario, own, 'basic_polymorph', { targets: replayedTargets })
    expect(
      player(scenario, own).board.find(
        (card) => card.instanceId === replayed.instanceId
      )
    ).toMatchObject({ baseAttack: 1, baseHealth: 1 })
  })

  it('uses combined Attack for Dispatch Kodo and applies Poisonous to its Battlecry', () => {
    const scenario = ready({ seed: 802 })
    const [own, enemy] = activePlayers(scenario)
    const victim = summon(scenario, enemy, 'basic_boulderfist_ogre')
    const id = zombeastId(
      'mean_streets_of_gadgetzan_dispatch_kodo',
      'classic_emperor_cobra'
    )
    setMana(scenario, own)
    addCard(scenario, own, id)
    play(scenario, own, id, {
      targets: [{ kind: 'minion', participantId: enemy, instanceId: victim.instanceId }]
    })
    expect(player(scenario, enemy).board).toHaveLength(0)
  })

  it.each(['classic_emperor_cobra', 'knights_of_the_frozen_throne_bloodworm'])(
    'applies %s keywords to Exploding Bloatbat deathrattle and resurrects the recipe',
    (second) => {
      const scenario = ready({ seed: 803 })
      const [own, enemy] = activePlayers(scenario)
      setHealth(scenario, own, 10)
      summon(scenario, enemy, 'basic_boulderfist_ogre')
      summon(scenario, enemy, 'basic_chillwind_yeti')
      const id = zombeastId('knights_of_the_frozen_throne_exploding_bloatbat', second)
      const target = summon(scenario, own, id)
      setMana(scenario, own)
      addCard(scenario, own, 'classic_naturalize')
      play(scenario, own, 'classic_naturalize', {
        targets: [{ kind: 'minion', participantId: own, instanceId: target.instanceId }]
      })
      if (second === 'classic_emperor_cobra')
        expect(player(scenario, enemy).board).toHaveLength(0)
      else expect(player(scenario, own).hero.health).toBe(14)
      setMana(scenario, own)
      addCard(scenario, own, 'whispers_of_the_old_gods_nzoth_the_corruptor')
      play(scenario, own, 'whispers_of_the_old_gods_nzoth_the_corruptor')
      expect(player(scenario, own).board.some((card) => card.cardId === id)).toBe(true)
    }
  )

  it('shuffles the whole Weasel Zombeast into the opposing deck', () => {
    const scenario = ready({ seed: 804 })
    const [own, enemy] = activePlayers(scenario)
    const id = zombeastId(
      'mean_streets_of_gadgetzan_weasel_tunneler',
      'basic_stonetusk_boar'
    )
    const target = summon(scenario, own, id)
    setMana(scenario, own)
    addCard(scenario, own, 'classic_naturalize')
    play(scenario, own, 'classic_naturalize', {
      targets: [{ kind: 'minion', participantId: own, instanceId: target.instanceId }]
    })
    expect(
      [...player(scenario, enemy).deck, ...player(scenario, enemy).hand].some(
        (card) => card.cardId === id
      )
    ).toBe(true)
  })

  it('restores the first stage deterministically and burns only the finished card with a full hand', () => {
    const scenario = ready({ seed: 805, firstHeroId: 'rexxar', secondHeroId: 'rexxar' })
    const [own] = activePlayers(scenario)
    setMana(scenario, own)
    addCard(scenario, own, 'knights_of_the_frozen_throne_deathstalker_rexxar')
    play(scenario, own, 'knights_of_the_frozen_throne_deathstalker_rexxar')
    while (player(scenario, own).hand.length < 10)
      addCard(scenario, own, 'basic_chillwind_yeti')
    setMana(scenario, own)
    const powerCost = player(scenario, own).heroPower.cost
    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
    ).toBe(true)
    const restored = createOpeningMatchFromCheckpoint(
      JSON.parse(JSON.stringify(scenario.match.getCheckpoint()))
    )
    for (let stage = 0; stage < 2; stage++) {
      const pending = scenario.match.getState().pendingCardChoice!
      const command = {
        type: 'choose-card-option' as const,
        participantId: own,
        sourceCardInstanceId: pending.sourceCardInstanceId,
        choice: 0
      }
      const result = scenario.match.dispatch(command)
      expect(result).toEqual(restored.dispatch(command))
      expect(result.accepted).toBe(true)
      if (result.accepted)
        expect(
          result.events.filter((event) => event.type === 'card-burned')
        ).toHaveLength(stage)
    }
    expect(player(scenario, own).hand).toHaveLength(10)
    expect(player(scenario, own).mana.available).toBe(10 - powerCost)
    expect(scenario.match.getState().pendingCardChoice).toBeUndefined()
  })
})

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function ready(options: Parameters<typeof createMatchScenario>[0] = {}) {
  const scenario = createMatchScenario(options)
  scenario.confirmBothMulligans()
  return scenario
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
}

function setMana(
  scenario: Scenario,
  participantId: string,
  available = 10,
  maximum = 10
): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available,
    maximum
  })
  if (!result.accepted) throw new Error(result.message)
}

function setHealth(scenario: Scenario, participantId: string, health: number): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-hero',
    participantId,
    health
  })
  if (!result.accepted) throw new Error(result.message)
}

function summon(scenario: Scenario, participantId: string, cardId: string) {
  const result = scenario.match.dispatch({
    type: 'dev-summon-minion',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
  return player(scenario, participantId).board.at(-1)!
}

function play(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  extra: Record<string, unknown> = {}
) {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  if (!card) throw new Error(`Card ${cardId} is not in the hand.`)
  const definition = CARD_CATALOG.require(asCardId(cardId))
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card.instanceId,
    ...(definition.type === 'Minion'
      ? { position: player(scenario, participantId).board.length }
      : {}),
    ...extra
  })
  if (!result.accepted) throw new Error(result.message)
  return result
}

function cycleTurn(
  scenario: Scenario,
  participantId: string,
  opponentId: string
): void {
  const first = scenario.match.dispatch({ type: 'end-turn', participantId })
  if (!first.accepted) throw new Error(first.message)
  const second = scenario.match.dispatch({
    type: 'end-turn',
    participantId: opponentId
  })
  if (!second.accepted) throw new Error(second.message)
}

function attack(
  match: OpeningMatchInstance,
  participantId: string,
  attacker: { kind: 'hero' } | { kind: 'minion'; instanceId: string },
  defender: { kind: 'hero' } | { kind: 'minion'; instanceId: string }
) {
  return match.dispatch({
    type: 'attack-character',
    participantId,
    attacker,
    defender
  })
}

describe('Goblins vs Gnomes and Mean Streets card corrections', () => {
  it('I Know a Guy offers three Taunt minions to Discover', () => {
    const scenario = ready({ seed: 1731, firstHeroId: 'garrosh' })
    const [participantId] = activePlayers(scenario)
    const cardId = 'mean_streets_of_gadgetzan_i_know_a_guy'
    setMana(scenario, participantId)
    addCard(scenario, participantId, cardId)

    const result = play(scenario, participantId, cardId)
    const pending = result.state.pendingDiscover
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'discover-started', participantId })
    )
    expect(pending?.candidates).toHaveLength(3)
    expect(
      pending?.candidates.every((card) =>
        CARD_CATALOG.require(card.cardId).keywords.includes('taunt')
      )
    ).toBe(true)
    const selected = pending!.candidates[0]!
    const choice = scenario.match.dispatch({
      type: 'choose-discover-card',
      participantId,
      cardInstanceId: selected.instanceId
    })
    expect(choice.accepted).toBe(true)
    expect(player(scenario, participantId).hand).toContainEqual(
      expect.objectContaining({ instanceId: selected.instanceId })
    )
  })

  it('Imp-losion summons the rolled damage amount even when the target dies', () => {
    const scenario = ready({ seed: 1706 })
    const [participantId, opponentId] = activePlayers(scenario)
    const target = summon(scenario, opponentId, 'classic_wisp')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'goblins_vs_gnomes_imp_losion')

    const result = play(scenario, participantId, 'goblins_vs_gnomes_imp_losion', {
      targets: [
        {
          kind: 'minion',
          participantId: opponentId,
          instanceId: target.instanceId
        }
      ]
    })
    const damage = result.events.find(
      (event) =>
        event.type === 'effect-resolved' &&
        event.action === 'damage' &&
        event.sourceCardId === 'goblins_vs_gnomes_imp_losion'
    )
    const rolledAmount =
      damage?.type === 'effect-resolved' ? damage.data?.amount : undefined
    expect(rolledAmount).toBeGreaterThanOrEqual(2)
    expect(rolledAmount).toBeLessThanOrEqual(4)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(
      player(scenario, participantId).board.filter(
        (minion) => minion.cardId === 'classic_imp'
      )
    ).toHaveLength(rolledAmount as number)
  })

  it('Kabal Chemist adds one random potion to hand', () => {
    const scenario = ready({ seed: 1732 })
    const [participantId] = activePlayers(scenario)
    const potionIds = [
      'mean_streets_of_gadgetzan_potion_of_polymorph',
      'mean_streets_of_gadgetzan_volcanic_potion',
      'mean_streets_of_gadgetzan_pint_size_potion',
      'mean_streets_of_gadgetzan_potion_of_madness',
      'mean_streets_of_gadgetzan_greater_healing_potion',
      'mean_streets_of_gadgetzan_dragonfire_potion',
      'mean_streets_of_gadgetzan_blastcrystal_potion',
      'mean_streets_of_gadgetzan_felfire_potion',
      'mean_streets_of_gadgetzan_freezing_potion',
      'mean_streets_of_gadgetzan_bloodfury_potion'
    ]

    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_kabal_chemist')

    const result = play(
      scenario,
      participantId,
      'mean_streets_of_gadgetzan_kabal_chemist'
    )
    const generated = player(scenario, participantId).hand[0]

    expect(generated).toBeDefined()
    expect(potionIds).toContain(generated?.cardId)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'card-generated',
        participantId,
        card: expect.objectContaining({ cardId: generated?.cardId })
      })
    )
  })

  it.each([
    {
      name: "Smuggler's Crate",
      cardId: 'mean_streets_of_gadgetzan_smugglers_crate',
      targetCardId: 'basic_oasis_snapjaw',
      attack: 4,
      health: 9
    },
    {
      name: 'Stolen Goods',
      cardId: 'mean_streets_of_gadgetzan_stolen_goods',
      targetCardId: 'basic_senjin_shieldmasta',
      attack: 6,
      health: 8
    }
  ])(
    '$name resolves a random hand-card target without exposing it as play input',
    ({ cardId, targetCardId, attack, health }) => {
      const scenario = ready({ seed: 1733, cardId })
      const [participantId] = activePlayers(scenario)
      addCard(scenario, participantId, targetCardId)
      setMana(scenario, participantId)

      const card = player(scenario, participantId).hand.find(
        (entry) => entry.cardId === cardId
      )!
      const input = scenario.match.getPlayInput!(participantId, card.instanceId)!
      expect(input.targetSelectors).toEqual([])
      expect(input.legalTargetOptions).toEqual([])

      play(scenario, participantId, cardId)
      expect(player(scenario, participantId).hand).toContainEqual(
        expect.objectContaining({ cardId: targetCardId, attack, health })
      )
    }
  )

  it('Mind Vision resolves its random opponent-hand target without exposing it as play input', () => {
    const scenario = ready({ seed: 1734, cardId: 'basic_mind_vision' })
    const [participantId, opponentId] = activePlayers(scenario)
    setMana(scenario, participantId)

    const vision = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'basic_mind_vision'
    )!
    const input = scenario.match.getPlayInput!(participantId, vision.instanceId)!
    expect(input.targetSelectors).toEqual([])
    expect(input.legalTargetOptions).toEqual([])
    const handSizeBefore = player(scenario, participantId).hand.length

    const result = play(scenario, participantId, 'basic_mind_vision')

    expect(player(scenario, opponentId).hand.length).toBeGreaterThan(0)
    expect(player(scenario, participantId).hand).toHaveLength(handSizeBefore)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'card-generated',
        participantId
      })
    )
  })
})

describe('One Night in Karazhan, Whispers of the Old Gods, and Mean Streets effects', () => {
  it.each([false, true])(
    'finishes both Kazakus potions with Brann (full hand: %s)',
    (fullHand) => {
      const scenario = ready({ seed: 1707 })
      const [participantId] = activePlayers(scenario)
      expect(
        scenario.match.dispatch({ type: 'dev-clear-zone', participantId, zone: 'hand' })
          .accepted
      ).toBe(true)
      summon(scenario, participantId, 'league_of_explorers_brann_bronzebeard')
      setMana(scenario, participantId)
      addCard(scenario, participantId, 'mean_streets_of_gadgetzan_kazakus')
      if (fullHand)
        for (let index = 0; index < 9; index++)
          addCard(scenario, participantId, 'basic_chillwind_yeti')
      const played = play(scenario, participantId, 'mean_streets_of_gadgetzan_kazakus')
      expect(
        played.events.filter((event) => event.type === 'card-choice-started')
      ).toHaveLength(1)
      expect(scenario.match.getState().pendingCardChoice?.queued).toHaveLength(1)
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId }).accepted
      ).toBe(false)
      let generated = 0
      let burned = 0
      for (let potion = 0; potion < 2; potion++) {
        for (const stage of ['cost', 'first-ingredient', 'second-ingredient']) {
          const pending = scenario.match.getState().pendingCardChoice!
          expect(pending.resolution).toMatchObject({ type: 'kazakus-potion', stage })
          const result = scenario.match.dispatch({
            type: 'choose-card-option',
            participantId,
            sourceCardInstanceId: pending.sourceCardInstanceId,
            choice: stage === 'cost' ? potion * 2 : 0
          })
          expect(result.accepted).toBe(true)
          const events = result.events.filter(
            (event) => event.type === 'card-choice-started'
          )
          expect(events).toHaveLength(
            potion === 1 && stage === 'second-ingredient' ? 0 : 1
          )
          if (events.length)
            expect(events[0]).toMatchObject({
              options: result.state.pendingCardChoice?.options
            })
          generated += result.events.filter(
            (event) => event.type === 'card-generated'
          ).length
          burned += result.events.filter((event) => event.type === 'card-burned').length
        }
      }
      expect(generated).toBe(fullHand ? 1 : 2)
      expect(burned).toBe(fullHand ? 1 : 0)
      expect(
        player(scenario, participantId).hand.filter((card) =>
          card.cardId.startsWith('mean_streets_of_gadgetzan_kazakus_potion_')
        )
      ).toHaveLength(fullHand ? 1 : 2)
      expect(scenario.match.getState().pendingCardChoice).toBeUndefined()
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId }).accepted
      ).toBe(true)
    }
  )

  it('keeps each doubled Ivory Knight Discover attached to its own healing', () => {
    const scenario = ready({ seed: 1701, firstHeroId: 'uther' })
    const [participantId] = activePlayers(scenario)
    summon(scenario, participantId, 'league_of_explorers_brann_bronzebeard')
    setMana(scenario, participantId)
    setHealth(scenario, participantId, 1)
    addCard(scenario, participantId, 'one_night_in_karazhan_ivory_knight')
    play(scenario, participantId, 'one_night_in_karazhan_ivory_knight')
    let expectedHealth = 1
    for (let index = 0; index < 2; index++) {
      const pending = scenario.match.getState().pendingDiscover!
      const selected = pending.candidates[0]!
      expectedHealth = Math.min(
        30,
        expectedHealth + CARD_CATALOG.require(selected.cardId).cost
      )
      const result = scenario.match.dispatch({
        type: 'choose-discover-card',
        participantId,
        cardInstanceId: selected.instanceId
      })
      expect(result.accepted).toBe(true)
      expect(player(scenario, participantId).hero.health).toBe(expectedHealth)
      expect(
        result.events.filter((event) => event.type === 'discover-started')
      ).toHaveLength(index === 0 ? 1 : 0)
    }
    expect(scenario.match.getState().pendingDiscover).toBeUndefined()
  })

  it('continues Ivory Knight after Discover and restores the selected spell cost', () => {
    const scenario = ready({ seed: 1701, firstHeroId: 'uther' })
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    setHealth(scenario, participantId, 10)
    addCard(scenario, participantId, 'one_night_in_karazhan_ivory_knight')

    play(scenario, participantId, 'one_night_in_karazhan_ivory_knight')

    const pending = scenario.match.getState().pendingDiscover
    expect(pending?.origin).toBe('generated')
    expect(pending?.candidates).toHaveLength(3)
    const selected = pending!.candidates.reduce((best, candidate) =>
      CARD_CATALOG.require(candidate.cardId).cost >
      CARD_CATALOG.require(best.cardId).cost
        ? candidate
        : best
    )
    const selectedCost = CARD_CATALOG.require(selected.cardId).cost
    expect(selectedCost).toBeGreaterThan(0)

    const result = scenario.match.dispatch({
      type: 'choose-discover-card',
      participantId,
      cardInstanceId: selected.instanceId
    })
    if (!result.accepted) throw new Error(result.message)
    expect(scenario.match.getState().pendingDiscover).toBeUndefined()
    expect(player(scenario, participantId).hero.health).toBe(10 + selectedCost)
    expect(
      player(scenario, participantId).hand.some(
        (card) =>
          card.instanceId === selected.instanceId && card.cardId === selected.cardId
      )
    ).toBe(true)
  })

  it('summons Patches from the deck when a Pirate is played', () => {
    const scenario = ready({
      seed: 1713,
      cardId: 'mean_streets_of_gadgetzan_patches_the_pirate'
    })
    const [participantId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'classic_southsea_captain')
    play(scenario, participantId, 'classic_southsea_captain')

    expect(
      player(scenario, participantId).board.some(
        (minion) => minion.cardId === 'mean_streets_of_gadgetzan_patches_the_pirate'
      )
    ).toBe(true)
  })

  it('does not re-fire Patches from the board when another Pirate is played', () => {
    const scenario = ready({ seed: 1723 })
    const [participantId] = activePlayers(scenario)
    summon(scenario, participantId, 'mean_streets_of_gadgetzan_patches_the_pirate')
    setMana(scenario, participantId)
    const deckSizeBeforePlay = player(scenario, participantId).deck.length

    addCard(scenario, participantId, 'classic_southsea_captain')
    const result = play(scenario, participantId, 'classic_southsea_captain')

    expect(
      result.events.filter(
        (event) =>
          event.type === 'trigger-activated' &&
          event.trigger === 'while-in-deck'
      )
    ).toHaveLength(0)
    const patchesOnBoard = player(scenario, participantId).board.filter(
      (minion) =>
        minion.cardId === 'mean_streets_of_gadgetzan_patches_the_pirate'
    )
    expect(patchesOnBoard).toHaveLength(1)
    expect(player(scenario, participantId).board).toHaveLength(2)
    expect(player(scenario, participantId).deck.length).toBe(deckSizeBeforePlay)
  })

  it("sets Raza's persistent zero-cost Hero Power for a duplicate-free deck", () => {
    const scenario = ready({ seed: 1714, firstHeroId: 'anduin' })
    const [participantId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    setHealth(scenario, participantId, 20)
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_raza_the_chained')
    play(scenario, participantId, 'mean_streets_of_gadgetzan_raza_the_chained')

    expect(player(scenario, participantId).heroPower.cost).toBe(0)
    const result = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId,
      target: { kind: 'hero', participantId }
    })
    if (!result.accepted) throw new Error(result.message)
    expect(player(scenario, participantId).mana.available).toBe(5)
    expect(player(scenario, participantId).hero.health).toBe(22)
  })

  it('checks Raza against the remaining deck at Battlecry time', () => {
    const scenario = ready({
      seed: 1715,
      firstHeroId: 'anduin',
      cardId: 'mean_streets_of_gadgetzan_raza_the_chained'
    })
    const [participantId] = activePlayers(scenario)

    expect(player(scenario, participantId).deckHasNoDuplicates).toBe(false)
    while (player(scenario, participantId).deck.length > 1) {
      const result = scenario.match.dispatch({ type: 'dev-draw', participantId })
      if (!result.accepted) throw new Error(result.message)
    }
    expect(player(scenario, participantId).deck).toHaveLength(1)
    expect(player(scenario, participantId).deckHasNoDuplicates).toBe(false)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_raza_the_chained')

    play(scenario, participantId, 'mean_streets_of_gadgetzan_raza_the_chained')

    expect(player(scenario, participantId).heroPower.cost).toBe(0)
  })

  it('does not keep Raza active after a duplicate enters the deck', () => {
    const scenario = ready({ seed: 1716, firstHeroId: 'anduin' })
    const [participantId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).deckHasNoDuplicates).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_bloodfen_raptor'
      }).accepted
    ).toBe(true)
    addCard(scenario, participantId, 'blackrock_mountain_gang_up')
    setMana(scenario, participantId)
    const target = player(scenario, participantId).board[0]!

    play(scenario, participantId, 'blackrock_mountain_gang_up', {
      targets: [
        {
          kind: 'minion',
          participantId,
          instanceId: target.instanceId
        }
      ]
    })

    expect(
      player(scenario, participantId).deck.filter(
        (card) => card.cardId === 'basic_bloodfen_raptor'
      )
    ).toHaveLength(3)
    expect(player(scenario, participantId).deckHasNoDuplicates).toBe(true)
    const normalHeroPowerCost = player(scenario, participantId).heroPower.cost
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_raza_the_chained')
    play(scenario, participantId, 'mean_streets_of_gadgetzan_raza_the_chained')

    expect(player(scenario, participantId).heroPower.cost).toBe(normalHeroPowerCost)
  })

  it('discovers a copy from the opponent deck when Drakonid Operative holds a Dragon', () => {
    const scenario = ready({ seed: 1715, firstHeroId: 'anduin' })
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'classic_ysera')
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_drakonid_operative')
    play(scenario, participantId, 'mean_streets_of_gadgetzan_drakonid_operative')

    const pending = scenario.match.getState().pendingDiscover
    expect(pending?.origin).toBe('opponent-deck')
    expect(pending?.participantId).toBe(participantId)
    expect(pending?.candidates.length).toBeGreaterThan(0)
    const selected = pending!.candidates[0]!
    const result = scenario.match.dispatch({
      type: 'choose-discover-card',
      participantId,
      cardInstanceId: selected.instanceId
    })
    if (!result.accepted) throw new Error(result.message)
    expect(
      player(scenario, participantId).hand.some(
        (card) =>
          card.instanceId === selected.instanceId && card.cardId === selected.cardId
      )
    ).toBe(true)
  })

  it('combines both Choose One branches under Fandral Staghelm', () => {
    const scenario = ready({ seed: 1702, firstHeroId: 'malfurion' })
    const [participantId] = activePlayers(scenario)
    summon(scenario, participantId, 'whispers_of_the_old_gods_fandral_staghelm')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'blackrock_mountain_druid_of_the_flame')

    const card = player(scenario, participantId).hand.find(
      (candidate) => candidate.cardId === 'blackrock_mountain_druid_of_the_flame'
    )!
    expect(scenario.match.getPlayInput?.(participantId, card.instanceId)).toMatchObject(
      {
        choiceCount: 0,
        choiceTiming: 'before-play'
      }
    )
    play(scenario, participantId, 'blackrock_mountain_druid_of_the_flame')

    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === card.instanceId
      )
    ).toMatchObject({
      cardId: 'blackrock_mountain_druid_of_the_flame_5_5',
      attack: 5,
      health: 5,
      maxHealth: 5
    })
  })

  it('heals Wickerflame damage normally and converts that heal through Auchenai', () => {
    const resolve = (withAuchenai: boolean): number => {
      const scenario = ready({
        seed: withAuchenai ? 1704 : 1703,
        firstHeroId: 'anduin',
        secondHeroId: 'anduin'
      })
      const [participantId, opponentId] = activePlayers(scenario)
      setHealth(scenario, participantId, 20)
      const wickerflame = summon(
        scenario,
        participantId,
        'mean_streets_of_gadgetzan_wickerflame_burnbristle'
      )
      if (withAuchenai) summon(scenario, participantId, 'classic_auchenai_soulpriest')
      const target = summon(scenario, opponentId, 'basic_senjin_shieldmasta')
      cycleTurn(scenario, participantId, opponentId)

      const result = attack(
        scenario.match,
        participantId,
        { kind: 'minion', instanceId: wickerflame.instanceId },
        { kind: 'minion', instanceId: target.instanceId }
      )
      if (!result.accepted) throw new Error(result.message)
      return player(scenario, participantId).hero.health
    }

    expect(resolve(false)).toBe(22)
    expect(resolve(true)).toBe(18)
  })

  it('uses the shared Lifesteal behavior for Mistress of Pain exactly once', () => {
    const scenario = ready({
      seed: 1713,
      firstHeroId: 'anduin',
      secondHeroId: 'anduin'
    })
    const [participantId, opponentId] = activePlayers(scenario)
    setHealth(scenario, participantId, 20)
    const mistress = summon(
      scenario,
      participantId,
      'goblins_vs_gnomes_mistress_of_pain'
    )
    const target = summon(scenario, opponentId, 'classic_wisp')
    cycleTurn(scenario, participantId, opponentId)

    const result = attack(
      scenario.match,
      participantId,
      { kind: 'minion', instanceId: mistress.instanceId },
      { kind: 'minion', instanceId: target.instanceId }
    )
    if (!result.accepted) throw new Error(result.message)
    expect(player(scenario, participantId).hero.health).toBe(21)
  })

  it('applies Lifesteal once when Auchenai replaces its healing event', () => {
    const scenario = ready({
      seed: 1705,
      firstHeroId: 'anduin',
      secondHeroId: 'anduin'
    })
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'basic_stonetusk_boar')
    summon(scenario, participantId, 'classic_auchenai_soulpriest')
    const target = summon(scenario, opponentId, 'classic_wisp')
    setHealth(scenario, participantId, 20)

    const checkpoint = scenario.match.getCheckpoint!()
    const state = checkpoint.state
    const players = state.players.map((candidate) =>
      candidate.participantId !== participantId
        ? candidate
        : {
            ...candidate,
            board: candidate.board.map((minion) =>
              minion.instanceId === attacker.instanceId
                ? { ...minion, keywords: [...(minion.keywords ?? []), 'lifesteal'] }
                : minion
            )
          }
    ) as unknown as typeof state.players
    const match = createOpeningMatchFromCheckpoint({
      ...checkpoint,
      state: { ...state, players }
    })
    cycleTurn(
      { match, participants: scenario.participants } as Scenario,
      participantId,
      opponentId
    )

    const result = attack(
      match,
      participantId,
      { kind: 'minion', instanceId: attacker.instanceId },
      { kind: 'minion', instanceId: target.instanceId }
    )
    if (!result.accepted) throw new Error(result.message)
    expect(
      match
        .getState()
        .players.find((candidate) => candidate.participantId === participantId)!.hero
        .health
    ).toBe(19)
  })

  it('converts Lifesteal healing into one damage with Embrace the Shadow', () => {
    const scenario = ready({
      seed: 1712,
      firstHeroId: 'anduin',
      secondHeroId: 'anduin'
    })
    const [participantId, opponentId] = activePlayers(scenario)
    setHealth(scenario, participantId, 20)
    const wickerflame = summon(
      scenario,
      participantId,
      'mean_streets_of_gadgetzan_wickerflame_burnbristle'
    )
    const target = summon(scenario, opponentId, 'basic_senjin_shieldmasta')
    addCard(scenario, participantId, 'whispers_of_the_old_gods_embrace_the_shadow')
    cycleTurn(scenario, participantId, opponentId)
    setMana(scenario, participantId)

    play(scenario, participantId, 'whispers_of_the_old_gods_embrace_the_shadow')
    const result = attack(
      scenario.match,
      participantId,
      { kind: 'minion', instanceId: wickerflame.instanceId },
      { kind: 'minion', instanceId: target.instanceId }
    )
    if (!result.accepted) throw new Error(result.message)

    expect(player(scenario, participantId).hero.health).toBe(18)
  })

  it("advertises Fool's Bane only against enemy minions and grants repeated attacks", () => {
    const scenario = ready({ seed: 1706, firstHeroId: 'garrosh' })
    const [participantId, opponentId] = activePlayers(scenario)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'one_night_in_karazhan_fools_bane')
    play(scenario, participantId, 'one_night_in_karazhan_fools_bane')
    const firstTarget = summon(scenario, opponentId, 'classic_wisp')
    const secondTarget = summon(scenario, opponentId, 'classic_wisp')

    const heroInstanceId = `${participantId}:hero`
    const targets =
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroInstanceId]
    expect(targets?.some((target) => target.kind === 'hero')).toBe(false)
    expect(
      attack(scenario.match, participantId, { kind: 'hero' }, { kind: 'hero' })
    ).toMatchObject({ accepted: false, code: 'invalid-target' })

    expect(
      attack(
        scenario.match,
        participantId,
        { kind: 'hero' },
        { kind: 'minion', instanceId: firstTarget.instanceId }
      ).accepted
    ).toBe(true)
    const secondAttack = attack(
      scenario.match,
      participantId,
      { kind: 'hero' },
      { kind: 'minion', instanceId: secondTarget.instanceId }
    )
    expect(secondAttack.accepted).toBe(true)
    expect(player(scenario, participantId).hero.attacksUsedThisTurn).toBe(2)
    expect(player(scenario, participantId).hero.maxAttacksPerTurn).toBe(99)

    expect(
      scenario.match.dispatch({ type: 'dev-remove-weapon', participantId }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).hero.maxAttacksPerTurn).toBe(1)
  })

  it('resolves Kazakus through cost, first ingredient, and second ingredient choices with duplicates', () => {
    const scenario = ready({ seed: 1707 })
    const [participantId] = activePlayers(scenario)
    expect(player(scenario, participantId).deckHasNoDuplicates).toBe(false)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_kazakus')
    play(scenario, participantId, 'mean_streets_of_gadgetzan_kazakus')

    let pending = scenario.match.getState().pendingCardChoice!
    expect(pending.options.map((option) => option.presentationCost)).toEqual([1, 5, 10])
    const sourceCardInstanceId = pending.sourceCardInstanceId
    expect(
      scenario.match.dispatch({
        type: 'choose-card-option',
        participantId,
        sourceCardInstanceId,
        choice: 0
      }).accepted
    ).toBe(true)

    pending = scenario.match.getState().pendingCardChoice!
    expect(pending.resolution).toMatchObject({
      type: 'kazakus-potion',
      stage: 'first-ingredient'
    })
    expect(pending.options).toHaveLength(3)
    expect(
      scenario.match.dispatch({
        type: 'choose-card-option',
        participantId,
        sourceCardInstanceId,
        choice: pending.options[0]!.choice
      }).accepted
    ).toBe(true)

    pending = scenario.match.getState().pendingCardChoice!
    expect(pending.resolution).toMatchObject({
      type: 'kazakus-potion',
      stage: 'second-ingredient'
    })
    const resolution = pending.resolution!
    if (resolution.type !== 'kazakus-potion')
      throw new Error('Expected potion resolution.')
    const firstIngredient = resolution.selectedFirstIngredient!
    const secondOption = pending.options.find((option) => {
      const secondIngredient = resolution.secondIngredientOffers?.[option.choice]
      return resolution.costOptions[0]!.recipes.some(
        (recipe) =>
          recipe.ingredients.includes(firstIngredient) &&
          recipe.ingredients.includes(secondIngredient!)
      )
    })!
    expect(secondOption).toBeDefined()
    expect(
      scenario.match.dispatch({
        type: 'choose-card-option',
        participantId,
        sourceCardInstanceId,
        choice: secondOption.choice
      }).accepted
    ).toBe(true)
    expect(scenario.match.getState().pendingCardChoice).toBeUndefined()
    expect(
      player(scenario, participantId).hand.find((card) =>
        card.cardId.startsWith('mean_streets_of_gadgetzan_kazakus_potion_1_')
      )
    ).toMatchObject({ currentCost: 1 })
  })

  it("buffs C'Thun wherever it is and summons Jade Golems with increasing stats", () => {
    const scenario = ready({ seed: 1708, firstHeroId: 'malfurion' })
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'whispers_of_the_old_gods_cthun')
    addCard(scenario, participantId, 'whispers_of_the_old_gods_dark_arakkoa')
    play(scenario, participantId, 'whispers_of_the_old_gods_dark_arakkoa')
    expect(
      player(scenario, participantId).hand.find(
        (card) => card.cardId === 'whispers_of_the_old_gods_cthun'
      )
    ).toMatchObject({ attack: 9, health: 9 })

    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_jade_spirit')
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_jade_spirit')
    setMana(scenario, participantId)
    play(scenario, participantId, 'mean_streets_of_gadgetzan_jade_spirit')
    play(scenario, participantId, 'mean_streets_of_gadgetzan_jade_spirit')
    expect(player(scenario, participantId).counters?.['jade-golem-size']).toBe(3)
    expect(
      player(scenario, participantId).board.filter((minion) =>
        minion.cardId.startsWith('mean_streets_of_gadgetzan_jade_golem_')
      )
    ).toMatchObject([
      { cardId: 'mean_streets_of_gadgetzan_jade_golem_1', attack: 1, health: 1 },
      { cardId: 'mean_streets_of_gadgetzan_jade_golem_2', attack: 2, health: 2 }
    ])
  })

  it('resolves Jade Claws Battlecry when the weapon is played', () => {
    const scenario = ready({ seed: 1716 })
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'mean_streets_of_gadgetzan_jade_claws')

    play(scenario, participantId, 'mean_streets_of_gadgetzan_jade_claws')

    expect(player(scenario, participantId).weapon).toMatchObject({
      cardId: 'mean_streets_of_gadgetzan_jade_claws',
      attack: 2,
      durability: 2
    })
    expect(player(scenario, participantId).board).toMatchObject([
      {
        cardId: 'mean_streets_of_gadgetzan_jade_golem_1',
        attack: 1,
        health: 1
      }
    ])
    expect(player(scenario, participantId).counters?.['jade-golem-size']).toBe(2)
  })

  it('spends all mana for Forbidden Flame, devolves by each target cost, and summons Finja Murlocs', () => {
    const forbidden = ready({ seed: 1709 })
    const [participantId, opponentId] = activePlayers(forbidden)
    const target = summon(forbidden, opponentId, 'basic_senjin_shieldmasta')
    setMana(forbidden, participantId, 7, 10)
    addCard(forbidden, participantId, 'whispers_of_the_old_gods_forbidden_flame')
    play(forbidden, participantId, 'whispers_of_the_old_gods_forbidden_flame', {
      targets: [
        { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
      ]
    })
    expect(player(forbidden, participantId).mana.available).toBe(0)
    expect(player(forbidden, opponentId).board).toHaveLength(0)

    const devolve = ready({ seed: 1710 })
    const [devolvePlayer, devolveOpponent] = activePlayers(devolve)
    const devolveTarget = summon(devolve, devolveOpponent, 'basic_senjin_shieldmasta')
    setMana(devolve, devolvePlayer)
    addCard(devolve, devolvePlayer, 'mean_streets_of_gadgetzan_devolve')
    play(devolve, devolvePlayer, 'mean_streets_of_gadgetzan_devolve')
    const transformed = player(devolve, devolveOpponent).board[0]
    expect(transformed).toBeDefined()
    expect(CARD_CATALOG.require(transformed!.cardId).cost).toBe(3)
    expect(transformed!.instanceId).toBe(devolveTarget.instanceId)

    const finja = ready({ seed: 1711, cardId: 'basic_bluegill_warrior' })
    const [finjaPlayer, finjaOpponent] = activePlayers(finja)
    const finjaMinion = summon(
      finja,
      finjaPlayer,
      'mean_streets_of_gadgetzan_finja_the_flying_star'
    )
    const murlocTarget = summon(finja, finjaOpponent, 'classic_wisp')
    cycleTurn(finja, finjaPlayer, finjaOpponent)
    const deckBefore = player(finja, finjaPlayer).deck.length
    const finjaAttack = attack(
      finja.match,
      finjaPlayer,
      { kind: 'minion', instanceId: finjaMinion.instanceId },
      { kind: 'minion', instanceId: murlocTarget.instanceId }
    )
    expect(finjaAttack.accepted).toBe(true)
    expect(player(finja, finjaPlayer).deck).toHaveLength(deckBefore - 2)
    expect(
      player(finja, finjaPlayer).board.filter(
        (minion) => minion.cardId === 'basic_bluegill_warrior'
      )
    ).toHaveLength(2)
  })

  it('spends Atiesh durability and destroys it after the third spell', () => {
    const scenario = ready({ seed: 1717 })
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'one_night_in_karazhan_medivh_the_guardian')
    play(scenario, participantId, 'one_night_in_karazhan_medivh_the_guardian')
    setMana(scenario, participantId)

    expect(player(scenario, participantId).weapon).toMatchObject({
      cardId: 'one_night_in_karazhan_atiesh',
      durability: 3,
      maxDurability: 3
    })

    let finalResult: ReturnType<typeof play> | undefined
    for (let cast = 0; cast < 3; cast += 1) {
      addCard(scenario, participantId, 'basic_arcane_missiles')
      finalResult = play(scenario, participantId, 'basic_arcane_missiles')
      if (cast < 2)
        expect(player(scenario, participantId).weapon).toMatchObject({
          cardId: 'one_night_in_karazhan_atiesh',
          durability: 2 - cast,
          maxDurability: 3
        })
      else expect(player(scenario, participantId).weapon).toBeNull()
    }

    expect(finalResult?.events).toContainEqual(
      expect.objectContaining({
        type: 'death-batch-started',
        deaths: [
          expect.objectContaining({
            kind: 'weapon',
            cardId: 'one_night_in_karazhan_atiesh'
          })
        ]
      })
    )
  })
})

describe('Original Cthun progression', () => {
  const id = 'whispers_of_the_old_gods_cthun'
  const cultist = 'whispers_of_the_old_gods_beckoner_of_evil'
  const targetOf = (participantId: string, instanceId: string) => ({
    kind: 'minion' as const,
    participantId,
    instanceId
  })

  it('keeps hand buffs on board and deals the enhanced number of individual hits', () => {
    const scenario = ready({ seed: 1901 })
    const [own, enemy] = activePlayers(scenario)
    addCard(scenario, own, id)
    addCard(scenario, own, cultist)
    setMana(scenario, own)
    play(scenario, own, cultist)
    expect(player(scenario, own).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 8
    })
    setMana(scenario, own)
    const before = player(scenario, enemy).hero.health
    const result = play(scenario, own, id)
    expect(player(scenario, own).board.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 8,
      maxHealth: 8,
      baseAttack: 6
    })
    expect(player(scenario, enemy).hero.health).toBe(before - 8)
    expect(
      result.events.filter(
        (e) =>
          e.type === 'effect-resolved' && e.action === 'damage' && e.sourceCardId === id
      )
    ).toHaveLength(8)
    setMana(scenario, own)
    expect(player(scenario, own).board.find((c) => c.cardId === id)?.attack).toBe(8)
  })

  it('tracks buffs without a Cthun present, activates thresholds, and buffs later copies once', () => {
    const scenario = ready({ seed: 1902 })
    const [own, enemy] = activePlayers(scenario)
    for (let i = 0; i < 2; i++) {
      addCard(scenario, own, cultist)
      setMana(scenario, own)
      play(scenario, own, cultist)
    }
    addCard(scenario, own, 'whispers_of_the_old_gods_ancient_shieldbearer')
    setMana(scenario, own)
    const armor = player(scenario, own).hero.armor
    play(scenario, own, 'whispers_of_the_old_gods_ancient_shieldbearer')
    expect(player(scenario, own).hero.armor).toBe(armor + 10)
    addCard(scenario, own, id)
    addCard(scenario, enemy, id)
    expect(player(scenario, own).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 10,
      health: 10
    })
    expect(player(scenario, enemy).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 6,
      health: 6
    })
    const restored = createOpeningMatchFromCheckpoint(scenario.match.getCheckpoint!())
    expect(
      restored.getState().players.find((p) => p.participantId === own)?.cthun
    ).toEqual({ attack: 4, health: 4, taunt: false })
    expect(
      restored
        .getState()
        .players.find((p) => p.participantId === own)
        ?.hand.find((c) => c.cardId === id)?.attack
    ).toBe(10)
  })

  it('grants Taunt in hand and transfers it to the board', () => {
    const scenario = ready({ seed: 1903 })
    const [own] = activePlayers(scenario)
    addCard(scenario, own, 'whispers_of_the_old_gods_twilight_geomancer')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_twilight_geomancer')
    addCard(scenario, own, id)
    const card = player(scenario, own).hand.find((c) => c.cardId === id)!
    expect(card.enchantments?.some((e) => e.keywords?.includes('taunt'))).toBe(true)
    setMana(scenario, own)
    play(scenario, own, id)
    expect(
      player(scenario, own)
        .board.find((c) => c.cardId === id)
        ?.enchantments?.some((e) => e.keywords?.includes('taunt'))
    ).toBe(true)
  })

  it('removes board enhancements with silence, then restores ritual totals on bounce', () => {
    const scenario = ready({ seed: 1904 })
    const [own] = activePlayers(scenario)
    addCard(scenario, own, id)
    addCard(scenario, own, cultist)
    setMana(scenario, own)
    play(scenario, own, cultist)
    setMana(scenario, own)
    play(scenario, own, id)
    const cthun = player(scenario, own).board.find((c) => c.cardId === id)!
    addCard(scenario, own, 'classic_silence')
    play(scenario, own, 'classic_silence', {
      targets: [targetOf(own, cthun.instanceId)]
    })
    expect(player(scenario, own).board.find((c) => c.cardId === id)?.attack).toBe(6)
    expect(player(scenario, own).cthun?.attack).toBe(2)
    addCard(scenario, own, 'classic_shadowstep')
    play(scenario, own, 'classic_shadowstep', {
      targets: [targetOf(own, cthun.instanceId)]
    })
    expect(player(scenario, own).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 8
    })
  })

  it.each([false, true])(
    'Blade captures a friendly damaged victim before destruction (Brann: %s)',
    (brann) => {
      const scenario = ready({ seed: 1905 })
      const [own] = activePlayers(scenario)
      if (brann) summon(scenario, own, 'league_of_explorers_brann_bronzebeard')
      const victim = summon(scenario, own, 'basic_chillwind_yeti')
      addCard(scenario, own, 'classic_moonfire')
      play(scenario, own, 'classic_moonfire', {
        targets: [targetOf(own, victim.instanceId)]
      })
      addCard(scenario, own, 'whispers_of_the_old_gods_blade_of_cthun')
      setMana(scenario, own)
      play(scenario, own, 'whispers_of_the_old_gods_blade_of_cthun', {
        targets: [targetOf(own, victim.instanceId)]
      })
      expect(
        player(scenario, own).board.some((c) => c.instanceId === victim.instanceId)
      ).toBe(false)
      expect(player(scenario, own).cthun).toMatchObject({
        attack: brann ? 8 : 4,
        health: brann ? 8 : 4
      })
    }
  )

  it('Doomcaller creates a fresh copy per repeated battlecry without consuming the death', () => {
    const scenario = ready({ seed: 1906 })
    const [own] = activePlayers(scenario)
    const cthun = summon(scenario, own, id)
    addCard(scenario, own, 'classic_naturalize')
    setMana(scenario, own)
    play(scenario, own, 'classic_naturalize', {
      targets: [targetOf(own, cthun.instanceId)]
    })
    summon(scenario, own, 'league_of_explorers_brann_bronzebeard')
    addCard(scenario, own, 'whispers_of_the_old_gods_doomcaller')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_doomcaller')
    const copies = player(scenario, own).deck.filter((c) => c.cardId === id)
    expect(copies).toHaveLength(2)
    expect(
      copies.every(
        (c) => c.attack === 10 && c.health === 10 && c.instanceId !== cthun.instanceId
      )
    ).toBe(true)
    expect(new Set(copies.map((c) => c.instanceId)).size).toBe(2)
    expect(
      player(scenario, own).graveyard?.some(
        (e) => e.minion.instanceId === cthun.instanceId
      )
    ).toBe(true)
  })

  it('records Disciple damage and public ritual stats at the time of each effect', () => {
    const scenario = ready({ seed: 1907 })
    const [own, enemy] = activePlayers(scenario)
    addCard(scenario, own, 'whispers_of_the_old_gods_disciple_of_cthun')
    setMana(scenario, own)
    const result = play(scenario, own, 'whispers_of_the_old_gods_disciple_of_cthun', {
      targets: [{ kind: 'hero', participantId: enemy }]
    })
    const history = result.events.find(
      (e) =>
        e.type === 'history-action-resolved' &&
        e.source.cardId === 'whispers_of_the_old_gods_disciple_of_cthun'
    )
    expect(history?.type).toBe('history-action-resolved')
    if (history?.type !== 'history-action-resolved') throw Error('Missing history')
    expect(history.outcomes.some((e) => e.kind === 'damage' && e.amount === 2)).toBe(
      true
    )
    const outcome = history.outcomes.find((e) => e.target.cardId === id)!
    expect(outcome).toMatchObject({
      kind: 'buff',
      before: { attack: 6, health: 6 },
      target: { attack: 8, health: 8, publicIdentity: true }
    })
    expect(outcome.target.zone).toBeUndefined()
    addCard(scenario, own, cultist)
    setMana(scenario, own)
    play(scenario, own, cultist)
    expect(outcome.target.attack).toBe(8)
  })
})

describe('Cthun cultist coverage', () => {
  const id = 'whispers_of_the_old_gods_cthun'
  const prefix = 'whispers_of_the_old_gods_'
  it.each([
    ['beckoner_of_evil', 2],
    ['cthuns_chosen', 2],
    ['skeram_cultist', 2],
    ['dark_arakkoa', 3],
    ['doomcaller', 2]
  ] as const)('%s adds its printed ritual bonus', (name, amount) => {
    const scenario = ready({ seed: 1920 })
    const [own] = activePlayers(scenario)
    addCard(scenario, own, prefix + name)
    setMana(scenario, own)
    play(scenario, own, prefix + name)
    expect(player(scenario, own).cthun).toMatchObject({
      attack: amount,
      health: amount
    })
    expect(player(scenario, own).deck.some((c) => c.cardId === id)).toBe(false)
  })

  it('Twilight Elder buffs only on its controller turn end and records its source', () => {
    const scenario = ready({ seed: 1921 })
    const [own, enemy] = activePlayers(scenario)
    summon(scenario, own, prefix + 'twilight_elder')
    const result = scenario.match.dispatch({ type: 'end-turn', participantId: own })
    expect(player(scenario, own).cthun?.attack).toBe(1)
    expect(
      result.events.some(
        (e) =>
          e.type === 'history-action-resolved' &&
          e.source.cardId === prefix + 'twilight_elder' &&
          e.outcomes.some((o) => o.target.attack === 7)
      )
    ).toBe(true)
    scenario.match.dispatch({ type: 'end-turn', participantId: enemy })
    expect(player(scenario, own).cthun?.attack).toBe(1)
  })

  it('Cult Sorcerer buffs only after its controller casts', () => {
    const scenario = ready({ seed: 1922 })
    const [own, enemy] = activePlayers(scenario)
    summon(scenario, own, prefix + 'cult_sorcerer')
    addCard(scenario, own, 'classic_moonfire')
    play(scenario, own, 'classic_moonfire', {
      targets: [{ kind: 'hero', participantId: enemy }]
    })
    expect(player(scenario, own).cthun?.attack).toBe(1)
    scenario.match.dispatch({ type: 'end-turn', participantId: own })
    addCard(scenario, enemy, 'classic_moonfire')
    play(scenario, enemy, 'classic_moonfire', {
      targets: [{ kind: 'hero', participantId: own }]
    })
    expect(player(scenario, own).cthun?.attack).toBe(1)
  })

  it('Hooded Acolyte observes healing by either player but ignores overhealing', () => {
    const scenario = ready({ seed: 1923 })
    const [own, enemy] = activePlayers(scenario)
    summon(scenario, own, prefix + 'hooded_acolyte')
    scenario.match.dispatch({ type: 'end-turn', participantId: own })
    setHealth(scenario, enemy, 10)
    addCard(scenario, enemy, 'basic_healing_touch')
    setMana(scenario, enemy)
    play(scenario, enemy, 'basic_healing_touch', {
      targets: [{ kind: 'hero', participantId: enemy }]
    })
    expect(player(scenario, own).cthun?.attack).toBe(1)
    setHealth(scenario, enemy, 30)
    addCard(scenario, enemy, 'basic_healing_touch')
    setMana(scenario, enemy)
    play(scenario, enemy, 'basic_healing_touch', {
      targets: [{ kind: 'hero', participantId: enemy }]
    })
    expect(player(scenario, own).cthun?.attack).toBe(1)
  })

  it('Crazed Worshipper buffs on lethal damage too', () => {
    const scenario = ready({ seed: 1924 })
    const [own] = activePlayers(scenario)
    const victim = summon(scenario, own, prefix + 'crazed_worshipper')
    addCard(scenario, own, 'basic_fireball')
    setMana(scenario, own)
    play(scenario, own, 'basic_fireball', {
      targets: [{ kind: 'minion', participantId: own, instanceId: victim.instanceId }]
    })
    expect(
      player(scenario, own).board.some((c) => c.instanceId === victim.instanceId)
    ).toBe(false)
    expect(player(scenario, own).cthun?.attack).toBe(1)
  })

  it('Usher of Souls buffs for a friendly death and ignores enemy deaths', () => {
    const scenario = ready({ seed: 1925 })
    const [own, enemy] = activePlayers(scenario)
    summon(scenario, own, prefix + 'usher_of_souls')
    for (const targetPlayer of [enemy, own]) {
      const victim = summon(scenario, targetPlayer, 'classic_wisp')
      addCard(scenario, own, 'classic_moonfire')
      play(scenario, own, 'classic_moonfire', {
        targets: [
          { kind: 'minion', participantId: targetPlayer, instanceId: victim.instanceId }
        ]
      })
      expect(player(scenario, own).cthun?.attack ?? 0).toBe(
        targetPlayer === own ? 1 : 0
      )
    }
  })

  it.each([
    'klaxxi_amber_weaver',
    'twilight_darkmender',
    'twin_emperor_veklor',
    'ancient_shieldbearer'
  ])('%s needs four ritual Attack', (name) => {
    for (const active of [false, true]) {
      const scenario = ready({ seed: 1926 })
      const [own] = activePlayers(scenario)
      if (active)
        for (let i = 0; i < 2; i++) {
          addCard(scenario, own, prefix + 'beckoner_of_evil')
          setMana(scenario, own)
          play(scenario, own, prefix + 'beckoner_of_evil')
        }
      setHealth(scenario, own, 10)
      addCard(scenario, own, prefix + name)
      setMana(scenario, own)
      const card = player(scenario, own).hand.find((c) => c.cardId === prefix + name)!
      expect(
        scenario.match.getPlayInput!(own, card.instanceId)?.effectPreview
          ?.conditionallyEnhanced ?? false
      ).toBe(active)
      play(scenario, own, prefix + name)
      const after = player(scenario, own)
      if (name === 'klaxxi_amber_weaver')
        expect(after.board.find((c) => c.cardId === prefix + name)?.health).toBe(
          active ? 10 : 5
        )
      if (name === 'twilight_darkmender')
        expect(after.hero.health).toBe(active ? 20 : 10)
      if (name === 'ancient_shieldbearer')
        expect(after.hero.armor).toBe(active ? 10 : 0)
      if (name === 'twin_emperor_veklor')
        expect(
          after.board.filter((c) => c.cardId === prefix + 'twin_emperor_veknilash')
        ).toHaveLength(active ? 1 : 0)
    }
  })
})

describe('Cthun zone and damage regression cases', () => {
  const id = 'whispers_of_the_old_gods_cthun'
  it('buffs the deck, draws with those stats, and repeats damage deterministically', () => {
    const original = ready({ seed: 1930 })
    const [own, enemy] = activePlayers(original)
    addCard(original, own, id)
    const checkpoint = original.match.getCheckpoint!()
    const cards = player(original, own).hand
    const cthun = cards.find((c) => c.cardId === id)!
    const players = checkpoint.state.players.map((p) =>
      p.participantId !== own
        ? p
        : {
            ...p,
            hand: p.hand.filter((c) => c.instanceId !== cthun.instanceId),
            deck: [{ ...cthun, zone: 'deck' as const, revealed: false }, ...p.deck]
          }
    ) as unknown as typeof checkpoint.state.players
    const scenario = {
      ...original,
      match: createOpeningMatchFromCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, players }
      })
    }
    addCard(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    expect(player(scenario, own).deck[0]).toMatchObject({ attack: 8, health: 8 })
    const draw = scenario.match.dispatch({ type: 'dev-draw', participantId: own })
    expect(draw.accepted).toBe(true)
    expect(player(scenario, own).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 8
    })
    summon(scenario, own, 'league_of_explorers_brann_bronzebeard')
    summon(scenario, enemy, 'classic_argent_squire')
    setMana(scenario, own)
    const saved = scenario.match.getCheckpoint!()
    const first = play(scenario, own, id)
    const second = play(
      { ...scenario, match: createOpeningMatchFromCheckpoint(saved) },
      own,
      id
    )
    expect(second.state).toEqual(first.state)
    expect(second.events).toEqual(first.events)
    expect(
      first.events.filter(
        (e) =>
          e.type === 'effect-resolved' && e.sourceCardId === id && e.action === 'damage'
      )
    ).toHaveLength(16)
    expect(player(scenario, enemy).board).toHaveLength(0)
    expect(player(scenario, enemy).hero.health).toBe(16)
  })

  it('ordinary hand buffs add to combat stats without activating ritual thresholds', () => {
    const scenario = ready({ seed: 1931 })
    const [own] = activePlayers(scenario)
    addCard(scenario, own, id)
    for (let i = 0; i < 4; i++) {
      addCard(scenario, own, 'mean_streets_of_gadgetzan_smugglers_run')
      setMana(scenario, own)
      play(scenario, own, 'mean_streets_of_gadgetzan_smugglers_run')
    }
    expect(player(scenario, own).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 10,
      health: 10
    })
    addCard(scenario, own, 'whispers_of_the_old_gods_ancient_shieldbearer')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_ancient_shieldbearer')
    expect(player(scenario, own).hero.armor).toBe(0)
    setMana(scenario, own)
    play(scenario, own, id)
    expect(player(scenario, own).board.find((c) => c.cardId === id)).toMatchObject({
      attack: 10,
      health: 10
    })
  })
})

describe('Cthun removal and stat edge cases', () => {
  const id = 'whispers_of_the_old_gods_cthun'
  it('zero Attack produces no battlecry hits', () => {
    const original = ready({ seed: 1940 })
    const [own, enemy] = activePlayers(original)
    addCard(original, own, id)
    setMana(original, own)
    const checkpoint = original.match.getCheckpoint!()
    const players = checkpoint.state.players.map((p) =>
      p.participantId !== own
        ? p
        : {
            ...p,
            hand: p.hand.map((c) =>
              c.cardId !== id
                ? c
                : {
                    ...c,
                    attack: 0,
                    enchantments: [
                      ...(c.enchantments ?? []),
                      {
                        id: 'test-attack-reduction',
                        sourceInstanceId: c.instanceId,
                        sourceCardId: c.cardId,
                        attackDelta: -6
                      }
                    ]
                  }
            )
          }
    ) as unknown as typeof checkpoint.state.players
    const scenario = {
      ...original,
      match: createOpeningMatchFromCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, players }
      })
    }
    const before = player(scenario, enemy).hero.health
    const result = play(scenario, own, id)
    expect(player(scenario, own).board.find((c) => c.cardId === id)?.attack).toBe(0)
    expect(player(scenario, enemy).hero.health).toBe(before)
    expect(
      result.events.filter(
        (e) =>
          e.type === 'effect-resolved' && e.action === 'damage' && e.sourceCardId === id
      )
    ).toHaveLength(0)
  })

  it('a transformed Cthun dying does not qualify for Doomcaller', () => {
    const scenario = ready({ seed: 1941 })
    const [own] = activePlayers(scenario)
    const cthun = summon(scenario, own, id)
    const targets = [
      { kind: 'minion', participantId: own, instanceId: cthun.instanceId }
    ]
    addCard(scenario, own, 'basic_polymorph')
    setMana(scenario, own)
    play(scenario, own, 'basic_polymorph', { targets })
    addCard(scenario, own, 'classic_moonfire')
    play(scenario, own, 'classic_moonfire', { targets })
    addCard(scenario, own, 'whispers_of_the_old_gods_doomcaller')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_doomcaller')
    expect(player(scenario, own).deck.some((c) => c.cardId === id)).toBe(false)
    expect(player(scenario, own).cthun).toMatchObject({ attack: 2, health: 2 })
  })

  it('buffing a damaged board Cthun preserves damage and survives another recalculation', () => {
    const scenario = ready({ seed: 1942 })
    const [own] = activePlayers(scenario)
    const cthun = summon(scenario, own, id)
    addCard(scenario, own, 'classic_moonfire')
    play(scenario, own, 'classic_moonfire', {
      targets: [{ kind: 'minion', participantId: own, instanceId: cthun.instanceId }]
    })
    addCard(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(scenario, own)
    expect(player(scenario, own).board.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 7,
      maxHealth: 8,
      damageTaken: 1
    })
  })
})

describe('Cthun generated copies', () => {
  const id = 'whispers_of_the_old_gods_cthun'
  it('a generated hand card and its presentation event use the receiving player rituals', () => {
    const original = ready({ seed: 1950 })
    const [own, enemy] = activePlayers(original)
    addCard(original, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(original, own)
    play(original, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    addCard(original, enemy, id)
    const checkpoint = original.match.getCheckpoint!()
    const players = checkpoint.state.players.map((p) =>
      p.participantId !== enemy
        ? p
        : {
            ...p,
            hand: p.hand.filter((c) => c.cardId === id),
            deck: [
              ...p.deck,
              ...p.hand
                .filter((c) => c.cardId !== id)
                .map((c) => ({ ...c, zone: 'deck' as const, revealed: false }))
            ]
          }
    ) as unknown as typeof checkpoint.state.players
    const scenario = {
      ...original,
      match: createOpeningMatchFromCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, players }
      })
    }
    addCard(scenario, own, 'basic_mind_vision')
    setMana(scenario, own)
    const vision = player(scenario, own).hand.find(
      (c) => c.cardId === 'basic_mind_vision'
    )!
    const input = scenario.match.getPlayInput!(own, vision.instanceId)!
    const result = play(scenario, own, 'basic_mind_vision', {
      targets: input.legalTargetOptions.map((options) => options[0])
    })
    expect(player(scenario, own).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 8
    })
    expect(player(scenario, enemy).hand.find((c) => c.cardId === id)).toMatchObject({
      attack: 6,
      health: 6
    })
    expect(
      result.events.find((e) => e.type === 'card-generated' && e.card.cardId === id)
    ).toMatchObject({ card: { attack: 8, health: 8 } })
  })

  it('an exact board copy retains enhancements once and both copies receive later buffs', () => {
    const scenario = ready({ seed: 1951 })
    const [own] = activePlayers(scenario)
    addCard(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    const cthun = summon(scenario, own, id)
    addCard(scenario, own, 'classic_faceless_manipulator')
    setMana(scenario, own)
    play(scenario, own, 'classic_faceless_manipulator', {
      targets: [{ kind: 'minion', participantId: own, instanceId: cthun.instanceId }]
    })
    expect(
      player(scenario, own)
        .board.filter((c) => c.cardId === id)
        .map((c) => c.attack)
    ).toEqual([8, 8])
    addCard(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    expect(
      player(scenario, own)
        .board.filter((c) => c.cardId === id)
        .map((c) => c.attack)
    ).toEqual([10, 10])
  })
})

describe('Cthun resurrection', () => {
  it('restores current ritual stats and retains Doomcaller eligibility after resurrection consumes the graveyard entry', () => {
    const scenario = ready({ seed: 1960 })
    const [own] = activePlayers(scenario)
    const id = 'whispers_of_the_old_gods_cthun'
    addCard(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_beckoner_of_evil')
    const cthun = summon(scenario, own, id)
    addCard(scenario, own, 'naxxramas_reincarnate')
    setMana(scenario, own)
    play(scenario, own, 'naxxramas_reincarnate', {
      targets: [{ kind: 'minion', participantId: own, instanceId: cthun.instanceId }]
    })
    expect(player(scenario, own).board.find((c) => c.cardId === id)).toMatchObject({
      attack: 8,
      health: 8,
      maxHealth: 8
    })
    expect(player(scenario, own).graveyard?.some((e) => e.minion.cardId === id)).toBe(
      false
    )
    addCard(scenario, own, 'whispers_of_the_old_gods_doomcaller')
    setMana(scenario, own)
    play(scenario, own, 'whispers_of_the_old_gods_doomcaller')
    expect(player(scenario, own).deck.filter((c) => c.cardId === id)).toMatchObject([
      { attack: 10, health: 10 }
    ])
  })
})
