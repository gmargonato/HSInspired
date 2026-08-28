import { describe, expect, it } from 'vitest'
import type { OpeningMatchState } from '../opening-match'
import type { PlayerId } from '../match-types'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function player(state: OpeningMatchState, participantId: PlayerId) {
  return state.players.find((candidate) => candidate.participantId === participantId)!
}

function context(scenario: Scenario): {
  readonly state: OpeningMatchState
  readonly participantId: PlayerId
  readonly opponentId: PlayerId
} {
  const state = scenario.match.getState()
  const participantId = state.activePlayerId!
  const opponentId = scenario.participants.find((id) => id !== participantId)!
  return { state, participantId, opponentId }
}

function setMana(
  scenario: Scenario,
  participantId: PlayerId,
  available = 10,
  maximum = 10
): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available,
    maximum
  })
  expect(result.accepted).toBe(true)
}

function addCard(scenario: Scenario, participantId: PlayerId, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId
  })
  expect(result.accepted).toBe(true)
}

function handCard(scenario: Scenario, participantId: PlayerId, cardId: string) {
  const card = player(scenario.match.getState(), participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  return card!
}

function effectActions(
  result: ReturnType<Scenario['match']['dispatch']>
): readonly string[] {
  if (!result.accepted) return []
  return result.events
    .filter(
      (event): event is Extract<typeof event, { type: 'effect-resolved' }> =>
        event.type === 'effect-resolved'
    )
    .map((event) => event.action)
}

describe('Phase 5/6 real-card integration', () => {
  it('plays a targeted spell once, pays mana, records cast history, and queues overload', () => {
    const scenario = createMatchScenario({
      seed: 501,
      cardId: 'classic_lightning_bolt'
    })
    scenario.confirmBothMulligans()
    const { participantId, opponentId, state: before } = context(scenario)
    setMana(scenario, participantId)
    const card = handCard(scenario, participantId, 'classic_lightning_bolt')
    const input = scenario.match.getPlayInput?.(participantId, card.instanceId)
    expect(input?.targetSelectors).toHaveLength(1)
    expect(input?.legalTargetOptions[0]).toContainEqual({
      kind: 'hero',
      participantId: opponentId
    })

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      targets: [{ kind: 'hero', participantId: opponentId }]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const nextPlayer = player(result.state, participantId)
    const nextOpponent = player(result.state, opponentId)
    expect(nextPlayer.mana.available).toBe(9)
    expect(nextPlayer.mana.overloadNextTurn).toBe(1)
    expect(nextPlayer.overload).toBe(1)
    expect(nextOpponent.hero.health).toBe(player(before, opponentId).hero.health - 3)
    expect(
      nextPlayer.hand.some((candidate) => candidate.instanceId === card.instanceId)
    ).toBe(false)
    expect(nextPlayer.discardedCards).toEqual(
      expect.arrayContaining([expect.objectContaining({ instanceId: card.instanceId })])
    )
    expect(result.state.history?.cardsCastThisTurn).toContain('classic_lightning_bolt')
    const actions = effectActions(result)
    expect(actions).toContain('damage')
    expect(actions).toContain('overload')
    expect(actions.indexOf('damage')).toBeLessThan(actions.indexOf('overload'))
  })

  it('inserts a played minion before Battlecry and applies immediate resource effects', () => {
    const scenario = createMatchScenario({ seed: 502, cardId: 'classic_felguard' })
    scenario.confirmBothMulligans()
    const { participantId } = context(scenario)
    setMana(scenario, participantId)
    const card = handCard(scenario, participantId, 'classic_felguard')

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 0
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const nextPlayer = player(result.state, participantId)
    expect(nextPlayer.board).toHaveLength(1)
    expect(nextPlayer.board[0]).toMatchObject({
      cardId: 'classic_felguard',
      controllerId: participantId,
      keywords: ['taunt']
    })
    expect(nextPlayer.mana.maximum).toBe(9)
    expect(nextPlayer.mana.available).toBe(7)
    expect(result.events.some((event) => event.type === 'minion-played')).toBe(true)
    const actions = effectActions(result)
    expect(actions.indexOf('summon')).toBeLessThan(
      actions.indexOf('destroy-mana-crystal')
    )
  })

  it('resolves multi-action untargeted spells and starts the next turn with overload locked', () => {
    const scenario = createMatchScenario({ seed: 503, cardId: 'classic_feral_spirit' })
    scenario.confirmBothMulligans()
    const { participantId } = context(scenario)
    setMana(scenario, participantId)
    const card = handCard(scenario, participantId, 'classic_feral_spirit')
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    let nextPlayer = player(result.state, participantId)
    expect(
      nextPlayer.board.filter((minion) => minion.cardId === 'classic_spirit_wolf')
    ).toHaveLength(2)
    expect(nextPlayer.mana.available).toBe(7)
    expect(nextPlayer.mana.overloadNextTurn).toBe(2)
    expect(effectActions(result)).toEqual(
      expect.arrayContaining(['summon', 'overload'])
    )

    const endActive = scenario.match.dispatch({
      type: 'end-turn',
      participantId
    })
    expect(endActive.accepted).toBe(true)
    const endOpponent = scenario.match.dispatch({
      type: 'end-turn',
      participantId: endActive.state.activePlayerId!
    })
    expect(endOpponent.accepted).toBe(true)
    nextPlayer = player(scenario.match.getState(), participantId)
    expect(nextPlayer.mana).toMatchObject({
      maximum: 10,
      available: 8,
      overloadLocked: 2,
      overloadNextTurn: 0
    })
    expect(nextPlayer.overload).toBe(2)
  })

  it('rejects a choice with no legal target and a full-board play atomically', () => {
    const choice = createMatchScenario({
      seed: 504,
      cardId: 'classic_keeper_of_the_grove'
    })
    choice.confirmBothMulligans()
    const { participantId } = context(choice)
    setMana(choice, participantId)
    const choiceCard = handCard(choice, participantId, 'classic_keeper_of_the_grove')
    const silenceInput = choice.match.getPlayInput?.(
      participantId,
      choiceCard.instanceId,
      1
    )
    expect(silenceInput?.legalTargetOptions).toEqual([[]])
    const choiceBefore = choice.match.getState()
    const choiceResult = choice.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: choiceCard.instanceId,
      position: 0,
      choice: 1
    })
    expect(choiceResult.accepted).toBe(false)
    if (!choiceResult.accepted) {
      expect(choiceResult.code).toBe('missing-input')
      expect(choiceResult.state).toEqual(choiceBefore)
    }

    const full = createMatchScenario({ seed: 505, cardId: 'basic_acidic_swamp_ooze' })
    full.confirmBothMulligans()
    const fullContext = context(full)
    setMana(full, fullContext.participantId)
    for (let index = 0; index < 7; index += 1) {
      const summon = full.match.dispatch({
        type: 'dev-summon-minion',
        participantId: fullContext.participantId,
        cardId: 'basic_acidic_swamp_ooze'
      })
      expect(summon.accepted).toBe(true)
    }
    const fullBefore = full.match.getState()
    const minionCard = handCard(
      full,
      fullContext.participantId,
      'basic_acidic_swamp_ooze'
    )
    const fullResult = full.match.dispatch({
      type: 'play-card',
      participantId: fullContext.participantId,
      cardInstanceId: minionCard.instanceId,
      position: 0
    })
    expect(fullResult.accepted).toBe(false)
    if (!fullResult.accepted) {
      expect(fullResult.code).toBe('board-full')
      expect(fullResult.state).toEqual(fullBefore)
    }
  })

  it('draws multiple cards and burns only the overflow card at hand capacity', () => {
    const scenario = createMatchScenario({
      seed: 506,
      cardId: 'basic_arcane_intellect'
    })
    scenario.confirmBothMulligans()
    const { participantId } = context(scenario)
    setMana(scenario, participantId)
    while (player(scenario.match.getState(), participantId).hand.length < 10)
      addCard(scenario, participantId, 'basic_acidic_swamp_ooze')
    const before = scenario.match.getState()
    const card = handCard(scenario, participantId, 'basic_arcane_intellect')
    const beforeDeck = player(before, participantId).deck.length
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const nextPlayer = player(result.state, participantId)
    expect(nextPlayer.hand).toHaveLength(10)
    expect(nextPlayer.deck).toHaveLength(beforeDeck - 2)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'card-burned')).toHaveLength(
      1
    )
    expect(
      nextPlayer.discardedCards?.filter((entry) => entry.instanceId === card.instanceId)
    ).toHaveLength(1)
    expect(effectActions(result)).toEqual(expect.arrayContaining(['draw', 'burn']))
  })

  it('fatigues from an empty deck and discards Soulfire’s random hand card', () => {
    const fatigue = createMatchScenario({ seed: 507, cardId: 'basic_arcane_intellect' })
    fatigue.confirmBothMulligans()
    const fatigueContext = context(fatigue)
    setMana(fatigue, fatigueContext.participantId)
    const destroyDeck = fatigue.match.dispatch({
      type: 'dev-modify-deck',
      participantId: fatigueContext.participantId,
      action: 'destroy'
    })
    expect(destroyDeck.accepted).toBe(true)
    const beforeHealth = player(fatigue.match.getState(), fatigueContext.participantId)
      .hero.health
    const drawCard = handCard(
      fatigue,
      fatigueContext.participantId,
      'basic_arcane_intellect'
    )
    const fatigueResult = fatigue.match.dispatch({
      type: 'play-card',
      participantId: fatigueContext.participantId,
      cardInstanceId: drawCard.instanceId
    })
    expect(fatigueResult.accepted).toBe(true)
    if (!fatigueResult.accepted) return
    expect(player(fatigueResult.state, fatigueContext.participantId).hero.health).toBe(
      beforeHealth - 3
    )
    expect(
      fatigueResult.events.filter((event) => event.type === 'fatigue')
    ).toHaveLength(2)

    const soulfire = createMatchScenario({ seed: 508, cardId: 'basic_soulfire' })
    soulfire.confirmBothMulligans()
    const soulfireContext = context(soulfire)
    setMana(soulfire, soulfireContext.participantId)
    const soulCard = handCard(soulfire, soulfireContext.participantId, 'basic_soulfire')
    const soulResult = soulfire.match.dispatch({
      type: 'play-card',
      participantId: soulfireContext.participantId,
      cardInstanceId: soulCard.instanceId,
      targets: [{ kind: 'hero', participantId: soulfireContext.opponentId }]
    })
    expect(soulResult.accepted).toBe(true)
    if (!soulResult.accepted) return
    expect(player(soulResult.state, soulfireContext.opponentId).hero.health).toBe(26)
    expect(
      player(soulResult.state, soulfireContext.participantId).discardedCards
    ).toHaveLength(2)
    expect(effectActions(soulResult)).toEqual(
      expect.arrayContaining(['damage', 'discard'])
    )
  })

  it('reveals Tracking’s top three, draws the chosen card, and discards the rest', () => {
    const scenario = createMatchScenario({ seed: 509, cardId: 'basic_tracking' })
    scenario.confirmBothMulligans()
    const { participantId } = context(scenario)
    setMana(scenario, participantId)
    const card = handCard(scenario, participantId, 'basic_tracking')
    const input = scenario.match.getPlayInput?.(participantId, card.instanceId)
    const selected = input?.legalTargetOptions[0]?.[0]
    expect(input?.targetSelectors).toHaveLength(1)
    expect(input?.legalTargetOptions[0]).toHaveLength(3)
    expect(selected).toBeDefined()
    const before = scenario.match.getState()
    const beforePlayer = player(before, participantId)
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      targets: [selected!]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const nextPlayer = player(result.state, participantId)
    expect(nextPlayer.deck).toHaveLength(beforePlayer.deck.length - 3)
    expect(nextPlayer.hand).toHaveLength(beforePlayer.hand.length)
    expect(nextPlayer.revealedCards ?? []).toHaveLength(0)
    expect(nextPlayer.discardedCards).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(1)
    expect(effectActions(result)).toEqual(
      expect.arrayContaining(['reveal', 'draw', 'discard'])
    )
  })

  it('copies opponent deck cards, generates filtered cards, and preserves deterministic IDs', () => {
    const first = createMatchScenario({ seed: 510, cardId: 'classic_thoughtsteal' })
    const second = createMatchScenario({ seed: 510, cardId: 'classic_thoughtsteal' })
    for (const scenario of [first, second]) {
      scenario.confirmBothMulligans()
      const { participantId } = context(scenario)
      setMana(scenario, participantId)
      const card = handCard(scenario, participantId, 'classic_thoughtsteal')
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId
      })
      expect(result.accepted).toBe(true)
    }
    expect(first.match.getState()).toEqual(second.match.getState())
    const firstContext = context(first)
    const copied = player(first.match.getState(), firstContext.participantId)
    const opponentDeck = player(first.match.getState(), firstContext.opponentId).deck
    const copiedCards = copied.hand.filter(
      (entry) =>
        entry.cardId === opponentDeck[0]?.cardId &&
        entry.instanceId.includes(':generated:')
    )
    expect(copiedCards).toHaveLength(2)
    expect(
      copiedCards.every((entry) => entry.ownerId === firstContext.participantId)
    ).toBe(true)
    expect(opponentDeck).toHaveLength(26)

    const portal = createMatchScenario({
      seed: 511,
      cardId: 'goblins_vs_gnomes_unstable_portal'
    })
    portal.confirmBothMulligans()
    const { participantId } = context(portal)
    setMana(portal, participantId)
    const portalCard = handCard(
      portal,
      participantId,
      'goblins_vs_gnomes_unstable_portal'
    )
    const before = portal.match.getState()
    const portalResult = portal.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: portalCard.instanceId
    })
    expect(portalResult.accepted).toBe(true)
    if (!portalResult.accepted) return
    const beforeIds = new Set(
      player(before, participantId).hand.map((entry) => entry.instanceId)
    )
    const generated = player(portalResult.state, participantId).hand.find(
      (entry) => !beforeIds.has(entry.instanceId)
    )
    expect(generated).toBeDefined()
    expect(generated?.currentCost).toBe(Math.max(0, (generated?.baseCost ?? 0) - 3))
    expect(generated?.costAdjustments).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: -3 })])
    )
    expect(effectActions(portalResult)).toEqual(
      expect.arrayContaining(['add-to-hand', 'change-cost'])
    )
  })

  it('derives empty and temporary mana changes and restores aura cost when its source leaves play', () => {
    const growth = createMatchScenario({ seed: 512, cardId: 'basic_wild_growth' })
    growth.confirmBothMulligans()
    const growthContext = context(growth)
    setMana(growth, growthContext.participantId, 5, 5)
    const growthCard = handCard(
      growth,
      growthContext.participantId,
      'basic_wild_growth'
    )
    const growthResult = growth.match.dispatch({
      type: 'play-card',
      participantId: growthContext.participantId,
      cardInstanceId: growthCard.instanceId
    })
    expect(growthResult.accepted).toBe(true)
    if (!growthResult.accepted) return
    expect(player(growthResult.state, growthContext.participantId).mana).toMatchObject({
      maximum: 6,
      available: 3
    })

    const innervate = createMatchScenario({ seed: 513, cardId: 'basic_innervate' })
    innervate.confirmBothMulligans()
    const innervateContext = context(innervate)
    setMana(innervate, innervateContext.participantId, 5, 5)
    const innervateCard = handCard(
      innervate,
      innervateContext.participantId,
      'basic_innervate'
    )
    const innervateResult = innervate.match.dispatch({
      type: 'play-card',
      participantId: innervateContext.participantId,
      cardInstanceId: innervateCard.instanceId
    })
    expect(innervateResult.accepted).toBe(true)
    if (!innervateResult.accepted) return
    expect(
      player(innervateResult.state, innervateContext.participantId).mana
    ).toMatchObject({
      maximum: 5,
      available: 7,
      temporary: 2
    })

    const aura = createMatchScenario({
      seed: 514,
      cardId: 'classic_sorcerers_apprentice'
    })
    aura.confirmBothMulligans()
    const auraContext = context(aura)
    setMana(aura, auraContext.participantId)
    addCard(aura, auraContext.participantId, 'basic_fireball')
    const apprentice = handCard(
      aura,
      auraContext.participantId,
      'classic_sorcerers_apprentice'
    )
    const fireballBefore = handCard(aura, auraContext.participantId, 'basic_fireball')
    expect(fireballBefore.currentCost).toBe(4)
    const auraResult = aura.match.dispatch({
      type: 'play-card',
      participantId: auraContext.participantId,
      cardInstanceId: apprentice.instanceId,
      position: 0
    })
    expect(auraResult.accepted).toBe(true)
    if (!auraResult.accepted) return
    const fireballAfter = handCard(aura, auraContext.participantId, 'basic_fireball')
    expect(fireballAfter.currentCost).toBe(3)
    expect(
      aura.match.getPlayInput?.(auraContext.participantId, fireballAfter.instanceId)
        ?.currentCost
    ).toBe(3)
    expect(
      aura.match.dispatch({
        type: 'dev-clear-zone',
        participantId: auraContext.participantId,
        zone: 'board'
      }).accepted
    ).toBe(true)
    expect(
      handCard(aura, auraContext.participantId, 'basic_fireball').currentCost
    ).toBe(4)
  })
  it('activates Combo only after a previous card-play boundary and leaves a clean non-combo base', () => {
    const combo = createMatchScenario({ seed: 515, cardId: 'classic_edwin_vancleef' })
    combo.confirmBothMulligans()
    const comboContext = context(combo)
    setMana(combo, comboContext.participantId)
    addCard(combo, comboContext.participantId, 'basic_the_coin')
    const coin = handCard(combo, comboContext.participantId, 'basic_the_coin')
    const coinResult = combo.match.dispatch({
      type: 'play-card',
      participantId: comboContext.participantId,
      cardInstanceId: coin.instanceId
    })
    expect(coinResult.accepted).toBe(true)
    const edwin = handCard(combo, comboContext.participantId, 'classic_edwin_vancleef')
    const comboResult = combo.match.dispatch({
      type: 'play-card',
      participantId: comboContext.participantId,
      cardInstanceId: edwin.instanceId,
      position: 0
    })
    expect(comboResult.accepted).toBe(true)
    if (!comboResult.accepted) return
    expect(
      player(comboResult.state, comboContext.participantId).board[0]
    ).toMatchObject({
      cardId: 'classic_edwin_vancleef',
      attack: 4,
      health: 4
    })

    const noCombo = createMatchScenario({ seed: 516, cardId: 'classic_edwin_vancleef' })
    noCombo.confirmBothMulligans()
    const noComboContext = context(noCombo)
    setMana(noCombo, noComboContext.participantId)
    const noComboEdwin = handCard(
      noCombo,
      noComboContext.participantId,
      'classic_edwin_vancleef'
    )
    const noComboResult = noCombo.match.dispatch({
      type: 'play-card',
      participantId: noComboContext.participantId,
      cardInstanceId: noComboEdwin.instanceId,
      position: 0
    })
    expect(noComboResult.accepted).toBe(true)
    if (!noComboResult.accepted) return
    expect(
      player(noComboResult.state, noComboContext.participantId).board[0]
    ).toMatchObject({
      attack: 2,
      health: 2
    })
  })

  it('shuffles generated Mine cards for Iron Juggernaut and draws to a turn-player hand target', () => {
    const juggernaut = createMatchScenario({
      seed: 517,
      cardId: 'goblins_vs_gnomes_iron_juggernaut'
    })
    juggernaut.confirmBothMulligans()
    const juggernautContext = context(juggernaut)
    setMana(juggernaut, juggernautContext.participantId)
    const card = handCard(
      juggernaut,
      juggernautContext.participantId,
      'goblins_vs_gnomes_iron_juggernaut'
    )
    const beforeOpponentDeck = player(
      juggernaut.match.getState(),
      juggernautContext.opponentId
    ).deck.length
    const result = juggernaut.match.dispatch({
      type: 'play-card',
      participantId: juggernautContext.participantId,
      cardInstanceId: card.instanceId,
      position: 0
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const opponent = player(result.state, juggernautContext.opponentId)
    expect(opponent.deck).toHaveLength(beforeOpponentDeck + 1)
    expect(
      opponent.deck.filter(
        (entry) => entry.cardId === 'goblins_vs_gnomes_burrowing_mine'
      )
    ).toHaveLength(1)
    const mine = opponent.deck.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_burrowing_mine'
    )!
    expect(mine).toMatchObject({
      ownerId: juggernautContext.opponentId,
      controllerId: juggernautContext.opponentId,
      zone: 'deck',
      revealed: false
    })
    expect(effectActions(result)).toContain('shuffle-into-deck')

    const jeeves = createMatchScenario({
      seed: 518,
      cardId: 'goblins_vs_gnomes_jeeves'
    })
    jeeves.confirmBothMulligans()
    const jeevesContext = context(jeeves)
    setMana(jeeves, jeevesContext.participantId)
    const jeevesCard = handCard(
      jeeves,
      jeevesContext.participantId,
      'goblins_vs_gnomes_jeeves'
    )
    const jeevesPlay = jeeves.match.dispatch({
      type: 'play-card',
      participantId: jeevesContext.participantId,
      cardInstanceId: jeevesCard.instanceId,
      position: 0
    })
    expect(jeevesPlay.accepted).toBe(true)
    const endTurn = jeeves.match.dispatch({
      type: 'end-turn',
      participantId: jeevesContext.participantId
    })
    expect(endTurn.accepted).toBe(true)
    expect(
      player(jeeves.match.getState(), jeevesContext.participantId).hand
    ).toHaveLength(3)
  })
})
