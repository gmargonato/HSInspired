import { describe, expect, it } from 'vitest'
import { asCardId, CARD_CATALOG, cardHasTribe } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'

function player(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string
) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

describe('aura-modified hero powers', () => {
  it('reports hero powers unavailable while Mindbreaker disables them', () => {
    const scenario = createMatchScenario({ seed: 1200 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find((id) => id !== participantId)!

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'knights_of_the_frozen_throne_mindbreaker'
      }).accepted
    ).toBe(true)

    expect(player(scenario, participantId).heroPower.available).toBe(false)
    expect(scenario.match.getLegality!(participantId).legalHeroPower).toBe(false)
    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId })
    ).toMatchObject({ accepted: false, code: 'hero-power-unavailable' })
  })

  it.each(['rexxar', 'jaina', 'garrosh', 'guldan', 'anduin'])(
    'only modifies Hunter powers, including upgrades, for %s',
    (heroId) => {
      const scenario = createMatchScenario({
        firstHeroId: heroId,
        secondHeroId: heroId
      })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      const before = player(scenario, participantId).heroPower.targetingGranted
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'goblins_vs_gnomes_steamwheedle_sniper'
        }).accepted
      ).toBe(true)
      expect(player(scenario, participantId).heroPower.targetingGranted).toBe(
        heroId === 'rexxar' ? 'minion' : before
      )
      expect(
        scenario.match.dispatch({
          type: 'dev-set-mana',
          participantId,
          available: 10,
          maximum: 10
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: asCardId('the_grand_tournament_justicar_trueheart')
        }).accepted
      ).toBe(true)
      const justicar = player(scenario, participantId).hand.find(
        (card) => card.cardId === 'the_grand_tournament_justicar_trueheart'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: justicar.instanceId,
          position: 1
        }).accepted
      ).toBe(true)
      const power = player(scenario, participantId).heroPower
      expect(power.targetingGranted).toBe(
        heroId === 'rexxar' ? 'minion' : power.targetType
      )
      if (heroId === 'rexxar') expect(power.id).toBe('hunter-ballista-shot')
    }
  )

  it('uses Steamwheedle Sniper targeting against the selected minion', () => {
    const scenario = createMatchScenario({
      seed: 1201,
      firstHeroId: 'rexxar',
      secondHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find((id) => id !== participantId)!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_steamwheedle_sniper'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, opponentId).board[0]!

    const legality = scenario.match.getLegality!(participantId)
    expect(legality.legalHeroPower).toBe(true)
    expect(legality.legalHeroPowerTargets).toContainEqual({
      kind: 'minion',
      participantId: opponentId,
      instanceId: target.instanceId
    })
    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId })
    ).toMatchObject({ accepted: false, code: 'invalid-target' })
    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId: opponentId,
          instanceId: target.instanceId
        }
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(player(scenario, opponentId).hero.health).toBe(30)
  })

  it('limits Dinomancy to friendly Beasts and rejects other friendly minions', () => {
    const scenario = createMatchScenario({
      seed: 1202,
      firstHeroId: 'rexxar',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const beast = CARD_CATALOG.all.find(
      (card) => card.type === 'Minion' && cardHasTribe(card, 'Beast')
    )!

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: asCardId('journey_to_ungoro_dinomancy')
      }).accepted
    ).toBe(true)
    const dinomancy = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'journey_to_ungoro_dinomancy'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: dinomancy.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: beast.id
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)

    const ownBoard = player(scenario, participantId).board
    const beastMinion = ownBoard.find((minion) => minion.cardId === beast.id)!
    const nonBeastMinion = ownBoard.find(
      (minion) => minion.cardId === 'basic_acidic_swamp_ooze'
    )!
    const legality = scenario.match.getLegality!(participantId)
    expect(player(scenario, participantId).heroPower.targetType).toBe('friendly-beast')
    expect(legality.legalHeroPowerTargets).toEqual([
      {
        kind: 'minion',
        participantId,
        instanceId: beastMinion.instanceId
      }
    ])

    const manaBeforeUse = player(scenario, participantId).mana.available
    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId,
          instanceId: nonBeastMinion.instanceId
        }
      })
    ).toMatchObject({ accepted: false, code: 'invalid-target' })
    expect(player(scenario, participantId).mana.available).toBe(manaBeforeUse)
    expect(player(scenario, participantId).heroPower.available).toBe(true)

    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId,
          instanceId: beastMinion.instanceId
        }
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === beastMinion.instanceId
      )
    ).toMatchObject({ attack: beastMinion.attack + 3, health: beastMinion.health + 3 })
  })
})

describe('explicit hero power VFX', () => {
  it.each(['jaina', 'rexxar', 'guldan'])(
    '%s uses only its authored visual for either participant',
    (heroId) => {
      const s = createMatchScenario({ firstHeroId: heroId, secondHeroId: heroId })
      s.confirmBothMulligans()
      for (let turn = 0; turn < 2; turn++) {
        const id = s.match.getState().activePlayerId!
        const enemy = s.participants.find((other) => other !== id)!
        s.match.dispatch({
          type: 'dev-set-mana',
          participantId: id,
          available: 10,
          maximum: 10
        })
        const result = s.match.dispatch({
          type: 'use-hero-power',
          participantId: id,
          ...(heroId === 'jaina'
            ? { target: { kind: 'hero' as const, participantId: enemy } }
            : {})
        })
        expect(result.accepted).toBe(true)
        if (!result.accepted) throw new Error(result.message)
        const cues = result.events.filter((e) => e.type === 'effect-vfx-started')
        if (heroId === 'guldan') expect(cues).toHaveLength(0)
        else {
          expect(cues).toHaveLength(1)
          expect(cues[0]).toMatchObject({
            origin: 'hero-power',
            controllerId: id,
            vfxId: heroId === 'jaina' ? 'fire-missile-small' : 'neutral-missile-raw',
            targetInstanceIds: [enemy + ':hero']
          })
          const outcome = result.events.find((e) => e.type === 'character-damaged')
          expect(outcome).toBeDefined()
          expect(result.events.indexOf(cues[0])).toBeLessThan(
            result.events.indexOf(outcome!)
          )
        }
        s.match.dispatch({ type: 'end-turn', participantId: id })
      }
    }
  )
})

