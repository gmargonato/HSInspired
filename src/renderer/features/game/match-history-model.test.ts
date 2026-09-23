import {
  Container,
  Sprite,
  Texture,
  FederatedPointerEvent,
  FederatedWheelEvent
} from 'pixi.js'
import { gsap } from '../../animation/animations'
import { MatchHistoryView } from './match-history-view'
import { CardView } from '../../rendering/cards/card-view'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import {
  HISTORY_GRID,
  MATCH_HISTORY_LAYOUT,
  historyTargetPlacements
} from './match-history-layout'
import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import { asPlayerId } from '../../../game/match/match-types'
import {
  getOpeningMatchPublicEvents,
  type CardBurnedEvent,
  type HistoryActionResolvedEvent
} from '../../../game/match'
import { MatchHistoryModel } from './match-history-model'

const local = asPlayerId('local')
const remote = asPlayerId('remote')

function played(cardId: string, participantId = remote): HistoryActionResolvedEvent {
  return {
    type: 'history-action-resolved',
    action: 'card',
    participantId,
    source: {
      id: 'played-card',
      participantId,
      kind: 'card',
      cardId: asCardId(cardId),
      baseCost: 2,
      currentCost: 1
    },
    outcomes: []
  }
}

describe('MatchHistoryModel', () => {
  it('conceals random Secret casts across grouped targets and associated sources, but shows activation', () => {
    const secret = {
      ...played('classic_counterspell').source,
      id: 'random-secret',
      publicIdentity: true,
      secretCast: true,
      rulesText: 'Counter a spell',
      knownTo: [local, remote]
    }
    const source = played('whispers_of_the_old_gods_yogg_saron_hopes_end')
    const cast: HistoryActionResolvedEvent = {
      ...source,
      outcomes: [
        { kind: 'cast-spell', target: secret },
        { kind: 'state', target: { ...secret, secretCast: undefined }, before: secret }
      ]
    }
    const sourceEvent: HistoryActionResolvedEvent = {
      ...source,
      action: 'trigger',
      source: secret,
      outcomes: []
    }
    const concealed = getOpeningMatchPublicEvents([cast, sourceEvent], local)
    expect(JSON.stringify(concealed)).not.toContain('classic_counterspell')
    expect(JSON.stringify(concealed)).not.toContain('Counter a spell')
    const model = new MatchHistoryModel(local)
    const entry = model.record(cast)
    expect(entry.kind).toBe('action')
    if (entry.kind !== 'action') return
    expect(entry.targets[0].target.concealedAs).toBe('secret')
    expect(
      JSON.stringify(getOpeningMatchPublicEvents([cast, sourceEvent], remote))
    ).toContain('classic_counterspell')
    const activation = { ...sourceEvent, source: { ...secret, secretCast: undefined } }
    expect(JSON.stringify(getOpeningMatchPublicEvents([activation], local))).toContain(
      'classic_counterspell'
    )
  })

  it('conceals every opponent Secret from raw engine events and public events', () => {
    const secrets = CARD_CATALOG.all.filter((card) => card.keywords.includes('secret'))
    expect(secrets.length).toBeGreaterThan(0)
    for (const secret of secrets) {
      const event = played(secret.id)
      const projected = getOpeningMatchPublicEvents(
        [event],
        local
      )[0] as HistoryActionResolvedEvent
      for (const input of [event, projected]) {
        const model = new MatchHistoryModel(local)
        const entry = model.record(input)
        expect(entry).toMatchObject({ source: { cardId: null, concealedAs: 'secret' } })
        if (entry.kind !== 'action') throw new Error('Expected action')
        expect(entry.source).not.toHaveProperty('baseCost')
        expect(entry.source).not.toHaveProperty('currentCost')
      }
      expect(event.source.cardId).toBe(secret.id)
    }
  })

  it.each([
    'classic_freezing_trap',
    'basic_fireball',
    'basic_acidic_swamp_ooze',
    'basic_fiery_war_axe'
  ])('shows own played %s', (cardId) => {
    expect(new MatchHistoryModel(local).record(played(cardId, local))).toMatchObject({
      source: { cardId }
    })
  })

  it.each(['basic_fireball', 'basic_acidic_swamp_ooze', 'basic_fiery_war_axe'])(
    'shows ordinary opponent play %s',
    (cardId) => {
      expect(new MatchHistoryModel(local).record(played(cardId))).toMatchObject({
        source: { cardId }
      })
    }
  )

  it('allows a public Secret trigger without rewriting its concealed play', () => {
    const model = new MatchHistoryModel(local)
    const event = played('classic_freezing_trap')
    model.record(event)
    model.record({ ...event, action: 'trigger' })
    expect(model.all()[0]).toMatchObject({
      source: { cardId: 'classic_freezing_trap' }
    })
    expect(model.all()[1]).toMatchObject({
      source: { cardId: null, concealedAs: 'secret' }
    })
  })

  it('hides opponent hand outcomes including other effects on the same card', () => {
    const event = played('basic_fireball')
    const target = {
      id: 'created',
      participantId: remote,
      kind: 'card' as const,
      cardId: asCardId('classic_freezing_trap'),
      baseCost: 2,
      currentCost: 1
    }
    const input: HistoryActionResolvedEvent = {
      ...event,
      outcomes: [
        { kind: 'create-hand', target },
        { kind: 'buff', target },
        { kind: 'draw', target: { ...target, id: 'drawn' } },
        { kind: 'create-hand', target: { ...target, id: 'own', participantId: local } },
        { kind: 'summon-board', target: { ...target, id: 'summoned', kind: 'minion' } }
      ]
    }
    const entry = new MatchHistoryModel(local).record(input)
    if (entry.kind !== 'action') throw new Error('Expected action')
    expect(
      entry.outcomes
        .slice(0, 3)
        .every(
          ({ target }) =>
            target.cardId === null &&
            target.baseCost === undefined &&
            target.currentCost === undefined
        )
    ).toBe(true)
    expect(entry.outcomes.slice(3).every(({ target }) => target.cardId !== null)).toBe(
      true
    )
    expect(input.outcomes[0]!.target.cardId).toBe('classic_freezing_trap')
  })

  it('shows an opponent burned Secret because burns are public', () => {
    const event = {
      type: 'card-burned',
      participantId: remote,
      card: { cardId: asCardId('classic_freezing_trap') }
    } as CardBurnedEvent
    expect(new MatchHistoryModel(local).recordBurn(event)).toMatchObject({
      card: { cardId: 'classic_freezing_trap' }
    })
  })

  it('keeps newest entries first and caps the rail', () => {
    const model = new MatchHistoryModel(local, 2)
    model.record({
      type: 'history-action-resolved',
      participantId: local,
      action: 'card',
      source: {
        id: 'card-1',
        participantId: local,
        kind: 'card',
        cardId: asCardId('basic_fireball')
      },
      outcomes: []
    })
    model.record({
      type: 'history-action-resolved',
      participantId: local,
      action: 'combat',
      source: {
        id: 'hero-1',
        participantId: local,
        kind: 'hero',
        cardId: null
      },
      outcomes: []
    })
    model.record({
      type: 'history-action-resolved',
      participantId: local,
      action: 'hero-power',
      source: {
        id: 'hero-power-1',
        participantId: local,
        kind: 'hero',
        cardId: null
      },
      outcomes: []
    })

    expect(model.all()).toHaveLength(2)
    expect(model.all().map((entry) => entry.action)).toEqual(['hero-power', 'combat'])
  })

  it('records a burn with its burned-card snapshot', () => {
    const model = new MatchHistoryModel(local, 2)
    const burn = {
      type: 'card-burned',
      participantId: local,
      card: { cardId: asCardId('basic_fireball') }
    } as CardBurnedEvent

    model.recordBurn(burn)

    expect(model.all()).toEqual([
      expect.objectContaining({
        kind: 'burn',
        action: 'burn',
        participantId: local,
        card: { cardId: asCardId('basic_fireball') }
      })
    ])
  })
})

