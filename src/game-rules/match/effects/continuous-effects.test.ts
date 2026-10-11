import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG, type CardDefinition } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { getDerivedState } from './effect-runtime'
import type { OpeningMatchState } from '../opening-match-types'

function healthAuraScenario(aura: string, target: string, seed = 1201) {
  const scenario = createMatchScenario({ seed })
  scenario.confirmBothMulligans()
  const participantId = scenario.match.getState().activePlayerId!
  const opponentId = scenario.participants.find((id) => id !== participantId)!
  for (const cardId of [aura, target]) {
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId
      }).accepted
    ).toBe(true)
  }
  return { scenario, participantId, opponentId }
}

describe('continuous effect derivation', () => {
  describe.each(['minion', 'hero'] as const)('%s multiplier publication', (kind) => {
    it.each([
      ['permanent', false, 6, false],
      ['this-turn', false, 6, false],
      ['next-turn', false, 3, false],
      ['while-damaged', false, 3, false],
      ['while-damaged', true, 6, false],
      ['while-damaged', true, 6, true],
      ['while-source-in-play', false, 6, false],
      ['while-source-equipped', false, 3, false]
    ] as const)(
      'combines a permanent factor with a %s aura (wounded=%s, factor=%i, health aura=%s)',
      (duration, wounded, expected, healthAura) => {
        const { scenario, opponentId } = healthAuraScenario(
          'classic_prophet_velen',
          'basic_chillwind_yeti'
        )
        const original = scenario.match.getState()
        const definition = CARD_CATALOG.require('classic_prophet_velen')
        const selector: Readonly<Record<string, string>> =
          kind === 'hero'
            ? { controller: 'self', type: 'hero', selection: 'all' }
            : { type: 'minion', selection: 'source' }
        const variant: CardDefinition = {
          ...definition,
          effects: [
            {
              trigger: 'aura',
              actions: [
                {
                  action: 'modify',
                  target: selector,
                  duration,
                  spellDamageMultiplier: 2,
                  healingMultiplier: 2,
                  heroPowerMultiplier: 2
                },
                ...(healthAura
                  ? [{ action: 'modify' as const, target: selector, health: 1 }]
                  : [])
              ]
            }
          ]
        }
        const stored = {
          id: 'stored-multiplier',
          sourceInstanceId: `${opponentId}:hero`,
          sourceCardId: null,
          duration: 'permanent',
          spellDamageMultiplier: 3,
          healingMultiplier: 3,
          heroPowerMultiplier: 3
        }
        const state: OpeningMatchState = {
          ...original,
          players: original.players.map((p) =>
            p.participantId !== opponentId
              ? p
              : {
                  ...p,
                  hero:
                    kind === 'hero'
                      ? {
                          ...p.hero,
                          maxHealth: p.hero.maxHealth + Number(healthAura),
                          health:
                            p.hero.maxHealth + Number(healthAura) - Number(wounded),
                          enchantments: [stored]
                        }
                      : p.hero,
                  board: p.board.map((minion) =>
                    kind === 'minion' && minion.cardId === definition.id
                      ? {
                          ...minion,
                          maxHealth: minion.maxHealth + Number(healthAura),
                          health:
                            minion.maxHealth + Number(healthAura) - Number(wounded),
                          enchantments: [stored]
                        }
                      : minion
                  )
                }
          ) as unknown as OpeningMatchState['players']
        }
        // Only this generic target/duration matrix alters the catalog lookup.
        // Integration cases use Velen's real, unmodified definition.
        const lookup = CARD_CATALOG.get.bind(CARD_CATALOG)
        const spy = vi
          .spyOn(CARD_CATALOG, 'get')
          .mockImplementation((id) => (id === definition.id ? variant : lookup(id)))
        try {
          const derived = getDerivedState(state)
          const p = derived.players.find((entry) => entry.participantId === opponentId)!
          const target =
            kind === 'hero'
              ? p.hero
              : p.board.find((minion) => minion.cardId === definition.id)!
          expect(target).toMatchObject({
            spellDamageMultiplier: expected,
            healingMultiplier: expected,
            heroPowerMultiplier: expected
          })
          expect(getDerivedState(derived)).toEqual(derived)
          expect(scenario.match.getState()).toEqual(original)
        } finally {
          spy.mockRestore()
        }
      }
    )
  })

  it.each([
    ['classic_murloc_warleader', 'basic_murloc_raider', 1201],
    ['classic_murloc_warleader', 'basic_murloc_raider', 1202],
    ['classic_southsea_captain', 'classic_southsea_deckhand', 1201]
  ] as const)(
    'does not rescue %s / %s from lethal Storm damage (seed %s)',
    (aura, target, seed) => {
      const { scenario, participantId, opponentId } = healthAuraScenario(
        aura,
        target,
        seed
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
          cardId: 'classic_lightning_storm'
        }).accepted
      ).toBe(true)
      const before = scenario.match.getState()
      const spell = before.players
        .find((p) => p.participantId === participantId)!
        .hand.find((c) => c.cardId === 'classic_lightning_storm')!
      const victim = before.players
        .find((p) => p.participantId === opponentId)!
        .board.find((m) => m.cardId === target)!
      expect(victim.health).toBe(2)
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: spell.instanceId
      })
      expect(result.accepted).toBe(true)
      expect(
        result.events.some(
          (event) =>
            event.type === 'effect-resolved' &&
            event.action === 'damage' &&
            event.data?.target === victim.instanceId &&
            event.data?.healthAfter === 0
        )
      ).toBe(true)
      expect(
        scenario.match
          .getState()
          .players.find((p) => p.participantId === opponentId)!
          .board.some((m) => m.instanceId === victim.instanceId)
      ).toBe(false)
    }
  )

  it.each([
    ['classic_murloc_warleader', 'basic_murloc_raider'],
    ['classic_southsea_captain', 'classic_bloodsail_raider'],
    ['goblins_vs_gnomes_malganis', 'basic_voidwalker']
  ])('preserves damage across repeated derivation with %s', (aura, target) => {
    const { scenario, opponentId } = healthAuraScenario(aura, target)
    const snapshot = scenario.match.getState()
    const wounded: OpeningMatchState = {
      ...snapshot,
      players: snapshot.players.map((p) => ({
        ...p,
        board: p.board.map((m) =>
          m.cardId === target ? { ...m, health: 1, damageTaken: m.maxHealth - 1 } : m
        )
      })) as unknown as OpeningMatchState['players']
    }
    const first = getDerivedState(wounded)
    expect(
      first.players
        .find((p) => p.participantId === opponentId)!
        .board.find((m) => m.cardId === target)!.health
    ).toBe(1)
    expect(getDerivedState(first)).toEqual(first)
  })

  it('applies actual health aura gains and losses without healing existing damage', () => {
    const { scenario, opponentId } = healthAuraScenario(
      'classic_murloc_warleader',
      'basic_murloc_raider'
    )
    const original = scenario.match.getState()
    const source = original.players.find((p) => p.participantId === opponentId)!
      .board[0]
    const withoutSource = getDerivedState({
      ...original,
      players: original.players.map((p) => ({
        ...p,
        board: p.board.filter((m) => m.instanceId !== source.instanceId)
      })) as unknown as OpeningMatchState['players']
    })
    expect(
      withoutSource.players.find((p) => p.participantId === opponentId)!.board[0]
    ).toMatchObject({ health: 1, maxHealth: 1, damageTaken: 0 })
    const restored = getDerivedState({
      ...withoutSource,
      players: withoutSource.players.map((p) =>
        p.participantId === opponentId ? { ...p, board: [source, ...p.board] } : p
      ) as unknown as OpeningMatchState['players']
    })
    expect(
      restored.players.find((p) => p.participantId === opponentId)!.board[1]
    ).toMatchObject({ health: 2, maxHealth: 2, damageTaken: 0 })
    const woundedWithoutSource = getDerivedState({
      ...restored,
      players: restored.players.map((p) => ({
        ...p,
        board: p.board
          .filter((m) => m.instanceId !== source.instanceId)
          .map((m) => ({ ...m, health: 1, damageTaken: m.maxHealth - 1 }))
      })) as unknown as OpeningMatchState['players']
    })
    expect(
      woundedWithoutSource.players.find((p) => p.participantId === opponentId)!.board[0]
    ).toMatchObject({ health: 1, maxHealth: 1, damageTaken: 0 })
  })

  it('preserves damage with stacked health auras when one source leaves', () => {
    const { scenario, opponentId } = healthAuraScenario(
      'classic_murloc_warleader',
      'basic_murloc_raider'
    )
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'classic_murloc_warleader'
      }).accepted
    ).toBe(true)
    const snapshot = scenario.match.getState()
    const board = snapshot.players.find((p) => p.participantId === opponentId)!.board
    expect(board.find((m) => m.cardId === 'basic_murloc_raider')).toMatchObject({
      health: 3,
      maxHealth: 3
    })
    const wounded = getDerivedState({
      ...snapshot,
      players: snapshot.players.map((p) => ({
        ...p,
        board: p.board.map((m) =>
          m.cardId === 'basic_murloc_raider' ? { ...m, health: 1, damageTaken: 2 } : m
        )
      })) as unknown as OpeningMatchState['players']
    })
    const result = getDerivedState({
      ...wounded,
      players: wounded.players.map((p) => ({
        ...p,
        board: p.board.filter((m) => m.instanceId !== board[0].instanceId)
      })) as unknown as OpeningMatchState['players']
    })
    expect(
      result.players
        .find((p) => p.participantId === opponentId)!
        .board.find((m) => m.cardId === 'basic_murloc_raider')
    ).toMatchObject({ health: 1, maxHealth: 2, damageTaken: 1 })
    expect(getDerivedState(result)).toEqual(result)
  })

  it('is idempotent and leaves the stored match snapshot unchanged', () => {
    const scenario = createMatchScenario({ seed: 1201 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_cogmaster'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_warbot'
      }).accepted
    ).toBe(true)

    const snapshot = scenario.match.getState()
    const first = getDerivedState(snapshot)
    const second = getDerivedState(first)

    expect(second).toEqual(first)
    expect(scenario.match.getState()).toEqual(snapshot)
    expect(
      first.players.find((player) => player.participantId === participantId)?.board[0]
    ).toMatchObject({ cardId: 'goblins_vs_gnomes_cogmaster', attack: 3 })
  })
})
