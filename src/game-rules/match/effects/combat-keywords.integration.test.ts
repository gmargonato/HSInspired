import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../content/cards'
import { getMatchLegality, resolveAttack } from './effect-runtime'
import type { BoardMinion } from '../opening-match-types'
import {
  effectiveBoardMinionKeywords,
  isBoardMinionSleeping
} from '../rules/minion-attack-state'
import { enumerateLegalCommands } from '../ai/legal-commands'
import { canBoardMinionAttack, canHeroAttack, getHeroAttack } from '../opening-match'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

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

function summon(scenario: Scenario, participantId: string, cardId: string) {
  const result = scenario.match.dispatch({
    type: 'dev-summon-minion',
    participantId,
    cardId
  })
  expect(result.accepted).toBe(true)
  return player(scenario, participantId).board.at(-1)!
}

function attack(
  scenario: Scenario,
  participantId: string,
  attacker: { kind: 'hero' } | { kind: 'minion'; instanceId: string },
  defender: { kind: 'hero' } | { kind: 'minion'; instanceId: string }
) {
  return scenario.match.dispatch({
    type: 'attack-character',
    participantId,
    attacker,
    defender
  })
}

function beginNextTurn(scenario: Scenario, participantId: string, opponentId: string) {
  expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
    true
  )
  expect(
    scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
  ).toBe(true)
}

