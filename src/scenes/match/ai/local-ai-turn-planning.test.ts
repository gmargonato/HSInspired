import { describe, expect, it } from 'vitest'
import { asCardId } from '../../../game-rules/content/cards'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import type { TurnMatchCommand } from '../../../game-rules/match'
import { createMatchScenario } from '../../../game-rules/match/testing/match-scenario-builder'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import type { TacticalLine } from '../../../game-rules/match/ai/tactical-search'
import type { AiDecisionRequest } from '../../../desktop/contracts/ipc/ai'
import { aiActions } from './ai-context'
import { GameBoardSession } from '../game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { expertResourceSetupPreference } from './expert-resource-preference'
import { expertSingletonCleanupSeeds } from './expert-cleanup-seeds'

function dispatch(session: GameBoardSession, command: TurnMatchCommand): void {
  const result = session.match.dispatch(command)
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
}

function startAiTurn(seed: number, configure: (session: GameBoardSession) => void) {
  const scenario = createMatchScenario({ seed })
  const session = new GameBoardSession({ setup: scenario.setup, decks: scenario.decks })
  dispatch(session, {
    type: 'confirm-mulligan',
    participantId: session.localParticipantId,
    replaceInstanceIds: []
  })
  dispatch(session, {
    type: 'confirm-mulligan',
    participantId: session.remoteParticipantId,
    replaceInstanceIds: []
  })
  configure(session)
  const active = session.getState().activePlayerId
  if (active === session.localParticipantId) {
    dispatch(session, { type: 'end-turn', participantId: session.localParticipantId })
  } else {
    dispatch(session, { type: 'end-turn', participantId: session.remoteParticipantId })
    dispatch(session, { type: 'end-turn', participantId: session.localParticipantId })
  }
  expect(session.getState().activePlayerId).toBe(session.remoteParticipantId)
  return session
}

function addCard(session: GameBoardSession, cardId: string): string {
  dispatch(session, {
    type: 'dev-add-card',
    participantId: session.remoteParticipantId,
    cardId: asCardId(cardId)
  })
  return session
    .findPlayer(session.getState(), session.remoteParticipantId)
    .hand.find((card) => card.cardId === cardId && card.instanceId.includes(':dev:'))!
    .instanceId
}

function clearHand(session: GameBoardSession): void {
  dispatch(session, {
    type: 'dev-clear-zone',
    participantId: session.remoteParticipantId,
    zone: 'hand'
  })
}

function clearBoard(
  session: GameBoardSession,
  participantId = session.remoteParticipantId
): void {
  dispatch(session, {
    type: 'dev-clear-zone',
    participantId,
    zone: 'board'
  })
}

function setMana(session: GameBoardSession, available: number): void {
  dispatch(session, {
    type: 'dev-set-mana',
    participantId: session.remoteParticipantId,
    available,
    maximum: available
  })
}

function legal(session: GameBoardSession): readonly TurnMatchCommand[] {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}

function request(
  session: GameBoardSession,
  actionIds: readonly string[]
): AiDecisionRequest {
  return {
    matchId: `planning-${session.getState().revision}`,
    requestId: `planning-request-${session.getState().revision}`,
    expectedRevision: session.getState().revision,
    phase: 'action',
    allowInspection: false,
    messages: [{ role: 'user', content: '{}' }],
    actionIds
  }
}

async function choose(session: GameBoardSession) {
  const commands = legal(session)
  const actions = aiActions(session, commands)
  const api = new LocalAiDecisionApi(session)
  const response = await api.decide(
    request(
      session,
      actions.map((action) => action.id)
    )
  )
  expect('actionId' in response.choice).toBe(true)
  if (!('actionId' in response.choice)) throw new Error('Expected an action choice.')
  const actionId = (response.choice as { actionId: string }).actionId
  const action = actions.find((candidate) => candidate.id === actionId)
  expect(action).toBeDefined()
  return { command: action!.command, trace: api.getLastTrace() }
}