describe('history retention and content layout', () => {
  it('retains the whole match while reading only a visible window', () => {
    const model = new MatchHistoryModel(local)
    for (let index = 0; index < 10000; index++)
      model.record({
        ...played('basic_fireball', local),
        source: { ...played('basic_fireball', local).source, id: 'card-' + index }
      })
    expect(model.count).toBe(10000)
    expect(model.visible(0, 7).map((entry) => entry.id)).toEqual([
      9999, 9998, 9997, 9996, 9995, 9994, 9993
    ])
    expect(model.visible(9997, 7).map((entry) => entry.id)).toEqual([2, 1, 0])
  })
  it('merges a deferred choice into its original slot without changing its played cost', () => {
    const model = new MatchHistoryModel(local)
    model.record(played('league_of_explorers_sir_finley_mrrgglton', local))
    model.record({
      ...played('league_of_explorers_sir_finley_mrrgglton', local),
      append: true,
      outcomes: [
        {
          kind: 'create-hand',
          target: {
            id: 'result',
            participantId: local,
            kind: 'card',
            cardId: asCardId('basic_fireball'),
            zone: 'hand'
          }
        }
      ]
    })
    expect(model.count).toBe(1)
    expect(model.all()[0]).toMatchObject({
      source: { currentCost: 1 },
      targets: [{ target: { cardId: 'basic_fireball' } }]
    })
  })
  it('shows retaliation on the source and groups all damage on the defender', () => {
    const model = new MatchHistoryModel(local)
    const event = played('basic_acidic_swamp_ooze', local)
    const defender = {
      id: 'defender',
      participantId: remote,
      kind: 'minion' as const,
      cardId: asCardId('basic_acidic_swamp_ooze'),
      health: 1
    }
    const entry = model.record({
      ...event,
      action: 'combat',
      outcomes: [
        { kind: 'damage', target: { ...event.source, health: 1 }, amount: 1 },
        { kind: 'damage', target: defender, amount: 1 },
        { kind: 'damage', target: { ...defender, health: 0 }, amount: 1 },
        { kind: 'death', target: { ...defender, health: 0 } }
      ]
    })
    expect(entry).toMatchObject({
      source: { health: 1 },
      sourceOutcomes: [{ kind: 'damage', amount: 1 }],
      targets: [{ target: { health: 0 } }]
    })
    if (entry.kind !== 'action') throw new Error('Expected action')
    expect(
      entry.targets[0].outcomes
        .filter((outcome) => outcome.kind === 'damage')
        .reduce((sum, outcome) => sum + (outcome.amount ?? 0), 0)
    ).toBe(2)
  })
  it.each([1, 7, 14, 30, 100])(
    'fits every padded result for %i targets without overlap',
    (count) => {
      const placements = historyTargetPlacements(count)
      expect(placements).toHaveLength(count)
      const bounds = placements.map(({ x, y, scale }) => ({
        x: x - HISTORY_GRID.insetX * scale,
        y: y - HISTORY_GRID.insetY * scale,
        width: HISTORY_GRID.cellWidth * scale,
        height: HISTORY_GRID.cellHeight * scale
      }))
      for (const [index, box] of bounds.entries()) {
        expect(box.x).toBeGreaterThanOrEqual(HISTORY_GRID.x - 0.001)
        expect(box.y).toBeGreaterThanOrEqual(HISTORY_GRID.y - 0.001)
        expect(box.x + box.width).toBeLessThanOrEqual(
          HISTORY_GRID.x + HISTORY_GRID.width + 0.001
        )
        expect(box.y + box.height).toBeLessThanOrEqual(
          HISTORY_GRID.y + HISTORY_GRID.height + 0.001
        )
        for (const other of bounds.slice(index + 1))
          expect(
            Math.min(box.x + box.width, other.x + other.width) -
              Math.max(box.x, other.x) >
              0.001 &&
              Math.min(box.y + box.height, other.y + other.height) -
                Math.max(box.y, other.y) >
                0.001
          ).toBe(false)
      }
    }
  )
  it('aligns a single result with the source and arrow', () => {
    const [target] = historyTargetPlacements(1)
    expect(target.y + 450 * target.scale).toBeCloseTo(HISTORY_GRID.arrow.y)
  })
})