describe('combat keyword matrix', () => {
  function shieldScenario(cardId: string) {
    const scenario = createMatchScenario({ seed: 1002, cardId })
    scenario.confirmBothMulligans()
    const [own, enemy] = activePlayers(scenario)
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId: own,
      available: 10,
      maximum: 10
    })
    const play = (id: string, target?: BoardMinion, owner = own) => {
      scenario.match.dispatch({ type: 'dev-add-card', participantId: own, cardId: id })
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: own,
        available: 10,
        maximum: 10
      })
      const card = player(scenario, own).hand.find((entry) => entry.cardId === id)!
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId: own,
        cardInstanceId: card.instanceId,
        ...(CARD_CATALOG.require(id).type === 'Minion'
          ? { position: player(scenario, own).board.length }
          : {}),
        ...(target
          ? {
              targets: [
                {
                  kind: 'minion' as const,
                  participantId: owner,
                  instanceId: target.instanceId
                }
              ]
            }
          : {})
      })
      expect(result).toMatchObject({ accepted: true })
      return result
    }
    return { scenario, own, enemy, play }
  }

  it('removes consumed shields from effective keywords and restores them only on a fresh grant', () => {
    const { scenario, own, play } = shieldScenario('classic_cruel_taskmaster')
    const squire = summon(scenario, own, 'classic_argent_squire')
    play('classic_cruel_taskmaster', squire)
    const current = () =>
      player(scenario, own).board.find(
        (entry) => entry.instanceId === squire.instanceId
      )!
    expect(current()).toMatchObject({
      attack: 3,
      health: 1,
      divineShield: false,
      divineShieldConsumed: true
    })
    expect(effectiveBoardMinionKeywords(current())).not.toContain('divine-shield')
    play('classic_argent_protector', squire)
    expect(current()).toMatchObject({ divineShield: true, divineShieldConsumed: false })
    expect(effectiveBoardMinionKeywords(current())).toContain('divine-shield')
    play('classic_cruel_taskmaster', squire)
    expect(current()).toMatchObject({ attack: 5, health: 1, divineShield: false })
  })

  it('records shield absorption before the resulting Bolvar trigger', () => {
    const { scenario, own, play } = shieldScenario('classic_cruel_taskmaster')
    const bolvar = summon(
      scenario,
      own,
      'knights_of_the_frozen_throne_bolvar_fireblood'
    )
    const squire = summon(scenario, own, 'classic_argent_squire')
    const result = play('classic_cruel_taskmaster', squire)
    const damage = result.events.findIndex(
      (event) => event.type === 'effect-resolved' && event.data?.shieldConsumed === true
    )
    const trigger = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === bolvar.instanceId
    )
    expect(damage).toBeGreaterThanOrEqual(0)
    expect(trigger).toBeGreaterThan(damage)
    expect(
      player(scenario, own).board.find(
        (entry) => entry.instanceId === bolvar.instanceId
      )?.attack
    ).toBe(bolvar.attack + 2)
  })

  it('removes all shields with Blood Knight, counts each once, and permits a new grant', () => {
    const { scenario, own, enemy, play } = shieldScenario('classic_blood_knight')
    const friendly = summon(scenario, own, 'classic_argent_squire')
    summon(scenario, enemy, 'classic_argent_squire')
    play('classic_blood_knight')
    expect(
      player(scenario, own).board.find(
        (entry) => entry.cardId === 'classic_blood_knight'
      )
    ).toMatchObject({ attack: 9, health: 9 })
    expect(player(scenario, own).board[0].divineShield).toBe(false)
    expect(player(scenario, enemy).board[0].divineShield).toBe(false)
    play('classic_argent_protector', friendly)
    expect(player(scenario, own).board[0].divineShield).toBe(true)
  })

  it('finishes simultaneous area damage before reacting to shield loss', () => {
    const { scenario, own, play } = shieldScenario('basic_whirlwind')
    const bolvar = summon(
      scenario,
      own,
      'knights_of_the_frozen_throne_bolvar_fireblood'
    )
    summon(scenario, own, 'classic_argent_squire')
    summon(scenario, own, 'basic_chillwind_yeti')
    const result = play('basic_whirlwind')
    const damages = result.events.flatMap((event, index) =>
      event.type === 'effect-resolved' && event.action === 'damage' ? [index] : []
    )
    const trigger = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === bolvar.instanceId
    )
    expect(damages).toHaveLength(3)
    expect(trigger).toBeGreaterThan(Math.max(...damages))
    expect(player(scenario, own).board[0]).toMatchObject({
      attack: bolvar.attack + 4,
      health: bolvar.health,
      divineShield: false
    })
    expect(player(scenario, own).board[2].health).toBe(4)
  })

  it('silences a shield, then allows a granted shield to absorb damage without damage triggers', () => {
    const { scenario, own, play } = shieldScenario('classic_silence')
    const squire = summon(scenario, own, 'classic_argent_squire')
    const berserker = summon(scenario, own, 'classic_frothing_berserker')
    play('classic_silence', squire)
    expect(player(scenario, own).board[0]).toMatchObject({
      silenced: true,
      divineShield: false
    })
    play('classic_argent_protector', squire)
    expect(player(scenario, own).board[0].divineShield).toBe(true)
    play('classic_cruel_taskmaster', squire)
    expect(player(scenario, own).board[0]).toMatchObject({
      health: 1,
      attack: 3,
      divineShield: false
    })
    expect(player(scenario, own).board[1].attack).toBe(berserker.attack)
  })

  it('does not consume a shield when the incoming damage is zero', () => {
    const { scenario, own, enemy } = shieldScenario('basic_fireball')
    const attacker = summon(scenario, own, 'classic_alakir_the_windlord')
    const defender = summon(scenario, enemy, 'classic_shieldbearer')
    expect(
      attack(
        scenario,
        own,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: defender.instanceId }
      ).accepted
    ).toBe(true)
    expect(player(scenario, own).board[0]).toMatchObject({
      health: attacker.health,
      divineShield: true
    })
  })

  it.each([
    'classic_emperor_cobra',
    'basic_water_elemental',
    'mean_streets_of_gadgetzan_wickerflame_burnbristle'
  ])('shield absorption blocks damage consequences from %s', (cardId) => {
    const { scenario, own, enemy } = shieldScenario('basic_fireball')
    const attacker = summon(scenario, own, cardId)
    const defender = summon(scenario, enemy, 'classic_argent_squire')
    beginNextTurn(scenario, own, enemy)
    scenario.match.dispatch({ type: 'dev-set-hero', participantId: own, health: 20 })
    expect(
      attack(
        scenario,
        own,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: defender.instanceId }
      ).accepted
    ).toBe(true)
    const survivor = player(scenario, enemy).board[0]
    expect(survivor).toMatchObject({
      instanceId: defender.instanceId,
      health: 1,
      divineShield: false
    })
    expect(survivor.frozenUntilTurn ?? null).toBeNull()
    expect(player(scenario, own).hero.health).toBe(20)
  })

  it('immunity prevents damage without spending Divine Shield', () => {
    const { scenario, own, play } = shieldScenario('classic_bestial_wrath')
    const beast = summon(scenario, own, 'basic_bloodfen_raptor')
    play('classic_argent_protector', beast)
    play('classic_bestial_wrath', beast)
    play('classic_cruel_taskmaster', beast)
    expect(player(scenario, own).board[0]).toMatchObject({
      health: beast.health,
      divineShield: true,
      immune: true
    })
  })

  it.each(['basic_assassinate', 'basic_polymorph'])(
    '%s bypasses Divine Shield',
    (cardId) => {
      const { scenario, enemy, play } = shieldScenario(cardId)
      const squire = summon(scenario, enemy, 'classic_argent_squire')
      play(cardId, squire, enemy)
      if (cardId === 'basic_assassinate')
        expect(player(scenario, enemy).board).toHaveLength(0)
      else
        expect(player(scenario, enemy).board[0]).toMatchObject({
          cardId: 'basic_sheep',
          divineShield: false
        })
    }
  )

  it('summons a 1/1 Ooze from Bilefin Tidehunter and enforces its Taunt', () => {
    const scenario = createMatchScenario({
      seed: 1001,
      cardId: 'whispers_of_the_old_gods_bilefin_tidehunter'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'whispers_of_the_old_gods_bilefin_tidehunter'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const board = player(scenario, participantId).board
    expect(board).toHaveLength(2)
    const ooze = board.find(
      (minion) => minion.cardId === 'whispers_of_the_old_gods_ooze'
    )!
    expect(ooze).toMatchObject({
      attack: 1,
      health: 1,
      maxHealth: 1,
      keywords: expect.arrayContaining(['taunt'])
    })
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    const attacker = summon(scenario, opponentId, 'basic_stonetusk_boar')
    for (const defender of [
      { kind: 'hero' as const },
      { kind: 'minion' as const, instanceId: card.instanceId }
    ]) {
      expect(
        attack(
          scenario,
          opponentId,
          { kind: 'minion', instanceId: attacker.instanceId },
          defender
        )
      ).toMatchObject({ accepted: false, code: 'invalid-target' })
    }
    expect(
      attack(
        scenario,
        opponentId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: ooze.instanceId }
      ).accepted
    ).toBe(true)
  })

  it('keeps Infested Tauren deathrattle Slime at 2/2 without Taunt', () => {
    const scenario = createMatchScenario({ seed: 1001, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const tauren = summon(
      scenario,
      opponentId,
      'whispers_of_the_old_gods_infested_tauren'
    )
    const fireball = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_fireball'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: fireball.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: tauren.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(1)
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      cardId: 'whispers_of_the_old_gods_slime',
      attack: 2,
      health: 2,
      maxHealth: 2,
      keywords: []
    })
  })

  it('enforces Taunt and Stealth target legality while allowing a Charge attacker immediately', () => {
    const scenario = createMatchScenario({ seed: 1001 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'basic_stonetusk_boar')
    expect(
      canBoardMinionAttack(attacker, scenario.match.getState(), participantId)
    ).toBe(true)
    const taunt = summon(scenario, opponentId, 'basic_goldshire_footman')
    const stealth = summon(scenario, opponentId, 'classic_worgen_infiltrator')

    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'invalid-target'
    })
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: stealth.instanceId }
      )
    ).toMatchObject({
      accepted: false,
      code: 'invalid-target'
    })
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: taunt.instanceId }
      ).accepted
    ).toBe(true)
  })

  it('keeps a Frozen armed hero out of attacker legality until Freeze expires', () => {
    const scenario = createMatchScenario({
      seed: 1008,
      cardId: 'classic_ice_lance'
    })
    scenario.confirmBothMulligans()
    const [freezingPlayerId, frozenPlayerId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: freezingPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const iceLance = player(scenario, freezingPlayerId).hand.find(
      (card) => card.cardId === 'classic_ice_lance'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: freezingPlayerId,
        cardInstanceId: iceLance.instanceId,
        targets: [{ kind: 'hero', participantId: frozenPlayerId }]
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: freezingPlayerId
      }).accepted
    ).toBe(true)

    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: frozenPlayerId,
        cardId: 'basic_fiery_war_axe'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: frozenPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const weapon = player(scenario, frozenPlayerId).hand.find(
      (card) => card.cardId === 'basic_fiery_war_axe'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: frozenPlayerId,
        cardInstanceId: weapon.instanceId
      }).accepted
    ).toBe(true)

    const frozenPlayer = player(scenario, frozenPlayerId)
    const frozenState = scenario.match.getState()
    const heroAttackerId = `${frozenPlayerId}:hero`
    expect(getHeroAttack(frozenPlayer)).toBeGreaterThan(0)
    expect(frozenPlayer.hero.frozenUntilTurn).toBeGreaterThanOrEqual(
      frozenState.turnNumber
    )
    expect(
      scenario.match.getLegality?.(frozenPlayerId).legalAttackTargets[heroAttackerId]
    ).toBeUndefined()
    expect(canHeroAttack(frozenPlayer, frozenState, frozenPlayerId)).toBe(false)
    expect(
      attack(scenario, frozenPlayerId, { kind: 'hero' }, { kind: 'hero' })
    ).toMatchObject({ accepted: false, code: 'hero-cannot-attack' })

    beginNextTurn(scenario, frozenPlayerId, freezingPlayerId)
    const thawedPlayer = player(scenario, frozenPlayerId)
    const thawedState = scenario.match.getState()
    expect(
      scenario.match.getLegality?.(frozenPlayerId).legalAttackTargets[heroAttackerId]
    ).toBeDefined()
    expect(canHeroAttack(thawedPlayer, thawedState, frozenPlayerId)).toBe(true)
  })

  it('lets a hero with Doomhammer attack twice but not a third time', () => {
    const scenario = createMatchScenario({
      seed: 1009,
      cardId: 'classic_doomhammer',
      firstHeroId: 'thrall',
      secondHeroId: 'thrall'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const doomhammer = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_doomhammer'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: doomhammer.instanceId
      }).accepted
    ).toBe(true)

    const heroAttackerId = `${participantId}:hero`
    expect(player(scenario, participantId).hero.maxAttacksPerTurn).toBe(2)
    expect(
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroAttackerId]
    ).toBeDefined()
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon?.durability).toBe(7)
    expect(
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroAttackerId]
    ).toBeDefined()
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon?.durability).toBe(6)
    expect(
      scenario.match.getLegality?.(participantId).legalAttackTargets[heroAttackerId]
    ).toBeUndefined()
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' })
    ).toMatchObject({
      accepted: false,
      code: 'hero-cannot-attack'
    })
  })

  it('makes Gorehowl spend Attack instead of durability after hitting a minion', () => {
    const scenario = createMatchScenario({
      seed: 1010,
      cardId: 'classic_gorehowl',
      firstHeroId: 'garrosh',
      secondHeroId: 'garrosh'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const gorehowl = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_gorehowl'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: gorehowl.instanceId
      }).accepted
    ).toBe(true)

    const friendlyAttacker = summon(scenario, participantId, 'basic_stonetusk_boar')
    const defender = summon(scenario, opponentId, 'classic_malygos')
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: friendlyAttacker.instanceId },
        { kind: 'minion', instanceId: defender.instanceId }
      ).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toMatchObject({
      attack: 7,
      durability: 1,
      maxDurability: 1
    })

    const result = attack(
      scenario,
      participantId,
      { kind: 'hero' },
      { kind: 'minion', instanceId: defender.instanceId }
    )
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const combat = result.events.find(
      (event) => event.type === 'character-combat-resolved'
    )
    expect(combat).toMatchObject({
      attacker: { attack: 7 },
      defender: { healthBefore: 11, healthAfter: 4 },
      weapon: {
        durabilityBefore: 1,
        durabilityAfter: 1,
        destroyed: false
      }
    })
    expect(player(scenario, participantId).weapon).toMatchObject({
      attack: 6,
      durability: 1,
      maxDurability: 1
    })
  })

  it('makes Gorehowl spend durability normally when hitting a hero', () => {
    const scenario = createMatchScenario({
      seed: 1011,
      cardId: 'classic_gorehowl',
      firstHeroId: 'garrosh',
      secondHeroId: 'garrosh'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const gorehowl = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_gorehowl'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: gorehowl.instanceId
      }).accepted
    ).toBe(true)

    const result = attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'character-combat-resolved',
        attacker: expect.objectContaining({ attack: 7 }),
        weapon: {
          participantId,
          durabilityBefore: 1,
          durabilityAfter: 0,
          destroyed: true
        }
      })
    )
    expect(player(scenario, opponentId).hero.health).toBe(23)
    expect(player(scenario, participantId).weapon).toBeNull()
  })

  it('consumes Divine Shield before health and permits Windfury but not a third attack', () => {
    const scenario = createMatchScenario({ seed: 1002 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'classic_alakir_the_windlord')
    const defender = summon(scenario, opponentId, 'classic_argent_squire')

    const shieldedAttack = attack(
      scenario,
      participantId,
      { kind: 'minion', instanceId: attacker.instanceId },
      { kind: 'minion', instanceId: defender.instanceId }
    )
    expect(shieldedAttack.accepted).toBe(true)
    if (!shieldedAttack.accepted) return
    const shieldedResult = shieldedAttack.events.find(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(shieldedResult?.defender).toMatchObject({
      attemptedDamage: 3,
      divineShieldConsumed: true,
      healthBefore: 1,
      healthAfter: 1
    })
    expect(player(scenario, opponentId).board[0]).toMatchObject({
      health: 1,
      divineShield: false
    })
    const overkillAttack = attack(
      scenario,
      participantId,
      { kind: 'minion', instanceId: attacker.instanceId },
      { kind: 'minion', instanceId: defender.instanceId }
    )
    expect(overkillAttack.accepted).toBe(true)
    if (!overkillAttack.accepted) return
    const overkillResult = overkillAttack.events.find(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(overkillResult?.defender).toMatchObject({
      attemptedDamage: 3,
      healthBefore: 1,
      healthAfter: 0
    })
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
  })

  it('rejects Cannot Attack and breaks a weapon exactly once', () => {
    const scenario = createMatchScenario({
      seed: 1003,
      firstHeroId: 'thrall',
      cardId: 'basic_wicked_knife'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const watcher = summon(scenario, participantId, 'classic_ancient_watcher')
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: watcher.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })

    const weapon = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'basic_wicked_knife'
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
        type: 'play-card',
        participantId,
        cardInstanceId: weapon.instanceId
      }).accepted
    ).toBe(true)
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toMatchObject({ durability: 1 })
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      attack(scenario, participantId, { kind: 'hero' }, { kind: 'hero' }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toBeNull()
  })

  it('blocks spell targets protected by Spell Immune and thaws Freeze after its missed attack', () => {
    const spellScenario = createMatchScenario({
      seed: 1005,
      cardId: 'basic_arcane_shot'
    })
    spellScenario.confirmBothMulligans()
    const [spellPlayerId, spellOpponentId] = activePlayers(spellScenario)
    const spellImmune = summon(spellScenario, spellOpponentId, 'classic_faerie_dragon')
    expect(
      spellScenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: spellPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const arcaneShot = player(spellScenario, spellPlayerId).hand[0]!
    expect(
      spellScenario.match.dispatch({
        type: 'play-card',
        participantId: spellPlayerId,
        cardInstanceId: arcaneShot.instanceId,
        targets: [
          {
            kind: 'minion',
            participantId: spellOpponentId,
            instanceId: spellImmune.instanceId
          }
        ]
      })
    ).toMatchObject({ accepted: false, code: 'immune-target' })

    const freezeScenario = createMatchScenario({
      seed: 1006,
      cardId: 'basic_frost_nova'
    })
    freezeScenario.confirmBothMulligans()
    const [freezingPlayerId, frozenPlayerId] = activePlayers(freezeScenario)
    const frozen = summon(freezeScenario, frozenPlayerId, 'basic_stonetusk_boar')
    expect(
      freezeScenario.match.dispatch({
        type: 'dev-set-mana',
        participantId: freezingPlayerId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const frostNova = player(freezeScenario, freezingPlayerId).hand[0]!
    expect(
      freezeScenario.match.dispatch({
        type: 'play-card',
        participantId: freezingPlayerId,
        cardInstanceId: frostNova.instanceId
      }).accepted
    ).toBe(true)
    expect(
      freezeScenario.match.dispatch({
        type: 'end-turn',
        participantId: freezingPlayerId
      }).accepted
    ).toBe(true)
    expect(
      attack(
        freezeScenario,
        frozenPlayerId,
        { kind: 'minion', instanceId: frozen.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
    expect(
      freezeScenario.match.dispatch({ type: 'end-turn', participantId: frozenPlayerId })
        .accepted
    ).toBe(true)
    expect(
      freezeScenario.match.dispatch({
        type: 'end-turn',
        participantId: freezingPlayerId
      }).accepted
    ).toBe(true)
    expect(
      attack(
        freezeScenario,
        frozenPlayerId,
        { kind: 'minion', instanceId: frozen.instanceId },
        { kind: 'hero' }
      ).accepted
    ).toBe(true)
  })

  it('allows Mega-Windfury exactly four attacks in a turn', () => {
    const scenario = createMatchScenario({ seed: 1007 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const attacker = summon(scenario, participantId, 'goblins_vs_gnomes_v_07_tr_0n')
    beginNextTurn(scenario, participantId, opponentId)
    for (let index = 0; index < 4; index += 1)
      expect(
        attack(
          scenario,
          participantId,
          { kind: 'minion', instanceId: attacker.instanceId },
          { kind: 'hero' }
        ).accepted
      ).toBe(true)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'hero' }
      )
    ).toMatchObject({
      accepted: false,
      code: 'minion-cannot-attack'
    })
  })

  it('replays wrong-enemy redirection identically with seeded RNG', () => {
    const run = () => {
      const scenario = createMatchScenario({ seed: 1004 })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activePlayers(scenario)
      const attacker = summon(scenario, participantId, 'goblins_vs_gnomes_ogre_brute')
      const first = summon(scenario, opponentId, 'basic_goldshire_footman')
      summon(scenario, opponentId, 'basic_frostwolf_grunt')
      beginNextTurn(scenario, participantId, opponentId)
      const result = attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: attacker.instanceId },
        { kind: 'minion', instanceId: first.instanceId }
      )
      expect(result.accepted).toBe(true)
      return {
        state: scenario.match.getState(),
        events: result.events,
        rng: scenario.rng.snapshot()
      }
    }
    expect(run()).toEqual(run())
  })
})

describe('Stealth and Elusive', () => {
  function setup(cardId: string) {
    const scenario = createMatchScenario({
      seed: 8201,
      cardId,
      firstHeroId: 'jaina',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === cardId
    )!
    return { scenario, participantId, opponentId, card }
  }

  it.each([
    ['basic_arcane_shot', 'classic_stranglethorn_tiger', false, false],
    ['basic_arcane_shot', 'classic_stranglethorn_tiger', true, true],
    ['basic_elven_archer', 'classic_stranglethorn_tiger', false, false],
    ['basic_elven_archer', 'classic_stranglethorn_tiger', true, true],
    ['basic_arcane_shot', 'classic_faerie_dragon', false, false],
    ['basic_arcane_shot', 'classic_faerie_dragon', true, false],
    ['basic_elven_archer', 'classic_faerie_dragon', false, true],
    ['basic_elven_archer', 'classic_faerie_dragon', true, true]
  ] as const)(
    '%s targeting %s (friendly=%s) is legal=%s',
    (cardId, minionId, friendly, legal) => {
      const { scenario, participantId, opponentId, card } = setup(cardId)
      const owner = friendly ? participantId : opponentId
      const minion = summon(scenario, owner, minionId)
      const target = {
        kind: 'minion' as const,
        participantId: owner,
        instanceId: minion.instanceId
      }
      const input = scenario.match.getPlayInput!(participantId, card.instanceId)!
      expect(
        input.legalTargetOptions
          .flat()
          .some(
            (entry) => entry.kind === 'minion' && entry.instanceId === minion.instanceId
          )
      ).toBe(legal)
      const before = scenario.match.getState()
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        ...(input.requiresPosition
          ? { position: player(scenario, participantId).board.length }
          : {}),
        targets: [target]
      })
      expect(result.accepted).toBe(legal)
      if (!legal) expect(scenario.match.getState()).toEqual(before)
    }
  )

  it.each([
    ['classic_stranglethorn_tiger', false, false],
    ['classic_stranglethorn_tiger', true, true],
    ['classic_faerie_dragon', false, false],
    ['classic_faerie_dragon', true, false]
  ] as const)(
    'Fireblast targeting %s (friendly=%s) is legal=%s',
    (minionId, friendly, legal) => {
      const { scenario, participantId, opponentId } = setup('basic_acidic_swamp_ooze')
      const owner = friendly ? participantId : opponentId
      const minion = summon(scenario, owner, minionId)
      const target = {
        kind: 'minion' as const,
        participantId: owner,
        instanceId: minion.instanceId
      }
      const targets = scenario.match.getLegality!(participantId).legalHeroPowerTargets
      expect(
        targets.some(
          (entry) => entry.kind === 'minion' && entry.instanceId === minion.instanceId
        )
      ).toBe(legal)
      expect(
        scenario.match.dispatch({ type: 'use-hero-power', participantId, target })
          .accepted
      ).toBe(legal)
    }
  )

  it.each(['classic_stranglethorn_tiger', 'classic_faerie_dragon'])(
    'area spell damage hits %s without removing its ability',
    (minionId) => {
      const { scenario, participantId, opponentId, card } = setup('basic_whirlwind')
      const minion = summon(scenario, opponentId, minionId)
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: card.instanceId
        }).accepted
      ).toBe(true)
      const after = player(scenario, opponentId).board[0]!
      expect(after.health).toBe(minion.health - 1)
      expect(after.stealth).toBe(minion.stealth)
      expect(after.spellImmune).toBe(minion.spellImmune)
    }
  )

  it('random spell damage can kill an Elusive minion', () => {
    const { scenario, participantId, opponentId, card } = setup(
      'goblins_vs_gnomes_bouncing_blade'
    )
    // Bouncing Blade selects random minions; with one target its hits are deterministic.
    summon(scenario, opponentId, 'classic_faerie_dragon')
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
  })

  it('Elusive does not prevent area damage from consuming Divine Shield', () => {
    const { scenario, participantId, opponentId, card } = setup('basic_whirlwind')
    summon(scenario, participantId, 'classic_argent_squire')
    summon(scenario, participantId, 'goblins_vs_gnomes_wee_spellstopper')
    beginNextTurn(scenario, participantId, opponentId)
    expect(player(scenario, participantId).board[0]!.spellImmune).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]).toMatchObject({
      health: 1,
      divineShield: false,
      spellImmune: true
    })
    expect(player(scenario, opponentId).board).toHaveLength(0)
  })

  it('Master of Disguise protects through the opponent turn and expires on the next friendly turn', () => {
    const { scenario, participantId, opponentId, card } = setup(
      'classic_master_of_disguise'
    )
    const minion = summon(scenario, participantId, 'basic_acidic_swamp_ooze')
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 1,
        targets: [{ kind: 'minion', participantId, instanceId: minion.instanceId }]
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (entry) => entry.instanceId === minion.instanceId
      )?.stealth
    ).toBe(true)
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(
      player(scenario, participantId).board.find(
        (entry) => entry.instanceId === minion.instanceId
      )?.stealth
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: opponentId }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (entry) => entry.instanceId === minion.instanceId
      )?.stealth
    ).toBe(false)
  })

  it('silencing an Elusive aura source restores spell targeting of its neighbors', () => {
    const { scenario, participantId, opponentId, card } = setup('classic_silence')
    const neighbor = summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    const source = summon(scenario, opponentId, 'goblins_vs_gnomes_wee_spellstopper')
    beginNextTurn(scenario, participantId, opponentId)
    expect(player(scenario, opponentId).board[0]!.spellImmune).toBe(true)
    const targets = () =>
      scenario.match.getPlayInput!(
        participantId,
        card.instanceId
      )!.legalTargetOptions.flat()
    expect(
      targets().some(
        (entry) => entry.kind === 'minion' && entry.instanceId === neighbor.instanceId
      )
    ).toBe(false)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: source.instanceId }
        ]
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board[0]!.spellImmune).toBe(false)
    expect(
      scenario.match.getLegality!(participantId).legalHeroPowerTargets
    ).toContainEqual({
      kind: 'minion',
      participantId: opponentId,
      instanceId: neighbor.instanceId
    })
  })

  it('attacking consumes Stealth, which can be granted again and removed by Flare', () => {
    const { scenario, participantId, opponentId, card } = setup('classic_conceal')
    const tiger = summon(scenario, participantId, 'classic_stranglethorn_tiger')
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      attack(
        scenario,
        participantId,
        { kind: 'minion', instanceId: tiger.instanceId },
        { kind: 'hero' }
      ).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]!.stealth).toBe(false)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]!.stealth).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_flare'
      }).accepted
    ).toBe(true)
    const flare = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'classic_flare'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: flare.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).board[0]!.stealth).toBe(false)
  })

  it('an Ogre can redirect onto Stealth despite being unable to choose it', () => {
    const { scenario, participantId, opponentId } = setup('basic_acidic_swamp_ooze')
    const ogre = summon(scenario, participantId, 'goblins_vs_gnomes_ogre_brute')
    const tiger = summon(scenario, opponentId, 'classic_stranglethorn_tiger')
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      scenario.match.getLegality!(participantId).legalAttackTargets[ogre.instanceId]
    ).not.toContainEqual({ kind: 'minion', instanceId: tiger.instanceId })
    const state = scenario.match.getState()
    const result = resolveAttack({
      state,
      participantId,
      attacker: { kind: 'minion', instanceId: ogre.instanceId },
      defender: { kind: 'hero' },
      rng: { ...scenario.rng, next: () => 0 },
      nextEntityOrdinal: 1000
    })
    expect(result.accepted).toBe(true)
    expect(
      result.state.players
        .find((entry) => entry.participantId === opponentId)!
        .board.find((entry) => entry.instanceId === tiger.instanceId)
    ).toMatchObject({ health: tiger.health - ogre.attack, stealth: true })
  })
})