async function playAiTurn(
  session: GameBoardSession
): Promise<readonly TurnMatchCommand[]> {
  const api = new LocalAiDecisionApi(session)
  const commands: TurnMatchCommand[] = []
  for (let step = 0; step < 8 && session.getState().phase !== 'ended'; step += 1) {
    if (session.getState().activePlayerId !== session.remoteParticipantId) break
    const available = legal(session)
    const actions = aiActions(session, available)
    const response = await api.decide(
      request(
        session,
        actions.map((action) => action.id)
      )
    )
    if (!('actionId' in response.choice)) throw new Error('Expected an action choice.')
    const actionId = (response.choice as { actionId: string }).actionId
    const action = actions.find((candidate) => candidate.id === actionId)
    if (!action) throw new Error('AI selected an unknown planning action.')
    commands.push(action.command)
    dispatch(session, action.command)
    if (action.command.type === 'end-turn') break
  }
  return commands
}

function summon(session: GameBoardSession, cardId: string): void {
  dispatch(session, {
    type: 'dev-summon-minion',
    participantId: session.remoteParticipantId,
    cardId: asCardId(cardId)
  })
}

function summonEnemy(session: GameBoardSession, cardId: string): void {
  dispatch(session, {
    type: 'dev-summon-minion',
    participantId: session.localParticipantId,
    cardId: asCardId(cardId)
  })
}

function disableHeroPower(session: GameBoardSession): void {
  dispatch(session, {
    type: 'dev-set-hero-power',
    participantId: session.remoteParticipantId,
    available: false
  })
}

