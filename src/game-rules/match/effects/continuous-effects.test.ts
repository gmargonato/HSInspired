import { describe, expect, it } from 'vitest'
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