describe('Rush', () => {
  it('attacks minions immediately and heroes on the next friendly turn', () => {
    const scenario = createMatchScenario({ seed: 8101 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    const icehowl = summon(scenario, participantId, 'the_grand_tournament_icehowl')
    const attacker = { kind: 'minion' as const, instanceId: icehowl.instanceId }
    expect(isBoardMinionSleeping(icehowl, scenario.match.getState().turnNumber)).toBe(
      false
    )
    expect(
      scenario.match.getLegality!(participantId).legalAttackTargets[icehowl.instanceId]
    ).toBeUndefined()
    expect(
      scenario.match
        .analyze((fork) => enumerateLegalCommands(fork, participantId))
        .filter((command) => command.type === 'attack-character')
    ).toEqual([])
    expect(attack(scenario, participantId, attacker, { kind: 'hero' }).accepted).toBe(
      false
    )
    const target = summon(scenario, opponentId, 'basic_goldshire_footman')
    expect(
      scenario.match.getLegality!(participantId).legalAttackTargets[icehowl.instanceId]
    ).toEqual([{ kind: 'minion', instanceId: target.instanceId }])
    expect(
      attack(scenario, participantId, attacker, {
        kind: 'minion',
        instanceId: target.instanceId
      }).accepted
    ).toBe(true)
    beginNextTurn(scenario, participantId, opponentId)
    expect(
      scenario.match.getLegality!(participantId).legalAttackTargets[icehowl.instanceId]
    ).toContainEqual({ kind: 'hero' })
    expect(attack(scenario, participantId, attacker, { kind: 'hero' }).accepted).toBe(
      true
    )
  })

  it.each(['charge', 'silence', 'freeze', 'control', 'prohibition', 'spent'] as const)(
    'keeps legality and attack resolution consistent for %s',
    (mode) => {
      const scenario = createMatchScenario({ seed: 8102 })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activePlayers(scenario)
      const icehowl = summon(scenario, participantId, 'the_grand_tournament_icehowl')
      const target = summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
      const state = scenario.match.getState()
      const minion = state.players.find((p) => p.participantId === participantId)!
        .board[0]! as { -readonly [K in keyof BoardMinion]: BoardMinion[K] }
      if (mode === 'charge') minion.keywords = ['rush', 'charge']
      if (mode === 'silence') minion.silenced = true
      if (mode === 'freeze') minion.frozenUntilTurn = state.turnNumber
      if (mode === 'control') {
        minion.summonedOnTurn = state.turnNumber - 1
        minion.controllerChangedOnTurn = state.turnNumber
      }
      if (mode === 'prohibition')
        minion.keywords = ['rush', 'charge', 'cannot-attack-heroes']
      if (mode === 'spent') {
        minion.lastAttackedOnTurn = state.turnNumber
        minion.attacksUsedThisTurn = 1
      }
      const canHitMinion = ['charge', 'control', 'prohibition'].includes(mode)
      const canHitHero = mode === 'charge'
      const targets =
        getMatchLegality(state, participantId).legalAttackTargets[icehowl.instanceId] ??
        []
      expect(targets.some((t) => t.kind === 'hero')).toBe(canHitHero)
      expect(targets.some((t) => t.kind === 'minion')).toBe(canHitMinion)
      for (const [defender, accepted] of [
        [{ kind: 'hero' as const }, canHitHero],
        [{ kind: 'minion' as const, instanceId: target.instanceId }, canHitMinion]
      ] as const) {
        expect(
          resolveAttack({
            state,
            participantId,
            attacker: { kind: 'minion', instanceId: icehowl.instanceId },
            defender
          }).accepted
        ).toBe(accepted)
      }
      expect(isBoardMinionSleeping(minion, state.turnNumber)).toBe(mode === 'silence')
    }
  )
})