describe('hardware local AI complete-turn planning', () => {
  const placementCards = [
    'classic_defender_of_argus',
    'basic_flametongue_totem',
    'classic_dire_wolf_alpha',
    'classic_sunfury_protector'
  ] as const

  for (let index = 0; index < 12; index += 1) {
    it(`places adjacent-effect minions optimally, case ${index + 1}`, async () => {
      const session = startAiTurn(0x600 + index, (current) => {
        summon(
          current,
          index % 2 === 0 ? 'basic_goldshire_footman' : 'basic_murloc_scout'
        )
        summon(current, index % 3 === 0 ? 'basic_boulderfist_ogre' : 'basic_core_hound')
        disableHeroPower(current)
      })
      clearBoard(session)
      summon(
        session,
        index % 2 === 0 ? 'basic_goldshire_footman' : 'basic_murloc_scout'
      )
      summon(session, index % 3 === 0 ? 'basic_boulderfist_ogre' : 'basic_core_hound')
      if (index % placementCards.length === 3) {
        summonEnemy(session, 'basic_core_hound')
        dispatch(session, {
          type: 'dev-set-hero',
          participantId: session.remoteParticipantId,
          health: 5
        })
      }
      disableHeroPower(session)
      clearHand(session)
      const cardId = placementCards[index % placementCards.length]!
      addCard(session, cardId)
      setMana(session, cardId === 'classic_defender_of_argus' ? 4 : 2)
      const selected = await choose(session)
      expect(selected.command.type).toBe('play-card')
      if (selected.command.type === 'play-card') {
        expect(selected.command.cardInstanceId).toContain(':dev:')
        if (cardId === 'classic_sunfury_protector')
          expect(selected.command.position).toBe(
            index % placementCards.length === 3 ? 0 : 1
          )
        else expect(selected.command.position).toBe(1)
      }
    })
  }

  it('keeps the same optimal adjacency route after a board-stat variation', async () => {
    const makeSession = (rightMinion: string) => {
      const session = startAiTurn(
        0x615 + (rightMinion === 'basic_murloc_scout' ? 1 : 0),
        (current) => {
          disableHeroPower(current)
        }
      )
      clearBoard(session)
      summon(session, 'basic_goldshire_footman')
      summon(session, rightMinion)
      disableHeroPower(session)
      clearHand(session)
      addCard(session, 'classic_defender_of_argus')
      setMana(session, 4)
      return session
    }
    const strongBoard = await choose(makeSession('basic_boulderfist_ogre'))
    const lowHealthBoard = await choose(makeSession('basic_murloc_scout'))
    for (const result of [strongBoard, lowHealthBoard]) {
      expect(result.command.type).toBe('play-card')
      if (result.command.type === 'play-card') expect(result.command.position).toBe(1)
      expect(result.trace?.chosenSequence?.[0]).toContain('position=1')
    }
  })

  for (let index = 0; index < 8; index += 1) {
    it(`plans a multi-action turn before committing, case ${index + 1}`, async () => {
      const session = startAiTurn(0x620 + index, (current) => {
        summon(current, 'basic_goldshire_footman')
        summon(current, index % 2 === 0 ? 'basic_murloc_scout' : 'basic_core_hound')
        disableHeroPower(current)
      })
      disableHeroPower(session)
      clearHand(session)
      const gormok = addCard(session, 'the_grand_tournament_gormok_the_impaler')
      const bodyOne = addCard(session, 'basic_goldshire_footman')
      const bodyTwo = addCard(session, 'basic_murloc_scout')
      setMana(session, 6)
      const enemyHeroHealthBefore = session.findPlayer(
        session.getState(),
        session.localParticipantId
      ).hero.health
      const commands = await playAiTurn(session)
      const played = commands.filter((command) => command.type === 'play-card')
      expect(played.length).toBeGreaterThan(1)
      const gormokIndex = commands.findIndex(
        (command) => command.type === 'play-card' && command.cardInstanceId === gormok
      )
      expect(gormokIndex).toBeGreaterThan(0)
      expect(
        commands
          .slice(0, gormokIndex)
          .some(
            (command) =>
              command.type === 'play-card' &&
              (command.cardInstanceId === bodyOne || command.cardInstanceId === bodyTwo)
          )
      ).toBe(true)
      expect(
        session
          .findPlayer(session.getState(), session.remoteParticipantId)
          .board.some(
            (minion) => minion.cardId === 'the_grand_tournament_gormok_the_impaler'
          )
      ).toBe(true)
      expect(
        session.findPlayer(session.getState(), session.localParticipantId).hero.health
      ).toBe(enemyHeroHealthBefore - (index % 2 === 0 ? 6 : 14))
    })
  }

  for (let index = 0; index < 8; index += 1) {
    it(`protects the hero against public pressure, case ${index + 1}`, async () => {
      const session = startAiTurn(0x640 + index, (current) => {
        summonEnemy(
          current,
          index % 2 === 0 ? 'basic_core_hound' : 'basic_boulderfist_ogre'
        )
        summonEnemy(current, 'basic_murloc_scout')
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.remoteParticipantId,
          health: 5
        })
        disableHeroPower(current)
      })
      disableHeroPower(session)
      clearHand(session)
      addCard(session, index % 2 === 0 ? 'basic_assassinate' : 'basic_hellfire')
      setMana(session, index % 2 === 0 ? 5 : 4)
      const selected = await choose(session)
      expect(selected.command.type).toBe('play-card')
      if (selected.command.type === 'play-card') {
        const cardInstanceId = selected.command.cardInstanceId
        const card = session
          .findPlayer(session.getState(), session.remoteParticipantId)
          .hand.find((entry) => entry.instanceId === cardInstanceId)
        expect(['basic_assassinate', 'basic_hellfire']).toContain(card?.cardId)
      }
    })
  }

  for (let index = 0; index < 8; index += 1) {
    it(`preserves resources when no useful follow-up exists, case ${index + 1}`, async () => {
      const session = startAiTurn(0x660 + index, (current) => {
        disableHeroPower(current)
      })
      disableHeroPower(session)
      clearHand(session)
      addCard(session, 'basic_the_coin')
      addCard(session, 'basic_goldshire_footman')
      setMana(session, 1)
      const selected = await choose(session)
      expect(selected.command.type).toBe('play-card')
      if (selected.command.type === 'play-card')
        expect(selected.command.cardInstanceId).not.toContain('basic_the_coin')
    })
  }

  for (let index = 0; index < 8; index += 1) {
    it(`takes a calculated random comeback line, case ${index + 1}`, async () => {
      const session = startAiTurn(0x680 + index, (current) => {
        summonEnemy(current, 'whispers_of_the_old_gods_cthun')
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.remoteParticipantId,
          health: 8
        })
        disableHeroPower(current)
      })
      disableHeroPower(session)
      clearHand(session)
      addCard(session, 'whispers_of_the_old_gods_yogg_saron_hopes_end')
      setMana(session, 10)
      const selected = await choose(session)
      expect(selected.command.type).toBe('play-card')
      if (selected.command.type === 'play-card') {
        const cardInstanceId = selected.command.cardInstanceId
        const card = session
          .findPlayer(session.getState(), session.remoteParticipantId)
          .hand.find((entry) => entry.instanceId === cardInstanceId)
        expect(card?.cardId).toBe('whispers_of_the_old_gods_yogg_saron_hopes_end')
        expect(selected.trace?.sampleCount).toBeGreaterThan(1)
      }
    })
  }

  for (let index = 0; index < 8; index += 1) {
    it(`respects placement and visible combat constraints, case ${index + 1}`, async () => {
      const session = startAiTurn(0x6a0 + index, (current) => {
        summon(current, 'basic_core_hound')
        summonEnemy(current, 'basic_frostwolf_grunt')
        dispatch(current, {
          type: 'dev-set-hero',
          participantId: current.localParticipantId,
          health: index % 2 === 0 ? 4 : 16
        })
        disableHeroPower(current)
      })
      clearHand(session)
      addCard(session, index % 2 === 0 ? 'basic_fireball' : 'classic_sunfury_protector')
      setMana(session, index % 2 === 0 ? 4 : 4)
      const commands = await playAiTurn(session)
      expect(commands.length).toBeGreaterThan(0)
      expect(commands[0]!.type).not.toBe('end-turn')
    })
  }

  it('keeps The Coin when it cannot unlock a useful follow-up', async () => {
    const session = startAiTurn(0x6b0, (current) => {
      disableHeroPower(current)
    })
    disableHeroPower(session)
    clearHand(session)
    addCard(session, 'basic_the_coin')
    setMana(session, 1)
    const selected = await choose(session)
    expect(selected.command.type).toBe('end-turn')
  })

  it('isolates random samples from the authoritative match RNG and state', async () => {
    const session = startAiTurn(0x6b1, (current) => {
      summonEnemy(current, 'whispers_of_the_old_gods_cthun')
      disableHeroPower(current)
    })
    disableHeroPower(session)
    clearHand(session)
    addCard(session, 'whispers_of_the_old_gods_yogg_saron_hopes_end')
    setMana(session, 10)
    const before = session.match.getCheckpoint()
    await choose(session)
    expect(session.match.getCheckpoint()).toEqual(before)
  })

  const interactionCases = [
    'league_of_explorers_raven_idol',
    'classic_nourish',
    'basic_assassinate',
    'basic_hellfire',
    'basic_arcane_intellect',
    'basic_boulderfist_ogre',
    'basic_fireball',
    'classic_holy_fire'
  ] as const

  for (let index = 0; index < interactionCases.length; index += 1) {
    it(`handles a different interaction family, case ${index + 1}`, async () => {
      const cardId = interactionCases[index]!
      const session = startAiTurn(0x6c0 + index, (current) => {
        if (index === 2 || index === 3) {
          summonEnemy(current, 'basic_boulderfist_ogre')
          summonEnemy(current, 'basic_goldshire_footman')
        }
        if (index === 5)
          for (let slot = 0; slot < 7; slot += 1)
            summon(current, 'basic_goldshire_footman')
        if (index === 6)
          dispatch(current, {
            type: 'dev-set-hero',
            participantId: current.localParticipantId,
            health: 6
          })
        disableHeroPower(current)
      })
      disableHeroPower(session)
      clearHand(session)
      addCard(session, cardId)
      setMana(session, index === 0 ? 1 : index === 1 ? 5 : index === 2 ? 5 : 6)
      const selected = await choose(session)
      if (index === 5) expect(selected.command.type).not.toBe('play-card')
      else {
        expect(selected.command.type).toBe('play-card')
        if (selected.command.type === 'play-card')
          expect(selected.command.cardInstanceId).toContain(':dev:')
      }
    })
  }
})