describe('Charged Hammer replacement', () => {
  it.each(['thrall', 'jaina'])(
    'replaces %s power with a refreshed, targeted Lightning Jolt',
    (heroId) => {
      const s = createMatchScenario({
        cardId: 'the_grand_tournament_charged_hammer',
        firstHeroId: heroId,
        secondHeroId: heroId
      })
      s.confirmBothMulligans()
      const own = s.match.getState().activePlayerId!
      const enemy = s.participants.find((id) => id !== own)!
      const mana = () =>
        s.match.dispatch({
          type: 'dev-set-mana',
          participantId: own,
          available: 10,
          maximum: 10
        })
      const equip = () => {
        mana()
        const result = s.match.dispatch({
          type: 'play-card',
          participantId: own,
          cardInstanceId: player(s, own).hand.find(
            (c) => c.cardId === 'the_grand_tournament_charged_hammer'
          )!.instanceId
        })
        expect(result.accepted).toBe(true)
        return result
      }
      mana()
      expect(
        s.match.dispatch({
          type: 'use-hero-power',
          participantId: own,
          ...(heroId === 'jaina'
            ? { target: { kind: 'hero' as const, participantId: enemy } }
            : {})
        }).accepted
      ).toBe(true)
      equip()
      expect(player(s, own).heroPower.available).toBe(false)
      const replacement = equip() // Replacing the equipped weapon triggers its Deathrattle.
      expect(replacement.events).toContainEqual(
        expect.objectContaining({
          type: 'hero-power-replaced',
          heroPowerId: 'shaman-lightning-jolt'
        })
      )
      expect(player(s, own).heroPower).toMatchObject({
        id: 'shaman-lightning-jolt',
        cost: 2,
        baseCost: 2,
        targetType: 'any-character',
        available: true,
        usesThisTurn: 0
      })
      expect(player(s, own).heroPower.effectOverride).toBeUndefined()
      expect(
        s.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
      ).toBe(false)
      const before = player(s, enemy).hero.health
      const manaBefore = player(s, own).mana.available
      const result = s.match.dispatch({
        type: 'use-hero-power',
        participantId: own,
        target: { kind: 'hero', participantId: enemy }
      })
      expect(result.accepted).toBe(true)
      expect(player(s, enemy).hero.health).toBe(before - 2)
      expect(player(s, own).mana.available).toBe(manaBefore - 2)
      expect(
        result.events.filter((e) => e.type === 'effect-vfx-started')
      ).toMatchObject([
        {
          vfxId: 'frost-missile-small',
          origin: 'hero-power',
          controllerId: own,
          targetInstanceIds: [enemy + ':hero']
        }
      ])
      expect(
        s.match.dispatch({
          type: 'use-hero-power',
          participantId: own,
          target: { kind: 'hero', participantId: enemy }
        }).accepted
      ).toBe(false)
      equip()
      expect(player(s, own).heroPower).toMatchObject({
        id: 'shaman-lightning-jolt',
        available: true,
        usesThisTurn: 0
      })
      const ownHealth = player(s, own).hero.health
      expect(
        s.match.dispatch({
          type: 'use-hero-power',
          participantId: own,
          target: { kind: 'hero', participantId: own }
        }).accepted
      ).toBe(true)
      expect(player(s, own).hero.health).toBe(ownHealth - 2)
    }
  )
})

it('retains a triggered missile impact when a hero power kills a deathrattle minion', () => {
  const s = createMatchScenario({ firstHeroId: 'jaina', secondHeroId: 'jaina' })
  s.confirmBothMulligans()
  const own = s.match.getState().activePlayerId!
  const enemy = s.participants.find((id) => id !== own)!
  s.match.dispatch({
    type: 'dev-set-mana',
    participantId: own,
    available: 10,
    maximum: 10
  })
  s.match.dispatch({
    type: 'dev-summon-minion',
    participantId: enemy,
    cardId: 'classic_leper_gnome'
  })
  const minion = player(s, enemy).board[0]
  const result = s.match.dispatch({
    type: 'use-hero-power',
    participantId: own,
    target: { kind: 'minion', participantId: enemy, instanceId: minion.instanceId }
  })
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(result.message)
  const cue = result.events.find(
    (e) => e.type === 'effect-vfx-started' && e.sourceInstanceId === minion.instanceId
  )
  expect(cue).toBeDefined()
  if (cue?.type !== 'effect-vfx-started') throw new Error('Missing deathrattle missile')
  const outcome = result.events.find(
    (e) => e.type === 'effect-resolved' && e.vfxGroupId === cue.vfxGroupId
  )
  expect(outcome).toMatchObject({ action: 'damage', data: { target: own + ':hero' } })
  expect(result.events.indexOf(outcome!)).toBeGreaterThan(result.events.indexOf(cue))
  const direct = result.events.find(
    (e) => e.type === 'effect-resolved' && e.actionPath.startsWith('hero-power.damage.')
  )
  expect(direct).toBeDefined()
  expect(result.events.indexOf(direct!)).toBeLessThan(result.events.indexOf(cue))
  expect(result.events.find((e) => e.type === 'character-damaged')).toMatchObject({
    vfxGroupId: direct?.type === 'effect-resolved' ? direct.vfxGroupId : undefined
  })
})
