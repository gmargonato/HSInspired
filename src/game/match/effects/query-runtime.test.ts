import type { EffectQueries } from './effect-queries'
import type {
  EntityRef as QueryEntity,
  SemanticEvent as QueryEvent,
  EffectFrame as QueryFrame
} from './effect-context'
import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId, type CardDefinition } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import type { CardPlayTargetRef } from '../opening-match'
import { asPlayerId, type PlayerId } from '../match-types'
import { EffectRuntime, resolveCardPlay } from './effect-runtime'

type Scenario = ReturnType<typeof createMatchScenario>

type ParticipantPair = readonly [PlayerId, PlayerId]

type QueryRuntime = EffectQueries

function queryRuntime(runtime: EffectRuntime): EffectQueries {
  return runtime.queries
}

function entityKey(entity: QueryEntity): string {
  return entity.kind + ':' + entity.participantId + ':' + entity.instanceId
}

function entityRef(
  kind: QueryEntity['kind'],
  participantId: string,
  instanceId: string,
  zone: QueryEntity['zone'],
  cardId?: string
): QueryEntity {
  return {
    kind,
    participantId: asPlayerId(participantId),
    instanceId,
    zone,
    ...(cardId ? { cardId: asCardId(cardId) } : {})
  }
}

function activeParticipants(scenario: Scenario): ParticipantPair {
  const state = scenario.match.getState()
  const active = state.activePlayerId!
  return [active, scenario.participants.find((id) => id !== active)!]
}

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
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

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId,
      cardId
    }).accepted
  ).toBe(true)
}

function summon(scenario: Scenario, participantId: string, cardId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId,
      cardId
    }).accepted
  ).toBe(true)
}

