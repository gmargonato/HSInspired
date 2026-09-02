import { describe, expect, it } from 'vitest'
import { asCardId, CARD_CATALOG, type CardId } from '../../content/cards'
import type { OpeningCommandResult } from '../opening-match-types'
import { createMatchScenario } from '../testing/match-scenario-builder'

function targetKey(target: {
  readonly kind: string
  readonly participantId: string
  readonly instanceId?: string
}): string {
  return `${target.kind}:${target.participantId}:${target.instanceId ?? ''}`
}

function playerBoard(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string
) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!.board
}

function attemptCard(
  cardId: string,
  seed: number
): {
  readonly result?: OpeningCommandResult
  readonly state: unknown
  readonly rngState: unknown
} {
  const scenario = createMatchScenario({
    seed,
    cardId,
    firstHeroId: 'jaina',
    secondHeroId: 'jaina'
  })
  scenario.confirmBothMulligans()
  const participantId = scenario.match.getState().activePlayerId!
  const mana = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available: 10,
    maximum: 10
  })
  expect(mana.accepted).toBe(true)
  for (const targetParticipantId of scenario.participants) {
    const setupMinion = scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: targetParticipantId,
      cardId: 'basic_acidic_swamp_ooze'
    })
    expect(setupMinion.accepted).toBe(true)
  }
  const opponentId = scenario.participants.find((id) => id !== participantId)!
  const summon = (targetParticipantId: typeof participantId, supportCardId: CardId) => {
    const setup = scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: targetParticipantId,
      cardId: supportCardId
    })
    expect(setup.accepted).toBe(true)
    const board = scenario.match
      .getState()
      .players.find(
        (candidate) => candidate.participantId === targetParticipantId
      )!.board
    return board[board.length - 1]!.instanceId
  }
  const damage = (targetParticipantId: typeof participantId, instanceId: string) => {
    const result = scenario.match.dispatch({
      type: 'use-hero-power',
      participantId,
      target: { kind: 'minion', participantId: targetParticipantId, instanceId }
    })
    if (!result.accepted)
      throw new Error(`${cardId} setup damage failed: ${result.code} ${result.message}`)
  }
  switch (cardId) {
    case 'basic_execute':
      damage(opponentId, playerBoard(scenario, opponentId)[0]!.instanceId)
      break
    case 'basic_houndmaster':
    case 'classic_bestial_wrath':
      summon(participantId, asCardId('basic_bloodfen_raptor'))
      break
    case 'basic_sacrificial_pact':
      summon(participantId, asCardId('classic_doomguard'))
      break
    case 'basic_shadow_word_death':
      summon(opponentId, asCardId('basic_boulderfist_ogre'))
      break
    case 'classic_big_game_hunter':
      summon(opponentId, asCardId('classic_sea_giant'))
      break
    case 'classic_cabal_shadow_priest':
      summon(opponentId, asCardId('classic_wisp'))
      break
    case 'classic_hungry_crab':
      summon(participantId, asCardId('basic_murloc_raider'))
      break
    case 'classic_rampage':
      damage(participantId, playerBoard(scenario, participantId)[0]!.instanceId)
      break
    case 'classic_the_black_knight':
      summon(opponentId, asCardId('basic_senjin_shieldmasta'))
      break
    case 'goblins_vs_gnomes_upgraded_repair_bot': {
      const mech = summon(participantId, asCardId('goblins_vs_gnomes_snowchugger'))
      damage(participantId, mech)
      break
    }
    case 'goblins_vs_gnomes_screwjank_clunker':
      summon(participantId, asCardId('goblins_vs_gnomes_snowchugger'))
      break
    case 'goblins_vs_gnomes_hemet_nesingwary':
      summon(opponentId, asCardId('basic_bloodfen_raptor'))
      break
    case 'the_grand_tournament_demonfuse':
      summon(participantId, asCardId('classic_doomguard'))
      break
    case 'classic_molten_giant':
      expect(
        scenario.match.dispatch({
          type: 'dev-set-hero',
          participantId,
          health: 1
        }).accepted
      ).toBe(true)
      break
  }
  const refreshedMana = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available: 10,
    maximum: 10
  })
  expect(refreshedMana.accepted).toBe(true)
  const player = scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
  const handCard = player.hand[0]
  if (!handCard) {
    return {
      result: undefined,
      state: scenario.match.getState(),
      rngState: scenario.rng.snapshot()
    }
  }
  const input = scenario.match.getPlayInput?.(participantId, handCard.instanceId)
  const legality = scenario.match.getLegality?.(participantId)
  const legalTargets = legality?.legalTargets[handCard.instanceId] ?? []
  const used = new Set<string>()
  const targets = input?.targetSelectors
    .map(() => {
      const target = legalTargets.find((candidate) => !used.has(targetKey(candidate)))
      if (target) used.add(targetKey(target))
      return target
    })
    .filter((target): target is NonNullable<typeof target> => target !== undefined)
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: handCard.instanceId,
    ...(input?.requiresPosition ? { position: input.legalPositions[0] ?? 0 } : {}),
    ...(targets && targets.length > 0 ? { targets } : {}),
    ...(input && input.choiceCount > 0 ? { choice: 0 } : {})
  })
  return {
    result,
    state: scenario.match.getState(),
    rngState: scenario.rng.snapshot()
  }
}

describe('catalog effect closure smoke', () => {
  it('resolves every live card deterministically through the public command boundary', () => {
    for (const [index, card] of CARD_CATALOG.all.entries()) {
      const seed = 0x5000 + index
      const firstAttempt = attemptCard(card.id, seed)
      expect(attemptCard(card.id, seed)).toEqual(firstAttempt)
      if (!firstAttempt.result?.accepted)
        throw new Error(
          `${card.id}: ${firstAttempt.result?.code ?? 'no-result'} ${
            firstAttempt.result?.message ?? ''
          }`
        )
    }
  }, 120_000)
})
