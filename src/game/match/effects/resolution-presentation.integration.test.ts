import { resolveCardPlay } from './effect-runtime'
import { CARD_CATALOG } from '../../content/cards'
import { validateCardSet } from '../../content/cards/card-validator'
import type { OpeningMatchEvent } from '../opening-match-types'
import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId,
      cardId
    }).accepted
  ).toBe(true)
}

function setMana(scenario: Scenario, participantId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

function summon(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  position?: number
): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId,
      cardId,
      ...(position === undefined ? {} : { position })
    }).accepted
  ).toBe(true)
}

function play(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  targets: readonly { kind: 'minion'; participantId: string; instanceId: string }[]
) {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  return scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    targets
  })
}

describe('resolution presentation events', () => {
  it('reports Healing Totem full values for undamaged friendly minions', () => {
    const scenario = createMatchScenario({ seed: 1698 })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    summon(scenario, participantId, 'basic_healing_totem')
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    const friendlyIds = new Set(
      player(scenario, participantId).board.map((minion) => minion.instanceId)
    )

    const result = scenario.match.dispatch({ type: 'end-turn', participantId })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const restores = result.events.filter(
      (event) =>
        event.type === 'effect-resolved' &&
        event.action === 'restore' &&
        event.sourceCardId === 'basic_healing_totem' &&
        typeof event.data?.target === 'string' &&
        friendlyIds.has(event.data.target)
    )
    expect(restores).toHaveLength(2)
    expect(restores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ amount: 0, displayAmount: 1 })
        }),
        expect.objectContaining({
          data: expect.objectContaining({ amount: 0, displayAmount: 1 })
        })
      ])
    )
  })

  it("reports Alexstrasza's actual hero health after setting it to fifteen", () => {
    const scenario = createMatchScenario({ seed: 1697 })
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
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId,
        health: 10
      }).accepted
    ).toBe(true)
    addCard(scenario, participantId, 'classic_alexstrasza')

    const alexstrasza = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_alexstrasza'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: alexstrasza.instanceId,
      targets: [{ kind: 'hero', participantId }],
      position: 0
    })

    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, participantId).hero.health).toBe(15)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'effect-resolved',
        action: 'set-health',
        data: expect.objectContaining({
          target: `${participantId}:hero`,
          health: 15,
          healthBefore: 10,
          healthAfter: 15,
          maximumHealthAfter: 30
        })
      })
    )
  })

  it.each(['classic_molten_giant', 'classic_mountain_giant'])(
    'does not activate %s hand-only cost effect from the board',
    (cardId) => {
      const scenario = createMatchScenario({ seed: 1699 })
      scenario.confirmBothMulligans()
      const [participantId] = activePlayers(scenario)

      const result = scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId
      })

      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const giant = player(scenario, participantId).board[0]!
      expect(
        result.events.filter(
          (event) =>
            event.type === 'trigger-activated' &&
            event.source.instanceId === giant.instanceId
        )
      ).toHaveLength(0)
    }
  )

  it('emits one trigger cue for every actual Acolyte damage trigger', () => {
    const scenario = createMatchScenario({ seed: 1700 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, opponentId, 'classic_acolyte_of_pain')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_fireball')

    const acolyte = player(scenario, opponentId).board[0]!
    const result = play(scenario, participantId, 'basic_fireball', [
      { kind: 'minion', participantId: opponentId, instanceId: acolyte.instanceId }
    ])
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const cues = result.events.filter(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === acolyte.instanceId
    )
    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({
      trigger: 'on-damage',
      eventType: 'damage-dealt',
      parentActivationId: null
    })
    const cueIndex = result.events.indexOf(cues[0]!)
    const drawIndex = result.events.findIndex(
      (event, index) => index > cueIndex && event.type === 'card-drawn'
    )
    expect(drawIndex).toBeGreaterThan(cueIndex)
    expect(
      result.events.find(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'damage' &&
          event.data?.target === acolyte.instanceId
      )
    ).toMatchObject({
      data: { actualDamage: 3, displayAmount: 6, healthAfter: 0 }
    })
  })

  it('exposes Frothing attack modifications after each damaged minion', () => {
    const scenario = createMatchScenario({ seed: 1701 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_frothing_berserker')
    summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_fireball')

    const target = player(scenario, opponentId).board[0]!
    const result = play(scenario, participantId, 'basic_fireball', [
      { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
    ])
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const frothing = player(scenario, participantId).board[0]!
    expect(frothing.attack).toBe(3)
    const cueIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === frothing.instanceId
    )
    expect(cueIndex).toBeGreaterThanOrEqual(0)
    const modify = result.events.find(
      (event, index) =>
        index > cueIndex &&
        event.type === 'effect-resolved' &&
        event.action === 'modify' &&
        event.data?.target === frothing.instanceId
    )
    expect(modify).toMatchObject({
      type: 'effect-resolved',
      action: 'modify',
      data: { attackBefore: 2, attackAfter: 3 }
    })
  })

  it('starts combat before damage effects so reactive chains can be presented in order', () => {
    const scenario = createMatchScenario({ seed: 1703 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_acolyte_of_pain')
    summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    const attacker = player(scenario, opponentId).board[0]!
    const defender = player(scenario, participantId).board[0]!
    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: opponentId,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'minion', instanceId: defender.instanceId }
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const startIndex = result.events.findIndex(
      (event) => event.type === 'combat-started'
    )
    const damageIndex = result.events.findIndex(
      (event) => event.type === 'effect-resolved' && event.action === 'damage'
    )
    const resolvedIndex = result.events.findIndex(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(damageIndex).toBeGreaterThan(startIndex)
    expect(resolvedIndex).toBeGreaterThan(damageIndex)
  })

  it('brackets simultaneous deaths and repeated Deathrattle activations', () => {
    const scenario = createMatchScenario({ seed: 1702 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_abomination')
    summon(scenario, participantId, 'naxxramas_baron_rivendare')
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    setMana(scenario, opponentId)
    addCard(scenario, opponentId, 'basic_assassinate')

    const abomination = player(scenario, participantId).board.find(
      (minion) => minion.cardId === 'classic_abomination'
    )!
    const result = play(scenario, opponentId, 'basic_assassinate', [
      { kind: 'minion', participantId, instanceId: abomination.instanceId }
    ])
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const started = result.events.find((event) => event.type === 'death-batch-started')
    const completed = result.events.find(
      (event) => event.type === 'death-batch-completed'
    )
    expect(started).toBeDefined()
    expect(completed).toBeDefined()
    if (!started || !completed) return
    expect(started.deaths.map((death) => death.instanceId)).toContain(
      abomination.instanceId
    )
    const activations = result.events.filter(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === abomination.instanceId &&
        event.trigger === 'deathrattle'
    )
    expect(activations).toHaveLength(2)
    expect(result.events.indexOf(started)).toBeLessThan(
      result.events.indexOf(activations[0]!)
    )
    expect(result.events.indexOf(activations[1]!)).toBeLessThan(
      result.events.indexOf(completed)
    )
  })

  it('emits paced activation cues for live Deathrattles', () => {
    const scenario = createMatchScenario({
      seed: 1704,
      cardId: 'goblins_vs_gnomes_feign_death',
      firstHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_leper_gnome')
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_feign_death'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const leper = player(scenario, participantId).board[0]!
    const activationIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === leper.instanceId &&
        event.trigger === 'deathrattle'
    )
    expect(activationIndex).toBeGreaterThanOrEqual(0)
    expect(
      result.events.findIndex(
        (event, index) =>
          index > activationIndex &&
          event.type === 'effect-resolved' &&
          event.action === 'damage' &&
          event.data?.target === `${opponentId}:hero`
      )
    ).toBeGreaterThan(activationIndex)
  })
})

function damagePhaseFixture(cardId = 'basic_swipe') {
  const s = createMatchScenario({ seed: 1100, cardId })
  s.confirmBothMulligans()
  const self = s.match.getState().activePlayerId!
  const enemy = s.participants.find((id) => id !== self)!
  const player = (id = enemy) =>
    s.match.getState().players.find((p) => p.participantId === id)!
  s.match.dispatch({
    type: 'dev-set-mana',
    participantId: self,
    available: 10,
    maximum: 10
  })
  const summon = (cardId: string, id = enemy) => {
    expect(
      s.match.dispatch({ type: 'dev-summon-minion', participantId: id, cardId })
        .accepted
    ).toBe(true)
    return player(id).board.at(-1)!
  }
  const play = (target?: ReturnType<typeof summon> | 'hero') => {
    const result = s.match.dispatch({
      type: 'play-card',
      participantId: self,
      cardInstanceId: player(self).hand.find((c) => c.cardId === cardId)!.instanceId,
      ...(target
        ? {
            targets: [
              target === 'hero'
                ? { kind: 'hero' as const, participantId: enemy }
                : {
                    kind: 'minion' as const,
                    participantId: enemy,
                    instanceId: target.instanceId
                  }
            ]
          }
        : {})
    })
    expect(result.accepted).toBe(true)
    return result
  }
  return { s, self, enemy, player, summon, play }
}
const bossId = 'blackrock_mountain_imp_gang_boss'
const impId = 'blackrock_mountain_imp'
function damageBeforeTriggers(events: readonly OpeningMatchEvent[], cardId: string) {
  const damage = events.flatMap((e, i) =>
    e.type === 'effect-resolved' && e.action === 'damage' && e.sourceCardId === cardId
      ? [i]
      : []
  )
  const firstTrigger = events.findIndex((e) => e.type === 'trigger-activated')
  expect(damage.length).toBeGreaterThan(0)
  expect(firstTrigger).toBeGreaterThan(Math.max(...damage))
}

describe('shared damage phases', () => {
  it.each([true, false])(
    'Swipe: surviving Imp and original splash targets (direct: %s)',
    (direct) => {
      const f = damagePhaseFixture()
      const boss = f.summon(bossId)
      f.summon('basic_bloodfen_raptor')
      const r = f.play(direct ? boss : 'hero')
      expect(f.player().board.find((m) => m.cardId === impId)).toMatchObject({
        health: 1
      })
      expect(
        f.player().board.find((m) => m.cardId === 'basic_bloodfen_raptor')
      ).toMatchObject({ health: 1 })
      if (direct)
        expect(
          f.player().board.find((m) => m.instanceId === boss.instanceId)
        ).toBeUndefined()
      else
        expect(
          f.player().board.find((m) => m.instanceId === boss.instanceId)
        ).toMatchObject({ health: 3 })
      damageBeforeTriggers(r.events, 'basic_swipe')
    }
  )
  it('ordinary area damage automatically applies to everyone before any reaction', () => {
    const f = damagePhaseFixture('basic_hellfire')
    f.summon(bossId)
    f.summon(bossId)
    f.summon('classic_acolyte_of_pain')
    const r = f.play()
    expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(2)
    expect(
      f
        .player()
        .board.filter((m) => m.cardId === impId)
        .every((m) => m.health === 1)
    ).toBe(true)
    expect(f.player().board.some((m) => m.cardId === 'classic_acolyte_of_pain')).toBe(
      false
    )
    damageBeforeTriggers(r.events, 'basic_hellfire')
    const lastReaction = Math.max(
      ...r.events.flatMap((e, i) => (e.type === 'trigger-activated' ? [i] : []))
    )
    expect(r.events.findIndex((e) => e.type === 'death-batch-started')).toBeGreaterThan(
      lastReaction
    )
  })
  it('does not free mortally wounded board slots before damage summons', () => {
    const f = damagePhaseFixture()
    const boss = f.summon(bossId)
    for (let i = 0; i < 6; i++) f.summon('basic_stonetusk_boar')
    f.play(boss)
    expect(f.player().board).toHaveLength(0)
  })
  it('Explosive Shot captures original neighbours before lethal primary damage', () => {
    const f = damagePhaseFixture('classic_explosive_shot')
    const left = f.summon('basic_chillwind_yeti')
    const boss = f.summon(bossId)
    const right = f.summon('basic_chillwind_yeti')
    const r = f.play(boss)
    expect(
      f.player().board.find((m) => m.instanceId === left.instanceId)
    ).toMatchObject({ health: 3 })
    expect(
      f.player().board.find((m) => m.instanceId === right.instanceId)
    ).toMatchObject({ health: 3 })
    expect(f.player().board.find((m) => m.cardId === impId)).toMatchObject({
      health: 1
    })
    damageBeforeTriggers(r.events, 'classic_explosive_shot')
  })
  it('combat applies attack and retaliation before either damage trigger', () => {
    const f = damagePhaseFixture()
    const attacker = f.summon(bossId, f.self)
    const defender = f.summon(bossId)
    f.s.match.dispatch({ type: 'end-turn', participantId: f.self })
    f.s.match.dispatch({ type: 'end-turn', participantId: f.enemy })
    const r = f.s.match.dispatch({
      type: 'attack-character',
      participantId: f.self,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'minion', instanceId: defender.instanceId }
    })
    expect(r.accepted).toBe(true)
    damageBeforeTriggers(r.events, bossId)
    expect(f.player().board.find((m) => m.cardId === impId)).toBeDefined()
    expect(f.player(f.self).board.find((m) => m.cardId === impId)).toBeDefined()
  })
  it('Mortal Coil draws from lethal damage before the death checkpoint', () => {
    const f = damagePhaseFixture('basic_mortal_coil')
    const target = f.summon('basic_stonetusk_boar')
    const before = f.player(f.self).hand.length
    f.play(target)
    expect(f.player(f.self).hand).toHaveLength(before)
    expect(f.player().board).toHaveLength(0)
  })
  it('Slam draws when the damaged target survives', () => {
    const f = damagePhaseFixture('classic_slam')
    const target = f.summon(bossId)
    const before = f.player(f.self).hand.length
    f.play(target)
    expect(f.player(f.self).hand).toHaveLength(before)
    expect(f.player().board.find((m) => m.cardId === impId)).toBeDefined()
  })
  it('Cobra Shot resolves its first damage trigger before damaging the hero', () => {
    const f = damagePhaseFixture('goblins_vs_gnomes_cobra_shot')
    const target = f.summon(bossId)
    const r = f.play(target)
    const trigger = r.events.findIndex((e) => e.type === 'trigger-activated')
    const damages = r.events.flatMap((e, i) =>
      e.type === 'effect-resolved' &&
      e.action === 'damage' &&
      e.sourceCardId === 'goblins_vs_gnomes_cobra_shot'
        ? [i]
        : []
    )
    expect(trigger).toBeGreaterThan(damages[0])
    expect(trigger).toBeLessThan(damages[1])
  })
  it('per-target damage captures targets but resolves each reaction immediately', () => {
    const f = damagePhaseFixture('goblins_vs_gnomes_lightbomb')
    f.summon(bossId)
    f.summon(bossId)
    const r = f.play()
    const trigger = r.events.findIndex((e) => e.type === 'trigger-activated')
    const damages = r.events.flatMap((e, i) =>
      e.type === 'effect-resolved' &&
      e.action === 'damage' &&
      e.sourceCardId === 'goblins_vs_gnomes_lightbomb'
        ? [i]
        : []
    )
    expect(trigger).toBeGreaterThan(damages[0])
    expect(trigger).toBeLessThan(damages[1])
    expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(2)
  })
})

it('repeated missiles can hit a summoned Imp before the outer death checkpoint', () => {
  const f = damagePhaseFixture('mean_streets_of_gadgetzan_greater_arcane_missiles')
  const boss = f.summon(bossId)
  const state = f.s.match.getState()
  let calls = 0
  const rng = {
    next: () => {
      return [0, 0.4, 0][calls++] ?? 0
    },
    snapshot: () => calls,
    restore: (n: unknown) => {
      calls = n as number
    }
  }
  const options = {
    state,
    rng,
    participantId: f.self,
    cardInstanceId: f.player(f.self).hand[0].instanceId
  }
  const result = resolveCardPlay(options)
  expect(result.accepted).toBe(true)
  if (!result.accepted) return
  const damages = result.events.flatMap((e) =>
    e.type === 'effect-resolved' &&
    e.action === 'damage' &&
    e.sourceCardId === 'mean_streets_of_gadgetzan_greater_arcane_missiles'
      ? [e]
      : []
  )
  expect(damages).toHaveLength(3)
  expect(damages[0].data?.target).toBe(boss.instanceId)
  expect(damages[1].data?.target).not.toBe(boss.instanceId)
  expect(damages[2].data?.target).toBe(boss.instanceId)
  const board = result.state.players.find((p) => p.participantId === f.enemy)!.board
  expect(board).toHaveLength(1)
  expect(board[0]).toMatchObject({ cardId: impId, health: 1 })
  const lastDamage = result.events.indexOf(damages.at(-1)!)
  expect(
    result.events.findIndex((e) => e.type === 'death-batch-started')
  ).toBeGreaterThan(lastDamage)
  calls = 0
  expect(resolveCardPlay(options)).toEqual(result)
  expect(f.s.match.getState()).toEqual(state)
})

it('damage-group validation rejects nesting, repeated hits and per-target members', () => {
  const card = CARD_CATALOG.require('basic_swipe')
  const damage = {
    action: 'damage',
    amount: 1,
    target: { controller: 'opponent', type: 'character', selection: 'all' }
  }
  const validate = (actions: unknown[]) =>
    validateCardSet(
      [{ ...card, effects: [{ trigger: 'cast', actions }] }],
      card.expansionId
    )
  expect(() =>
    validate([{ action: 'damage-group', actions: [damage, damage] }])
  ).not.toThrow()
  for (const child of [
    { ...damage, hits: 2 },
    { ...damage, damageResolution: 'per-target' },
    { action: 'damage-group', actions: [damage] },
    { action: 'draw', player: 'self', count: 1 }
  ])
    expect(() => validate([{ action: 'damage-group', actions: [child] }])).toThrow()
  expect(() => validate([{ ...damage, damageResolution: 'later' }])).toThrow()
  expect(() => validate([{ action: 'damage-group', actions: [] }])).toThrow()
})

it('Swipe scales both damage amounts and never damages its primary target twice', () => {
  const f = damagePhaseFixture()
  f.summon('basic_kobold_geomancer', f.self)
  f.summon('basic_chillwind_yeti')
  f.play('hero')
  expect(f.player().hero.health).toBe(25)
  expect(f.player().board[0]).toMatchObject({ health: 3 })
})

it('prevented area damage consumes shields without creating damage triggers', () => {
  const f = damagePhaseFixture('basic_whirlwind')
  f.summon('classic_argent_squire')
  f.summon(bossId)
  const r = f.play()
  expect(
    f.player().board.find((m) => m.cardId === 'classic_argent_squire')
  ).toMatchObject({ health: 1, divineShield: false })
  expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(1)
  damageBeforeTriggers(r.events, 'basic_whirlwind')
})

it('rolls back a failure between missiles and restores RNG state', () => {
  const f = damagePhaseFixture('mean_streets_of_gadgetzan_greater_arcane_missiles')
  f.summon(bossId)
  const state = f.s.match.getState(),
    before = structuredClone(state)
  let calls = 0
  const result = resolveCardPlay({
    state,
    participantId: f.self,
    cardInstanceId: f.player(f.self).hand[0].instanceId,
    rng: {
      next: () => {
        if (calls++ === 1) throw Error('injected second-hit failure')
        return 0
      },
      snapshot: () => calls,
      restore: (n: unknown) => {
        calls = n as number
      }
    }
  })
  expect(result.accepted).toBe(false)
  expect(result.events).toEqual([])
  expect(calls).toBe(0)
  expect(state).toEqual(before)
})

it('converted area healing applies all damage before damage triggers', () => {
  const f = damagePhaseFixture('classic_circle_of_healing')
  f.summon('classic_auchenai_soulpriest', f.self)
  f.summon(bossId)
  f.summon(bossId)
  const r = f.play()
  expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(2)
  damageBeforeTriggers(r.events, 'classic_circle_of_healing')
})