describe('effect-runtime query language', () => {
  it('evaluates target.attack for every stable all-selector candidate', () => {
    const scenario = createMatchScenario({
      seed: 401,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    setMana(scenario, participantId)
    summon(scenario, participantId, 'basic_chillwind_yeti')
    summon(scenario, opponentId, 'basic_chillwind_yeti')
    summon(scenario, opponentId, 'basic_boulderfist_ogre')
    addCard(scenario, participantId, 'goblins_vs_gnomes_lightbomb')

    const before = scenario.match.getState()
    const ownBefore = before.players.find(
      (entry) => entry.participantId === participantId
    )!
    const opponentBefore = before.players.find(
      (entry) => entry.participantId === opponentId
    )!
    const lightbomb = ownBefore.hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_lightbomb'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: lightbomb.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const ownAfter = result.state.players.find(
      (entry) => entry.participantId === participantId
    )!
    const opponentAfter = result.state.players.find(
      (entry) => entry.participantId === opponentId
    )!
    expect(
      ownAfter.board.find((entry) => entry.cardId === 'basic_chillwind_yeti')
    ).toMatchObject({
      attack: 4,
      health: 1
    })
    expect(
      opponentAfter.board.find((entry) => entry.cardId === 'basic_chillwind_yeti')
    ).toMatchObject({ attack: 4, health: 1 })
    expect(
      opponentAfter.board.find((entry) => entry.cardId === 'basic_boulderfist_ogre')
    ).toMatchObject({ attack: 6, health: 1 })
    expect(ownAfter.hero.health).toBe(ownBefore.hero.health)
    expect(opponentAfter.hero.health).toBe(opponentBefore.hero.health)
  })

  it('resolves chosen target references and dynamic target-cost filters', () => {
    const innerFireScenario = createMatchScenario({ seed: 402 })
    innerFireScenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(innerFireScenario)
    setMana(innerFireScenario, participantId)
    summon(innerFireScenario, opponentId, 'basic_boulderfist_ogre')
    addCard(innerFireScenario, participantId, 'classic_inner_fire')
    const target = player(innerFireScenario, opponentId).board[0]!
    const innerFire = player(innerFireScenario, participantId).hand.find(
      (entry) => entry.cardId === 'classic_inner_fire'
    )!
    const innerFireResult = innerFireScenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: innerFire.instanceId,
      targets: [
        { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
      ]
    })
    expect(innerFireResult.accepted).toBe(true)
    expect(
      innerFireResult.accepted &&
        innerFireResult.state.players.find(
          (entry) => entry.participantId === opponentId
        )!.board[0]
    ).toMatchObject({ attack: 7, health: 7 })

    const recombobulatorScenario = createMatchScenario({ seed: 403 })
    recombobulatorScenario.confirmBothMulligans()
    const [recombobulatorPlayer] = activeParticipants(recombobulatorScenario)
    setMana(recombobulatorScenario, recombobulatorPlayer)
    summon(recombobulatorScenario, recombobulatorPlayer, 'classic_mountain_giant')
    addCard(
      recombobulatorScenario,
      recombobulatorPlayer,
      'goblins_vs_gnomes_recombobulator'
    )
    const before = recombobulatorScenario.match.getState()
    const giant = before.players.find(
      (entry) => entry.participantId === recombobulatorPlayer
    )!.board[0]!
    const recombobulator = before.players
      .find((entry) => entry.participantId === recombobulatorPlayer)!
      .hand.find((entry) => entry.cardId === 'goblins_vs_gnomes_recombobulator')!
    const result = resolveCardPlay({
      state: before,
      rng: { next: () => 0.999, snapshot: () => 0, restore: () => undefined },
      participantId: recombobulatorPlayer,
      cardInstanceId: recombobulator.instanceId,
      position: 1,
      targets: [
        {
          kind: 'minion',
          participantId: recombobulatorPlayer,
          instanceId: giant.instanceId
        }
      ],
      nextEntityOrdinal: before.nextEntityOrdinal
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const transformed = result.state.players
      .find((entry) => entry.participantId === recombobulatorPlayer)!
      .board.find((entry) => entry.instanceId === giant.instanceId)!
    expect(CARD_CATALOG.require(transformed.cardId).type).toBe('Minion')
    expect(CARD_CATALOG.require(transformed.cardId).cost).toBe(
      CARD_CATALOG.require('classic_mountain_giant').cost
    )
    expect(transformed.cardId).toBe('goblins_vs_gnomes_clockwork_giant')
  })

  it('limits Discover candidates to the declared top position range', () => {
    const scenario = createMatchScenario({ seed: 404, cardId: 'basic_tracking' })
    scenario.confirmBothMulligans()
    const [participantId] = activeParticipants(scenario)
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_tracking')
    const before = scenario.match.getState()
    const participant = before.players.find(
      (entry) => entry.participantId === participantId
    )!
    const tracking = participant.hand.find(
      (entry) => entry.cardId === 'basic_tracking'
    )!
    const input = scenario.match.getPlayInput?.(participantId, tracking.instanceId)
    expect(input?.targetSelectors).toEqual([])
    const topThree = participant.deck.slice(0, 3)

    const cast = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: tracking.instanceId
    })
    expect(cast.accepted).toBe(true)
    if (!cast.accepted) return
    expect(
      cast.state.pendingDiscover?.candidates.map((card) => card.instanceId)
    ).toEqual(topThree.map((card) => card.instanceId))
    const selected = cast.state.pendingDiscover!.candidates[0]!

    const result = scenario.match.dispatch({
      type: 'choose-discover-card',
      participantId,
      cardInstanceId: selected.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const after = result.state.players.find(
      (entry) => entry.participantId === participantId
    )!
    expect(after.deck).toHaveLength(participant.deck.length - 3)
    expect(after.hand.some((entry) => entry.instanceId === selected.instanceId)).toBe(
      true
    )
    for (const card of topThree.slice(1))
      expect(
        after.discardedCards?.some((entry) => entry.instanceId === card.instanceId)
      ).toBe(true)
  })

  it('preserves one stable random candidate while moving the remaining candidates', () => {
    const scenario = createMatchScenario({ seed: 405 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    setMana(scenario, participantId)
    summon(scenario, participantId, 'basic_acidic_swamp_ooze')
    summon(scenario, opponentId, 'basic_chillwind_yeti')
    summon(scenario, opponentId, 'basic_boulderfist_ogre')
    addCard(scenario, participantId, 'classic_brawl')
    const before = scenario.match.getState()
    const own = before.players.find((entry) => entry.participantId === participantId)!
    const brawl = own.hand.find((entry) => entry.cardId === 'classic_brawl')!
    const result = resolveCardPlay({
      state: before,
      rng: { next: () => 0, snapshot: () => 0, restore: () => undefined },
      participantId,
      cardInstanceId: brawl.instanceId,
      nextEntityOrdinal: before.nextEntityOrdinal
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const after = result.state.players
    expect(after.flatMap((entry) => entry.board)).toHaveLength(1)
    expect(after.flatMap((entry) => entry.board)[0]?.instanceId).toBe(
      own.board[0]!.instanceId
    )
    expect(after.flatMap((entry) => entry.graveyard ?? [])).toHaveLength(2)
  })

  it.each([
    { cardId: 'basic_acidic_swamp_ooze', survives: false },
    { cardId: 'basic_chillwind_yeti', survives: true }
  ])(
    'runs then only when the chosen target survives ($cardId)',
    ({ cardId, survives }) => {
      const scenario = createMatchScenario({ seed: survives ? 407 : 406 })
      scenario.confirmBothMulligans()
      const [participantId, opponentId] = activeParticipants(scenario)
      setMana(scenario, participantId)
      summon(scenario, opponentId, cardId)
      addCard(scenario, participantId, 'classic_slam')
      const before = scenario.match.getState()
      const own = before.players.find((entry) => entry.participantId === participantId)!
      const target = before.players.find((entry) => entry.participantId === opponentId)!
        .board[0]!
      const slam = own.hand.find((entry) => entry.cardId === 'classic_slam')!
      const beforeDraws = before.history?.cardsDrawnThisTurn.length ?? 0
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: slam.instanceId,
        targets: [
          { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
        ]
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const draws = result.state.history?.cardsDrawnThisTurn.length ?? 0
      expect(draws).toBe(beforeDraws + (survives ? 1 : 0))
    }
  )

  it('applies reference multipliers after counting removed keywords', () => {
    const scenario = createMatchScenario({ seed: 408 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    setMana(scenario, participantId)
    summon(scenario, participantId, 'classic_argent_squire')
    summon(scenario, opponentId, 'classic_argent_squire')
    addCard(scenario, participantId, 'classic_blood_knight')
    const before = scenario.match.getState()
    const own = before.players.find((entry) => entry.participantId === participantId)!
    const bloodKnight = own.hand.find(
      (entry) => entry.cardId === 'classic_blood_knight'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: bloodKnight.instanceId,
      position: 1
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(
      result.state.players
        .find((entry) => entry.participantId === participantId)!
        .board.find((entry) => entry.instanceId === bloodKnight.instanceId)
    ).toMatchObject({ attack: 9, health: 9 })
  })
  type QueryFixture = {
    readonly runtime: QueryRuntime
    readonly selfId: PlayerId
    readonly opponentId: PlayerId
    readonly source: QueryEntity
    readonly ownBoard: readonly QueryEntity[]
    readonly opponentBoard: readonly QueryEntity[]
    readonly selfDeck: readonly QueryEntity[]
    readonly selfHand: readonly QueryEntity[]
    readonly opponentHand: readonly QueryEntity[]
    readonly selfHero: QueryEntity
    readonly opponentHero: QueryEntity
    readonly selfHeroPower: QueryEntity
    readonly opponentHeroPower: QueryEntity
    readonly selfWeapon: QueryEntity
    readonly selfSecret: QueryEntity
  }

  function playCard(
    scenario: Scenario,
    participantId: PlayerId,
    cardId: string,
    targets: readonly CardPlayTargetRef[] = []
  ): void {
    const card = player(scenario, participantId).hand.find(
      (candidate) => candidate.cardId === cardId
    )
    expect(card, `Expected ${cardId} in ${participantId}'s hand.`).toBeDefined()
    if (!card) throw new Error(`Missing fixture card ${cardId}.`)
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      ...(targets.length > 0 ? { targets } : {})
    })
    expect(result.accepted, `Could not play fixture card ${cardId}.`).toBe(true)
  }

  function requireCard(cards: readonly QueryEntity[], cardId: string): QueryEntity {
    const card = cards.find((candidate) => candidate.cardId === cardId)
    if (!card) throw new Error(`Expected fixture card ${cardId}.`)
    return card
  }

  function matchingCards(
    cards: readonly QueryEntity[],
    predicate: (definition: CardDefinition) => boolean
  ): readonly QueryEntity[] {
    return cards.filter((card) =>
      card.cardId ? predicate(CARD_CATALOG.require(card.cardId)) : false
    )
  }

  function buildQueryFixture(): QueryFixture {
    const scenario = createMatchScenario({
      seed: 409,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [selfId, opponentId] = activeParticipants(scenario)
    setMana(scenario, selfId)

    summon(scenario, selfId, 'basic_frostwolf_grunt')
    summon(scenario, selfId, 'classic_argent_squire')
    summon(scenario, selfId, 'basic_chillwind_yeti')
    summon(scenario, opponentId, 'basic_boulderfist_ogre')
    summon(scenario, opponentId, 'basic_chillwind_yeti')
    summon(scenario, opponentId, 'basic_frostwolf_grunt')

    addCard(scenario, selfId, 'basic_fireball')
    const damagedTarget = player(scenario, opponentId).board[0]!
    playCard(scenario, selfId, 'basic_fireball', [
      {
        kind: 'minion',
        participantId: opponentId,
        instanceId: damagedTarget.instanceId
      }
    ])

    addCard(scenario, selfId, 'classic_eaglehorn_bow')
    playCard(scenario, selfId, 'classic_eaglehorn_bow')
    addCard(scenario, selfId, 'classic_ice_barrier')
    playCard(scenario, selfId, 'classic_ice_barrier')

    for (const cardId of [
      'classic_kirin_tor_mage',
      'goblins_vs_gnomes_clockwork_gnome',
      'goblins_vs_gnomes_piloted_shredder',
      'classic_the_black_knight',
      'classic_lightning_bolt',
      'goblins_vs_gnomes_spare_part_armor_plating'
    ])
      addCard(scenario, selfId, cardId)
    addCard(scenario, opponentId, 'basic_fireball')
    addCard(scenario, opponentId, 'classic_kirin_tor_mage')

    const state = scenario.match.getState()
    const self = state.players.find((entry) => entry.participantId === selfId)!
    const opponent = state.players.find((entry) => entry.participantId === opponentId)!
    const ownBoard = self.board.map((minion) =>
      entityRef('minion', selfId, minion.instanceId, 'board', minion.cardId)
    )
    const opponentBoard = opponent.board.map((minion) =>
      entityRef('minion', opponentId, minion.instanceId, 'board', minion.cardId)
    )
    const selfDeck = self.deck.map((card) =>
      entityRef('card', selfId, card.instanceId, 'deck', card.cardId)
    )
    const selfHand = self.hand.map((card) =>
      entityRef('card', selfId, card.instanceId, 'hand', card.cardId)
    )
    const opponentHand = opponent.hand.map((card) =>
      entityRef('card', opponentId, card.instanceId, 'hand', card.cardId)
    )
    const selfWeaponState = self.weapon
    const selfSecretState = self.secrets?.[0]
    if (!selfWeaponState || !selfSecretState)
      throw new Error('Expected weapon and secret fixture entities.')
    const selfWeapon = entityRef(
      'weapon',
      selfId,
      selfWeaponState.instanceId,
      'weapon',
      selfWeaponState.cardId
    )
    const selfSecret = entityRef(
      'secret',
      selfId,
      selfSecretState.instanceId,
      'secret',
      selfSecretState.cardId
    )
    const selfHero = entityRef('hero', selfId, selfId + ':hero', 'hero')
    const opponentHero = entityRef('hero', opponentId, opponentId + ':hero', 'hero')
    const selfHeroPower = entityRef(
      'hero-power',
      selfId,
      selfId + ':hero-power',
      'hero-power'
    )
    const opponentHeroPower = entityRef(
      'hero-power',
      opponentId,
      opponentId + ':hero-power',
      'hero-power'
    )
    const runtime = queryRuntime(
      new EffectRuntime(state, scenario.rng, state.nextEntityOrdinal ?? 0)
    )
    return {
      runtime,
      selfId,
      opponentId,
      source: ownBoard[1]!,
      ownBoard,
      opponentBoard,
      selfDeck,
      selfHand,
      opponentHand,
      selfHero,
      opponentHero,
      selfHeroPower,
      opponentHeroPower,
      selfWeapon,
      selfSecret
    }
  }

  type SelectorCase = {
    readonly name: string
    readonly selector: unknown
    readonly source?: QueryEntity
    readonly event?: QueryEvent | null
    readonly chosenTargets?: readonly QueryEntity[]
    readonly prepare?: (frame: QueryFrame, fixture: QueryFixture) => void
    readonly assert: (actual: readonly QueryEntity[], fixture: QueryFixture) => void
  }

  type FilterCase = {
    readonly name: string
    readonly selector: Record<string, unknown>
    readonly chosenTargets?: readonly QueryEntity[]
    readonly assert: (actual: readonly QueryEntity[], fixture: QueryFixture) => void
  }

  function keys(entities: readonly QueryEntity[]): readonly string[] {
    return entities.map(entityKey)
  }

  function expectKeys(
    actual: readonly QueryEntity[],
    expected: readonly QueryEntity[]
  ): void {
    expect(keys(actual)).toEqual(keys(expected))
  }

  function selectWithFilter(
    fixture: QueryFixture,
    selector: Record<string, unknown>,
    chosenTargets: readonly QueryEntity[] = []
  ): readonly QueryEntity[] {
    const frame = fixture.runtime.frameFor(fixture.source, null, chosenTargets)
    return [...fixture.runtime.select(selector, frame)]
  }
  it('covers selector controllers, types, modes, ranges, and exclusions', () => {
    const fixture = buildQueryFixture()
    const event: QueryEvent = {
      sequence: 1,
      type: 'card-played',
      source: fixture.source,
      target: fixture.opponentBoard[1]!,
      controllerId: fixture.selfId,
      cardId: asCardId('basic_fireball'),
      cardInstanceId: 'event-card:1',
      kind: 'play'
    }
    const eventCard = entityRef(
      'card',
      fixture.selfId,
      'event-card:1',
      'revealed',
      'basic_fireball'
    )
    const cases: readonly SelectorCase[] = [
      {
        name: 'self minions',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, current.ownBoard)
      },
      {
        name: 'opponent minions',
        selector: {
          controller: 'opponent',
          type: 'minion',
          zone: 'board',
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, current.opponentBoard)
      },
      {
        name: 'any characters',
        selector: { controller: 'any', type: 'character', selection: 'all' },
        assert: (actual, current) =>
          expectKeys(actual, [
            ...current.ownBoard,
            current.selfHero,
            ...current.opponentBoard,
            current.opponentHero
          ])
      },
      {
        name: 'count takes the stable prefix',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          count: 1
        },
        assert: (actual, current) => expectKeys(actual, [current.ownBoard[0]!])
      },
      {
        name: 'adjacent to source',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'adjacent',
          adjacentTo: 'source'
        },
        assert: (actual, current) =>
          expectKeys(actual, [current.ownBoard[0]!, current.ownBoard[2]!])
      },
      {
        name: 'chosen target',
        selector: {
          controller: 'opponent',
          type: 'minion',
          zone: 'board',
          selection: 'chosen'
        },
        chosenTargets: [fixture.opponentBoard[1]!],
        assert: (actual, current) => expectKeys(actual, [current.opponentBoard[1]!])
      },
      {
        name: 'chosen and adjacent',
        selector: {
          controller: 'opponent',
          type: 'minion',
          zone: 'board',
          selection: 'chosen-and-adjacent'
        },
        chosenTargets: [fixture.opponentBoard[1]!],
        assert: (actual, current) =>
          expectKeys(actual, [
            current.opponentBoard[1]!,
            current.opponentBoard[0]!,
            current.opponentBoard[2]!
          ])
      },
      {
        name: 'event source',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'event-source'
        },
        event,
        assert: (actual, current) => expectKeys(actual, [current.source])
      },
      {
        name: 'event target',
        selector: {
          controller: 'opponent',
          type: 'minion',
          zone: 'board',
          selection: 'event-target'
        },
        event,
        assert: (actual, current) => expectKeys(actual, [current.opponentBoard[1]!])
      },
      {
        name: 'missing event source',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'event-source'
        },
        assert: (actual) => expect(actual).toEqual([])
      },
      {
        name: 'missing event target',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'event-target'
        },
        assert: (actual) => expect(actual).toEqual([])
      },
      {
        name: 'source string',
        selector: 'source',
        assert: (actual, current) => expectKeys(actual, [current.source])
      },
      {
        name: 'source object',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'source'
        },
        assert: (actual, current) => expectKeys(actual, [current.source])
      },
      {
        name: 'hero selection',
        selector: {
          controller: 'opponent',
          type: 'hero',
          selection: 'hero'
        },
        assert: (actual, current) => expectKeys(actual, [current.opponentHero])
      },
      {
        name: 'hero power type',
        selector: {
          controller: 'self',
          type: 'hero-power',
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, [current.selfHeroPower])
      },
      {
        name: 'weapon type',
        selector: {
          controller: 'self',
          type: 'weapon',
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, [current.selfWeapon])
      },
      {
        name: 'secret type',
        selector: {
          controller: 'self',
          type: 'secret',
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, [current.selfSecret])
      },
      {
        name: 'all cards in hand',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, current.selfHand)
      },
      {
        name: 'minion cards in hand',
        selector: {
          controller: 'self',
          type: 'minion-card',
          zone: 'hand',
          selection: 'all'
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) => definition.type === 'Minion'
            )
          )
      },
      {
        name: 'spell cards in hand',
        selector: {
          controller: 'self',
          type: 'spell-card',
          zone: 'hand',
          selection: 'all'
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(current.selfHand, (definition) => definition.type === 'Spell')
          )
      },
      {
        name: 'other player hand',
        selector: {
          controller: 'any',
          type: 'card',
          zone: 'hand',
          selection: 'other-player-hand'
        },
        assert: (actual, current) => expectKeys(actual, current.opponentHand)
      },
      {
        name: 'next hand card',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'next'
        },
        source: fixture.selfHand[0]!,
        assert: (actual, current) => expectKeys(actual, [current.selfHand[1]!])
      },
      {
        name: 'random count one',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'random',
          count: 1
        },
        assert: (actual, current) => {
          expect(actual).toHaveLength(1)
          expect(current.ownBoard.map(entityKey)).toContain(entityKey(actual[0]!))
        }
      },
      {
        name: 'preserve removes the preserved opponent set',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          preserve: { controller: 'opponent' }
        },
        assert: (actual, current) => expectKeys(actual, current.ownBoard)
      },
      {
        name: 'top deck count',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'deck',
          position: 'top',
          count: 3,
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, current.selfDeck.slice(0, 3))
      },
      {
        name: 'bottom deck count',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'deck',
          position: 'bottom',
          count: 2,
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, current.selfDeck.slice(-2))
      },
      {
        name: 'numeric board position',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          position: 1,
          selection: 'all'
        },
        assert: (actual, current) => expectKeys(actual, [current.ownBoard[1]!])
      },
      {
        name: 'exclude source',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          exclude: 'source'
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[0]!,
            current.ownBoard[2]!,
            ...current.opponentBoard
          ])
      },
      {
        name: 'exclude event target',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          exclude: 'event-target'
        },
        event,
        assert: (actual, current) =>
          expectKeys(actual, [
            ...current.ownBoard,
            current.opponentBoard[0]!,
            current.opponentBoard[2]!
          ])
      },
      {
        name: 'exclude card id',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          excludeCardId: 'basic_chillwind_yeti'
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[0]!,
            current.ownBoard[1]!,
            current.opponentBoard[0]!,
            current.opponentBoard[2]!
          ])
      },
      {
        name: 'no candidate selection',
        selector: {
          controller: 'self',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { cardId: 'classic_the_black_knight' }
        },
        assert: (actual) => expect(actual).toHaveLength(0)
      },
      {
        name: 'event card context',
        selector: { type: 'event-card', selection: 'all' },
        event,
        assert: (actual) => expectKeys(actual, [eventCard])
      },
      {
        name: 'drawn card context',
        selector: { type: 'drawn-card', selection: 'all' },
        prepare: (frame, current) => {
          frame.drawnCards.push(current.opponentHand[0]!)
        },
        assert: (actual, current) => expectKeys(actual, [current.opponentHand[0]!])
      },
      {
        name: 'added card context',
        selector: { type: 'added-card', selection: 'all' },
        prepare: (frame, current) => {
          frame.addedCards.push(current.selfHand[0]!)
        },
        assert: (actual, current) => expectKeys(actual, [current.selfHand[0]!])
      }
    ]
    for (const testCase of cases) {
      const frame = fixture.runtime.frameFor(
        testCase.source ?? fixture.source,
        testCase.event ?? null,
        testCase.chosenTargets ?? []
      )
      testCase.prepare?.(frame, fixture)
      testCase.assert([...fixture.runtime.select(testCase.selector, frame)], fixture)
    }
  })

  it('covers filter fields, boolean values, and comparison operators', () => {
    const fixture = buildQueryFixture()
    const board = [...fixture.ownBoard, ...fixture.opponentBoard]
    const cases: readonly FilterCase[] = [
      {
        name: 'card id',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { cardId: 'classic_kirin_tor_mage' }
        },
        assert: (actual, current) =>
          expectKeys(actual, [requireCard(current.selfHand, 'classic_kirin_tor_mage')])
      },
      {
        name: 'card type',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { cardType: 'Minion' }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) => definition.type === 'Minion'
            )
          )
      },
      {
        name: 'cost equality',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { cost: 3 }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(current.selfHand, (definition) => definition.cost === 3)
          )
      },
      {
        name: 'cost comparison',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { cost: 3, operator: 'gte' }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(current.selfHand, (definition) => definition.cost >= 3)
          )
      },
      {
        name: 'dynamic target cost',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { cost: 'target-cost' }
        },
        chosenTargets: [requireCard(fixture.selfHand, 'classic_kirin_tor_mage')],
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(current.selfHand, (definition) => definition.cost === 3)
          )
      },
      {
        name: 'damaged true',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { damaged: true }
        },
        assert: (actual, current) => expectKeys(actual, [current.opponentBoard[0]!])
      },
      {
        name: 'damaged false',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { damaged: false }
        },
        assert: (actual) =>
          expectKeys(
            actual,
            board.filter((_, index) => index !== 3)
          )
      },
      {
        name: 'battlecry true',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { hasBattlecry: true }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(current.selfHand, (definition) =>
              definition.effects.some((effect) => effect.trigger === 'battlecry')
            )
          )
      },
      {
        name: 'battlecry false',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { hasBattlecry: false }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) =>
                !definition.effects.some((effect) => effect.trigger === 'battlecry')
            )
          )
      },
      {
        name: 'deathrattle true',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { hasDeathrattle: true }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(current.selfHand, (definition) =>
              definition.effects.some((effect) => effect.trigger === 'deathrattle')
            )
          )
      },
      {
        name: 'deathrattle false',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { hasDeathrattle: false }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) =>
                !definition.effects.some((effect) => effect.trigger === 'deathrattle')
            )
          )
      },
      {
        name: 'taunt keyword',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { keyword: 'taunt' }
        },
        assert: (actual, current) =>
          expectKeys(actual, [current.ownBoard[0]!, current.opponentBoard[2]!])
      },
      {
        name: 'negated taunt keyword',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { keyword: 'taunt', negate: true }
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[1]!,
            current.ownBoard[2]!,
            current.opponentBoard[0]!,
            current.opponentBoard[1]!
          ])
      },
      {
        name: 'overload true',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { overload: true }
        },
        assert: (actual, current) =>
          expectKeys(actual, [requireCard(current.selfHand, 'classic_lightning_bolt')])
      },
      {
        name: 'spare part',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { sparePart: true }
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            requireCard(current.selfHand, 'goblins_vs_gnomes_spare_part_armor_plating')
          ])
      },
      {
        name: 'rare',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { rarity: 'Rare' }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) => definition.rarity === 'Rare'
            )
          )
      },
      {
        name: 'mech tribe',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { tribe: 'Mech' }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) => definition.subtype === 'Mech'
            )
          )
      },
      {
        name: 'mech type alias',
        selector: {
          controller: 'self',
          type: 'card',
          zone: 'hand',
          selection: 'all',
          filter: { type: 'Mech' }
        },
        assert: (actual, current) =>
          expectKeys(
            actual,
            matchingCards(
              current.selfHand,
              (definition) => definition.subtype === 'Mech'
            )
          )
      },
      {
        name: 'attack greater than four',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { stat: 'attack', operator: 'gt', value: 4 }
        },
        assert: (actual, current) => expectKeys(actual, [current.opponentBoard[0]!])
      },
      {
        name: 'attack at least four',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { stat: 'attack', operator: 'gte', value: 4 }
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[2]!,
            current.opponentBoard[0]!,
            current.opponentBoard[1]!
          ])
      },
      {
        name: 'attack below four',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { stat: 'attack', operator: 'lt', value: 4 }
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[0]!,
            current.ownBoard[1]!,
            current.opponentBoard[2]!
          ])
      },
      {
        name: 'attack at most four',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { stat: 'attack', operator: 'lte', value: 4 }
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[0]!,
            current.ownBoard[1]!,
            current.ownBoard[2]!,
            current.opponentBoard[1]!,
            current.opponentBoard[2]!
          ])
      },
      {
        name: 'attack exactly four',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { stat: 'attack', operator: 'eq', value: 4 }
        },
        assert: (actual, current) =>
          expectKeys(actual, [current.ownBoard[2]!, current.opponentBoard[1]!])
      },
      {
        name: 'maximum health at most two',
        selector: {
          controller: 'any',
          type: 'minion',
          zone: 'board',
          selection: 'all',
          filter: { stat: 'health', operator: 'lte', value: 2 }
        },
        assert: (actual, current) =>
          expectKeys(actual, [
            current.ownBoard[0]!,
            current.ownBoard[1]!,
            current.opponentBoard[2]!
          ])
      }
    ]
    for (const testCase of cases) {
      const actual = selectWithFilter(
        fixture,
        testCase.selector,
        testCase.chosenTargets ?? []
      )
      testCase.assert(actual, fixture)
    }
  })
  it('covers every numeric reference and value operation', () => {
    const fixture = buildQueryFixture()
    const event: QueryEvent = {
      sequence: 2,
      type: 'damage-dealt',
      source: fixture.source,
      target: fixture.opponentBoard[1]!,
      controllerId: fixture.selfId,
      damage: 7,
      amount: 7,
      kind: 'damage'
    }
    const weaponEvent: QueryEvent = {
      ...event,
      sequence: 3,
      target: fixture.selfWeapon
    }
    const values: readonly {
      readonly name: string
      readonly value: unknown
      readonly source?: QueryEntity
      readonly event?: QueryEvent | null
      readonly chosenTargets?: readonly QueryEntity[]
      readonly prepare?: (frame: QueryFrame) => void
      readonly expected: number | readonly number[]
    }[] = [
      {
        name: 'available board slots',
        value: { reference: 'available-board-slots' },
        expected: 4
      },
      {
        name: 'cards played earlier this turn',
        value: { reference: 'cards-played-earlier-this-turn' },
        expected: 2
      },
      {
        name: 'damage dealt',
        value: { reference: 'damage-dealt' },
        prepare: (frame) => {
          frame.damageDealt = 5
        },
        expected: 5
      },
      {
        name: 'drawn card cost',
        value: { reference: 'drawn-card.cost' },
        prepare: (frame) => {
          frame.drawnCards.push(requireCard(fixture.selfHand, 'classic_kirin_tor_mage'))
        },
        expected: 3
      },
      {
        name: 'event target attack',
        value: { reference: 'event-target.attack' },
        event,
        expected: 4
      },
      {
        name: 'event target durability',
        value: { reference: 'event-target.durability' },
        event: weaponEvent,
        expected: 2
      },
      {
        name: 'event damage',
        value: { reference: 'event.damage' },
        event,
        expected: 7
      },
      {
        name: 'hand size difference',
        value: { reference: 'hand-size-difference' },
        expected: Math.abs(fixture.selfHand.length - fixture.opponentHand.length)
      },
      {
        name: 'source health reference',
        value: { reference: 'health' },
        expected: 1
      },
      {
        name: 'hero damage',
        value: { reference: 'hero-damage' },
        expected: 0
      },
      {
        name: 'matching entity count',
        value: {
          reference: 'matching-entity-count',
          selector: {
            controller: 'self',
            type: 'minion',
            zone: 'board',
            selection: 'all'
          }
        },
        expected: 3
      },
      {
        name: 'other cards in hand',
        value: { reference: 'other-cards-in-hand' },
        source: fixture.selfHand[0]!,
        expected: fixture.selfHand.length - 1
      },
      {
        name: 'other minions on board',
        value: { reference: 'other-minions-on-board' },
        expected: 5
      },
      {
        name: 'removed keyword count',
        value: { reference: 'removed-keyword-count' },
        prepare: (frame) => {
          frame.removedKeywordCount = 2
        },
        expected: 2
      },
      {
        name: 'self hero armor',
        value: { reference: 'self.hero.armor' },
        expected: 0
      },
      {
        name: 'self hero attack includes weapon',
        value: { reference: 'self.hero.attack' },
        expected: 3
      },
      {
        name: 'source attack',
        value: { reference: 'source.attack' },
        expected: 1
      },
      {
        name: 'source health',
        value: { reference: 'source.health' },
        expected: 1
      },
      {
        name: 'source weapon attack',
        value: { reference: 'source.weapon.attack' },
        expected: 3
      },
      {
        name: 'target attack',
        value: { reference: 'target.attack' },
        chosenTargets: [fixture.opponentBoard[1]!],
        expected: 4
      },
      {
        name: 'target health',
        value: { reference: 'target.health' },
        chosenTargets: [fixture.opponentBoard[1]!],
        expected: 5
      },
      {
        name: 'literal',
        value: 7,
        expected: 7
      },
      {
        name: 'random literal',
        value: { random: [2, 8] },
        expected: [2, 8]
      },
      {
        name: 'referenced multiplier',
        value: { reference: 'removed-keyword-count', multiplier: 3 },
        prepare: (frame) => {
          frame.removedKeywordCount = 2
        },
        expected: 6
      },
      {
        name: 'multiply operation',
        value: {
          reference: 'source.attack',
          operation: 'multiply',
          value: 2
        },
        expected: 2
      },
      {
        name: 'set operation',
        value: {
          reference: 'source.attack',
          operation: 'set',
          value: 9
        },
        expected: 9
      },
      {
        name: 'subtract operation',
        value: {
          reference: 'source.attack',
          operation: 'subtract',
          value: 5
        },
        expected: 4
      }
    ]
    for (const testCase of values) {
      const frame = fixture.runtime.frameFor(
        testCase.source ?? fixture.source,
        testCase.event ?? null,
        testCase.chosenTargets ?? []
      )
      testCase.prepare?.(frame)
      const actual = fixture.runtime.evaluate(testCase.value, frame)
      if (Array.isArray(testCase.expected))
        expect(testCase.expected, testCase.name).toContain(actual)
      else expect(actual, testCase.name).toBe(testCase.expected)
    }
  })

  it('terminates a real repeat effect when its target dies', () => {
    const scenario = createMatchScenario({
      seed: 410,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activeParticipants(scenario)
    setMana(scenario, participantId)
    summon(scenario, opponentId, 'classic_worthless_imp')
    addCard(scenario, participantId, 'goblins_vs_gnomes_bouncing_blade')
    const before = scenario.match.getState()
    const own = before.players.find((entry) => entry.participantId === participantId)!
    const blade = own.hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_bouncing_blade'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: blade.instanceId
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const opponent = result.state.players.find(
      (entry) => entry.participantId === opponentId
    )!
    expect(opponent.board).toHaveLength(0)
    expect(opponent.graveyard).toHaveLength(1)
    expect(
      result.state.effectTrace?.some((entry) => entry.actionPath.includes('.repeat[0]'))
    ).toBe(true)
  })

  it('covers every declared condition type against current state and history', () => {
    const fixture = buildQueryFixture()
    const freezeScenario = createMatchScenario({
      seed: 411,
      cardId: 'basic_acidic_swamp_ooze'
    })
    freezeScenario.confirmBothMulligans()
    const [freezePlayer, freezeOpponent] = activeParticipants(freezeScenario)
    setMana(freezeScenario, freezePlayer)
    summon(freezeScenario, freezeOpponent, 'basic_chillwind_yeti')
    addCard(freezeScenario, freezePlayer, 'basic_frostbolt')
    const freezeTarget = player(freezeScenario, freezeOpponent).board[0]!
    playCard(freezeScenario, freezePlayer, 'basic_frostbolt', [
      {
        kind: 'minion',
        participantId: freezeOpponent,
        instanceId: freezeTarget.instanceId
      }
    ])
    const frozenState = freezeScenario.match.getState()
    const frozenMinion = frozenState.players.find(
      (entry) => entry.participantId === freezeOpponent
    )!.board[0]!
    const frozenRef = entityRef(
      'minion',
      freezeOpponent,
      frozenMinion.instanceId,
      'board',
      frozenMinion.cardId
    )
    const frozenRuntime = queryRuntime(
      new EffectRuntime(
        frozenState,
        freezeScenario.rng,
        frozenState.nextEntityOrdinal ?? 0
      )
    )

    const demonScenario = createMatchScenario({
      seed: 412,
      cardId: 'basic_acidic_swamp_ooze'
    })
    demonScenario.confirmBothMulligans()
    const [demonPlayer] = activeParticipants(demonScenario)
    summon(demonScenario, demonPlayer, 'basic_voidwalker')
    const demonState = demonScenario.match.getState()
    const demonMinion = demonState.players.find(
      (entry) => entry.participantId === demonPlayer
    )!.board[0]!
    const demonRef = entityRef(
      'minion',
      demonPlayer,
      demonMinion.instanceId,
      'board',
      demonMinion.cardId
    )
    const demonRuntime = queryRuntime(
      new EffectRuntime(
        demonState,
        demonScenario.rng,
        demonState.nextEntityOrdinal ?? 0
      )
    )

    const deathEvent: QueryEvent = {
      sequence: 4,
      type: 'minion-died',
      source: fixture.source,
      target: fixture.opponentBoard[0]!,
      controllerId: fixture.opponentId,
      kind: 'damage'
    }
    const cases: readonly {
      readonly name: string
      readonly value: unknown
      readonly runtime?: QueryRuntime
      readonly source?: QueryEntity
      readonly event?: QueryEvent | null
      readonly chosenTargets?: readonly QueryEntity[]
      readonly prepare?: (frame: QueryFrame) => void
      readonly expected: boolean
    }[] = [
      {
        name: 'card died this game',
        value: { type: 'card-died-this-game' },
        expected: false
      },
      {
        name: 'combo',
        value: { type: 'combo' },
        expected: true
      },
      {
        name: 'combo active',
        value: { type: 'combo-active' },
        expected: true
      },
      {
        name: 'not combo',
        value: { type: 'not-combo' },
        expected: false
      },
      {
        name: 'drawn card matches',
        value: { type: 'drawn-card-matches', filter: { cardType: 'Spell' } },
        prepare: (frame) => {
          frame.drawnCards.push(requireCard(fixture.selfHand, 'classic_lightning_bolt'))
        },
        expected: true
      },
      {
        name: 'controls secret',
        value: { type: 'player-controls-secret', player: 'self' },
        expected: true
      },
      {
        name: 'has secret',
        value: { type: 'player-has-secret', player: 'self' },
        expected: true
      },
      {
        name: 'has damaged minion',
        value: { type: 'player-has-damaged-minion', player: 'opponent' },
        expected: true
      },
      {
        name: 'hand count',
        value: {
          type: 'player-has-hand-count',
          player: 'self',
          operator: 'gte',
          value: fixture.selfHand.length
        },
        expected: true
      },
      {
        name: 'has minion',
        value: {
          type: 'player-has-minion',
          player: 'self',
          filter: { keyword: 'taunt' }
        },
        expected: true
      },
      {
        name: 'has minion count',
        value: {
          type: 'player-has-minion-count',
          player: 'opponent',
          operator: 'eq',
          value: 1,
          filter: { keyword: 'taunt' }
        },
        expected: true
      },
      {
        name: 'has weapon',
        value: { type: 'player-has-weapon', player: 'self' },
        expected: true
      },
      {
        name: 'health greater than',
        value: { type: 'player-health-gt', player: 'self', value: 20 },
        expected: true
      },
      {
        name: 'health less than or equal',
        value: { type: 'player-health-lte', player: 'self', value: 30 },
        expected: true
      },
      {
        name: 'lacks minion',
        value: {
          type: 'player-lacks-minion',
          player: 'self',
          filter: { cardId: 'classic_the_black_knight' }
        },
        expected: true
      },
      {
        name: 'lacks weapon',
        value: { type: 'player-lacks-weapon', player: 'opponent' },
        expected: true
      },
      {
        name: 'source damaged',
        value: { type: 'source-damaged' },
        source: fixture.opponentBoard[0]!,
        expected: true
      },
      {
        name: 'target damaged',
        value: { type: 'target-damaged' },
        chosenTargets: [fixture.opponentBoard[0]!],
        expected: true
      },
      {
        name: 'target died event',
        value: { type: 'target-died' },
        event: deathEvent,
        chosenTargets: [fixture.opponentBoard[0]!],
        expected: true
      },
      {
        name: 'target frozen',
        value: { type: 'target-frozen' },
        runtime: frozenRuntime,
        source: frozenRef,
        chosenTargets: [frozenRef],
        expected: true
      },
      {
        name: 'target not frozen',
        value: { type: 'target-not-frozen' },
        chosenTargets: [fixture.opponentBoard[1]!],
        expected: true
      },
      {
        name: 'friendly demon',
        value: { type: 'target-is-friendly-demon' },
        runtime: demonRuntime,
        source: demonRef,
        chosenTargets: [demonRef],
        expected: true
      },
      {
        name: 'not friendly demon',
        value: { type: 'target-is-not-friendly-demon' },
        chosenTargets: [fixture.opponentBoard[1]!],
        expected: true
      },
      {
        name: 'target survived',
        value: { type: 'target-survived' },
        chosenTargets: [fixture.opponentBoard[1]!],
        expected: true
      }
    ]
    for (const testCase of cases) {
      const runtime = testCase.runtime ?? fixture.runtime
      const frame = runtime.frameFor(
        testCase.source ?? fixture.source,
        testCase.event ?? null,
        testCase.chosenTargets ?? []
      )
      testCase.prepare?.(frame)
      expect(runtime.conditionMatches(testCase.value, frame), testCase.name).toBe(
        testCase.expected
      )
    }
  })
})