describe('Expert bounded resource setup preferences', () => {
  const apprentice = 'classic_sorcerers_apprentice'
  const upgrade = 'classic_upgrade'
  const raider = 'classic_bloodsail_raider'
  const base: AiFixtureOptions = {
    seed: 1022,
    aiHeroId: 'jaina',
    opponentHeroId: 'guldan',
    aiMana: 3,
    aiHand: [apprentice, 'basic_frostbolt']
  }
  function inspect(options: Partial<AiFixtureOptions> = {}, cardId = apprentice) {
    const session = new GameBoardSession(createAiFixture({ ...base, ...options }))
    const player = session.findPlayer(session.getState(), session.remoteParticipantId)
    const card = player.hand.find((entry) => entry.cardId === cardId)!
    const command =
      legal(session).find(
        (entry) =>
          entry.type === 'play-card' && entry.cardInstanceId === card.instanceId
      ) ??
      ({
        type: 'play-card',
        participantId: session.remoteParticipantId,
        cardInstanceId: card.instanceId,
        position: 0
      } satisfies TurnMatchCommand)
    const before = session.match.getCheckpoint()
    const preference = session.match.analyze((root) =>
      expertResourceSetupPreference(root, session.remoteParticipantId, command)
    )
    expect(session.match.getCheckpoint()).toEqual(before)
    return { session, command, preference }
  }

  it('recognizes a discount that makes the setup and spell executable', () => {
    const { session, command, preference } = inspect()
    expect(preference).toBeGreaterThan(0)
    dispatch(session, command)
    const spell = legal(session).find((entry) => entry.type === 'play-card')!
    dispatch(session, spell)
    expect(
      session.findPlayer(session.getState(), session.remoteParticipantId).mana.available
    ).toBe(0)
  })

  it('recognizes the one-attack weapon upgrade before a scaling battlecry', () => {
    const { session, command, preference } = inspect(
      {
        aiHeroId: 'garrosh',
        aiHand: [upgrade, raider],
        aiWeapon: { cardId: 'basic_heavy_axe' }
      },
      upgrade
    )
    expect(preference).toBeGreaterThan(0)
    dispatch(session, command)
    dispatch(
      session,
      legal(session).find((entry) => entry.type === 'play-card')!
    )
    const player = session.findPlayer(session.getState(), session.remoteParticipantId)
    expect(player.board.find((minion) => minion.cardId === raider)?.attack).toBe(4)
  })

  const negatives: readonly [string, Partial<AiFixtureOptions>][] = [
    ['no affordable payoff', { aiMana: 2 }],
    ['no spell payoff', { aiHand: [apprentice, 'classic_wisp'] }],
    ['already free spell', { aiHand: [apprentice, 'basic_the_coin'] }],
    ['full board', { aiBoard: Array(7).fill({ cardId: 'classic_wisp' }) }],
    ['unknown secret', { opponentSecrets: [{ cardId: 'classic_snipe' }] }],
    ['random summon trigger', { aiBoard: [{ cardId: 'classic_knife_juggler' }] }]
  ]
  for (const [name, options] of negatives)
    it(`does not prefer setup with ${name}`, () => {
      expect(inspect(options).preference).toBe(0)
    })

  it('abstains without RNG observation or when the shared deadline expires', () => {
    const { session, command } = inspect()
    session.match.analyze((root) => {
      expect(
        expertResourceSetupPreference(
          { ...root, getRandomState: undefined },
          session.remoteParticipantId,
          command
        )
      ).toBe(0)
      expect(
        expertResourceSetupPreference(
          root,
          session.remoteParticipantId,
          command,
          () => true
        )
      ).toBe(0)
    })
  })

  const drake = 'classic_twilight_drake'
  const hunter = 'classic_big_game_hunter'
  const handSetup: Partial<AiFixtureOptions> = {
    aiHeroId: 'guldan',
    aiMana: 8,
    aiHeroPowerAvailable: false,
    aiHeroPowerUsesThisTurn: 1,
    aiHand: [drake, hunter, 'basic_hellfire', 'classic_siphon_soul'],
    aiDeck: ['classic_wisp']
  }

  it('prefers a hand-count health battlecry before an affordable second minion', () => {
    const { session, command, preference } = inspect(handSetup, drake)
    expect(preference).toBeGreaterThan(0)
    dispatch(session, command)
    const hunterId = session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.cardId === hunter)!.instanceId
    dispatch(
      session,
      legal(session).find(
        (entry) => entry.type === 'play-card' && entry.cardInstanceId === hunterId
      )!
    )
    expect(
      session
        .findPlayer(session.getState(), session.remoteParticipantId)
        .board.find((minion) => minion.cardId === drake)?.health
    ).toBe(4)
  })

  it('leaves affordable draw hero powers first, using current cost and used legality', () => {
    const { session, command } = inspect(handSetup, drake)
    const actor = session.remoteParticipantId
    const preference = () =>
      session.match.analyze((root) =>
        expertResourceSetupPreference(root, actor, command)
      )
    for (const cost of [0, 2, 7]) {
      dispatch(session, {
        type: 'dev-set-hero-power',
        participantId: actor,
        cost,
        available: true
      })
      expect(session.findPlayer(session.getState(), actor).heroPower.cost).toBe(cost)
      expect(preference() > 0).toBe(cost === 7)
    }
    dispatch(session, {
      type: 'dev-set-hero-power',
      participantId: actor,
      cost: 0,
      available: false
    })
    expect(preference()).toBeGreaterThan(0)
  })

  const handGrowthCards = [
    'basic_novice_engineer',
    'basic_arcane_intellect',
    'one_night_in_karazhan_babbling_book',
    'journey_to_ungoro_fire_fly',
    'basic_mind_vision',
    'classic_thoughtsteal',
    'goblins_vs_gnomes_echo_of_medivh'
  ]
  for (const cardId of handGrowthCards)
    it(`leaves affordable hand growth first for ${cardId}`, () => {
      expect(
        inspect(
          {
            ...handSetup,
            aiHand: [drake, hunter, cardId],
            aiBoard: [{ cardId: 'classic_wisp' }],
            opponentHand: ['classic_wisp'],
            opponentDeck: ['classic_wisp', 'classic_wisp']
          },
          drake
        ).preference
      ).toBe(0)
    })

  const handNegatives: readonly [string, Partial<AiFixtureOptions>][] = [
    ['no second minion', { aiHand: [drake, 'basic_hellfire'] }],
    ['insufficient pair mana', { aiMana: 6 }],
    ['only one board slot', { aiBoard: Array(6).fill({ cardId: 'classic_wisp' }) }],
    ['full board', { aiBoard: Array(7).fill({ cardId: 'classic_wisp' }) }],
    ['deterministic trigger', { aiBoard: [{ cardId: 'classic_questing_adventurer' }] }],
    ['random trigger', { aiBoard: [{ cardId: 'classic_knife_juggler' }] }],
    ['body-changing second minion', { aiHand: [drake, 'classic_ironbeak_owl'] }],
    ['secret uncertainty', { opponentSecrets: [{ cardId: 'classic_snipe' }] }]
  ]
  for (const [name, options] of handNegatives)
    it(`abstains from hand-size setup with ${name}`, () => {
      expect(inspect({ ...handSetup, ...options }, drake).preference).toBe(0)
    })

  it('does not trade cheaper hand-dependent costs for the hand-count buff', () => {
    expect(
      inspect(
        {
          ...handSetup,
          aiMana: 9,
          aiHand: [
            drake,
            'classic_mountain_giant',
            ...Array(7).fill('basic_boulderfist_ogre')
          ]
        },
        drake
      ).preference
    ).toBe(0)
  })
})

