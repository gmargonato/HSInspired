import { describe, expect, it } from 'vitest'
import {
  asCardId,
  asHeroPowerId,
  CARD_CATALOG,
  cardHasClass,
  cardHasTribe
} from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { createSeededRng } from '../rng'
import { resolveHeroPower } from './effect-runtime'
import type {
  BoardMinion,
  OpeningMatchEvent,
  OpeningMatchState
} from '../opening-match-types'

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

describe('Sing-Along Buddy hero power repetition', () => {
  const buddyId = 'future_past_sing_along_buddy'
  const horsemen = [
    'knights_of_the_frozen_throne_darion_mograine',
    'knights_of_the_frozen_throne_deathlord_nazgrim',
    'knights_of_the_frozen_throne_inquisitor_whitemane',
    'knights_of_the_frozen_throne_thoras_trollbane'
  ]

  function fixture(heroId = 'uther', buddies = 1) {
    const s = createMatchScenario({
      seed: 1234,
      firstHeroId: heroId,
      secondHeroId: heroId
    })
    s.confirmBothMulligans()
    const own = s.match.getState().activePlayerId!
    const enemy = s.participants.find((id) => id !== own)!
    expect(
      s.match.dispatch({
        type: 'dev-set-mana',
        participantId: own,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const summon = (cardId: string, participantId = own) => {
      const result = s.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId
      })
      expect(result.accepted).toBe(true)
      return player(s, participantId).board.at(-1)!
    }
    for (let index = 0; index < buddies; index += 1) summon(buddyId)
    return { s, own, enemy, summon }
  }

  function withBuddyState(
    state: OpeningMatchState,
    update: Partial<BoardMinion>
  ): OpeningMatchState {
    return {
      ...state,
      players: state.players.map((entry) => ({
        ...entry,
        board: entry.board.map((minion) =>
          minion.cardId === buddyId ? { ...minion, ...update } : minion
        )
      })) as unknown as OpeningMatchState['players']
    }
  }

  it('summons twice but pays, counts the activation, and triggers Inspire once', () => {
    const { s, own, summon } = fixture()
    const squire = summon('the_grand_tournament_lowly_squire')
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    expect(
      player(s, own).board.filter(
        (minion) => minion.cardId === 'basic_silver_hand_recruit'
      )
    ).toHaveLength(2)
    expect(
      player(s, own).board.find((minion) => minion.instanceId === squire.instanceId)
        ?.attack
    ).toBe(2)
    expect(player(s, own).mana.available).toBe(8)
    expect(player(s, own).heroPower).toMatchObject({
      usesThisTurn: 1,
      available: false
    })
    expect(result.state.history?.heroPowersUsedByPlayer[own]).toBe(1)
    expect(
      result.events.filter((event) => event.type === 'hero-power-used')
    ).toHaveLength(1)
    expect(
      result.events.filter((event) => event.type === 'hero-power-minion-summoned')
    ).toHaveLength(2)
  })

  it('does not stack additional copies of a triggers-twice aura', () => {
    const { s, own } = fixture('uther', 2)
    expect(
      s.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
    ).toBe(true)
    expect(
      player(s, own).board.filter(
        (minion) => minion.cardId === 'basic_silver_hand_recruit'
      )
    ).toHaveLength(2)
  })

  it('preserves baseline Inspire ordering and outcome reporting without Buddy', () => {
    const { s, own, summon } = fixture('jaina', 0)
    const medic = summon('the_grand_tournament_tournament_medic')
    expect(
      s.match.dispatch({ type: 'dev-set-hero', participantId: own, health: 20 })
        .accepted
    ).toBe(true)
    const result = s.match.dispatch({
      type: 'use-hero-power',
      participantId: own,
      target: { kind: 'hero', participantId: own }
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    expect(player(s, own).hero.health).toBe(21)
    const outcome = result.events.find((event) => event.type === 'character-damaged')!
    // The existing single-effect summary includes the subsequent Inspire heal.
    expect(outcome).toMatchObject({
      amount: 0,
      attemptedAmount: 1,
      healthBefore: 20,
      healthAfter: 21
    })
    const inspireIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.trigger === 'inspire' &&
        event.source.instanceId === medic.instanceId
    )
    expect(inspireIndex).toBeGreaterThanOrEqual(0)
    expect(inspireIndex).toBeLessThan(result.events.indexOf(outcome))
  })

  it.each([
    ['silenced', { silenced: true }],
    ['dormant', { dormant: true }],
    ['dead', { health: 0 }]
  ] as const)('ignores a %s aura source', (_name, update) => {
    const { s, own } = fixture()
    const result = resolveHeroPower({
      state: withBuddyState(s.match.getState(), update),
      participantId: own
    })
    expect(result.accepted).toBe(true)
    expect(
      result.state.players
        .find((entry) => entry.participantId === own)!
        .board.filter((minion) => minion.cardId === 'basic_silver_hand_recruit')
    ).toHaveLength(1)
  })

  it('ignores an opponent Buddy', () => {
    const { s, own, enemy, summon } = fixture('uther', 0)
    summon(buddyId, enemy)
    expect(
      s.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
    ).toBe(true)
    expect(player(s, own).board).toHaveLength(1)
  })

  it('reports two distinct targeted impacts with accurate per-hit amounts', () => {
    const { s, own, enemy } = fixture('jaina')
    const result = s.match.dispatch({
      type: 'use-hero-power',
      participantId: own,
      target: { kind: 'hero', participantId: enemy }
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    expect(player(s, enemy).hero.health).toBe(28)
    const hits = result.events.filter(
      (event): event is Extract<OpeningMatchEvent, { type: 'character-damaged' }> =>
        event.type === 'character-damaged'
    )
    expect(hits).toMatchObject([
      { amount: 1, attemptedAmount: 1, healthBefore: 30, healthAfter: 29 },
      { amount: 1, attemptedAmount: 1, healthBefore: 29, healthAfter: 28 }
    ])
    expect(new Set(hits.map((event) => event.vfxGroupId)).size).toBe(2)
  })

  it.each(['jaina', 'jaina-frost-lich'])(
    'never retargets %s after the first hit kills its target',
    (heroId) => {
      const { s, own, enemy, summon } = fixture(heroId)
      const target = summon('classic_wisp', enemy)
      const survivor = summon('basic_acidic_swamp_ooze', enemy)
      const result = s.match.dispatch({
        type: 'use-hero-power',
        participantId: own,
        target: { kind: 'minion', participantId: enemy, instanceId: target.instanceId }
      })
      expect(result.accepted).toBe(true)
      expect(player(s, enemy).board).toMatchObject([
        { instanceId: survivor.instanceId, health: 2 }
      ])
      expect(player(s, enemy).hero.health).toBe(30)
      expect(
        result.events.filter((event) => event.type === 'character-damaged')
      ).toHaveLength(1)
      if (heroId === 'jaina-frost-lich')
        expect(
          player(s, own).board.filter(
            (minion) => minion.cardId === 'basic_water_elemental'
          )
        ).toHaveLength(1)
    }
  )

  it('removes Divine Shield with the first hit and damages the same minion with the second', () => {
    const { s, own, enemy, summon } = fixture('jaina')
    const target = summon('classic_argent_squire', enemy)
    const result = s.match.dispatch({
      type: 'use-hero-power',
      participantId: own,
      target: { kind: 'minion', participantId: enemy, instanceId: target.instanceId }
    })
    expect(result.accepted).toBe(true)
    expect(player(s, enemy).board).toHaveLength(0)
    expect(
      result.events.filter((event) => event.type === 'character-damaged')
    ).toMatchObject([
      {
        character: { kind: 'minion', instanceId: target.instanceId },
        amount: 0,
        attemptedAmount: 1,
        healthBefore: 1,
        healthAfter: 1
      },
      {
        character: { kind: 'minion', instanceId: target.instanceId },
        amount: 1,
        attemptedAmount: 1,
        healthBefore: 1,
        healthAfter: 0
      }
    ])
  })

  it('keeps the activation snapshot when its Buddy dies to the first effect', () => {
    const { s, own, enemy, summon } = fixture('garrosh-scourgelord')
    summon('basic_acidic_swamp_ooze', enemy)
    const result = resolveHeroPower({
      state: withBuddyState(s.match.getState(), { health: 1, damageTaken: 3 }),
      participantId: own
    })
    expect(result.accepted).toBe(true)
    expect(
      result.state.players.find((entry) => entry.participantId === own)!.board
    ).toHaveLength(0)
    expect(
      result.state.players.find((entry) => entry.participantId === enemy)!.board
    ).toHaveLength(0)
  })

  it('stops repeating after the first effect kills a hero', () => {
    const { s, own } = fixture('guldan')
    expect(
      s.match.dispatch({ type: 'dev-set-hero', participantId: own, health: 2 }).accepted
    ).toBe(true)
    const before = player(s, own).deck.length
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    expect(player(s, own).deck).toHaveLength(before - 1)
    expect(
      result.events.filter((event) => event.type === 'character-damaged')
    ).toHaveLength(1)
    expect(result.state.phase).toBe('ended')
  })

  it('respects the board cap when only one summon slot remains', () => {
    const { s, own, summon } = fixture()
    for (let index = 0; index < 5; index += 1) summon('basic_acidic_swamp_ooze')
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    expect(player(s, own).board).toHaveLength(7)
    expect(player(s, own).mana.available).toBe(8)
    expect(
      result.events.filter((event) => event.type === 'hero-power-minion-summoned')
    ).toHaveLength(1)
  })

  it('rejects a summon power on an already full board without spending mana', () => {
    const { s, own, summon } = fixture()
    for (let index = 0; index < 6; index += 1) summon('basic_acidic_swamp_ooze')
    expect(
      s.match.dispatch({ type: 'use-hero-power', participantId: own })
    ).toMatchObject({ accepted: false, code: 'board-full' })
    expect(player(s, own).mana.available).toBe(10)
    expect(player(s, own).heroPower.usesThisTurn ?? 0).toBe(0)
  })

  it('recomputes random Totem eligibility before the repeated summon', () => {
    const { s, own, summon } = fixture('thrall')
    summon('basic_healing_totem')
    summon('basic_searing_totem')
    summon('basic_stoneclaw_totem')
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    expect(player(s, own).board).toHaveLength(5)
    expect(
      player(s, own).board.filter(
        (minion) => minion.cardId === 'basic_wrath_of_air_totem'
      )
    ).toHaveLength(1)
  })

  it('resolves damage and draw twice for one Life Tap activation', () => {
    const { s, own } = fixture('guldan')
    const before = player(s, own)
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    expect(player(s, own).hero.health).toBe(before.hero.health - 4)
    expect(player(s, own).deck).toHaveLength(before.deck.length - 2)
    expect(player(s, own).hand).toHaveLength(before.hand.length + 2)
    expect(player(s, own).mana.available).toBe(8)
    expect(
      result.events.filter((event) => event.type === 'character-damaged')
    ).toHaveLength(2)
  })

  it('reports the total armor gained by both effects', () => {
    const { s, own } = fixture('garrosh')
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    expect(player(s, own).hero.armor).toBe(4)
    expect(
      result.events.filter((event) => event.type === 'armor-gained')
    ).toMatchObject([{ amount: 4, armorBefore: 0, armorAfter: 4 }])
  })

  it('keeps added-card modifiers local to each repeated effect', () => {
    const { s, own } = fixture('jaina')
    const initial = s.match.getState()
    const before = new Set(player(s, own).hand.map((card) => card.instanceId))
    const state: OpeningMatchState = {
      ...initial,
      players: initial.players.map((entry) =>
        entry.participantId === own
          ? {
              ...entry,
              heroPower: {
                ...entry.heroPower,
                id: asHeroPowerId('saviors_of_uldum_ascendant_scroll'),
                targetType: 'none',
                targetingGranted: 'none'
              }
            }
          : entry
      ) as unknown as OpeningMatchState['players']
    }
    const pool = CARD_CATALOG.all.filter(
      (card) =>
        card.collectible &&
        card.type === 'Spell' &&
        !card.quest &&
        cardHasClass(card, 'Mage')
    )
    const index = pool.findIndex((card) => card.id === 'basic_flamestrike')
    expect(index).toBeGreaterThanOrEqual(0)
    const result = resolveHeroPower({
      state,
      participantId: own,
      rng: { ...createSeededRng(1), next: () => (index + 0.5) / pool.length }
    })
    expect(result.accepted).toBe(true)
    const added = result.state.players
      .find((entry) => entry.participantId === own)!
      .hand.filter((card) => !before.has(card.instanceId))
    expect(added).toHaveLength(2)
    for (const card of added) {
      expect(card.cardId).toBe('basic_flamestrike')
      expect(card.currentCost).toBe(CARD_CATALOG.require(card.cardId).cost - 2)
    }
  })

  it('queues both Build-a-Beast recipes and resolves each pair of choices', () => {
    const { s, own } = fixture('rexxar-deathstalker')
    const before = player(s, own).hand.length
    expect(
      s.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
    ).toBe(true)
    expect(s.match.getState().pendingCardChoice?.queued).toHaveLength(1)
    for (let index = 0; index < 4; index += 1) {
      const pending = s.match.getState().pendingCardChoice!
      expect(pending.resolution?.type).toBe('build-a-beast')
      expect(
        s.match.dispatch({
          type: 'choose-card-option',
          participantId: own,
          sourceCardInstanceId: pending.sourceCardInstanceId,
          choice: 0
        }).accepted
      ).toBe(true)
    }
    expect(s.match.getState().pendingCardChoice).toBeUndefined()
    expect(player(s, own).hand).toHaveLength(before + 2)
    expect(player(s, own).mana.available).toBe(8)
    expect(player(s, own).heroPower.usesThisTurn).toBe(1)
  })

  it('summons two different Horsemen and wins only once all four are present', () => {
    const { s, own, enemy, summon } = fixture('uther-ebon-blade')
    summon(horsemen[0])
    summon(horsemen[1])
    const before = s.match.getState()
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    const present = player(s, own).board.filter((minion) =>
      horsemen.includes(minion.cardId)
    )
    expect(new Set(present.map((minion) => minion.cardId)).size).toBe(4)
    expect(player(s, enemy).hero.health).toBe(0)
    expect(
      result.events.filter(
        (event) =>
          event.type === 'effect-resolved' &&
          event.actionPath === 'hero-power.four-horsemen.destroy-enemy-hero'
      )
    ).toHaveLength(1)
    expect(resolveHeroPower({ state: before, participantId: own })).toEqual(
      resolveHeroPower({ state: before, participantId: own })
    )
  })

  it('does not count duplicate Horsemen toward the four-distinct passive', () => {
    const { s, own, enemy, summon } = fixture('uther-ebon-blade')
    summon(horsemen[0])
    summon(horsemen[0])
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: own })
    expect(result.accepted).toBe(true)
    const present = player(s, own).board.filter((minion) =>
      horsemen.includes(minion.cardId)
    )
    expect(present).toHaveLength(4)
    expect(new Set(present.map((minion) => minion.cardId)).size).toBe(3)
    expect(player(s, enemy).hero.health).toBe(30)
    expect(result.state.phase).toBe('turns')
  })

  it.each([0, 1, 2])(
    'pays nine mana for Buddy, Commander, and two activations with %i starting filler minions',
    (fillers) => {
      const { s, own, enemy, summon } = fixture('uther-ebon-blade', 0)
      expect(
        s.match.dispatch({
          type: 'dev-set-mana',
          participantId: own,
          maximum: 9,
          available: 9
        }).accepted
      ).toBe(true)
      for (let index = 0; index < fillers; index += 1) summon('basic_acidic_swamp_ooze')
      for (const cardId of [buddyId, 'the_grand_tournament_garrison_commander']) {
        expect(
          s.match.dispatch({ type: 'dev-add-card', participantId: own, cardId })
            .accepted
        ).toBe(true)
        const card = player(s, own).hand.find((entry) => entry.cardId === cardId)!
        expect(
          s.match.dispatch({
            type: 'play-card',
            participantId: own,
            cardInstanceId: card.instanceId,
            position: player(s, own).board.length
          }).accepted
        ).toBe(true)
      }
      expect(player(s, own).mana.available).toBe(4)
      const first = s.match.dispatch({ type: 'use-hero-power', participantId: own })
      expect(first.accepted).toBe(true)
      expect(player(s, own).mana.available).toBe(2)
      expect(player(s, own).heroPower).toMatchObject({
        available: true,
        usesThisTurn: 1
      })
      expect(player(s, enemy).hero.health).toBe(30)
      const second = s.match.dispatch({ type: 'use-hero-power', participantId: own })
      expect(second.accepted).toBe(true)
      expect(player(s, own).mana.available).toBe(0)
      expect(player(s, own).heroPower).toMatchObject({
        available: false,
        usesThisTurn: 2
      })
      expect(second.state.history?.heroPowersUsedByPlayer[own]).toBe(2)
      const present = player(s, own).board.filter((minion) =>
        horsemen.includes(minion.cardId)
      )
      expect(new Set(present.map((minion) => minion.cardId)).size).toBe(
        fillers < 2 ? 4 : 3
      )
      expect(player(s, own).board).toHaveLength(Math.min(7, fillers + 6))
      expect(player(s, enemy).hero.health).toBe(fillers < 2 ? 0 : 30)
      expect(second.state.phase).toBe(fillers < 2 ? 'ended' : 'turns')
      expect(
        [...first.events, ...second.events].filter(
          (event) => event.type === 'hero-power-used'
        )
      ).toHaveLength(2)
    }
  )
  it('cannot complete the paid combo from eight mana after the Buddy nerf', () => {
    const { s, own, enemy } = fixture('uther-ebon-blade', 0)
    expect(
      s.match.dispatch({
        type: 'dev-set-mana',
        participantId: own,
        maximum: 8,
        available: 8
      }).accepted
    ).toBe(true)
    for (const cardId of [buddyId, 'the_grand_tournament_garrison_commander']) {
      expect(
        s.match.dispatch({ type: 'dev-add-card', participantId: own, cardId }).accepted
      ).toBe(true)
      const card = player(s, own).hand.find((entry) => entry.cardId === cardId)!
      expect(
        s.match.dispatch({
          type: 'play-card',
          participantId: own,
          cardInstanceId: card.instanceId,
          position: player(s, own).board.length
        }).accepted
      ).toBe(true)
    }
    expect(player(s, own).mana.available).toBe(3)
    expect(
      s.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
    ).toBe(true)
    expect(player(s, own).mana.available).toBe(1)
    expect(
      s.match.dispatch({ type: 'use-hero-power', participantId: own }).accepted
    ).toBe(false)
    expect(player(s, own).mana.available).toBe(1)
    expect(
      player(s, own).board.filter((minion) => horsemen.includes(minion.cardId))
    ).toHaveLength(2)
    expect(player(s, enemy).hero.health).toBe(30)
  })
})