describe('history rail lifecycle', () => {
  it('slides new entries in from the left while preserving existing slot content', () => {
    const texture = Texture.WHITE
    const textures = new Proxy({}, { get: () => texture }) as ConstructorParameters<
      typeof MatchHistoryView
    >[0]
    const view = new MatchHistoryView(textures, local, vi.fn())
    const settle = (): void => {
      for (const child of view.rail.children)
        for (const tween of gsap.getTweensOf(child)) tween.progress(1)
    }

    try {
      const firstSlot = view.rail.children[0]
      const secondSlot = view.rail.children[1]
      view.record(played('basic_fireball', local))
      expect(firstSlot.x).toBe(MATCH_HISTORY_LAYOUT.rail.entryAnimation.incomingOffsetX)

      view.record({
        ...played('basic_frostbolt', remote),
        source: { ...played('basic_frostbolt', remote).source, id: 'second' }
      })
      expect(secondSlot.x).toBe(
        MATCH_HISTORY_LAYOUT.rail.entryAnimation.incomingOffsetX
      )
      settle()

      expect(secondSlot.x).toBe(0)
      expect(secondSlot.y).toBe(0)
      expect(firstSlot.x).toBe(0)
      expect(firstSlot.y).toBe(MATCH_HISTORY_LAYOUT.rail.gap)
    } finally {
      if (!view.destroyed) view.destroy({ children: true })
    }
  })

  it('keeps seven reusable slots and closes pending previews on leaving the rail', async () => {
    const artwork = vi
      .spyOn(CardAssetResolver.prototype, 'loadArtwork')
      .mockResolvedValue(undefined)
    const create = vi.spyOn(CardView, 'create').mockImplementation(async () => {
      const card = new Container() as CardView
      const content = new Sprite(Texture.WHITE)
      content.width = 10
      content.height = 10
      card.addChild(content)
      return card
    })
    const texture = Texture.WHITE
    const textures = new Proxy({}, { get: () => texture }) as ConstructorParameters<
      typeof MatchHistoryView
    >[0]
    const desaturate = vi.fn()
    const view = new MatchHistoryView(textures, local, desaturate)
    try {
      const rail = view.children[0]
      const slots = [...rail.children]
      for (let index = 0; index < 1000; index++)
        view.record({
          ...played('basic_fireball', local),
          source: { ...played('basic_fireball', local).source, id: 'card-' + index }
        })
      expect(rail.children).toEqual(slots)
      expect(rail.children).toHaveLength(7)
      expect(view.children[1].children).toHaveLength(0)
      const pointer = new FederatedPointerEvent(null!)
      pointer.global.set(rail.x + 20, rail.y + 20)
      rail.emit('pointerenter', pointer)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(view.children[1].children).toHaveLength(1)
      expect(view.children[1].children[0]?.label).toBe('game.history.source')
      expect(desaturate).toHaveBeenLastCalledWith(true)
      const wheel = new FederatedWheelEvent(null!)
      wheel.deltaY = 1
      wheel.stopPropagation = vi.fn()
      wheel.preventDefault = vi.fn()
      rail.emit('wheel', wheel)
      expect(wheel.stopPropagation).toHaveBeenCalledOnce()
      expect(wheel.preventDefault).toHaveBeenCalledOnce()
      rail.emit('pointerleave', pointer)
      expect(view.children[1].children).toHaveLength(0)
      expect(desaturate).toHaveBeenLastCalledWith(false)
      rail.emit('pointerenter', pointer)
      view.destroy({ children: true })
      expect(desaturate).toHaveBeenLastCalledWith(false)
    } finally {
      if (!view.destroyed) view.destroy({ children: true })
      artwork.mockRestore()
      create.mockRestore()
    }
  })
})