describe('Expert singleton cleanup rollout seeds', () => {
  const apprentice = 'classic_sorcerers_apprentice'
  const cleanup = 'goblins_vs_gnomes_flamecannon'
  function fixture(options: Partial<AiFixtureOptions> = {}, first = apprentice) {
    const session = new GameBoardSession(
      createAiFixture({
        seed: 1023,
        aiHeroId: 'jaina',
        opponentHeroId: 'guldan',
        aiMana: 8,
        aiHand: [first, cleanup],
        opponentBoard: [{ cardId: 'league_of_explorers_brann_bronzebeard' }],
        ...options
      })
    )
    const actor = session.remoteParticipantId
    const player = session.findPlayer(session.getState(), actor)
    const firstId = player.hand.find((card) => card.cardId === first)!.instanceId
    const lastId = player.hand.find((card) => card.cardId === cleanup)!.instanceId
    const line: TacticalLine = {
      commands: [
        legal(session).find(
          (command) =>
            command.type === 'play-card' && command.cardInstanceId === firstId
        )!,
        { type: 'play-card', participantId: actor, cardInstanceId: lastId }
      ],
      outcome: 'ongoing',
      proven: false,
      value: 10
    }
    return { session, actor, line }
  }
  function selected(options: Partial<AiFixtureOptions> = {}, first = apprentice) {
    const { session, actor, line } = fixture(options, first)
    const before = session.match.getCheckpoint()
    const seeds = session.match.analyze((root) =>
      expertSingletonCleanupSeeds(root, actor, [line])
    )
    expect(session.match.getCheckpoint()).toEqual(before)
    expect(seeds.every((seed) => seed.proven === false)).toBe(true)
    return seeds
  }

  it('seeds a real singleton cleanup without changing its unproven status', () => {
    expect(selected()).toHaveLength(1)
  })

  const negatives: readonly [string, Partial<AiFixtureOptions>][] = [
    [
      'two eligible enemies',
      { opponentBoard: [{ cardId: 'classic_wisp' }, { cardId: 'classic_wisp' }] }
    ],
    ['a surviving enemy', { opponentBoard: [{ cardId: 'basic_boulderfist_ogre' }] }],
    ['an unknown secret', { opponentSecrets: [{ cardId: 'classic_counterspell' }] }],
    ['another cast trigger', { aiBoard: [{ cardId: 'classic_mana_wyrm' }] }],
    [
      'a deathrattle',
      {
        opponentBoard: [{ cardId: 'classic_loot_hoarder' }],
        opponentDeck: ['classic_wisp']
      }
    ]
  ]
  for (const [name, options] of negatives)
    it(`does not seed cleanup with ${name}`, () => {
      expect(selected(options)).toHaveLength(0)
    })

  it('stops at random or information-revealing prefixes', () => {
    expect(selected({}, 'goblins_vs_gnomes_unstable_portal')).toHaveLength(0)
    expect(
      selected({ aiDeck: ['classic_wisp', 'classic_wisp'] }, 'basic_arcane_intellect')
    ).toHaveLength(0)
  })

  it('keeps one best seed per root and observes the shared deadline', () => {
    const { session, actor, line } = fixture()
    session.match.analyze((root) => {
      const seeds = expertSingletonCleanupSeeds(root, actor, [
        line,
        { ...line, value: 9 }
      ])
      expect(seeds).toEqual([line])
      expect(expertSingletonCleanupSeeds(root, actor, [line], () => true)).toHaveLength(
        0
      )
      expect(
        expertSingletonCleanupSeeds(root, actor, [{ ...line, proven: true }])
      ).toHaveLength(0)
      expect(
        expertSingletonCleanupSeeds({ ...root, getRandomState: undefined }, actor, [
          line
        ])
      ).toHaveLength(0)
    })
  })

  it('reviews at most eight candidate lines', () => {
    const { session, actor, line } = fixture()
    const invalidLine: TacticalLine = {
      ...line,
      commands: [
        { type: 'play-card', participantId: actor, cardInstanceId: 'missing-prefix' },
        line.commands[1]!
      ]
    }
    let reviewed = 0
    session.match.analyze((root) =>
      expertSingletonCleanupSeeds(
        {
          ...root,
          analyze: (operation) => {
            reviewed++
            return root.analyze(operation)
          }
        },
        actor,
        Array(20).fill(invalidLine)
      )
    )
    expect(reviewed).toBe(8)
  })
})
