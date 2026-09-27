import { describe, expect, it, vi } from 'vitest'
import {
  aiActionFacts,
  aiMulliganModelState,
  aiMulliganSystemContext,
  aiModelState,
  aiSystemContext,
  type aiActions
} from './ai-context'
import { compactAiFacts } from './ai-compact-context'
import { observedAiCorrections } from './ai-feedback'
import { enumerateLegalCommands } from '../../../game/match/ai'
import { GameBoardSession } from './game-board-session'
import { createMatchScenario } from '../../../game/match/testing/match-scenario-builder'
import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import { createAiFixture } from '../../../game/match/testing/ai-scenario-builder'
import { AiTurnController } from './ai-turn-controller'
import { parseAiDecisionResponse, type AiDecisionApi } from '../../../shared/ipc/ai'

describe('AI context fidelity', () => {
  it('includes the first Beast and crafting stage in Build-a-Beast decisions', () => {
    const fixture = createAiFixture({
      seed: 806,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      pendingCardChoice: {
        sourceCardId: 'knights_of_the_frozen_throne_build_a_beast',
        options: [
          {
            choice: 0,
            label: 'Stonetusk Boar',
            presentationCardId: 'basic_stonetusk_boar'
          }
        ],
        resolution: {
          type: 'build-a-beast',
          stage: 'second',
          firstBeast: asCardId('basic_timber_wolf')
        }
      }
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    expect(aiModelState(session, [])).toMatchObject({
      pendingChoice: {
        resolution: {
          type: 'build-a-beast',
          stage: 'second',
          firstBeast: { name: 'Timber Wolf' }
        }
      }
    })
  })
  it('omits generated Kazakus recipe mappings while retaining choice rules', () => {
    const effects = CARD_CATALOG.require('mean_streets_of_gadgetzan_kazakus').effects
    const original = JSON.stringify(effects)
    const compact = JSON.stringify(compactAiFacts(effects))
    expect(original).toContain('recipes')
    expect(compact).not.toContain('recipes')
    expect(compact).toContain('costOptions')
    expect(compact).toContain('ingredient')
    expect(compact.length).toBeLessThan(original.length / 2)
    expect(JSON.stringify(effects)).toBe(original)
  })
  it('shows full health and weapon attack readiness, and records real zero-healing outcomes', async () => {
    const scenario = createMatchScenario({ secondHeroId: 'anduin' })
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    const dispatch = (command: unknown) => {
      const result = session.match.dispatch(command)
      expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
      return result
    }
    for (const participantId of scenario.participants)
      dispatch({ type: 'confirm-mulligan', participantId, replaceInstanceIds: [] })
    const participantId = session.remoteParticipantId
    if (session.getState().activePlayerId !== participantId)
      dispatch({ type: 'end-turn', participantId: session.getState().activePlayerId })
    dispatch({ type: 'dev-set-mana', participantId, available: 10, maximum: 10 })
    const play = (cardId: string, extra: object = {}) => {
      dispatch({ type: 'dev-add-card', participantId, cardId })
      const card = session
        .getState()
        .players.find((p) => p.participantId === participantId)!
        .hand.find((c) => c.cardId === cardId)!
      return dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        ...extra
      })
    }
    play('basic_fiery_war_axe')
    const commands = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      participantId
    )
    expect(aiModelState(session, commands)).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({
          role: 'self',
          hero: expect.objectContaining({
            health: 30,
            maxHealth: 30,
            missingHealth: 0,
            combat: expect.objectContaining({
              effectiveAttack: 3,
              canAttackNow: true,
              canAttackHeroNow: true
            })
          })
        })
      ])
    })
    const healed = dispatch({
      type: 'use-hero-power',
      participantId,
      target: { kind: 'hero', participantId }
    })
    const publicEvents = session.match.getPublicEvents!(participantId, healed.events)
    expect(observedAiCorrections(publicEvents)).toMatchObject({
      zeroHealing: { evidence: { healthBefore: 30, healthAfter: 30, restored: 0 } }
    })
    const captured: Record<string, unknown>[] = []
    const controller = new AiTurnController({
      session,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      api: {
        settings: async () => ({
          enabled: true,
          provider: 'openrouter',
          modelId: 'stub',
          reasoningEffort: 'low',
          maxCompletionTokens: 1000
        }),
        cancel: async () => {},
        decide: async (request) => {
          captured.push(JSON.parse(request.messages.at(-1)!.content))
          throw new Error('Stop after capturing the fair request.')
        }
      }
    })
    try {
      controller.recordExecution(
        {
          matchId: 'test',
          requestId: 'heal',
          expectedRevision: 1,
          actionId: 'test',
          command: {
            type: 'use-hero-power',
            participantId,
            target: { kind: 'hero', participantId }
          },
          source: 'model',
          expectedResult: 'Gain maximum health.'
        },
        healed
      )
      await controller.chooseTurnAction()
      expect(captured[0]).toMatchObject({
        outcomeReviews: [
          {
            predictionToCheck: 'Gain maximum health.',
            accepted: true,
            observed: expect.any(Array)
          }
        ]
      })
      expect(JSON.stringify(captured[0].outcomeReviews)).toContain('30')
      expect(captured[0]).not.toHaveProperty('previousExpectation')
    } finally {
      controller.dispose()
    }
  })
  it('runs real session context, planning, inspection, intent validation and dispatch without a simulation preview', async () => {
    const scenario = createMatchScenario()
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    for (const participantId of scenario.participants)
      expect(
        session.match.dispatch({
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    if (session.getState().activePlayerId !== session.remoteParticipantId)
      expect(
        session.match.dispatch({
          type: 'end-turn',
          participantId: session.localParticipantId
        }).accepted
      ).toBe(true)
    expect(
      session.match.dispatch({
        type: 'dev-set-mana',
        participantId: session.remoteParticipantId,
        available: 3,
        maximum: 3
      }).accepted
    ).toBe(true)
    const previews = ['preview', 'previewSequence', 'analyze'].map((method) =>
      vi.spyOn(session.match, method as 'preview').mockImplementation(() => {
        throw new Error('Full-state previews are not available to AI deliberation.')
      })
    )
    let count = 0
    const api: AiDecisionApi = {
      settings: async () => ({
        enabled: true,
        provider: 'openrouter',
        modelId: 'stub',
        reasoningEffort: 'low',
        maxCompletionTokens: 1000
      }),
      cancel: async () => {},
      decide: async (request) => {
        count++
        const facts = [...request.messages]
          .reverse()
          .filter((m) => m.role === 'user')
          .map((m) => JSON.parse(m.content))
          .find((v) => Array.isArray(v.actions))
        const action = facts.actions.find((a) => a.move.startsWith('end-turn'))
        const choice =
          request.phase === 'plan'
            ? {
                plan: {
                  objective: 'Protocol integration, not tactics.',
                  winCheck: 'Not evaluated.',
                  lossRisk: 'Not evaluated.',
                  candidates: [
                    {
                      sequence: ['End turn.'],
                      budget: '0 mana.',
                      endPosition: 'Pass.',
                      opponentReply: 'Not evaluated.'
                    }
                  ],
                  preferred: 0,
                  firstActionId: action.id,
                  checks: [
                    {
                      topic: 'resources',
                      ref: 'self',
                      question: 'Current mana?',
                      decisionImpact: 'Check the fair adapter.'
                    }
                  ]
                }
              }
            : request.allowInspection
              ? {
                  inspect: [
                    {
                      topic: 'action',
                      ref: action.id,
                      question: 'Exact input?',
                      decisionImpact: 'Check round-trip identity.'
                    }
                  ]
                }
              : {
                  actionId: action.id,
                  intent: action.intent,
                  expectedResult: 'Pass to opponent.',
                  planUpdate: null
                }
        return parseAiDecisionResponse({
          ...request,
          reason: 'Protocol test.',
          choice,
          modelId: 'stub',
          durationMs: 1,
          finishReason: 'stop'
        })
      }
    }
    const abandoned = vi.fn()
    const controller = new AiTurnController({
      session,
      api,
      onAbandoned: abandoned,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    try {
      const decision = await controller.chooseTurnAction()
      expect(decision).not.toBeNull()
      expect(count).toBe(4)
      expect(controller.isCurrent(decision!)).toBe(true)
      const result = session.match.dispatch(decision!.command)
      controller.recordExecution(decision!, result)
      expect(result.accepted).toBe(true)
      expect(session.getState().activePlayerId).toBe(session.localParticipantId)
      expect(abandoned).not.toHaveBeenCalled()
      for (const preview of previews) expect(preview).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
      previews.forEach((preview) => preview.mockRestore())
    }
  })
  it('separates printed shields from consumed shields and silenced abilities', () => {
    const scenario = createMatchScenario()
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    const outcomes: ReturnType<typeof observedAiCorrections> = {}
    const dispatch = (command: unknown) => {
      const result = session.match.dispatch(command)
      expect(result.accepted).toBe(true)
      Object.assign(
        outcomes,
        observedAiCorrections(
          session.match.getPublicEvents!(session.remoteParticipantId, result.events)
        )
      )
    }
    for (const participantId of scenario.participants)
      dispatch({ type: 'confirm-mulligan', participantId, replaceInstanceIds: [] })
    const participantId = session.getState().activePlayerId!
    dispatch({
      type: 'dev-summon-minion',
      participantId,
      cardId: 'whispers_of_the_old_gods_cthuns_chosen'
    })
    const minion = session
      .getState()
      .players.find((player) => player.participantId === participantId)!.board[0]!
    const boardFact = () => {
      const facts = aiModelState(session, []) as unknown as {
        players: { board?: { ref: string; [key: string]: unknown }[] }[]
      }
      return facts.players
        .flatMap((player) => player.board ?? [])
        .find((card) => card.ref === minion.instanceId)!
    }
    expect(boardFact()).toMatchObject({
      activeKeywords: ['divine-shield'],
      currentStatus: { shieldActive: true }
    })
    const cast = (cardId: string) => {
      dispatch({ type: 'dev-add-card', participantId, cardId })
      const card = session
        .getState()
        .players.find((player) => player.participantId === participantId)!
        .hand.find((card) => card.cardId === cardId)!
      dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        targets: [{ kind: 'minion', participantId, instanceId: minion.instanceId }]
      })
    }
    cast('classic_moonfire')
    expect(boardFact()).toMatchObject({
      printedKeywords: ['divine-shield'],
      currentStatus: { shieldActive: false },
      health: 2
    })
    expect(boardFact()).toMatchObject({ maxHealth: 2, missingHealth: 0 })
    expect(outcomes.divineShield).toBeDefined()
    expect(boardFact().activeKeywords).toBeUndefined()
    expect(boardFact().keywords).toBeUndefined()
    expect(boardFact().text).toBeUndefined()
    cast('classic_silence')
    expect(boardFact()).toMatchObject({
      currentStatus: { shieldActive: false, isSilenced: true }
    })
    expect(boardFact().activeKeywords).toBeUndefined()
  })
  it('identifies displayed stats as already including enchantment deltas', () => {
    const scenario = createMatchScenario()
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    expect(aiSystemContext(session).content).toContain(
      'never add enchantment deltas again'
    )
    const dispatch = (command: unknown) => {
      const result = session.match.dispatch(command)
      expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    }
    for (const participantId of scenario.participants)
      dispatch({ type: 'confirm-mulligan', participantId, replaceInstanceIds: [] })
    const participantId = session.remoteParticipantId
    if (session.getState().activePlayerId !== participantId)
      dispatch({ type: 'end-turn', participantId: session.getState().activePlayerId })
    dispatch({ type: 'dev-set-mana', participantId, available: 10, maximum: 10 })
    dispatch({
      type: 'dev-add-card',
      participantId,
      cardId: 'whispers_of_the_old_gods_cthun'
    })
    for (let index = 0; index < 2; index++) {
      const cardId = 'whispers_of_the_old_gods_beckoner_of_evil'
      dispatch({ type: 'dev-add-card', participantId, cardId })
      const card = session
        .getState()
        .players.find((player) => player.participantId === participantId)!
        .hand.find((card) => card.cardId === cardId)!
      dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 0
      })
    }
    const base = CARD_CATALOG.require('whispers_of_the_old_gods_cthun')
    if (base.type !== 'Minion') throw new Error('Expected Cthun minion')
    expect(aiModelState(session, [])).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({
          role: 'self',
          hand: expect.arrayContaining([
            expect.objectContaining({
              name: "C'Thun",
              attack: base.attack + 4,
              health: base.health + 4,
              activeEnchantments: expect.arrayContaining([
                expect.objectContaining({ attackDelta: 4 })
              ])
            })
          ])
        })
      ])
    })
  })
  it('includes engine hand-condition facts in the model context', () => {
    const scenario = createMatchScenario()
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    for (const participantId of scenario.participants) {
      expect(
        session.match.dispatch({
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: []
        }).accepted
      ).toBe(true)
    }
    expect(
      session.match.dispatch({
        type: 'dev-add-card',
        participantId: session.remoteParticipantId,
        cardId: 'one_night_in_karazhan_book_wyrm'
      }).accepted
    ).toBe(true)
    expect(aiModelState(session, [])).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({
          role: 'self',
          hand: expect.arrayContaining([
            expect.objectContaining({
              name: 'Book Wyrm',
              implementedMechanics: expect.stringContaining('player-has-card-in-hand'),
              battlecryConditions: [expect.objectContaining({ status: 'not-met' })]
            })
          ])
        })
      ])
    })
    const ownDeck = session.findPlayer(
      session.getState(),
      session.remoteParticipantId
    ).deck
    expect(aiModelState(session, []).remainingDeck).toEqual({
      'Acidic Swamp Ooze': ownDeck.length
    })
    expect(aiSystemContext(session).content).not.toContain('questions')
  })
  it('groups position variants without merging different cards or targets', () => {
    const actions = [
      {
        id: 'a0',
        description: 'Card (position; position=0)',
        command: { type: 'play-card', cardInstanceId: 'card1', position: 0 }
      },
      {
        id: 'a1',
        description: 'Card (position; position=1)',
        command: { type: 'play-card', cardInstanceId: 'card1', position: 1 }
      },
      {
        id: 'a2',
        description: 'Other card',
        command: { type: 'play-card', cardInstanceId: 'card2', position: 0 }
      },
      {
        id: 'a3',
        description: 'Targeted card',
        command: {
          type: 'play-card',
          cardInstanceId: 'card1',
          position: 0,
          target: { kind: 'hero' }
        }
      }
    ] as unknown as ReturnType<typeof aiActions>
    const original = structuredClone(actions)
    const facts = aiActionFacts(actions)
    expect(facts).toHaveLength(3)
    expect(facts[0]).toMatchObject({
      positions: { '0': 'a0', '1': 'a1' },
      intent: { position: null }
    })
    expect(facts[1]).toMatchObject({
      positions: { '0': 'a2' },
      intent: { position: 0 }
    })
    expect(facts[2]).toMatchObject({ positions: { '0': 'a3' } })
    expect(actions).toEqual(original)
  })
  it('uses a smaller mulligan snapshot and system prompt than the full turn path', () => {
    const scenario = createMatchScenario({ secondHeroId: 'anduin' })
    const session = new GameBoardSession({
      setup: scenario.setup,
      decks: scenario.decks
    })
    const participantId = session.remoteParticipantId
    const commands = enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      participantId
    )
    expect(JSON.stringify(aiMulliganModelState(session)).length).toBeLessThan(
      JSON.stringify(aiModelState(session, commands)).length / 2
    )
    expect(aiMulliganSystemContext(session).content.length).toBeLessThan(
      aiSystemContext(session).content.length
    )
  })
  it('preserves zero stats and false attack permission while omitting inactive metadata', () => {
    expect(
      compactAiFacts({
        cost: 0,
        attack: 0,
        combat: { canAttackNow: false, canAttackHeroNow: false },
        immune: false,
        overload: 0
      })
    ).toEqual({
      cost: 0,
      attack: 0,
      combat: { canAttackNow: false, canAttackHeroNow: false }
    })
  })
})