describe('Cthun ritual history previews', () => {
  it('groups Disciple targets and keeps public ritual snapshots independent of later totals', () => {
    const model = new MatchHistoryModel(local)
    const cthun = asCardId('whispers_of_the_old_gods_cthun')
    const event: HistoryActionResolvedEvent = {
      ...played('whispers_of_the_old_gods_disciple_of_cthun'),
      outcomes: [
        {
          kind: 'damage',
          amount: 2,
          target: {
            id: 'hero',
            kind: 'hero',
            participantId: local,
            cardId: null,
            health: 28
          }
        },
        {
          kind: 'buff',
          target: {
            id: 'remote:cthun-progression',
            kind: 'card',
            participantId: remote,
            cardId: cthun,
            publicIdentity: true,
            attack: 8,
            health: 8
          }
        }
      ]
    }
    const entry = model.record(event)
    if (entry.kind !== 'action') throw Error('Expected action')
    expect(entry.targets).toHaveLength(2)
    expect(entry.targets[1].target).toMatchObject({
      cardId: cthun,
      attack: 8,
      health: 8
    })
    expect(entry.targets[1].target.zone).toBeUndefined()
    model.record({
      ...played('whispers_of_the_old_gods_beckoner_of_evil'),
      source: {
        ...played('whispers_of_the_old_gods_beckoner_of_evil').source,
        id: 'later-cultist'
      },
      outcomes: [
        {
          kind: 'buff',
          target: { ...event.outcomes[1].target, attack: 10, health: 10 }
        }
      ]
    })
    expect(entry.targets[1].target.attack).toBe(8)
    const projected = getOpeningMatchPublicEvents(
      [event],
      local
    )[0] as HistoryActionResolvedEvent
    expect(projected.outcomes[1].target.cardId).toBe(cthun)
    expect(projected.outcomes[1].target.attack).toBe(8)
  })
})
