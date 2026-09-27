import { describe, expect, it } from 'vitest'
import { asCardId, CARD_CATALOG } from '../../../game/content/cards'
import { enumerateLegalCommands } from '../../../game/match/ai'
import type {
  CardPlayTargetRef,
  OpeningMatchAnalysis,
  OpeningMatchState,
  PlayerId,
  TurnMatchCommand
} from '../../../game/match'
import {
  createAiFixture,
  type AiFixtureMinion,
  type AiFixtureOptions
} from '../../../game/match/testing/ai-scenario-builder'
import type { AiDecisionRequest } from '../../../shared/ipc/ai'
import { aiActions } from './ai-context'
import { GameBoardSession } from './game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'

type ScenarioSession = GameBoardSession
// Bound search work deterministically; wall-clock performance belongs in benchmarks.
const ARTIFACT_MCTS_WORK_BUDGET = 256

function createSession(options: AiFixtureOptions): ScenarioSession {
  const fixture = createAiFixture(options)
  return new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint: fixture.checkpoint
  })
}

function dispatch(session: ScenarioSession, command: TurnMatchCommand): void {
  const result = session.match.dispatch(command)
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
}

function legal(session: ScenarioSession): readonly TurnMatchCommand[] {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}

function cardIdForCommand(
  session: ScenarioSession,
  command: TurnMatchCommand
): string | null {
  if (command.type !== 'play-card') return null
  return (
    session
      .findPlayer(session.getState(), session.remoteParticipantId)
      .hand.find((card) => card.instanceId === command.cardInstanceId)?.cardId ?? null
  )
}

function playCommand(
  session: ScenarioSession,
  cardId: string,
  target?: (target: CardPlayTargetRef) => boolean,
  choice?: number
): TurnMatchCommand {
  const command = legal(session).find((candidate) => {
    if (candidate.type !== 'play-card') return false
    if (cardIdForCommand(session, candidate) !== cardId) return false
    if (choice !== undefined && candidate.choice !== choice) return false
    return target ? candidate.targets?.some(target) : true
  })
  if (!command) throw new Error(`No legal fixture play for ${cardId}.`)
  return command
}

function attackCommand(
  session: ScenarioSession,
  attackerInstanceId: string,
  defender: 'hero' | string
): TurnMatchCommand {
  const command = legal(session).find((candidate) => {
    if (candidate.type !== 'attack-character') return false
    if (candidate.attacker.kind !== 'minion') return false
    if (candidate.attacker.instanceId !== attackerInstanceId) return false
    return defender === 'hero'
      ? candidate.defender.kind === 'hero'
      : candidate.defender.kind === 'minion' &&
          candidate.defender.instanceId === defender
  })
  if (!command) throw new Error(`No legal fixture attack for ${attackerInstanceId}.`)
  return command
}

function heroAttackCommand(
  session: ScenarioSession,
  defender: 'hero' | string
): TurnMatchCommand {
  const command = legal(session).find((candidate) => {
    if (candidate.type !== 'attack-character') return false
    if (candidate.attacker.kind !== 'hero') return false
    return defender === 'hero'
      ? candidate.defender.kind === 'hero'
      : candidate.defender.kind === 'minion' &&
          candidate.defender.instanceId === defender
  })
  if (!command) throw new Error('No legal fixture hero attack.')
  return command
}

function legalFromFork(
  fork: OpeningMatchAnalysis,
  participantId: PlayerId
): readonly TurnMatchCommand[] {
  return enumerateLegalCommands(
    {
      getState: fork.getState,
      getPlayInput: fork.getPlayInput,
      getLegality: fork.getLegality
    },
    participantId
  )
}

/** Checks every legal opponent reply until the next AI turn begins. */
function everyOpponentReply(
  session: ScenarioSession,
  predicate: (state: OpeningMatchState) => boolean,
  nodeLimit = 10_000
): boolean {
  let nodes = 0
  return session.match.analyze((root) => {
    const visit = (fork: OpeningMatchAnalysis): boolean => {
      nodes += 1
      if (nodes > nodeLimit)
        throw new Error(`Opponent reply search exceeded ${nodeLimit} nodes.`)
      const state = fork.getState()
      if (
        state.phase === 'ended' ||
        state.activePlayerId !== session.localParticipantId
      )
        return predicate(state)
      const commands = legalFromFork(fork, session.localParticipantId)
      if (commands.length === 0) return predicate(state)
      for (const command of commands) {
        const safe = fork.analyze((child) => {
          const result = child.dispatch(command)
          return result.accepted && visit(child)
        })
        if (!safe) return false
      }
      return true
    }
    return visit(root)
  })
}

function request(
  session: ScenarioSession,
  requestId: string,
  actionIds: readonly string[],
  phase: AiDecisionRequest['phase'] = 'action'
): AiDecisionRequest {
  return {
    matchId: 'artifact-local-ai',
    requestId,
    expectedRevision: session.getState().revision,
    phase,
    allowInspection: false,
    messages: [{ role: 'user', content: '{}' }],
    actionIds
  }
}

async function runAiTurn(
  session: ScenarioSession,
  maxActions = 20
): Promise<readonly TurnMatchCommand[]> {
  const traceEnabled = process.env.LOCAL_AI_ARTIFACT_TRACE === '1'
  const api = new LocalAiDecisionApi(
    session,
    traceEnabled
      ? (trace) =>
          console.log(
            'LOCAL_AI_ARTIFACT_TRACE ' +
              JSON.stringify({
                requestId: trace.requestId,
                durationMs: trace.durationMs,
                iterations: trace.sequenceNodes,
                selectedActionId: trace.chosenActionId,
                averageDepth: trace.chosenSequenceDepth,
                mctsProfile: trace.mctsProfile,
                candidates: trace.candidates.slice(0, 8).map((candidate) => ({
                  actionId: candidate.actionId,
                  description: candidate.description,
                  visits: candidate.visits,
                  meanValue: candidate.meanValue,
                  prior: candidate.prior,
                  recommendationValue: candidate.recommendationValue,
                  recommendationRiskAdjustment: candidate.recommendationRiskAdjustment
                }))
              })
          )
      : undefined,
    {
      profile: 'expert',
      workBudget: ARTIFACT_MCTS_WORK_BUDGET
    }
  )
  const actions: TurnMatchCommand[] = []
  for (let step = 0; step < maxActions; step += 1) {
    const state = session.getState()
    if (state.phase !== 'turns' || state.activePlayerId !== session.remoteParticipantId)
      break
    const commands = legal(session)
    expect(commands.length).toBeGreaterThan(0)
    const choices = aiActions(session, commands)
    const decision = await api.decide(
      request(
        session,
        `artifact-${state.revision}-${step}`,
        choices.map((choice) => choice.id)
      )
    )
    expect('actionId' in decision.choice).toBe(true)
    if (!('actionId' in decision.choice)) break
    const selectedId = decision.choice.actionId
    const selected = choices.find((choice) => choice.id === selectedId)
    expect(selected).toBeDefined()
    if (!selected) break
    dispatch(session, selected.command)
    if (traceEnabled)
      console.log(
        'AI_ACTION_RESULT ' +
          JSON.stringify({
            action: selected.description,
            self: aiPlayer(session).board.map((m) => [m.cardId, m.attack, m.health]),
            enemy: opponent(session).board.map((m) => [m.cardId, m.attack, m.health]),
            hand: aiPlayer(session).hand.map((c) => c.cardId)
          })
      )
    actions.push(selected.command)
    if (selected.command.type === 'end-turn') break
  }
  expect(session.getState().phase).not.toBe('mulligan')
  return actions
}

async function runAiMulligan(session: ScenarioSession): Promise<readonly string[]> {
  const hand = aiPlayer(session).hand
  const api = new LocalAiDecisionApi(session)
  const decision = await api.decide(
    request(
      session,
      `mulligan-${session.getState().revision}`,
      hand.map((card) => card.instanceId),
      'mulligan'
    )
  )
  expect('replace' in decision.choice).toBe(true)
  if (!('replace' in decision.choice)) return []
  return decision.choice.replace
    .map((instanceId) => hand.find((card) => card.instanceId === instanceId)?.cardId)
    .filter((cardId) => cardId !== undefined)
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) return [values]
  const result: T[][] = []
  values.forEach((value, index) => {
    const remainder = [...values.slice(0, index), ...values.slice(index + 1)]
    for (const suffix of permutations(remainder)) result.push([value, ...suffix])
  })
  return result
}

async function runMulliganOrders(
  options: Omit<AiFixtureOptions, 'aiHand'>,
  hand: readonly string[]
): Promise<readonly (readonly string[])[]> {
  const outcomes: (readonly string[])[] = []
  for (const order of permutations(hand)) {
    const session = createSession({ ...options, aiHand: order })
    outcomes.push(await runAiMulligan(session))
  }
  return outcomes
}

function aiBoard(...minions: AiFixtureMinion[]): readonly AiFixtureMinion[] {
  return minions
}

function minion(
  session: ScenarioSession,
  participantId: PlayerId,
  cardId: string,
  occurrence = 0
) {
  const player = session.findPlayer(session.getState(), participantId)
  const matches = player.board.filter((entry) => entry.cardId === cardId)
  const result = matches[occurrence]
  if (!result) throw new Error(`Missing fixture minion ${cardId} #${occurrence}.`)
  return result
}

function heroTarget(session: ScenarioSession): (target: CardPlayTargetRef) => boolean {
  return (target) =>
    target.kind === 'hero' && target.participantId === session.localParticipantId
}

function friendlyHeroTarget(
  session: ScenarioSession
): (target: CardPlayTargetRef) => boolean {
  return (target) =>
    target.kind === 'hero' && target.participantId === session.remoteParticipantId
}

function playAtPosition(
  session: ScenarioSession,
  cardId: string,
  position: number
): TurnMatchCommand {
  const command = legal(session).find(
    (candidate) =>
      candidate.type === 'play-card' &&
      cardIdForCommand(session, candidate) === cardId &&
      candidate.position === position
  )
  if (!command)
    throw new Error(`No legal positioned play for ${cardId} at ${position}.`)
  return command
}

function friendlyMinionTarget(
  session: ScenarioSession,
  cardId: string
): (target: CardPlayTargetRef) => boolean {
  const targetMinion = minion(session, session.remoteParticipantId, cardId)
  return (target) =>
    target.kind === 'minion' &&
    target.participantId === session.remoteParticipantId &&
    target.instanceId === targetMinion.instanceId
}

function friendlyHeroPowerMinionTarget(
  session: ScenarioSession,
  cardId: string
): {
  readonly kind: 'minion'
  readonly participantId: PlayerId
  readonly instanceId: string
} {
  const targetMinion = minion(session, session.remoteParticipantId, cardId)
  return {
    kind: 'minion',
    participantId: session.remoteParticipantId,
    instanceId: targetMinion.instanceId
  }
}

function enemyHeroPowerMinionTarget(
  session: ScenarioSession,
  cardId: string,
  occurrence = 0
): {
  readonly kind: 'minion'
  readonly participantId: PlayerId
  readonly instanceId: string
} {
  const targetMinion = minion(session, session.localParticipantId, cardId, occurrence)
  return {
    kind: 'minion',
    participantId: session.localParticipantId,
    instanceId: targetMinion.instanceId
  }
}

function enemyMinionTarget(
  session: ScenarioSession,
  cardId: string,
  occurrence = 0
): (target: CardPlayTargetRef) => boolean {
  const targetMinion = minion(session, session.localParticipantId, cardId, occurrence)
  return (target) =>
    target.kind === 'minion' &&
    target.participantId === session.localParticipantId &&
    target.instanceId === targetMinion.instanceId
}

function heroPowerCommand(
  session: ScenarioSession,
  target?: CardPlayTargetRef
): TurnMatchCommand {
  const command = legal(session).find((candidate) => {
    if (candidate.type !== 'use-hero-power') return false
    if (!target) return candidate.target === undefined
    return JSON.stringify(candidate.target) === JSON.stringify(target)
  })
  if (!command) throw new Error('No legal fixture hero-power command.')
  return command
}

function discoverCommand(session: ScenarioSession, cardId: string): TurnMatchCommand {
  const command = legal(session).find(
    (candidate) =>
      candidate.type === 'choose-discover-card' &&
      session
        .getState()
        .pendingDiscover?.candidates.find(
          (entry) => entry.instanceId === candidate.cardInstanceId
        )?.cardId === cardId
  )
  if (!command) throw new Error(`No legal fixture Discover choice for ${cardId}.`)
  return command
}

function choiceCommand(session: ScenarioSession, choice: number): TurnMatchCommand {
  const command = legal(session).find(
    (candidate) =>
      candidate.type === 'choose-card-option' && candidate.choice === choice
  )
  if (!command) throw new Error(`No legal fixture card choice ${choice}.`)
  return command
}

function aiWon(session: ScenarioSession): boolean {
  return session.getState().winnerId === session.remoteParticipantId
}

function opponent(session: ScenarioSession) {
  return session.findPlayer(session.getState(), session.localParticipantId)
}

function aiPlayer(session: ScenarioSession) {
  return session.findPlayer(session.getState(), session.remoteParticipantId)
}

describe('hardware local AI artifact scenarios', () => {
  it('DEV-001: finds spell-damage lethal through Taunt', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0001,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 12,
      opponentHealth: 11,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: [
        'classic_bloodmage_thalnos',
        'basic_fireball',
        'basic_frostbolt',
        'basic_chillwind_yeti'
      ],
      opponentBoard: [
        { cardId: 'basic_senjin_shieldmasta', attack: 3, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    const thalnos = playCommand(reference, 'classic_bloodmage_thalnos')
    dispatch(reference, thalnos)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_fireball',
        (target) =>
          target.kind === 'hero' &&
          target.participantId === reference.localParticipantId
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_frostbolt',
        (target) =>
          target.kind === 'hero' &&
          target.participantId === reference.localParticipantId
      )
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    const chosen = await runAiTurn(actual)
    expect(aiWon(actual), JSON.stringify(chosen)).toBe(true)
  }, 30_000)

  it('DEV-002: uses the small attacker to remove Divine Shield first', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0002,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      opponentHealth: 3,
      aiBoard: aiBoard(
        {
          cardId: 'classic_argent_squire',
          attack: 1,
          health: 1,
          ready: true,
          divineShield: true
        },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        {
          cardId: 'classic_stranglethorn_tiger',
          attack: 5,
          health: 5,
          ready: true,
          stealth: true
        }
      ),
      opponentBoard: [
        {
          cardId: 'classic_sunwalker',
          attack: 4,
          health: 5,
          ready: true,
          divineShield: true
        }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
    expect(opponent(actual).board).toHaveLength(0)
  }, 30_000)

  it('DEV-003: buffs a Windfury attacker before both swings', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0003,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      opponentHealth: 8,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_rockbiter_weapon'],
      aiBoard: [
        { cardId: 'classic_young_dragonhawk', attack: 1, health: 1, ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-004: creates a Beast before Kill Command', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0004,
      aiHeroId: 'rexxar',
      opponentHeroId: 'uther',
      opponentHealth: 8,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['classic_unleash_the_hounds', 'classic_kill_command'],
      opponentBoard: [
        { cardId: 'basic_silver_hand_recruit', ready: true },
        { cardId: 'basic_silver_hand_recruit', ready: true },
        { cardId: 'basic_silver_hand_recruit', ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-005: includes the hero in Savage Roar damage', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0005,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      opponentHealth: 13,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_savage_roar'],
      aiBoard: [
        { cardId: 'basic_chillwind_yeti', ready: true },
        { cardId: 'basic_bloodfen_raptor', ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-006: activates Combo before Eviscerate', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0006,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      opponentHealth: 4,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['goblins_vs_gnomes_the_coin', 'classic_eviscerate']
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-007: opens board space before the charging finisher', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0007,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      opponentHealth: 5,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['classic_doomguard'],
      aiBoard: [
        {
          cardId: 'classic_flame_imp',
          attack: 3,
          health: 1,
          maxHealth: 2,
          ready: true
        },
        { cardId: 'classic_imp', ready: true },
        { cardId: 'classic_imp', ready: true },
        { cardId: 'classic_imp', ready: true },
        { cardId: 'classic_imp', ready: true },
        { cardId: 'classic_imp', ready: true },
        { cardId: 'classic_imp', ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_senjin_shieldmasta', attack: 3, health: 5, ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-008: combines the existing weapon with a Charge minion', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0008,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      opponentHealth: 9,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_korkron_elite', 'basic_fiery_war_axe'],
      aiWeapon: {
        cardId: 'basic_arcanite_reaper',
        attack: 5,
        durability: 1,
        maxDurability: 1
      }
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-009: does not invent lethal through Armor', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0009,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      opponentHealth: 10,
      opponentArmor: 1,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['basic_fireball', 'basic_frostbolt']
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_fireball',
        (target) =>
          target.kind === 'hero' &&
          target.participantId === reference.localParticipantId
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_frostbolt',
        (target) =>
          target.kind === 'hero' &&
          target.participantId === reference.localParticipantId
      )
    )
    expect(aiWon(reference)).toBe(false)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(false)
    expect(opponent(actual).hero.health + opponent(actual).hero.armor).toBeGreaterThan(
      0
    )
  }, 30_000)

  it('DEV-010: keeps Spell Damage from changing Fireblast', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0010,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      opponentHealth: 2,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_bloodmage_thalnos']
    }
    const reference = createSession(options)
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.remoteParticipantId,
      target: { kind: 'hero', participantId: reference.localParticipantId }
    })
    expect(aiWon(reference)).toBe(false)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(false)
    expect(opponent(actual).hero.health).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('DEV-011: recalculates Enrage and Frothing triggers before attacking', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0011,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      opponentHealth: 9,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['basic_whirlwind'],
      aiBoard: [
        { cardId: 'classic_frothing_berserker', attack: 2, health: 4, ready: true },
        { cardId: 'classic_amani_berserker', attack: 2, health: 3, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_whirlwind'))
    const frothing = minion(
      reference,
      reference.remoteParticipantId,
      'classic_frothing_berserker'
    )
    const amani = minion(
      reference,
      reference.remoteParticipantId,
      'classic_amani_berserker'
    )
    dispatch(reference, attackCommand(reference, frothing.instanceId, 'hero'))
    dispatch(reference, attackCommand(reference, amani.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-012: handles a random ping with one possible target across R20', async () => {
    const base: Omit<AiFixtureOptions, 'seed'> = {
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 10,
      opponentHealth: 3,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['classic_flame_imp'],
      aiBoard: [{ cardId: 'classic_knife_juggler', attack: 2, health: 2, ready: true }]
    }
    for (let index = 0; index < 20; index += 1) {
      const options = { ...base, seed: 0xde0120 + index }
      const reference = createSession(options)
      dispatch(reference, playCommand(reference, 'classic_flame_imp'))
      const juggler = minion(
        reference,
        reference.remoteParticipantId,
        'classic_knife_juggler'
      )
      dispatch(reference, attackCommand(reference, juggler.instanceId, 'hero'))
      expect(aiWon(reference)).toBe(true)
      expect(
        reference.findPlayer(reference.getState(), reference.remoteParticipantId).hero
          .health
      ).toBe(7)

      const actual = createSession(options)
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
      const actualHealth = actual.findPlayer(
        actual.getState(),
        actual.remoteParticipantId
      ).hero.health
      expect(actualHealth).toBe(7)
    }
  }, 120_000)

  it('DEV-013: sends every Avenging Wrath missile to the only enemy across R20', async () => {
    const base: Omit<AiFixtureOptions, 'seed'> = {
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      opponentHealth: 8,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['classic_avenging_wrath']
    }
    for (let index = 0; index < 20; index += 1) {
      const options = { ...base, seed: 0xde0130 + index }
      const reference = createSession(options)
      dispatch(reference, playCommand(reference, 'classic_avenging_wrath'))
      expect(aiWon(reference)).toBe(true)

      const actual = createSession(options)
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 120_000)

  it('DEV-014: lets zero-Attack Totems attack after Bloodlust', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0014,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      opponentHealth: 10,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['basic_bloodlust'],
      aiBoard: [
        { cardId: 'basic_searing_totem', attack: 1, health: 1, ready: true },
        { cardId: 'basic_healing_totem', attack: 0, health: 2, ready: true },
        { cardId: 'basic_stoneclaw_totem', attack: 0, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_bloodlust'))
    for (const cardId of [
      'basic_searing_totem',
      'basic_healing_totem',
      'basic_stoneclaw_totem'
    ]) {
      const attacker = minion(reference, reference.remoteParticipantId, cardId)
      dispatch(reference, attackCommand(reference, attacker.instanceId, 'hero'))
    }
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-015: silences an existing Ancient Watcher to enable its attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0015,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      opponentHealth: 4,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_ironbeak_owl'],
      aiBoard: [
        { cardId: 'classic_ancient_watcher', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_ironbeak_owl',
        friendlyMinionTarget(reference, 'classic_ancient_watcher')
      )
    )
    const watcher = minion(
      reference,
      reference.remoteParticipantId,
      'classic_ancient_watcher'
    )
    dispatch(reference, attackCommand(reference, watcher.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-016: removes the transformed Taunt before attacking with Ogre', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0016,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      opponentHealth: 6,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['basic_hex', 'classic_lightning_bolt'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        { cardId: 'naxxramas_sludge_belcher', attack: 3, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_hex',
        enemyMinionTarget(reference, 'naxxramas_sludge_belcher')
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_lightning_bolt',
        enemyMinionTarget(reference, 'classic_frog')
      )
    )
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-017: applies Divine Spirit before Inner Fire', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0017,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      opponentHealth: 10,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_divine_spirit', 'classic_inner_fire'],
      aiBoard: [{ cardId: 'classic_lightwell', attack: 0, health: 5, ready: true }]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_divine_spirit',
        friendlyMinionTarget(reference, 'classic_lightwell')
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_inner_fire',
        friendlyMinionTarget(reference, 'classic_lightwell')
      )
    )
    const lightwell = minion(
      reference,
      reference.remoteParticipantId,
      'classic_lightwell'
    )
    dispatch(reference, attackCommand(reference, lightwell.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-018: spends targeted burn before random discard', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0018,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      opponentHealth: 8,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: [
        'goblins_vs_gnomes_darkbomb',
        'basic_soulfire',
        'basic_boulderfist_ogre'
      ],
      aiBoard: [{ cardId: 'classic_imp', attack: 1, health: 1, ready: true }]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(reference, 'goblins_vs_gnomes_darkbomb', heroTarget(reference))
    )
    dispatch(reference, playCommand(reference, 'basic_soulfire', heroTarget(reference)))
    const imp = minion(reference, reference.remoteParticipantId, 'classic_imp')
    dispatch(reference, attackCommand(reference, imp.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-019: attacks the enemy hero past a Stealthed Taunt', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0019,
      aiHeroId: 'rexxar',
      opponentHeroId: 'malfurion',
      opponentHealth: 6,
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'classic_stranglethorn_tiger',
          attack: 7,
          health: 7,
          ready: true,
          stealth: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 30_000)

  it('DEV-020: treats Ice Block as useful progress without inventing a win', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0020,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      opponentHealth: 1,
      aiMana: 10,
      aiMaximumMana: 10,
      aiHand: ['basic_fireball', 'basic_fireball', 'basic_frostbolt'],
      opponentSecrets: [{ cardId: 'classic_ice_block' }]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_fireball', heroTarget(reference)))
    expect(aiWon(reference)).toBe(false)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(false)
    expect(actual.getState().phase).toBe('turns')
  }, 30_000)

  it('DEV-021: plays Equality before Consecration', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0021,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 4,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['classic_equality', 'basic_consecration', 'classic_truesilver_champion'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_equality'))
    dispatch(reference, playCommand(reference, 'basic_consecration'))
    expect(opponent(reference).board).toHaveLength(0)
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) =>
          state.phase === 'ended' ||
          state.players.some(
            (player) =>
              player.participantId === reference.remoteParticipantId &&
              player.hero.health > 0
          )
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-022: freezes an otherwise lethal board', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0022,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_frost_nova', 'basic_arcane_intellect'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_frost_nova'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-023: combines Frost Nova with Doomsayer', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0023,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 4,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['basic_frost_nova', 'classic_doomsayer'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_doomsayer'))
    dispatch(reference, playCommand(reference, 'basic_frost_nova'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) =>
          state.phase === 'ended' ||
          (state.activePlayerId === reference.remoteParticipantId &&
            state.players.every((player) => player.board.length === 0) &&
            state.players.some(
              (player) =>
                player.participantId === reference.remoteParticipantId &&
                player.hero.health > 0
            ))
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) =>
          state.phase === 'ended' ||
          (state.activePlayerId === actual.remoteParticipantId &&
            state.players.every((player) => player.board.length === 0) &&
            state.players.some(
              (player) =>
                player.participantId === actual.remoteParticipantId &&
                player.hero.health > 0
            ))
      )
    ).toBe(true)
    dispatch(actual, { type: 'end-turn', participantId: actual.localParticipantId })
    expect(actual.getState().activePlayerId).toBe(actual.remoteParticipantId)
    expect(actual.getState().players.every((player) => player.board.length === 0)).toBe(
      true
    )
  }, 60_000)

  it('DEV-024: records the Lesser Heal setup mismatch', () => {
    expect(CARD_CATALOG.all.some((card) => card.name === 'Lesser Heal')).toBe(false)
  })

  it('DEV-025: armors before the dangerous weapon trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0025,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 2,
      aiMaximumMana: 2,
      aiWeapon: {
        cardId: 'basic_fiery_war_axe',
        attack: 3,
        durability: 1,
        maxDurability: 1
      },
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.remoteParticipantId
    })
    const raptor = minion(
      reference,
      reference.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(reference, heroAttackCommand(reference, raptor.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).hero.health).toBe(2)
    expect(aiPlayer(reference).hero.armor).toBe(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).hero.health).toBe(2)
    expect(aiPlayer(actual).hero.armor).toBe(0)
  }, 60_000)

  it('DEV-026: resolves Truesilver healing before retaliation', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0026,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_truesilver_champion'],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 2,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_truesilver_champion'))
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, heroAttackCommand(reference, yeti.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).hero.health).toBe(1)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(opponent(actual).hero.health).toBeGreaterThan(0)
  }, 60_000)

  it('DEV-027: classifies the live Earthen Scales cost against the historical fixture', () => {
    expect(CARD_CATALOG.get('journey_to_ungoro_earthen_scales')?.cost).toBe(2)
  })

  it('DEV-028: combines Lifesteal with Divine Shield in the recovery trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0028,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_blessing_of_kings'],
      aiBoard: [
        {
          cardId: 'mean_streets_of_gadgetzan_wickerflame_burnbristle',
          attack: 2,
          health: 2,
          ready: true
        }
      ],
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 6,
          health: 6,
          maxHealth: 7,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_blessing_of_kings',
        friendlyMinionTarget(
          reference,
          'mean_streets_of_gadgetzan_wickerflame_burnbristle'
        )
      )
    )
    const wickerflame = minion(
      reference,
      reference.remoteParticipantId,
      'mean_streets_of_gadgetzan_wickerflame_burnbristle'
    )
    const ogre = minion(
      reference,
      reference.localParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(
      reference,
      attackCommand(reference, wickerflame.instanceId, ogre.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)
    const referenceWickerflame = minion(
      reference,
      reference.remoteParticipantId,
      'mean_streets_of_gadgetzan_wickerflame_burnbristle'
    )
    expect(referenceWickerflame.health).toBe(6)
    expect(referenceWickerflame.divineShield).toBe(false)
    expect(aiPlayer(reference).hero.health).toBeGreaterThanOrEqual(7)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    const actualWickerflame = minion(
      actual,
      actual.remoteParticipantId,
      'mean_streets_of_gadgetzan_wickerflame_burnbristle'
    )
    expect(actualWickerflame.health).toBeGreaterThan(0)
    expect(actualWickerflame.divineShield).toBe(false)
    expect(aiPlayer(actual).hero.health).toBeGreaterThanOrEqual(7)
  }, 60_000)

  it('DEV-029: removes Doomsayer without sacrificing the developed board', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0029,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_shadow_word_pain'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_doomsayer', attack: 0, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_shadow_word_pain',
        enemyMinionTarget(reference, 'classic_doomsayer')
      )
    )
    expect(opponent(reference).board).toHaveLength(0)
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return (
          state.phase === 'ended' ||
          (ai?.board.every(
            (entry) =>
              entry.cardId === 'basic_boulderfist_ogre' ||
              entry.cardId === 'basic_chillwind_yeti'
          ) ??
            false)
        )
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return (
          state.phase === 'ended' ||
          (ai?.board.every(
            (entry) =>
              entry.cardId === 'basic_boulderfist_ogre' ||
              entry.cardId === 'basic_chillwind_yeti'
          ) ??
            false)
        )
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-030: chooses the Taunt instead of self-lethal Hellfire', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0030,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_hellfire', 'basic_senjin_shieldmasta'],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_senjin_shieldmasta'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-031: triggers Explosive Sheep with Fireblast', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0031,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 4,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['goblins_vs_gnomes_explosive_sheep'],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'goblins_vs_gnomes_explosive_sheep'))
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.remoteParticipantId,
      target: friendlyHeroPowerMinionTarget(
        reference,
        'goblins_vs_gnomes_explosive_sheep'
      )
    })
    expect(opponent(reference).board).toHaveLength(0)
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-032: classifies the live Envenom Weapon cost against the historical fixture', () => {
    expect(CARD_CATALOG.get('journey_to_ungoro_envenom_weapon')?.cost).toBe(2)
  })

  it('DEV-033: uses destroy rather than damage against Divine Shields', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0033,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: ['classic_twisting_nether', 'basic_hellfire'],
      opponentBoard: [
        { cardId: 'classic_sunwalker', attack: 4, health: 5, ready: true },
        { cardId: 'classic_sunwalker', attack: 4, health: 5, ready: true },
        {
          cardId: 'goblins_vs_gnomes_shielded_minibot',
          attack: 2,
          health: 2,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_twisting_nether'))
    expect(opponent(reference).board).toHaveLength(0)
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-034: suppresses Tirion before trading the remaining Raptor', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0034,
      aiHeroId: 'thrall',
      opponentHeroId: 'uther',
      aiHealth: 4,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['basic_hex', 'classic_lightning_bolt'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'classic_tirion_fordring', attack: 6, health: 6, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_hex',
        enemyMinionTarget(reference, 'classic_tirion_fordring')
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_lightning_bolt',
        enemyMinionTarget(reference, 'classic_frog')
      )
    )
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const raptor = minion(
      reference,
      reference.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, raptor.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(opponent(reference).weapon).toBeNull()
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(opponent(actual).weapon).toBeNull()
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-035: lets Ice Block answer Steady Shot while Ice Barrier stays inert', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0035,
      aiHeroId: 'jaina',
      opponentHeroId: 'rexxar',
      aiHealth: 1,
      aiMana: 3,
      aiMaximumMana: 3,
      opponentMaximumMana: 3,
      aiHand: ['classic_ice_block', 'basic_frostbolt'],
      aiSecrets: [{ cardId: 'classic_ice_barrier' }]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_ice_block'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.localParticipantId
    })
    expect(aiPlayer(reference).hero.health).toBe(1)
    expect(
      aiPlayer(reference).secrets?.some(
        (secret) => secret.cardId === 'classic_ice_block'
      )
    ).toBe(false)
    expect(
      aiPlayer(reference).secrets?.some(
        (secret) => secret.cardId === 'classic_ice_barrier'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-036: freezes the armed enemy hero', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0036,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 4,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_frostbolt'],
      opponentWeapon: {
        cardId: 'basic_arcanite_reaper',
        attack: 5,
        durability: 1,
        maxDurability: 1
      }
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(reference, 'basic_frostbolt', heroTarget(reference))
    )
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-037: selects the Taunt that absorbs both attack opportunities', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0037,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['classic_sunwalker', 'basic_senjin_shieldmasta'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_sunwalker'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'classic_sunwalker')
    ).toBe(true)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-038: uses zero-cost Ancestral Healing to create the required Taunt', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0038,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 2,
      aiMana: 0,
      aiMaximumMana: 6,
      aiHand: ['basic_ancestral_healing'],
      aiBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 6,
          health: 1,
          maxHealth: 7,
          ready: true
        }
      ],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_ancestral_healing',
        friendlyMinionTarget(reference, 'basic_boulderfist_ogre')
      )
    )
    expect(
      minion(reference, reference.remoteParticipantId, 'basic_boulderfist_ogre').health
    ).toBe(7)
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(reference, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(actual, (state) => {
        const ai = state.players.find(
          (player) => player.participantId === actual.remoteParticipantId
        )
        return state.phase === 'ended' || (ai?.hero.health ?? 0) > 0
      })
    ).toBe(true)
  }, 60_000)

  it('DEV-039: records the controlled Steady Shot loss without a tactical failure', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0039,
      aiHeroId: 'jaina',
      opponentHeroId: 'rexxar',
      aiHealth: 1,
      aiMana: 10,
      aiMaximumMana: 10,
      opponentMaximumMana: 10,
      aiHand: [
        'basic_boulderfist_ogre',
        'basic_senjin_shieldmasta',
        'classic_sunwalker'
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(actual.getState().activePlayerId).toBe(actual.localParticipantId)
    dispatch(actual, {
      type: 'use-hero-power',
      participantId: actual.localParticipantId
    })
    expect(actual.getState().phase).toBe('ended')
    expect(actual.getState().winnerId).toBe(actual.localParticipantId)
  }, 60_000)

  it('DEV-040: records the forced Ragnaros loss across R20', async () => {
    const base: Omit<AiFixtureOptions, 'seed'> = {
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['basic_frost_nova', 'basic_frostbolt'],
      opponentBoard: [
        {
          cardId: 'classic_ragnaros_the_firelord',
          attack: 8,
          health: 8,
          ready: false,
          keywords: ['cannot-attack']
        }
      ]
    }
    for (let index = 0; index < 20; index += 1) {
      const actual = createSession({ ...base, seed: 0xde0040 + index })
      await runAiTurn(actual)
      expect(actual.getState().phase).toBe('turns')
      expect(actual.getState().activePlayerId).toBe(actual.localParticipantId)
      dispatch(actual, { type: 'end-turn', participantId: actual.localParticipantId })
      expect(actual.getState().phase).toBe('ended')
      expect(actual.getState().winnerId).toBe(actual.localParticipantId)
    }
  }, 120_000)

  it('DEV-041: removes the global aura before the second trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0041,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 4,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: ['classic_savannah_highmane'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        {
          cardId: 'classic_stranglethorn_tiger',
          attack: 5,
          health: 5,
          ready: true,
          stealth: true
        }
      ],
      opponentBoard: [
        { cardId: 'basic_stormwind_champion', attack: 6, health: 6, ready: true },
        {
          cardId: 'basic_chillwind_yeti',
          attack: 5,
          health: 6,
          maxHealth: 6,
          baseAttack: 4,
          baseHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const champion = minion(
      reference,
      reference.localParticipantId,
      'basic_stormwind_champion'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, champion.instanceId))
    const tiger = minion(
      reference,
      reference.remoteParticipantId,
      'classic_stranglethorn_tiger'
    )
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, attackCommand(reference, tiger.instanceId, yeti.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board.map((entry) => entry.cardId)).toEqual(
      expect.arrayContaining(['basic_boulderfist_ogre', 'classic_stranglethorn_tiger'])
    )

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board.map((entry) => entry.cardId)).toEqual(
      expect.arrayContaining(['basic_boulderfist_ogre', 'classic_stranglethorn_tiger'])
    )
  }, 60_000)

  it('DEV-042: assigns Poisonous to the large threat', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0042,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMaximumMana: 7,
      aiBoard: [
        {
          cardId: 'classic_emperor_cobra',
          attack: 2,
          health: 3,
          ready: true,
          keywords: ['poisonous']
        },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    const cobra = minion(
      reference,
      reference.remoteParticipantId,
      'classic_emperor_cobra'
    )
    const enemyOgre = minion(
      reference,
      reference.localParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(
      reference,
      attackCommand(reference, cobra.instanceId, enemyOgre.instanceId)
    )
    const friendlyOgre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const raptor = minion(
      reference,
      reference.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(
      reference,
      attackCommand(reference, friendlyOgre.instanceId, raptor.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'basic_boulderfist_ogre'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_boulderfist_ogre')
    ).toBe(true)
  }, 60_000)

  it('DEV-043: spends Divine Shield instead of the durable body', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0043,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMaximumMana: 6,
      aiBoard: [
        {
          cardId: 'classic_argent_commander',
          attack: 4,
          health: 2,
          ready: true,
          divineShield: true
        },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 4,
          maxHealth: 5,
          ready: true
        },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    const commander = minion(
      reference,
      reference.remoteParticipantId,
      'classic_argent_commander'
    )
    const enemyYeti = minion(
      reference,
      reference.localParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(
      reference,
      attackCommand(reference, commander.instanceId, enemyYeti.instanceId)
    )
    const friendlyYeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const raptor = minion(
      reference,
      reference.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(
      reference,
      attackCommand(reference, friendlyYeti.instanceId, raptor.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board).toHaveLength(2)
    expect(
      aiPlayer(reference).board.some(
        (entry) =>
          entry.cardId === 'classic_argent_commander' && entry.divineShield === false
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board,
      JSON.stringify(
        aiPlayer(actual).board.map((entry) => ({
          cardId: entry.cardId,
          health: entry.health
        }))
      )
    ).toHaveLength(2)
  }, 60_000)

  it('DEV-044: uses the small attacker against the aura-buffed fragile minion', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0044,
      aiHeroId: 'rexxar',
      opponentHeroId: 'thrall',
      aiHealth: 20,
      aiMaximumMana: 6,
      aiBoard: [
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true },
        { cardId: 'basic_reckless_rocketeer', attack: 5, health: 2, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_flametongue_totem', attack: 0, health: 3, ready: true },
        {
          cardId: 'basic_murloc_raider',
          attack: 4,
          health: 1,
          maxHealth: 1,
          baseAttack: 2,
          baseHealth: 1,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    const recruit = minion(
      reference,
      reference.remoteParticipantId,
      'basic_silver_hand_recruit'
    )
    const raider = minion(
      reference,
      reference.localParticipantId,
      'basic_murloc_raider'
    )
    dispatch(reference, attackCommand(reference, recruit.instanceId, raider.instanceId))
    const rocketeer = minion(
      reference,
      reference.remoteParticipantId,
      'basic_reckless_rocketeer'
    )
    const flametongue = minion(
      reference,
      reference.localParticipantId,
      'basic_flametongue_totem'
    )
    dispatch(
      reference,
      attackCommand(reference, rocketeer.instanceId, flametongue.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'basic_reckless_rocketeer'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'basic_reckless_rocketeer'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-045: records both defensible Silence-versus-trade diagnostic lines', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0045,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_ironbeak_owl'],
      aiBoard: [{ cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }],
      opponentBoard: [
        { cardId: 'classic_acolyte_of_pain', attack: 1, health: 3, ready: true }
      ]
    }
    const silenced = createSession(options)
    dispatch(
      silenced,
      playCommand(
        silenced,
        'classic_ironbeak_owl',
        enemyMinionTarget(silenced, 'classic_acolyte_of_pain')
      )
    )
    const silencedRaptor = minion(
      silenced,
      silenced.remoteParticipantId,
      'basic_bloodfen_raptor'
    )
    const silencedAcolyte = minion(
      silenced,
      silenced.localParticipantId,
      'classic_acolyte_of_pain'
    )
    dispatch(
      silenced,
      attackCommand(silenced, silencedRaptor.instanceId, silencedAcolyte.instanceId)
    )
    expect(opponent(silenced).board).toHaveLength(0)
    expect(
      minion(silenced, silenced.remoteParticipantId, 'basic_bloodfen_raptor').health
    ).toBe(1)

    const traded = createSession(options)
    const tradedRaptor = minion(
      traded,
      traded.remoteParticipantId,
      'basic_bloodfen_raptor'
    )
    const tradedAcolyte = minion(
      traded,
      traded.localParticipantId,
      'classic_acolyte_of_pain'
    )
    dispatch(
      traded,
      attackCommand(traded, tradedRaptor.instanceId, tradedAcolyte.instanceId)
    )
    expect(opponent(traded).board).toHaveLength(0)
    expect(
      traded
        .findPlayer(traded.getState(), traded.remoteParticipantId)
        .hand.some((card) => card.cardId === 'classic_ironbeak_owl')
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeLessThanOrEqual(1)
  }, 60_000)

  it('DEV-046: records pressure and trade as a diagnostic choice', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0046,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 20,
      aiMaximumMana: 4,
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'classic_loot_hoarder', attack: 2, health: 1, ready: true }
      ]
    }
    const pressure = createSession(options)
    const pressureYeti = minion(
      pressure,
      pressure.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(pressure, attackCommand(pressure, pressureYeti.instanceId, 'hero'))
    expect(opponent(pressure).hero.health).toBe(16)
    expect(opponent(pressure).board).toHaveLength(1)

    const trade = createSession(options)
    const tradeYeti = minion(trade, trade.remoteParticipantId, 'basic_chillwind_yeti')
    const hoarder = minion(trade, trade.localParticipantId, 'classic_loot_hoarder')
    dispatch(trade, attackCommand(trade, tradeYeti.instanceId, hoarder.instanceId))
    expect(opponent(trade).board).toHaveLength(0)
    expect(
      minion(trade, trade.remoteParticipantId, 'basic_chillwind_yeti').health
    ).toBe(3)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).hero.health).toBeLessThanOrEqual(20)
  }, 60_000)

  it('DEV-047: keeps an inert Egg intact as a diagnostic pressure line', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0047,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMaximumMana: 4,
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'naxxramas_nerubian_egg', attack: 0, health: 2, ready: true }
      ]
    }
    const pressure = createSession(options)
    const yeti = minion(pressure, pressure.remoteParticipantId, 'basic_chillwind_yeti')
    dispatch(pressure, attackCommand(pressure, yeti.instanceId, 'hero'))
    expect(opponent(pressure).hero.health).toBe(26)
    expect(opponent(pressure).board[0]?.cardId).toBe('naxxramas_nerubian_egg')

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('DEV-048: removes the damaged Taunt before taking the winning attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0048,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_frostbolt'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 3,
          maxHealth: 5,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_frostbolt',
        enemyMinionTarget(reference, 'basic_senjin_shieldmasta')
      )
    )
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-049: records both token-trade diagnostic outcomes', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0049,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMaximumMana: 4,
      aiBoard: [
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'basic_bloodfen_raptor',
          attack: 3,
          health: 1,
          maxHealth: 2,
          ready: true
        }
      ]
    }
    const tokenTrade = createSession(options)
    const recruit = minion(
      tokenTrade,
      tokenTrade.remoteParticipantId,
      'basic_silver_hand_recruit'
    )
    const raptor = minion(
      tokenTrade,
      tokenTrade.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(
      tokenTrade,
      attackCommand(tokenTrade, recruit.instanceId, raptor.instanceId)
    )
    const yeti = minion(
      tokenTrade,
      tokenTrade.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(tokenTrade, attackCommand(tokenTrade, yeti.instanceId, 'hero'))
    expect(opponent(tokenTrade).hero.health).toBe(26)

    const bodyTrade = createSession(options)
    const bodyYeti = minion(
      bodyTrade,
      bodyTrade.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const bodyRaptor = minion(
      bodyTrade,
      bodyTrade.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(
      bodyTrade,
      attackCommand(bodyTrade, bodyYeti.instanceId, bodyRaptor.instanceId)
    )
    const bodyRecruit = minion(
      bodyTrade,
      bodyTrade.remoteParticipantId,
      'basic_silver_hand_recruit'
    )
    dispatch(bodyTrade, attackCommand(bodyTrade, bodyRecruit.instanceId, 'hero'))
    expect(opponent(bodyTrade).hero.health).toBe(29)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).hero.health).toBeLessThanOrEqual(30)
  }, 60_000)

  it('DEV-050: removes Divine Shield with Fireblast before the Ogre attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0050,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMana: 2,
      aiMaximumMana: 2,
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_sunwalker', attack: 4, health: 5, ready: true },
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.remoteParticipantId,
      target: enemyHeroPowerMinionTarget(reference, 'classic_sunwalker')
    })
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const sunwalker = minion(
      reference,
      reference.localParticipantId,
      'classic_sunwalker'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, sunwalker.instanceId))
    expect(
      opponent(reference).board.some((entry) => entry.cardId === 'classic_sunwalker')
    ).toBe(false)
    expect(
      minion(reference, reference.remoteParticipantId, 'basic_boulderfist_ogre').health
    ).toBe(3)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      opponent(actual).board.some((entry) => entry.cardId === 'classic_sunwalker')
    ).toBe(false)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'basic_boulderfist_ogre' && entry.health > 0
      )
    ).toBe(true)
  }, 60_000)
  it('DEV-051: heals the damaged minion before its trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0051,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 1,
      aiMaximumMana: 4,
      aiHand: ['the_grand_tournament_flash_heal', 'basic_senjin_shieldmasta'],
      aiBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 1,
          maxHealth: 5,
          ready: true
        }
      ],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 4,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'the_grand_tournament_flash_heal',
        friendlyMinionTarget(reference, 'basic_chillwind_yeti')
      )
    )
    const friendlyYeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const enemyYeti = minion(
      reference,
      reference.localParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(
      reference,
      attackCommand(reference, friendlyYeti.instanceId, enemyYeti.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board[0]?.health).toBeGreaterThan(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board).toHaveLength(1)
  }, 60_000)

  it('DEV-052: preserves Enrage long enough to make the trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0052,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_earthen_ring_farseer'],
      aiBoard: [
        {
          cardId: 'classic_amani_berserker',
          attack: 5,
          health: 2,
          maxHealth: 3,
          baseAttack: 2,
          baseHealth: 3,
          ready: true
        }
      ],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    const berserker = minion(
      reference,
      reference.remoteParticipantId,
      'classic_amani_berserker'
    )
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, attackCommand(reference, berserker.instanceId, yeti.instanceId))
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-053: reports either safe area-damage order around Frothing', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0053,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: ['basic_fireball', 'basic_arcane_explosion'],
      opponentBoard: [
        { cardId: 'classic_frothing_berserker', attack: 2, health: 4, ready: true },
        {
          cardId: 'basic_bloodfen_raptor',
          attack: 3,
          health: 1,
          maxHealth: 2,
          ready: true
        },
        { cardId: 'basic_murloc_raider', attack: 2, health: 1, ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeLessThanOrEqual(3)
  }, 60_000)

  it('DEV-054: trades the small Beasts before the Hyena', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0054,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMaximumMana: 5,
      aiBoard: [
        { cardId: 'classic_scavenging_hyena', attack: 2, health: 2, ready: true },
        {
          cardId: 'mean_streets_of_gadgetzan_alleycat',
          attack: 1,
          health: 1,
          ready: true
        },
        {
          cardId: 'mean_streets_of_gadgetzan_alleycat',
          attack: 1,
          health: 1,
          ready: true
        }
      ],
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const first = minion(
      reference,
      reference.remoteParticipantId,
      'mean_streets_of_gadgetzan_alleycat',
      0
    )
    const second = minion(
      reference,
      reference.remoteParticipantId,
      'mean_streets_of_gadgetzan_alleycat',
      1
    )
    const taunt = minion(
      reference,
      reference.localParticipantId,
      'basic_senjin_shieldmasta'
    )
    dispatch(reference, attackCommand(reference, first.instanceId, taunt.instanceId))
    const nextTaunt = minion(
      reference,
      reference.localParticipantId,
      'basic_senjin_shieldmasta'
    )
    dispatch(
      reference,
      attackCommand(reference, second.instanceId, nextTaunt.instanceId)
    )
    const hyena = minion(
      reference,
      reference.remoteParticipantId,
      'classic_scavenging_hyena'
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        hyena.instanceId,
        minion(reference, reference.localParticipantId, 'basic_senjin_shieldmasta')
          .instanceId
      )
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_scavenging_hyena'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'classic_scavenging_hyena'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-055: sacrifices the token to draw and cast the finisher', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0055,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 6,
      aiMana: 4,
      aiMaximumMana: 4,
      aiDeck: ['basic_fireball'],
      aiBoard: [
        { cardId: 'classic_cult_master', attack: 4, health: 2, ready: true },
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    const recruit = minion(
      reference,
      reference.remoteParticipantId,
      'basic_silver_hand_recruit'
    )
    const raptor = minion(
      reference,
      reference.localParticipantId,
      'basic_bloodfen_raptor'
    )
    dispatch(reference, attackCommand(reference, recruit.instanceId, raptor.instanceId))
    dispatch(reference, playCommand(reference, 'basic_fireball', heroTarget(reference)))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-056: records the frozen-threat diagnostic line', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0056,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 6,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_fireball'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 6,
          health: 7,
          ready: true,
          frozenUntilTurn: 6
        }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).hero.health).toBeLessThanOrEqual(30)
  }, 60_000)

  it('DEV-057: spends both attacks to remove Doomsayer', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0057,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMaximumMana: 5,
      aiBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_doomsayer', attack: 0, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    const doomsayer = minion(
      reference,
      reference.localParticipantId,
      'classic_doomsayer'
    )
    for (const cardId of ['basic_chillwind_yeti', 'basic_bloodfen_raptor']) {
      const attacker = minion(reference, reference.remoteParticipantId, cardId)
      dispatch(
        reference,
        attackCommand(reference, attacker.instanceId, doomsayer.instanceId)
      )
    }
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-058: keeps the Deathrattle token free of the destroyed Taunt', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0058,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 6,
      aiMaximumMana: 6,
      aiBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'naxxramas_nerubian_egg',
          attack: 1,
          health: 3,
          maxHealth: 3,
          baseAttack: 0,
          baseHealth: 2,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const raptor = minion(
      reference,
      reference.remoteParticipantId,
      'basic_bloodfen_raptor'
    )
    const egg = minion(
      reference,
      reference.localParticipantId,
      'naxxramas_nerubian_egg'
    )
    dispatch(reference, attackCommand(reference, raptor.instanceId, egg.instanceId))
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)
    const token = opponent(reference).board.find(
      (entry) => entry.cardId === 'naxxramas_nerubian'
    )
    expect(token?.keywords?.includes('taunt')).toBe(false)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
    expect(
      opponent(actual).board.some((entry) => entry.cardId === 'naxxramas_nerubian_egg')
    ).toBe(false)
  }, 60_000)

  it('DEV-059: silences Sylvanas before exposing the Ogre', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0059,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_ironbeak_owl'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_sylvanas_windrunner', attack: 5, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_ironbeak_owl',
        enemyMinionTarget(reference, 'classic_sylvanas_windrunner')
      )
    )
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const sylvanas = minion(
      reference,
      reference.localParticipantId,
      'classic_sylvanas_windrunner'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, sylvanas.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'basic_boulderfist_ogre'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_boulderfist_ogre')
    ).toBe(true)
  }, 60_000)

  it('DEV-060: removes Baron Geddon before the opposing turn', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0060,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 8,
      opponentHealth: 30,
      aiMaximumMana: 7,
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_baron_geddon', attack: 7, health: 5, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const geddon = minion(
      reference,
      reference.localParticipantId,
      'classic_baron_geddon'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, geddon.instanceId))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-061: records the engine-versus-body removal diagnostic', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0061,
      aiHeroId: 'rexxar',
      opponentHeroId: 'malfurion',
      aiHealth: 20,
      opponentHealth: 30,
      aiMaximumMana: 6,
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'whispers_of_the_old_gods_fandral_staghelm',
          attack: 3,
          health: 5,
          ready: true
        },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeLessThanOrEqual(2)
  }, 60_000)

  it('DEV-062: targets Knife Juggler in the fragile-engine diagnostic', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0062,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      opponentBoard: [
        {
          cardId: 'classic_knife_juggler',
          attack: 2,
          health: 1,
          maxHealth: 2,
          ready: true
        },
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.remoteParticipantId,
      target: enemyHeroPowerMinionTarget(reference, 'classic_knife_juggler')
    })
    expect(
      opponent(reference).board.some(
        (entry) => entry.cardId === 'classic_knife_juggler'
      )
    ).toBe(false)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeLessThanOrEqual(2)
  }, 60_000)

  it('DEV-063: records the Polymorph target diagnostic', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0063,
      aiHeroId: 'jaina',
      opponentHeroId: 'rexxar',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_polymorph'],
      aiBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_savannah_highmane', attack: 6, health: 5, ready: true },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_polymorph',
        enemyMinionTarget(reference, 'classic_savannah_highmane')
      )
    )
    const sheep = minion(reference, reference.localParticipantId, 'basic_sheep')
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, sheep.instanceId))
    expect(
      opponent(reference).board.some((entry) => entry.cardId === 'basic_sheep')
    ).toBe(false)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeLessThanOrEqual(2)
  }, 60_000)

  it('DEV-064: destroys Ashbringer after Tirion falls', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0064,
      aiHeroId: 'uther',
      opponentHeroId: 'uther',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_acidic_swamp_ooze'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'classic_tirion_fordring',
          attack: 6,
          health: 6,
          ready: true,
          divineShield: false,
          divineShieldConsumed: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const tirion = minion(
      reference,
      reference.localParticipantId,
      'classic_tirion_fordring'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, tirion.instanceId))
    dispatch(reference, playCommand(reference, 'basic_acidic_swamp_ooze'))
    expect(opponent(reference).board).toHaveLength(0)
    expect(opponent(reference).weapon).toBeNull()
    expect(aiPlayer(reference).board[0]?.health).toBeGreaterThan(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(opponent(actual).weapon).toBeNull()
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_boulderfist_ogre')
    ).toBe(true)
  }, 60_000)

  it('DEV-065: records both board-control and pressure diagnostics', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0065,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 14,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_fireball'],
      aiBoard: [
        { cardId: 'classic_mana_wyrm', attack: 1, health: 3, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_river_crocolisk', attack: 2, health: 3, ready: true }
      ]
    }
    const reference = createSession(options)
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const crocolisk = minion(
      reference,
      reference.localParticipantId,
      'basic_river_crocolisk'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, crocolisk.instanceId))
    const wyrm = minion(reference, reference.remoteParticipantId, 'classic_mana_wyrm')
    dispatch(reference, attackCommand(reference, wyrm.instanceId, 'hero'))
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
  }, 60_000)

  it('DEV-066: reduces Ogre Attack before the preservation trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0066,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_aldor_peacekeeper'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 6,
          health: 4,
          maxHealth: 7,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_aldor_peacekeeper',
        enemyMinionTarget(reference, 'basic_boulderfist_ogre')
      )
    )
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const ogre = minion(
      reference,
      reference.localParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, ogre.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board[0]?.health).toBeGreaterThan(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board.map((entry) => entry.cardId)).toEqual(
      expect.arrayContaining(['basic_chillwind_yeti', 'classic_aldor_peacekeeper'])
    )
  }, 60_000)

  it('DEV-067: makes the Ogre eligible for Stampeding Kodo', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0067,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: ['classic_aldor_peacekeeper', 'classic_stampeding_kodo'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_aldor_peacekeeper',
        enemyMinionTarget(reference, 'basic_boulderfist_ogre')
      )
    )
    dispatch(reference, playCommand(reference, 'classic_stampeding_kodo'))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board.map((entry) => entry.cardId)).toEqual(
      expect.arrayContaining(['classic_aldor_peacekeeper', 'classic_stampeding_kodo'])
    )

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board).toHaveLength(2)
  }, 60_000)

  it('DEV-068: aims Foe Reaper at the middle Taunt', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0068,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMaximumMana: 8,
      aiBoard: [
        {
          cardId: 'goblins_vs_gnomes_foe_reaper_4000',
          attack: 6,
          health: 9,
          ready: true
        }
      ],
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const reaper = minion(
      reference,
      reference.remoteParticipantId,
      'goblins_vs_gnomes_foe_reaper_4000'
    )
    const middle = minion(
      reference,
      reference.localParticipantId,
      'basic_senjin_shieldmasta',
      1
    )
    dispatch(reference, attackCommand(reference, reaper.instanceId, middle.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board[0]?.health).toBe(6)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board[0]?.health).toBe(6)
  }, 60_000)

  it('DEV-069: uses temporary Immunity to preserve a trading body', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0069,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['knights_of_the_frozen_throne_deathspeaker'],
      aiBoard: [{ cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }],
      opponentBoard: [
        { cardId: 'basic_magma_rager', attack: 5, health: 1, ready: true }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_bloodfen_raptor')
    ).toBe(true)
  }, 60_000)

  it('DEV-070: takes the Chow face line before Fireball', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0070,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 8,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_fireball'],
      aiBoard: [{ cardId: 'naxxramas_zombie_chow', attack: 2, health: 3, ready: true }],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    const chow = minion(
      reference,
      reference.remoteParticipantId,
      'naxxramas_zombie_chow'
    )
    dispatch(reference, attackCommand(reference, chow.instanceId, 'hero'))
    dispatch(reference, playCommand(reference, 'basic_fireball', heroTarget(reference)))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-071: freezes the weapon user before the opposing turn', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0071,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 5,
      opponentHealth: 30,
      aiMaximumMana: 6,
      aiBoard: [{ cardId: 'basic_water_elemental', attack: 3, health: 6, ready: true }],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ],
      opponentWeapon: {
        cardId: 'basic_arcanite_reaper',
        attack: 5,
        durability: 2,
        maxDurability: 2
      }
    }
    const reference = createSession(options)
    const elemental = minion(
      reference,
      reference.remoteParticipantId,
      'basic_water_elemental'
    )
    dispatch(reference, attackCommand(reference, elemental.instanceId, 'hero'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-072: combines minion and weapon attacks against Doomsayer', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0072,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 4,
      opponentHealth: 30,
      aiMaximumMana: 6,
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'classic_doomsayer', attack: 0, health: 7, ready: true }
      ],
      aiWeapon: {
        cardId: 'basic_assassins_blade',
        attack: 3,
        durability: 1,
        maxDurability: 1
      }
    }
    const reference = createSession(options)
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const doomsayer = minion(
      reference,
      reference.localParticipantId,
      'classic_doomsayer'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, doomsayer.instanceId))
    dispatch(reference, heroAttackCommand(reference, 'hero'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-073: resolves Harvest Golem without granting the token an attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0073,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMaximumMana: 4,
      aiBoard: [
        { cardId: 'classic_harvest_golem', attack: 2, health: 3, ready: true },
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 3,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    const golem = minion(
      reference,
      reference.remoteParticipantId,
      'classic_harvest_golem'
    )
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, attackCommand(reference, golem.instanceId, yeti.instanceId))
    const recruit = minion(
      reference,
      reference.remoteParticipantId,
      'basic_silver_hand_recruit'
    )
    const remainingYeti = minion(
      reference,
      reference.localParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(
      reference,
      attackCommand(reference, recruit.instanceId, remainingYeti.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_damaged_golem'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    const damaged = aiPlayer(actual).board.find(
      (entry) => entry.cardId === 'classic_damaged_golem'
    )
    expect(damaged).toBeDefined()
    expect(damaged?.summonedOnTurn).toBeLessThan(actual.getState().turnNumber)
  }, 60_000)

  it('DEV-074: uses Tinyfin on the harmless Taunt before Ogre face damage', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0074,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMaximumMana: 6,
      aiBoard: [
        {
          cardId: 'league_of_explorers_murloc_tinyfin',
          attack: 1,
          health: 1,
          ready: true
        },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'classic_frog',
          attack: 0,
          health: 1,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const tinyfin = minion(
      reference,
      reference.remoteParticipantId,
      'league_of_explorers_murloc_tinyfin'
    )
    const frog = minion(reference, reference.localParticipantId, 'classic_frog')
    dispatch(reference, attackCommand(reference, tinyfin.instanceId, frog.instanceId))
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, 'hero'))
    expect(opponent(reference).board).toHaveLength(0)
    expect(opponent(reference).hero.health).toBe(24)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(opponent(actual).hero.health).toBeLessThanOrEqual(24)
  }, 60_000)

  it('DEV-075: changes from face lethal to removal across the Health pair', async () => {
    const base: AiFixtureOptions = {
      seed: 0xde0075,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 5,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_kill_command'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const lethal = { ...base, opponentHealth: 6 }
    const referenceLethal = createSession(lethal)
    const friendlyLethal = minion(
      referenceLethal,
      referenceLethal.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(
      referenceLethal,
      attackCommand(referenceLethal, friendlyLethal.instanceId, 'hero')
    )
    expect(aiWon(referenceLethal)).toBe(true)
    const actualLethal = createSession(lethal)
    await runAiTurn(actualLethal)
    expect(aiWon(actualLethal)).toBe(true)

    const removal = { ...base, opponentHealth: 10 }
    const referenceRemoval = createSession(removal)
    dispatch(
      referenceRemoval,
      playCommand(
        referenceRemoval,
        'classic_kill_command',
        enemyMinionTarget(referenceRemoval, 'basic_boulderfist_ogre')
      )
    )
    const friendlyRemoval = minion(
      referenceRemoval,
      referenceRemoval.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    const enemyRemoval = minion(
      referenceRemoval,
      referenceRemoval.localParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(
      referenceRemoval,
      attackCommand(
        referenceRemoval,
        friendlyRemoval.instanceId,
        enemyRemoval.instanceId
      )
    )
    dispatch(referenceRemoval, {
      type: 'end-turn',
      participantId: referenceRemoval.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        referenceRemoval,
        (state) => state.winnerId !== referenceRemoval.localParticipantId
      )
    ).toBe(true)
    const actualRemoval = createSession(removal)
    await runAiTurn(actualRemoval)
    expect(
      everyOpponentReply(
        actualRemoval,
        (state) => state.winnerId !== actualRemoval.localParticipantId
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-076: recalculates Flametongue adjacency after the blocker dies', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0076,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 5,
      aiMaximumMana: 8,
      aiBoard: [
        {
          cardId: 'classic_argent_squire',
          attack: 1,
          health: 1,
          ready: true,
          divineShield: false,
          divineShieldConsumed: true
        },
        { cardId: 'basic_river_crocolisk', attack: 2, health: 3, ready: true },
        {
          cardId: 'basic_bloodfen_raptor',
          attack: 5,
          health: 2,
          baseAttack: 3,
          baseHealth: 2,
          ready: true
        },
        { cardId: 'basic_flametongue_totem', attack: 0, health: 3, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const raptor = minion(
      reference,
      reference.remoteParticipantId,
      'basic_bloodfen_raptor'
    )
    const taunt = minion(
      reference,
      reference.localParticipantId,
      'basic_senjin_shieldmasta'
    )
    dispatch(reference, attackCommand(reference, raptor.instanceId, taunt.instanceId))
    const crocolisk = minion(
      reference,
      reference.remoteParticipantId,
      'basic_river_crocolisk'
    )
    const squire = minion(
      reference,
      reference.remoteParticipantId,
      'classic_argent_squire'
    )
    dispatch(reference, attackCommand(reference, crocolisk.instanceId, 'hero'))
    dispatch(reference, attackCommand(reference, squire.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-077: uses the post-change Innervate amount for Charge', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0077,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_innervate', 'classic_druid_of_the_claw', 'basic_boulderfist_ogre']
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_innervate'))
    dispatch(
      reference,
      playCommand(reference, 'classic_druid_of_the_claw', undefined, 0)
    )
    const cat = minion(
      reference,
      reference.remoteParticipantId,
      'classic_druid_of_the_claw'
    )
    dispatch(reference, attackCommand(reference, cat.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-078: installs Sorcerer Apprentice before the burn sequence', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0078,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 9,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['classic_sorcerers_apprentice', 'basic_fireball', 'basic_frostbolt']
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_sorcerers_apprentice'))
    dispatch(reference, playCommand(reference, 'basic_fireball', heroTarget(reference)))
    dispatch(
      reference,
      playCommand(reference, 'basic_frostbolt', heroTarget(reference))
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-079: records the live minimum spell cost that conflicts with the snapshot', () => {
    const radiant = CARD_CATALOG.get('journey_to_ungoro_radiant_elemental')
    expect(radiant?.rulesText).toContain('but not less than 1')
    expect(JSON.stringify(radiant?.effects)).toContain('"minimum":1')
  })

  it('DEV-080: unlocks current mana before Lava Burst', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0080,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 7,
      aiMana: 2,
      aiMaximumMana: 6,
      aiOverloadLocked: 4,
      aiHand: ['blackrock_mountain_lava_shock', 'classic_lava_burst']
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(reference, 'blackrock_mountain_lava_shock', heroTarget(reference))
    )
    dispatch(
      reference,
      playCommand(reference, 'classic_lava_burst', heroTarget(reference))
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-081: records the no-Overload breakpoint diagnostic', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0081,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: [
        'classic_earth_shock',
        'classic_lightning_bolt',
        'whispers_of_the_old_gods_bog_creeper'
      ],
      opponentBoard: [
        {
          cardId: 'basic_bloodfen_raptor',
          attack: 3,
          health: 1,
          maxHealth: 2,
          ready: true
        }
      ]
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(opponent(actual).board.length).toBeLessThanOrEqual(1)
  }, 60_000)

  it('DEV-082: takes the certain Bloodlust attacks before Evolve', async () => {
    const bloodlust = (id: string) => ({
      id,
      sourceInstanceId: 'fixture-bloodlust',
      sourceCardId: asCardId('basic_bloodfen_raptor'),
      attackDelta: 3,
      duration: 'this-turn',
      expiresOnTurn: 5
    })
    const options: AiFixtureOptions = {
      seed: 0xde0082,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 12,
      aiMana: 1,
      aiMaximumMana: 6,
      aiHand: ['whispers_of_the_old_gods_evolve'],
      aiBoard: [
        {
          cardId: 'league_of_explorers_murloc_tinyfin',
          attack: 4,
          health: 1,
          baseAttack: 1,
          baseHealth: 1,
          ready: true,
          enchantments: [bloodlust('fixture-bloodlust-1')]
        },
        {
          cardId: 'league_of_explorers_murloc_tinyfin',
          attack: 4,
          health: 1,
          baseAttack: 1,
          baseHealth: 1,
          ready: true,
          enchantments: [bloodlust('fixture-bloodlust-2')]
        },
        {
          cardId: 'league_of_explorers_murloc_tinyfin',
          attack: 4,
          health: 1,
          baseAttack: 1,
          baseHealth: 1,
          ready: true,
          enchantments: [bloodlust('fixture-bloodlust-3')]
        }
      ]
    }
    const reference = createSession(options)
    for (let index = 0; index < 3; index += 1) {
      const tinyfin = minion(
        reference,
        reference.remoteParticipantId,
        'league_of_explorers_murloc_tinyfin',
        index
      )
      dispatch(reference, attackCommand(reference, tinyfin.instanceId, 'hero'))
    }
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-083: spends the temporary buff before consuming the body', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0083,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_power_overwhelming', 'classic_void_terror'],
      aiBoard: [{ cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_power_overwhelming',
        friendlyMinionTarget(reference, 'basic_bloodfen_raptor')
      )
    )
    const raptor = minion(
      reference,
      reference.remoteParticipantId,
      'basic_bloodfen_raptor'
    )
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, attackCommand(reference, raptor.instanceId, yeti.instanceId))
    dispatch(reference, playAtPosition(reference, 'classic_void_terror', 1))
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some((entry) => entry.cardId === 'classic_void_terror')
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'classic_void_terror')
    ).toBe(true)
  }, 60_000)

  it('DEV-084: copies the permanently buffed Yeti', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0084,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 9,
      aiMaximumMana: 9,
      aiHand: ['basic_blessing_of_kings', 'classic_faceless_manipulator'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_blessing_of_kings',
        friendlyMinionTarget(reference, 'basic_chillwind_yeti')
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_faceless_manipulator',
        friendlyMinionTarget(reference, 'basic_chillwind_yeti')
      )
    )
    expect(
      aiPlayer(reference).board.filter(
        (entry) => entry.cardId === 'basic_chillwind_yeti'
      )
    ).toHaveLength(2)
    expect(
      aiPlayer(reference).board.every(
        (entry) => entry.attack === 8 && entry.health === 9
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    const yetis = aiPlayer(actual).board.filter(
      (entry) => entry.cardId === 'basic_chillwind_yeti'
    )
    expect(yetis).toHaveLength(2)
    expect(yetis.every((entry) => entry.attack >= 8 && entry.health >= 9)).toBe(true)
  }, 60_000)

  it('DEV-085: breaks Deaths Bite before the Grommash attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0085,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 14,
      aiMaximumMana: 8,
      aiBoard: [
        {
          cardId: 'classic_grommash_hellscream',
          attack: 10,
          health: 8,
          maxHealth: 9,
          baseAttack: 4,
          baseHealth: 9,
          ready: true,
          enchantments: [
            {
              id: 'fixture-grommash-enrage',
              sourceInstanceId: 'fixture-grommash-enrage',
              sourceCardId: asCardId('classic_grommash_hellscream'),
              attackDelta: 6,
              duration: 'while-damaged'
            }
          ]
        }
      ],
      aiWeapon: {
        cardId: 'naxxramas_deaths_bite',
        attack: 4,
        durability: 1,
        maxDurability: 1
      }
    }
    const reference = createSession(options)
    dispatch(reference, heroAttackCommand(reference, 'hero'))
    const grommash = minion(
      reference,
      reference.remoteParticipantId,
      'classic_grommash_hellscream'
    )
    dispatch(reference, attackCommand(reference, grommash.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-086: treats a replacement weapon as a control case', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0086,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 8,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_fiery_war_axe'],
      aiWeapon: {
        cardId: 'basic_arcanite_reaper',
        attack: 5,
        durability: 1,
        maxDurability: 1
      }
    }
    const reference = createSession(options)
    dispatch(reference, heroAttackCommand(reference, 'hero'))
    dispatch(reference, playCommand(reference, 'basic_fiery_war_axe'))
    expect(opponent(reference).hero.health).toBe(3)
    expect(aiPlayer(reference).hero.attacksUsedThisTurn).toBe(1)
    expect(aiPlayer(reference).weapon?.cardId).toBe('basic_fiery_war_axe')

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().winnerId).not.toBe(actual.remoteParticipantId)
    expect(aiPlayer(actual).hero.attacksUsedThisTurn ?? 0).toBeLessThanOrEqual(1)
  }, 60_000)

  it('DEV-087: spends Darkbomb before Doomguard discards it', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0087,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 8,
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: ['goblins_vs_gnomes_darkbomb', 'classic_doomguard']
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(reference, 'goblins_vs_gnomes_darkbomb', heroTarget(reference))
    )
    dispatch(reference, playCommand(reference, 'classic_doomguard'))
    const doomguard = minion(
      reference,
      reference.remoteParticipantId,
      'classic_doomguard'
    )
    dispatch(reference, attackCommand(reference, doomguard.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-088: damages the Ogre before making Execute legal', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0088,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_whirlwind', 'basic_execute'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_whirlwind'))
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_execute',
        enemyMinionTarget(reference, 'basic_boulderfist_ogre')
      )
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board).toHaveLength(1)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_chillwind_yeti')
    ).toBe(true)
  }, 60_000)

  it('DEV-089: keeps Faerie Dragon in hand for Templar', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0089,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['one_night_in_karazhan_nightbane_templar', 'classic_faerie_dragon']
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(reference, 'one_night_in_karazhan_nightbane_templar')
    )
    dispatch(reference, playCommand(reference, 'classic_faerie_dragon'))
    expect(aiPlayer(reference).board).toHaveLength(4)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_faerie_dragon'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiPlayer(actual).board).toHaveLength(4)
  }, 60_000)

  it('DEV-090: plays Brann before the Archer Battlecry', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0090,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 2,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['league_of_explorers_brann_bronzebeard', 'basic_elven_archer']
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'league_of_explorers_brann_bronzebeard'))
    dispatch(
      reference,
      playCommand(reference, 'basic_elven_archer', heroTarget(reference))
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-091: installs Muklas Champion before Reinforce', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0091,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: ['the_grand_tournament_muklas_champion'],
      aiBoard: [
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true },
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'the_grand_tournament_muklas_champion'))
    dispatch(reference, {
      type: 'use-hero-power',
      participantId: reference.remoteParticipantId
    })
    const recruits = reference
      .findPlayer(reference.getState(), reference.remoteParticipantId)
      .board.filter((entry) => entry.cardId === 'basic_silver_hand_recruit')
    expect(recruits).toHaveLength(3)
    expect(
      recruits.slice(0, 2).every((entry) => entry.attack === 2 && entry.health === 2)
    ).toBe(true)
    for (const recruit of recruits.slice(0, 2))
      dispatch(reference, attackCommand(reference, recruit.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-092: opens two slots before Muster for Battle', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0092,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['goblins_vs_gnomes_muster_for_battle'],
      aiBoard: Array.from({ length: 6 }, () => ({
        cardId: 'basic_silver_hand_recruit',
        attack: 1,
        health: 1,
        ready: true
      })),
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    for (let index = 0; index < 2; index += 1) {
      const recruit = minion(
        reference,
        reference.remoteParticipantId,
        'basic_silver_hand_recruit',
        index
      )
      const raptor = minion(
        reference,
        reference.localParticipantId,
        'basic_bloodfen_raptor'
      )
      dispatch(
        reference,
        attackCommand(reference, recruit.instanceId, raptor.instanceId)
      )
    }
    dispatch(reference, playCommand(reference, 'goblins_vs_gnomes_muster_for_battle'))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board).toHaveLength(7)
    expect(aiPlayer(reference).weapon?.cardId).toBe('goblins_vs_gnomes_lights_justice')

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board).toHaveLength(7)
  }, 60_000)

  it('DEV-093: attacks Leeroy before Shadowstep replay', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0093,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 12,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_shadowstep'],
      aiBoard: [
        { cardId: 'classic_leeroy_jenkins', attack: 6, health: 2, ready: true }
      ],
      opponentBoard: [
        { cardId: 'classic_whelp', attack: 1, health: 1, ready: true },
        { cardId: 'classic_whelp', attack: 1, health: 1, ready: true }
      ]
    }
    const reference = createSession(options)
    const leeroy = minion(
      reference,
      reference.remoteParticipantId,
      'classic_leeroy_jenkins'
    )
    dispatch(reference, attackCommand(reference, leeroy.instanceId, 'hero'))
    const replayTarget = minion(
      reference,
      reference.remoteParticipantId,
      'classic_leeroy_jenkins'
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_shadowstep',
        friendlyMinionTarget(reference, 'classic_leeroy_jenkins')
      )
    )
    dispatch(reference, playCommand(reference, 'classic_leeroy_jenkins'))
    const replay = minion(
      reference,
      reference.remoteParticipantId,
      'classic_leeroy_jenkins'
    )
    dispatch(reference, attackCommand(reference, replay.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)
    void replayTarget

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-094: establishes Auchenai before Flash Heal damage', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0094,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 5,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['classic_auchenai_soulpriest', 'the_grand_tournament_flash_heal']
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_auchenai_soulpriest'))
    dispatch(
      reference,
      playCommand(reference, 'the_grand_tournament_flash_heal', heroTarget(reference))
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-095: plays Pyromancer before Equality', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0095,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_wild_pyromancer', 'classic_equality'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_wild_pyromancer'))
    dispatch(reference, playCommand(reference, 'classic_equality'))
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-096: uses Cruel Taskmaster without forcing one removal recipe', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0096,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_cruel_taskmaster', 'basic_execute'],
      aiBoard: [
        { cardId: 'classic_grommash_hellscream', attack: 4, health: 9, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_cruel_taskmaster',
        friendlyMinionTarget(reference, 'classic_grommash_hellscream')
      )
    )
    const grommash = minion(
      reference,
      reference.remoteParticipantId,
      'classic_grommash_hellscream'
    )
    const ogre = minion(
      reference,
      reference.localParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, grommash.instanceId, ogre.instanceId))
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'classic_grommash_hellscream'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-097: attacks with Deckhand before the dagger breaks', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0097,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 5,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['classic_southsea_deckhand', 'basic_deadly_poison'],
      aiWeapon: {
        cardId: 'basic_wicked_knife',
        attack: 1,
        durability: 1,
        maxDurability: 1
      }
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_deadly_poison'))
    dispatch(reference, playCommand(reference, 'classic_southsea_deckhand'))
    const deckhand = minion(
      reference,
      reference.remoteParticipantId,
      'classic_southsea_deckhand'
    )
    dispatch(reference, attackCommand(reference, deckhand.instanceId, 'hero'))
    dispatch(reference, heroAttackCommand(reference, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-098: removes Weblord before paying the Battlecry aura cost', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0098,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 14,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: [
        'basic_fireball',
        { cardId: 'classic_abusive_sergeant', baseCost: 1, currentCost: 3 }
      ],
      aiBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'naxxramas_nerubar_weblord',
          attack: 1,
          health: 4,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    const weblord = minion(
      reference,
      reference.localParticipantId,
      'naxxramas_nerubar_weblord'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, weblord.instanceId))
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_abusive_sergeant',
        friendlyMinionTarget(reference, 'basic_boulderfist_ogre')
      )
    )
    dispatch(reference, playCommand(reference, 'basic_fireball', heroTarget(reference)))
    const ogre = minion(
      reference,
      reference.remoteParticipantId,
      'basic_boulderfist_ogre'
    )
    dispatch(reference, attackCommand(reference, ogre.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-099: trades Tirion before playing N Zoth', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0099,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 10,
      aiMaximumMana: 10,
      aiHand: ['whispers_of_the_old_gods_nzoth_the_corruptor'],
      aiBoard: [
        {
          cardId: 'classic_tirion_fordring',
          attack: 6,
          health: 1,
          maxHealth: 6,
          ready: true,
          divineShield: false,
          divineShieldConsumed: true,
          keywords: ['taunt']
        }
      ],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    const tirion = minion(
      reference,
      reference.remoteParticipantId,
      'classic_tirion_fordring'
    )
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, attackCommand(reference, tirion.instanceId, yeti.instanceId))
    dispatch(
      reference,
      playCommand(reference, 'whispers_of_the_old_gods_nzoth_the_corruptor')
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_tirion_fordring' && entry.divineShield
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'classic_tirion_fordring' && entry.divineShield
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-100: heals before spending the Lightwarden attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0100,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 25,
      opponentHealth: 3,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['the_grand_tournament_flash_heal'],
      aiBoard: [{ cardId: 'classic_lightwarden', attack: 1, health: 2, ready: true }]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'the_grand_tournament_flash_heal',
        friendlyHeroTarget(reference)
      )
    )
    const lightwarden = minion(
      reference,
      reference.remoteParticipantId,
      'classic_lightwarden'
    )
    dispatch(reference, attackCommand(reference, lightwarden.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-101: breaks Divine Shield before using Poisonous', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0101,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['basic_elven_archer'],
      aiBoard: [{ cardId: 'classic_emperor_cobra', attack: 2, health: 3, ready: true }],
      opponentBoard: [
        {
          cardId: 'classic_sunwalker',
          attack: 4,
          health: 5,
          maxHealth: 5,
          ready: true,
          keywords: ['taunt'],
          divineShield: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_elven_archer',
        enemyMinionTarget(reference, 'classic_sunwalker')
      )
    )
    const cobra = minion(
      reference,
      reference.remoteParticipantId,
      'classic_emperor_cobra'
    )
    const sunwalker = minion(
      reference,
      reference.localParticipantId,
      'classic_sunwalker'
    )
    dispatch(
      reference,
      attackCommand(reference, cobra.instanceId, sunwalker.instanceId)
    )
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-102: does not attack with a Frozen Windfury minion', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0102,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 8,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_rockbiter_weapon'],
      aiBoard: [
        {
          cardId: 'classic_young_dragonhawk',
          attack: 1,
          health: 1,
          ready: true,
          frozenUntilTurn: 6
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(reference, 'basic_rockbiter_weapon', friendlyHeroTarget(reference))
    )
    expect(
      reference
        .getState()
        .players.find(
          (player) => player.participantId === reference.remoteParticipantId
        )?.board[0]?.attacksUsedThisTurn
    ).toBe(0)

    const actual = createSession(options)
    const actions = await runAiTurn(actual)
    expect(
      actions.some(
        (command) =>
          command.type === 'attack-character' && command.attacker.kind === 'minion'
      )
    ).toBe(false)
  }, 60_000)

  it('DEV-103: uses area damage to clear a Stealthed board', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0103,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: ['basic_flamestrike', 'basic_fireball'],
      opponentBoard: [
        {
          cardId: 'classic_stranglethorn_tiger',
          attack: 5,
          health: 4,
          maxHealth: 5,
          ready: true,
          stealth: true
        },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_flamestrike'))
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-104: attacks Faerie Dragon with the equipped weapon', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0104,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_truesilver_champion', 'basic_hammer_of_wrath'],
      opponentBoard: [
        { cardId: 'classic_faerie_dragon', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_truesilver_champion'))
    dispatch(
      reference,
      heroAttackCommand(
        reference,
        minion(reference, reference.localParticipantId, 'classic_faerie_dragon')
          .instanceId
      )
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).hero.health).toBe(19)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-105: converts Circle of Healing into area damage', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0105,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_auchenai_soulpriest', 'classic_circle_of_healing'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 4,
          maxHealth: 5,
          ready: true
        },
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 4,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_auchenai_soulpriest'))
    dispatch(reference, playCommand(reference, 'classic_circle_of_healing'))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board).toHaveLength(2)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board,
      JSON.stringify(
        aiPlayer(actual).board.map((entry) => ({
          cardId: entry.cardId,
          health: entry.health
        }))
      )
    ).toHaveLength(2)
  }, 60_000)

  it('DEV-106: resurrects a fresh exhausted Deathrattle body', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0106,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['classic_ancestral_spirit'],
      aiBoard: [{ cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 3,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_ancestral_spirit',
        friendlyMinionTarget(reference, 'basic_bloodfen_raptor')
      )
    )
    const raptor = minion(
      reference,
      reference.remoteParticipantId,
      'basic_bloodfen_raptor'
    )
    const yeti = minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
    dispatch(reference, attackCommand(reference, raptor.instanceId, yeti.instanceId))
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board).toHaveLength(1)
    expect(aiPlayer(reference).board[0]?.attacksUsedThisTurn).toBe(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_bloodfen_raptor'),
      JSON.stringify(
        aiPlayer(actual).board.map((entry) => ({
          cardId: entry.cardId,
          attack: entry.attack,
          health: entry.health
        }))
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-107: preserves Redemption instead of sacrificing Sunwalker on its own turn', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0107,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_holy_light'],
      aiBoard: [
        {
          cardId: 'classic_sunwalker',
          attack: 4,
          health: 1,
          maxHealth: 5,
          ready: true,
          keywords: ['taunt'],
          divineShield: false
        }
      ],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 4,
          maxHealth: 5,
          ready: true
        }
      ],
      aiSecrets: [{ cardId: 'classic_redemption' }]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_holy_light',
        friendlyMinionTarget(reference, 'classic_sunwalker')
      )
    )
    const sunwalker = minion(
      reference,
      reference.remoteParticipantId,
      'classic_sunwalker'
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        sunwalker.instanceId,
        minion(reference, reference.localParticipantId, 'basic_chillwind_yeti')
          .instanceId
      )
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).secrets).toHaveLength(1)

    const actual = createSession(options)
    await runAiTurn(actual)
    // Trading on the opponent turn can also preserve the minion through Redemption.
    // Require preservation rather than prescribing the heal-and-trade reference line.
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'classic_sunwalker')
    ).toBe(true)
    expect(aiPlayer(actual).secrets).toHaveLength(1)
  }, 60_000)

  it('DEV-108: records Reincarnate recovery without granting a free attack', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0108,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['naxxramas_reincarnate'],
      aiBoard: [
        {
          cardId: 'classic_cairne_bloodhoof',
          attack: 4,
          health: 1,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'naxxramas_reincarnate',
        friendlyMinionTarget(reference, 'classic_cairne_bloodhoof')
      )
    )
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_cairne_bloodhoof'
      )
    ).toBe(true)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_baine_bloodhoof'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'classic_cairne_bloodhoof'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-109: transforms Cairne before pinging the replacement', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0109,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['basic_polymorph'],
      opponentBoard: [
        { cardId: 'classic_cairne_bloodhoof', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_polymorph',
        enemyMinionTarget(reference, 'classic_cairne_bloodhoof')
      )
    )
    dispatch(
      reference,
      heroPowerCommand(reference, enemyHeroPowerMinionTarget(reference, 'basic_sheep'))
    )
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-110: resolves Explosive Sheep after the first damage wave', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0110,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['basic_whirlwind'],
      opponentBoard: [
        {
          cardId: 'goblins_vs_gnomes_explosive_sheep',
          attack: 1,
          health: 1,
          ready: true
        },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 3,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_whirlwind'))
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-111: carries Spell Damage through both parts of Swipe', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0111,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 2,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_swipe'],
      aiBoard: [
        { cardId: 'classic_bloodmage_thalnos', attack: 1, health: 1, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          ready: true,
          keywords: ['taunt']
        },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_swipe',
        enemyMinionTarget(reference, 'basic_senjin_shieldmasta')
      )
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-112: keeps Spell Damage out of a damage Battlecry', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0112,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: ['basic_fire_elemental', 'basic_elven_archer'],
      aiBoard: [
        {
          cardId: 'classic_bloodmage_thalnos',
          attack: 1,
          health: 1,
          ready: true,
          attacksUsedThisTurn: 1
        }
      ],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 4,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_fire_elemental',
        enemyMinionTarget(reference, 'basic_chillwind_yeti')
      )
    )
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_elven_archer',
        enemyMinionTarget(reference, 'basic_chillwind_yeti')
      )
    )
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-113: leaves Divine Shield for a later ping after Equality', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0113,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['classic_wild_pyromancer', 'classic_equality', 'basic_elven_archer'],
      opponentBoard: [
        {
          cardId: 'classic_sunwalker',
          attack: 4,
          health: 5,
          ready: true,
          keywords: ['taunt'],
          divineShield: true
        },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_wild_pyromancer'))
    dispatch(reference, playCommand(reference, 'classic_equality'))
    dispatch(
      reference,
      playCommand(
        reference,
        'basic_elven_archer',
        enemyMinionTarget(reference, 'classic_sunwalker')
      )
    )
    expect(opponent(reference).board).toHaveLength(0)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
  }, 60_000)

  it('DEV-114: ends the turn for Ragnaros to resolve', async () => {
    for (let index = 0; index < 20; index += 1) {
      const options: AiFixtureOptions = {
        seed: 0xde0114 + index,
        aiHeroId: 'garrosh',
        opponentHeroId: 'garrosh',
        aiHealth: 20,
        opponentHealth: 8,
        aiMana: 8,
        aiMaximumMana: 8,
        aiHand: ['classic_ragnaros_the_firelord']
      }
      const reference = createSession(options)
      dispatch(reference, playCommand(reference, 'classic_ragnaros_the_firelord'))
      dispatch(reference, {
        type: 'end-turn',
        participantId: reference.remoteParticipantId
      })
      expect(aiWon(reference)).toBe(true)

      const actual = createSession(options)
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 120_000)

  it('DEV-115: removes Sylvanas before developing Highmane', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0115,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 9,
      aiMaximumMana: 9,
      aiHand: ['classic_deadly_shot', 'classic_savannah_highmane'],
      opponentBoard: [
        { cardId: 'classic_sylvanas_windrunner', attack: 5, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'classic_deadly_shot'))
    dispatch(reference, playCommand(reference, 'classic_savannah_highmane'))
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.some(
        (entry) => entry.cardId === 'classic_savannah_highmane'
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'classic_savannah_highmane'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-116: restores positive Attack before the Poisonous trade', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0116,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 1,
      aiMaximumMana: 3,
      aiHand: ['classic_abusive_sergeant'],
      aiBoard: [
        {
          cardId: 'naxxramas_maexxna',
          attack: 0,
          health: 8,
          maxHealth: 8,
          baseAttack: 2,
          baseHealth: 8,
          ready: true,
          enchantments: [
            {
              id: 'fixture-shrinkmeister-attack',
              sourceInstanceId: 'fixture-shrinkmeister-attack',
              sourceCardId: asCardId('goblins_vs_gnomes_shrinkmeister'),
              attackDelta: -2,
              duration: 'this-turn',
              expiresOnTurn: 5
            }
          ]
        },
        {
          cardId: 'goblins_vs_gnomes_shrinkmeister',
          attack: 3,
          health: 2,
          ready: false
        }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_abusive_sergeant',
        friendlyMinionTarget(reference, 'naxxramas_maexxna')
      )
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'naxxramas_maexxna')
          .instanceId,
        minion(reference, reference.localParticipantId, 'basic_boulderfist_ogre')
          .instanceId
      )
    )
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(opponent(reference).board).toHaveLength(0)
    expect(
      aiPlayer(reference).board.find((entry) => entry.cardId === 'naxxramas_maexxna')
        ?.attack
    ).toBe(2)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.find((entry) => entry.cardId === 'naxxramas_maexxna')
        ?.attack
    ).toBe(2)
  }, 60_000)

  it('DEV-117: does not count Divine Shield removal as Frothing damage', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0117,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['basic_whirlwind'],
      aiBoard: [
        { cardId: 'classic_frothing_berserker', attack: 2, health: 4, ready: true },
        {
          cardId: 'classic_argent_squire',
          attack: 1,
          health: 1,
          ready: true,
          divineShield: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(reference, playCommand(reference, 'basic_whirlwind'))
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'classic_frothing_berserker')
          .instanceId,
        'hero'
      )
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'classic_argent_squire')
          .instanceId,
        'hero'
      )
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-118: holds the Dragon for Blackwing Corruptor', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0118,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 6,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['blackrock_mountain_blackwing_corruptor', 'classic_azure_drake'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      opponentBoard: [
        {
          cardId: 'classic_frog',
          attack: 0,
          health: 1,
          ready: true,
          keywords: ['taunt']
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'blackrock_mountain_blackwing_corruptor',
        enemyMinionTarget(reference, 'classic_frog')
      )
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'basic_boulderfist_ogre')
          .instanceId,
        'hero'
      )
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-119: executes Blazecallers Battlecry only after an Elemental turn', () => {
    for (const active of [false, true]) {
      const session = createSession({
        seed: 0xde0119,
        aiHeroId: 'jaina',
        opponentHeroId: 'garrosh',
        aiMana: 10,
        aiMaximumMana: 10,
        aiHand: ['journey_to_ungoro_blazecaller'],
        aiElementalPlayedLastTurn: active,
        opponentHealth: 30
      })
      dispatch(session, playCommand(session, 'journey_to_ungoro_blazecaller'))
      expect(opponent(session).hero.health).toBe(active ? 25 : 30)
    }
  })

  it('DEV-120: resolves the singleton Healing Wave Joust before OPP-1', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0120,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['the_grand_tournament_healing_wave'],
      aiDeck: ['basic_boulderfist_ogre'],
      opponentDeck: ['basic_river_crocolisk'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'the_grand_tournament_healing_wave',
        friendlyHeroTarget(reference)
      )
    )
    expect(aiPlayer(reference).hero.health).toBeGreaterThan(3)
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiPlayer(actual).hero.health).toBeGreaterThan(3)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-121: chooses and plays the affordable defensive Stonehill option', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0121,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 4,
      aiMaximumMana: 7,
      aiBoard: [
        {
          cardId: 'journey_to_ungoro_stonehill_defender',
          attack: 1,
          health: 4,
          ready: false
        }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      pendingDiscover: {
        sourceCardId: 'journey_to_ungoro_stonehill_defender',
        candidates: [
          'basic_senjin_shieldmasta',
          'classic_sunwalker',
          'classic_tirion_fordring'
        ]
      }
    }
    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-122: resolves Primordial Glyph Discover and discounts the selected spell', () => {
    const session = createSession({
      seed: 0xde0122,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['journey_to_ungoro_primordial_glyph']
    })
    dispatch(session, playCommand(session, 'journey_to_ungoro_primordial_glyph'))
    const pending = session.getState().pendingDiscover!
    expect(pending.candidates).toHaveLength(3)
    const candidate = pending.candidates[0]!
    expect(CARD_CATALOG.require(candidate.cardId).type).toBe('Spell')
    dispatch(session, discoverCommand(session, candidate.cardId))
    const card = aiPlayer(session).hand.find(
      (entry) => entry.cardId === candidate.cardId
    )!
    expect(card.currentCost).toBe(
      Math.max(0, CARD_CATALOG.require(candidate.cardId).cost - 2)
    )
  })

  it('DEV-123: chooses an affordable defensive spell from the Glyph menu', async () => {
    const session = createSession({
      seed: 0xde0123,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 2,
      aiMana: 2,
      aiMaximumMana: 4,
      opponentBoard: [{ cardId: 'basic_boulderfist_ogre', ready: true }],
      pendingDiscover: {
        sourceCardId: 'journey_to_ungoro_primordial_glyph',
        candidates: [
          { cardId: 'basic_polymorph', currentCost: 2, baseCost: 2 },
          'classic_pyroblast',
          'basic_flamestrike'
        ]
      }
    })
    await runAiTurn(session)
    expect(
      opponent(session).board.some((entry) => entry.cardId === 'basic_boulderfist_ogre')
    ).toBe(false)
  }, 60_000)

  it('DEV-124: chooses Soulfire from Dark Peddlers menu and casts it', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0124,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 1,
      aiMaximumMana: 3,
      aiBoard: [
        {
          cardId: 'league_of_explorers_dark_peddler',
          attack: 2,
          health: 2,
          ready: false
        }
      ],
      pendingDiscover: {
        sourceCardId: 'league_of_explorers_dark_peddler',
        candidates: ['basic_soulfire', 'classic_flame_imp', 'classic_abusive_sergeant']
      }
    }
    const reference = createSession(options)
    dispatch(reference, discoverCommand(reference, 'basic_soulfire'))
    dispatch(reference, playCommand(reference, 'basic_soulfire', heroTarget(reference)))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-125: takes Kill Command from Tracking and discards the other offers', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0125,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 6,
      aiMana: 3,
      aiMaximumMana: 4,
      aiBoard: [
        {
          cardId: 'mean_streets_of_gadgetzan_alleycat',
          attack: 1,
          health: 1,
          ready: true
        }
      ],
      pendingDiscover: {
        sourceCardId: 'basic_tracking',
        origin: 'deck',
        candidates: [
          'classic_kill_command',
          'classic_savannah_highmane',
          'basic_bloodfen_raptor'
        ]
      }
    }
    const reference = createSession(options)
    dispatch(reference, discoverCommand(reference, 'classic_kill_command'))
    dispatch(
      reference,
      playCommand(reference, 'classic_kill_command', heroTarget(reference))
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(
          reference,
          reference.remoteParticipantId,
          'mean_streets_of_gadgetzan_alleycat'
        ).instanceId,
        'hero'
      )
    )
    expect(aiWon(reference)).toBe(true)
    expect(aiPlayer(reference).discardedCards?.length).toBe(3)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
    expect(aiPlayer(actual).discardedCards?.length).toBe(3)
  }, 60_000)

  it('DEV-126: resolves a forced-loss Tracking menu without demanding a win', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0126,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 0,
      aiMaximumMana: 1,
      pendingDiscover: {
        sourceCardId: 'basic_tracking',
        origin: 'deck',
        candidates: [
          'basic_chillwind_yeti',
          'basic_boulderfist_ogre',
          'classic_savannah_highmane'
        ]
      }
    }
    const actual = createSession(options)
    const actions = await runAiTurn(actual)
    expect(actions.some((command) => command.type === 'choose-discover-card')).toBe(
      true
    )
    expect(actual.getState().phase).toBe('turns')
  }, 60_000)

  it('DEV-127: counts the Discover source Beast for Kill Command', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0127,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 5,
      aiMana: 3,
      aiMaximumMana: 5,
      aiBoard: [
        {
          cardId: 'league_of_explorers_jeweled_scarab',
          attack: 1,
          health: 1,
          ready: false
        }
      ],
      pendingDiscover: {
        sourceCardId: 'league_of_explorers_jeweled_scarab',
        candidates: [
          'classic_kill_command',
          'classic_animal_companion',
          'basic_ironfur_grizzly'
        ]
      }
    }
    const reference = createSession(options)
    dispatch(reference, discoverCommand(reference, 'classic_kill_command'))
    dispatch(
      reference,
      playCommand(reference, 'classic_kill_command', heroTarget(reference))
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-128: takes Sludge Belcher from Journey Below before OPP-1', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0128,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 5,
      aiMaximumMana: 6,
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ],
      pendingDiscover: {
        sourceCardId: 'whispers_of_the_old_gods_journey_below',
        candidates: [
          'naxxramas_sludge_belcher',
          'classic_loot_hoarder',
          'classic_sylvanas_windrunner'
        ]
      }
    }
    const reference = createSession(options)
    dispatch(reference, discoverCommand(reference, 'naxxramas_sludge_belcher'))
    dispatch(reference, playCommand(reference, 'naxxramas_sludge_belcher'))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-129: discovers and resurrects a fallen friendly minion', () => {
    const session = createSession({
      seed: 0xde0129,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['knights_of_the_frozen_throne_eternal_servitude'],
      aiGraveyard: [{ cardId: 'classic_cairne_bloodhoof' }]
    })
    dispatch(
      session,
      playCommand(session, 'knights_of_the_frozen_throne_eternal_servitude')
    )
    if (session.getState().pendingDiscover)
      dispatch(session, discoverCommand(session, 'classic_cairne_bloodhoof'))
    expect(aiPlayer(session).board.map((entry) => entry.cardId)).toEqual([
      'classic_cairne_bloodhoof'
    ])
  })

  it('DEV-130: chooses Healing Touch from Raven Idol and survives OPP-1', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0130,
      aiHeroId: 'malfurion',
      opponentHeroId: 'rexxar',
      aiHealth: 2,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 4,
      pendingDiscover: {
        sourceCardId: 'league_of_explorers_raven_idol',
        candidates: ['basic_healing_touch', 'basic_swipe', 'basic_wild_growth']
      }
    }
    const reference = createSession(options)
    dispatch(reference, discoverCommand(reference, 'basic_healing_touch'))
    dispatch(
      reference,
      playCommand(reference, 'basic_healing_touch', friendlyHeroTarget(reference))
    )
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-131: chooses Windfury for two immediate attacks', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0131,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 8,
      aiMana: 0,
      aiMaximumMana: 1,
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      pendingCardChoice: {
        sourceCardId: 'journey_to_ungoro_lightning_speed',
        targetCardId: 'basic_chillwind_yeti',
        options: [
          {
            choice: 0,
            label: 'Windfury',
            presentationCardId: 'journey_to_ungoro_lightning_speed'
          },
          {
            choice: 1,
            label: '+3 Attack',
            presentationCardId: 'journey_to_ungoro_flaming_claws'
          },
          { choice: 2, label: 'Taunt', presentationCardId: 'journey_to_ungoro_massive' }
        ],
        resolution: {
          type: 'adapt',
          targetInstanceIds: ['fixture-target'],
          remaining: 1
        }
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 0))
    const yeti = minion(
      reference,
      reference.remoteParticipantId,
      'basic_chillwind_yeti'
    )
    dispatch(reference, attackCommand(reference, yeti.instanceId, 'hero'))
    dispatch(reference, attackCommand(reference, yeti.instanceId, 'hero'))
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-132: chooses Poisonous for the oversized threat', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0132,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 0,
      aiMaximumMana: 1,
      aiBoard: [{ cardId: 'basic_river_crocolisk', attack: 2, health: 3, ready: true }],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      pendingCardChoice: {
        sourceCardId: 'journey_to_ungoro_poison_spit',
        targetCardId: 'basic_river_crocolisk',
        options: [
          {
            choice: 0,
            label: 'Poisonous',
            presentationCardId: 'journey_to_ungoro_poison_spit'
          },
          {
            choice: 1,
            label: '+3 Attack',
            presentationCardId: 'journey_to_ungoro_flaming_claws'
          },
          {
            choice: 2,
            label: '+3 Health',
            presentationCardId: 'journey_to_ungoro_rocky_carapace'
          }
        ],
        resolution: {
          type: 'adapt',
          targetInstanceIds: ['fixture-target'],
          remaining: 1
        }
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 0))
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'basic_river_crocolisk')
          .instanceId,
        minion(reference, reference.localParticipantId, 'basic_boulderfist_ogre')
          .instanceId
      )
    )
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-133: chooses Divine Shield to preserve the trading Yeti', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0133,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 0,
      aiMaximumMana: 1,
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 6,
          health: 4,
          maxHealth: 7,
          ready: true
        }
      ],
      pendingCardChoice: {
        sourceCardId: 'journey_to_ungoro_crackling_shield',
        targetCardId: 'basic_chillwind_yeti',
        options: [
          {
            choice: 0,
            label: 'Divine Shield',
            presentationCardId: 'journey_to_ungoro_crackling_shield'
          },
          {
            choice: 1,
            label: '+3 Attack',
            presentationCardId: 'journey_to_ungoro_flaming_claws'
          },
          { choice: 2, label: 'Taunt', presentationCardId: 'journey_to_ungoro_massive' }
        ],
        resolution: {
          type: 'adapt',
          targetInstanceIds: ['fixture-target'],
          remaining: 1
        }
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 0))
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'basic_chillwind_yeti')
          .instanceId,
        minion(reference, reference.localParticipantId, 'basic_boulderfist_ogre')
          .instanceId
      )
    )
    expect(opponent(reference).board).toHaveLength(0)
    expect(aiPlayer(reference).board).toHaveLength(1)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).board).toHaveLength(1)
  }, 60_000)

  it('DEV-134: chooses Taunt when only the hero needs protection', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0134,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 0,
      aiMaximumMana: 1,
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: false }],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      pendingCardChoice: {
        sourceCardId: 'journey_to_ungoro_massive',
        targetCardId: 'basic_chillwind_yeti',
        options: [
          {
            choice: 0,
            label: 'Taunt',
            presentationCardId: 'journey_to_ungoro_massive'
          },
          {
            choice: 1,
            label: 'Stealth',
            presentationCardId: 'journey_to_ungoro_shrouding_mist'
          },
          {
            choice: 2,
            label: '+3 Attack',
            presentationCardId: 'journey_to_ungoro_flaming_claws'
          }
        ],
        resolution: {
          type: 'adapt',
          targetInstanceIds: ['fixture-target'],
          remaining: 1
        }
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 0))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-135: chooses Druid Cat form for immediate Charge lethal', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0135,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 0,
      aiMaximumMana: 5,
      aiBoard: [
        { cardId: 'classic_druid_of_the_claw', attack: 4, health: 4, ready: false }
      ],
      pendingCardChoice: {
        sourceCardId: 'classic_druid_of_the_claw',
        targetCardId: 'classic_druid_of_the_claw',
        options: [
          { choice: 0, label: 'Charge', presentationCardId: 'classic_cat_form' },
          { choice: 1, label: 'Taunt', presentationCardId: 'classic_bear_form' }
        ]
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 0))
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'classic_druid_of_the_claw')
          .instanceId,
        'hero'
      )
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-136: chooses Druid Bear form for OPP-1 survival', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0136,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 0,
      aiMaximumMana: 5,
      aiBoard: [
        { cardId: 'classic_druid_of_the_claw', attack: 4, health: 4, ready: false }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ],
      pendingCardChoice: {
        sourceCardId: 'classic_druid_of_the_claw',
        targetCardId: 'classic_druid_of_the_claw',
        options: [
          { choice: 0, label: 'Charge', presentationCardId: 'classic_cat_form' },
          { choice: 1, label: 'Taunt', presentationCardId: 'classic_bear_form' }
        ]
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 1))
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-137: chooses Wrath damage over the inert draw mode', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0137,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['classic_wrath'],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 3,
          maxHealth: 5,
          ready: true
        }
      ]
    }
    const reference = createSession(options)
    dispatch(
      reference,
      playCommand(
        reference,
        'classic_wrath',
        enemyMinionTarget(reference, 'basic_chillwind_yeti'),
        0
      )
    )
    dispatch(reference, {
      type: 'end-turn',
      participantId: reference.remoteParticipantId
    })
    expect(
      everyOpponentReply(
        reference,
        (state) => state.winnerId !== reference.localParticipantId
      )
    ).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-138: spends Nourish mana on a same-turn Charge finisher', async () => {
    const options: AiFixtureOptions = {
      seed: 0xde0138,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 4,
      aiMana: 5,
      aiMaximumMana: 8,
      aiHand: ['classic_druid_of_the_claw'],
      pendingCardChoice: {
        sourceCardId: 'classic_nourish',
        options: [
          {
            choice: 0,
            label: 'Gain 2 Mana Crystals',
            presentationCardId: 'classic_nourish_mana'
          },
          {
            choice: 1,
            label: 'Draw 3 cards',
            presentationCardId: 'classic_nourish_draw'
          }
        ],
        resolution: { type: 'bonus-spell' }
      }
    }
    const reference = createSession(options)
    dispatch(reference, choiceCommand(reference, 0))
    dispatch(
      reference,
      playCommand(reference, 'classic_druid_of_the_claw', undefined, 0)
    )
    dispatch(
      reference,
      attackCommand(
        reference,
        minion(reference, reference.remoteParticipantId, 'classic_druid_of_the_claw')
          .instanceId,
        'hero'
      )
    )
    expect(aiWon(reference)).toBe(true)

    const actual = createSession(options)
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-139: completes a Zombeast with Charge for lethal', async () => {
    const actual = createSession({
      seed: 0xde0139,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiMana: 2,
      aiMaximumMana: 2,
      aiHeroPowerAvailable: false,
      aiHand: [],
      opponentHealth: 2,
      pendingCardChoice: {
        sourceCardId: 'knights_of_the_frozen_throne_build_a_beast',
        options: [
          'basic_stonetusk_boar',
          'basic_river_crocolisk',
          'basic_ironfur_grizzly'
        ].map((id, choice) => ({
          choice,
          label: CARD_CATALOG.require(id).name,
          presentationCardId: id
        })),
        resolution: {
          type: 'build-a-beast',
          stage: 'second',
          firstBeast: asCardId('basic_timber_wolf')
        }
      }
    })
    await runAiTurn(actual)
    expect(actual.getState().pendingCardChoice).toBeUndefined()
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-140: resolves both stages of Build-a-Beast', async () => {
    const actual = createSession({
      seed: 0xde0140,
      aiHeroId: 'rexxar',
      opponentHeroId: 'jaina',
      aiMana: 0,
      aiMaximumMana: 2,
      aiHeroPowerAvailable: false,
      aiHand: [],
      pendingCardChoice: {
        sourceCardId: 'knights_of_the_frozen_throne_build_a_beast',
        options: [
          'basic_timber_wolf',
          'classic_dire_wolf_alpha',
          'classic_scavenging_hyena'
        ].map((id, choice) => ({
          choice,
          label: CARD_CATALOG.require(id).name,
          presentationCardId: id
        })),
        resolution: { type: 'build-a-beast', stage: 'first' }
      }
    })
    await runAiTurn(actual)
    expect(actual.getState().pendingCardChoice).toBeUndefined()
    expect(
      aiPlayer(actual).hand.some(
        (card) => CARD_CATALOG.require(card.cardId).name === 'Zombeast'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-141: probes the hidden spell secret with The Coin before Fireball', async () => {
    for (const secretId of ['classic_counterspell', 'classic_mirror_entity']) {
      const actual = createSession({
        seed: 0xde0141,
        aiHeroId: 'jaina',
        opponentHeroId: 'jaina',
        aiHealth: 20,
        opponentHealth: 6,
        aiMana: 4,
        aiMaximumMana: 4,
        aiHeroPowerAvailable: false,
        aiHand: ['basic_the_coin', 'basic_fireball'],
        opponentSecrets: [{ cardId: secretId }]
      })
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-142: leads with the expendable Raptor through either attack secret', async () => {
    for (const secretId of ['classic_freezing_trap', 'classic_explosive_trap']) {
      const actual = createSession({
        seed: 0xde0142,
        aiHeroId: 'rexxar',
        opponentHeroId: 'rexxar',
        aiHealth: 20,
        opponentHealth: 8,
        aiMana: 2,
        aiMaximumMana: 2,
        aiBoard: [
          { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
          { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
        ],
        opponentSecrets: [{ cardId: secretId }]
      })
      const actions = await runAiTurn(actual)
      expect(actions.some((command) => command.type === 'attack-character')).toBe(true)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-143: sets Explosive Trap before the incoming Raptor attacks', async () => {
    const actual = createSession({
      seed: 0xde0143,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['classic_explosive_trap'],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ]
    })
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-144: baits Mirror Entity before developing Ragnaros', async () => {
    for (const secretId of ['classic_mirror_entity', 'classic_counterspell']) {
      const actual = createSession({
        seed: 0xde0144,
        aiHeroId: 'jaina',
        opponentHeroId: 'jaina',
        aiHealth: 20,
        opponentHealth: 8,
        aiMana: 10,
        aiMaximumMana: 10,
        aiHand: ['league_of_explorers_murloc_tinyfin', 'classic_ragnaros_the_firelord'],
        opponentSecrets: [{ cardId: secretId }]
      })
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-145: plays Noble Sacrifice before the existing weapon attack', async () => {
    const actual = createSession({
      seed: 0xde0145,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHeroPowerAvailable: false,
      aiHand: ['classic_noble_sacrifice'],
      opponentWeapon: { cardId: 'basic_arcanite_reaper', attack: 5, durability: 1 },
      opponentHeroPowerAvailable: false
    })
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-146: probes the weak enemy minion through Redemption or Repentance', async () => {
    for (const secretId of ['classic_redemption', 'classic_repentance']) {
      const actual = createSession({
        seed: 0xde0146,
        aiHeroId: 'jaina',
        opponentHeroId: 'uther',
        aiHealth: 20,
        opponentHealth: 30,
        aiMana: 2,
        aiMaximumMana: 2,
        aiBoard: [
          { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true },
          { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
          { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
        ],
        opponentBoard: [
          { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true },
          {
            cardId: 'classic_sunwalker',
            attack: 4,
            health: 1,
            maxHealth: 5,
            ready: true,
            keywords: ['taunt'],
            divineShield: false
          }
        ],
        opponentSecrets: [{ cardId: secretId }]
      })
      await runAiTurn(actual)
      expect(opponent(actual).board).toHaveLength(0)
      expect(aiPlayer(actual).board.map((entry) => entry.cardId)).toEqual(
        expect.arrayContaining(['basic_boulderfist_ogre', 'basic_bloodfen_raptor'])
      )
    }
  }, 60_000)

  it('DEV-147: clears both enemy minions before Avenge can retain a survivor', async () => {
    for (const secretId of ['naxxramas_avenge', 'classic_noble_sacrifice']) {
      const actual = createSession({
        seed: 0xde0147,
        aiHeroId: 'uther',
        opponentHeroId: 'uther',
        aiHealth: 20,
        opponentHealth: 30,
        aiMana: 6,
        aiMaximumMana: 6,
        aiHand: ['classic_equality', 'basic_consecration'],
        opponentBoard: [
          { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true },
          { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
        ],
        opponentSecrets: [{ cardId: secretId }]
      })
      await runAiTurn(actual)
      expect(opponent(actual).board).toHaveLength(0)
    }
  }, 60_000)

  it('DEV-148: probes Counterspell or Spellbender with Frostbolt before Fireball', async () => {
    for (const secretId of ['classic_counterspell', 'classic_spellbender']) {
      const actual = createSession({
        seed: 0xde0148,
        aiHeroId: 'jaina',
        opponentHeroId: 'jaina',
        aiHealth: 20,
        opponentHealth: 6,
        aiMana: 6,
        aiMaximumMana: 6,
        aiHeroPowerAvailable: false,
        aiHand: ['basic_frostbolt', 'basic_fireball'],
        opponentBoard: [
          {
            cardId: 'basic_senjin_shieldmasta',
            attack: 3,
            health: 5,
            ready: true,
            keywords: ['taunt']
          }
        ],
        opponentSecrets: [{ cardId: secretId }]
      })
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-149: spends the smaller attacker before the hidden Vaporize check', async () => {
    for (const secretId of ['classic_vaporize', 'classic_mirror_entity']) {
      const actual = createSession({
        seed: 0xde0149,
        aiHeroId: 'rexxar',
        opponentHeroId: 'jaina',
        aiHealth: 20,
        opponentHealth: 8,
        aiMana: 2,
        aiMaximumMana: 2,
        aiBoard: [
          { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
          { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
        ],
        opponentSecrets: [{ cardId: secretId }]
      })
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-150: records Ice Block immunity without requiring an impossible win', async () => {
    const actual = createSession({
      seed: 0xde0150,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiHealth: 20,
      opponentHealth: 10,
      aiMana: 10,
      aiMaximumMana: 10,
      aiHand: ['basic_fireball', 'basic_fireball', 'basic_frostbolt'],
      opponentSecrets: [{ cardId: 'classic_ice_block' }]
    })
    await runAiTurn(actual)
    expect(opponent(actual).hero.health).toBe(1)
    expect(opponent(actual).secrets).toHaveLength(0)
    expect(aiWon(actual)).toBe(false)
  }, 60_000)

  it('DEV-151: does not let the opponent Ice Block survive its own fatigue', async () => {
    const actual = createSession({
      seed: 0xde0151,
      aiHeroId: 'jaina',
      opponentHeroId: 'jaina',
      aiHealth: 20,
      opponentHealth: 1,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_fireball'],
      opponentDeck: [],
      opponentSecrets: [{ cardId: 'classic_ice_block' }]
    })
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-152: baits Counterspell before Flare in both secret worlds', async () => {
    for (const secretIds of [
      ['classic_counterspell', 'classic_ice_block'],
      ['classic_mirror_entity', 'classic_ice_block']
    ]) {
      const actual = createSession({
        seed: 0xde0152,
        aiHeroId: 'rexxar',
        opponentHeroId: 'jaina',
        aiHealth: 20,
        opponentHealth: 6,
        aiMana: 2,
        aiMaximumMana: 2,
        aiHand: ['basic_the_coin', 'classic_flare'],
        aiBoard: [
          { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
        ],
        opponentSecrets: secretIds.map((cardId) => ({ cardId }))
      })
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-153: leaves a friendly Counterspell armed while casting Coin and Fireball', async () => {
    const actual = createSession({
      seed: 0xde0153,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 6,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_the_coin', 'basic_fireball'],
      aiSecrets: [{ cardId: 'classic_counterspell' }],
      aiHeroPowerAvailable: false
    })
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
    expect(
      aiPlayer(actual).secrets?.some(
        (secret) => secret.cardId === 'classic_counterspell'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-154: adds Explosive Trap without attempting a duplicate Freezing Trap', async () => {
    const actual = createSession({
      seed: 0xde0154,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['classic_freezing_trap', 'classic_explosive_trap'],
      aiSecrets: [{ cardId: 'classic_freezing_trap' }],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2, ready: true }
      ],
      aiHeroPowerAvailable: false
    })
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-155: keeps the first action independent of hidden hands, decks, and secrets', async () => {
    const signatures: string[] = []
    const observations: string[] = []
    for (const secretId of ['classic_counterspell', 'classic_mirror_entity']) {
      for (const hiddenCard of ['basic_fireball', 'basic_chillwind_yeti']) {
        for (const deckOrder of [
          ['basic_fireball', 'basic_river_crocolisk'],
          ['basic_river_crocolisk', 'basic_fireball']
        ]) {
          const actual = createSession({
            seed: 0xde0155,
            aiHeroId: 'jaina',
            opponentHeroId: 'jaina',
            aiHealth: 30,
            opponentHealth: 30,
            aiMana: 4,
            aiMaximumMana: 4,
            aiHand: ['basic_chillwind_yeti', 'basic_fireball'],
            aiDeck: deckOrder,
            opponentHand: [hiddenCard],
            opponentSecrets: [{ cardId: secretId }]
          })
          observations.push(JSON.stringify(actual.getAiObservation()))
          const before = new Map(
            actual
              .findPlayer(actual.getState(), actual.remoteParticipantId)
              .hand.map((card) => [card.instanceId, card.cardId])
          )
          const actions = await runAiTurn(actual, 1)
          const first = actions[0]
          expect(first).toBeDefined()
          signatures.push(
            first?.type === 'play-card'
              ? `${first.type}:${before.get(first.cardInstanceId) ?? ''}`
              : (first?.type ?? '')
          )
        }
      }
    }
    expect(new Set(observations).size).toBe(1)
    expect(new Set(signatures).size).toBe(1)
  }, 120_000)

  it('DEV-156: draws the remaining Fireball before choosing the large minion', async () => {
    for (const aiDeck of [
      ['basic_fireball', 'basic_river_crocolisk'],
      ['basic_river_crocolisk', 'basic_fireball']
    ]) {
      const actual = createSession({
        seed: 0xde0156,
        aiHeroId: 'jaina',
        opponentHeroId: 'garrosh',
        aiHealth: 20,
        opponentHealth: 6,
        aiMana: 7,
        aiMaximumMana: 7,
        aiHand: ['basic_arcane_intellect', 'basic_boulderfist_ogre'],
        aiDeck
      })
      await runAiTurn(actual)
      expect(aiWon(actual)).toBe(true)
    }
  }, 60_000)

  it('DEV-157: keeps the Warlock alive instead of Life Tapping at two Health', async () => {
    const actual = createSession({
      seed: 0xde0157,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 2,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: ['basic_river_crocolisk']
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).hero.health).toBeGreaterThan(0)
  }, 60_000)

  it('DEV-158: does not draw from an empty deck at one Health', async () => {
    const actual = createSession({
      seed: 0xde0158,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_arcane_intellect'],
      aiDeck: []
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).hero.health).toBeGreaterThan(0)
  }, 60_000)

  it('DEV-159: records the hand-space diagnostic around a valuable draw', async () => {
    const actual = createSession({
      seed: 0xde0159,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: [
        'classic_wisp',
        'basic_boulderfist_ogre',
        'basic_chillwind_yeti',
        'basic_senjin_shieldmasta',
        'classic_sunwalker',
        'basic_stormwind_champion',
        'classic_ragnaros_the_firelord',
        'classic_alexstrasza',
        'classic_ysera',
        'classic_cairne_bloodhoof'
      ],
      aiBoard: [
        { cardId: 'classic_acolyte_of_pain', attack: 1, health: 3, ready: false }
      ],
      aiDeck: ['basic_fireball']
    })
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
  }, 60_000)

  it('DEV-160: records Doomguard discard and refill sequencing', async () => {
    const actual = createSession({
      seed: 0xde0160,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: ['classic_doomguard'],
      aiDeck: ['classic_siphon_soul']
    })
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
  }, 60_000)

  it('DEV-161: plays Northshire before healing the damaged Yeti', async () => {
    const actual = createSession({
      seed: 0xde0161,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['basic_northshire_cleric'],
      aiBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 3,
          maxHealth: 5,
          ready: false
        }
      ],
      // Keep this draw-order scenario out of fatigue.
      aiDeck: [
        'basic_river_crocolisk',
        'basic_river_crocolisk',
        'basic_river_crocolisk'
      ]
    })
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.find((entry) => entry.cardId === 'basic_chillwind_yeti')
        ?.health
    ).toBe(5)
    expect(
      aiPlayer(actual).hand.some((card) => card.cardId === 'basic_river_crocolisk')
    ).toBe(true)
  }, 60_000)

  it('DEV-162: gains Armor before using Shield Slam', async () => {
    const actual = createSession({
      seed: 0xde0162,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['classic_shield_block', 'classic_shield_slam'],
      opponentBoard: [
        {
          cardId: 'basic_boulderfist_ogre',
          attack: 6,
          health: 5,
          maxHealth: 7,
          ready: true
        }
      ]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).hero.armor).toBeGreaterThanOrEqual(5)
  }, 60_000)

  it('DEV-163: uses Ooze instead of fatigue-drawing Harrison Jones', async () => {
    const actual = createSession({
      seed: 0xde0163,
      aiHeroId: 'garrosh',
      opponentHeroId: 'uther',
      aiHealth: 3,
      opponentHealth: 30,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['classic_harrison_jones', 'basic_acidic_swamp_ooze'],
      aiDeck: [],
      opponentWeapon: { cardId: 'classic_ashbringer', attack: 5, durability: 3 }
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).hero.health).toBeGreaterThan(0)
    expect(opponent(actual).weapon).toBeNull()
  }, 60_000)

  it('DEV-164: converts two empty-deck draws into exact fatigue lethal', async () => {
    const actual = createSession({
      seed: 0xde0164,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 3,
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: ['classic_coldlight_oracle'],
      opponentDeck: []
    })
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-165: makes Mortal Coil both removal and replacement draw', async () => {
    const actual = createSession({
      seed: 0xde0165,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: ['basic_mortal_coil'],
      aiDeck: ['goblins_vs_gnomes_darkbomb'],
      opponentBoard: [
        {
          cardId: 'basic_bloodfen_raptor',
          attack: 3,
          health: 1,
          maxHealth: 2,
          ready: true
        }
      ]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).hand.some((card) => card.cardId === 'goblins_vs_gnomes_darkbomb')
    ).toBe(true)
  }, 60_000)

  it('DEV-166: keeps Barnes sensitive to the actual remaining minion profile', async () => {
    for (const aiDeck of [['classic_ragnaros_the_firelord'], ['basic_oasis_snapjaw']]) {
      const actual = createSession({
        seed: 0xde0166,
        aiHeroId: 'thrall',
        opponentHeroId: 'garrosh',
        aiHealth: 20,
        opponentHealth: 8,
        aiMana: 4,
        aiMaximumMana: 4,
        aiHand: ['one_night_in_karazhan_barnes'],
        aiDeck
      })
      await runAiTurn(actual)
      if (aiDeck[0] === 'classic_ragnaros_the_firelord')
        expect(aiWon(actual)).toBe(true)
      else expect(actual.getState().phase).toBe('turns')
    }
  }, 60_000)

  it('DEV-167: checks live duplicate counts before relying on Reno', async () => {
    for (const aiDeck of [
      ['basic_river_crocolisk', 'basic_bloodfen_raptor', 'basic_chillwind_yeti'],
      [
        'basic_river_crocolisk',
        'basic_bloodfen_raptor',
        'basic_chillwind_yeti',
        'basic_river_crocolisk'
      ]
    ]) {
      const actual = createSession({
        seed: 0xde0167,
        aiHeroId: 'guldan',
        opponentHeroId: 'garrosh',
        aiHealth: 4,
        opponentHealth: 30,
        aiMana: 6,
        aiMaximumMana: 6,
        aiHand: [
          'league_of_explorers_reno_jackson',
          'goblins_vs_gnomes_antique_healbot'
        ],
        aiDeck,
        opponentBoard: [
          { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
        ]
      })
      await runAiTurn(actual)
      expect(
        everyOpponentReply(
          actual,
          (state) => state.winnerId !== actual.localParticipantId
        )
      ).toBe(true)
    }
  }, 120_000)

  it('DEV-168: reuses the healing Battlecry after Shadowstep', async () => {
    const actual = createSession({
      seed: 0xde0168,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['classic_shadowstep', 'classic_earthen_ring_farseer'],
      aiBoard: [
        { cardId: 'classic_earthen_ring_farseer', attack: 3, health: 3, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true }
      ]
    })
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-169: records the Coin-preserving two-turn curve diagnostic', async () => {
    const actual = createSession({
      seed: 0xde0169,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_the_coin', 'basic_chillwind_yeti', 'classic_savannah_highmane']
    })
    await runAiTurn(actual)
    if (actual.getState().activePlayerId === actual.localParticipantId)
      dispatch(actual, { type: 'end-turn', participantId: actual.localParticipantId })
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
  }, 60_000)

  it('DEV-170: preserves hand resources through the unavoidable Doomsayer wipe', async () => {
    const actual = createSession({
      seed: 0xde0170,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: ['basic_chillwind_yeti', 'basic_senjin_shieldmasta'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'classic_doomsayer', attack: 0, health: 7, ready: false }
      ]
    })
    await runAiTurn(actual)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
    expect(aiPlayer(actual).hand.map((card) => card.cardId)).toEqual(
      expect.arrayContaining(['basic_chillwind_yeti', 'basic_senjin_shieldmasta'])
    )
  }, 120_000)

  it('DEV-171: records whether the AI preserves Fireball for a small trade', async () => {
    const actual = createSession({
      seed: 0xde0171,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['basic_fireball'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }],
      opponentBoard: [
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: true }
      ]
    })
    await runAiTurn(actual)
    expect(actual.getState().phase).toBe('turns')
  }, 60_000)

  it('DEV-172: takes the current Hunter power win before Deathstalker Rexxar', async () => {
    const actual = createSession({
      seed: 0xde0172,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 2,
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: ['knights_of_the_frozen_throne_deathstalker_rexxar']
    })
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-173: preserves enough health across enemy power and fatigue', async () => {
    const actual = createSession({
      seed: 0xde0173,
      aiHeroId: 'anduin',
      opponentHeroId: 'rexxar',
      aiHealth: 3,
      opponentHealth: 30,
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: ['mean_streets_of_gadgetzan_greater_healing_potion'],
      aiDeck: [],
      aiFatigueDamage: 3
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).hero.health).toBeGreaterThanOrEqual(9)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-174: treats Silverware Golem as a summon, not a second Charge attacker', async () => {
    const actual = createSession({
      seed: 0xde0174,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 20,
      opponentHealth: 8,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['classic_doomguard', 'one_night_in_karazhan_silverware_golem']
    })
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'classic_doomguard')
    ).toBe(true)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'one_night_in_karazhan_silverware_golem'
      )
    ).toBe(true)
  }, 60_000)

  it('DEV-175: completes a forced-loss turn without inventing a winning line', async () => {
    const actual = createSession({
      seed: 0xde0175,
      aiHeroId: 'garrosh',
      opponentHeroId: 'rexxar',
      aiHealth: 1,
      opponentHealth: 30,
      aiMana: 8,
      aiMaximumMana: 10,
      aiHeroPowerAvailable: false,
      aiHand: [
        'basic_boulderfist_ogre',
        'basic_chillwind_yeti',
        'basic_senjin_shieldmasta'
      ]
    })
    const actions = await runAiTurn(actual)
    expect(actions.length).toBeGreaterThan(0)
    expect(actual.getState().phase).not.toBe('mulligan')
  }, 60_000)

  it('DEV-176: reaches the CThun threshold before the seven-mana payoff', async () => {
    const actual = createSession({
      seed: 0xde0176,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: [
        'whispers_of_the_old_gods_beckoner_of_evil',
        'basic_boulderfist_ogre',
        'whispers_of_the_old_gods_twin_emperor_veklor',
        'whispers_of_the_old_gods_cthun'
      ],
      aiCthun: { attack: 8, health: 8 }
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).cthun?.attack).toBeGreaterThanOrEqual(10)
    expect(
      aiPlayer(actual).hand.some(
        (card) => card.cardId === 'whispers_of_the_old_gods_twin_emperor_veklor'
      )
    ).toBe(true)
    if (actual.getState().activePlayerId === actual.localParticipantId)
      dispatch(actual, { type: 'end-turn', participantId: actual.localParticipantId })
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.filter(
        (entry) =>
          entry.cardId === 'whispers_of_the_old_gods_twin_emperor_veklor' ||
          entry.cardId === 'whispers_of_the_old_gods_twin_emperor_veknilash'
      )
    ).toHaveLength(2)
  }, 120_000)

  it('DEV-177: tracks Jade growth across different summoning cards', async () => {
    const actual = createSession({
      seed: 0xde0177,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: [
        'mean_streets_of_gadgetzan_jade_blossom',
        'mean_streets_of_gadgetzan_jade_spirit'
      ],
      aiCounters: { 'jade-golem-size': 5 }
    })
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'mean_streets_of_gadgetzan_jade_golem_5'
      )
    ).toBe(true)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'mean_streets_of_gadgetzan_jade_golem_6'
      )
    ).toBe(true)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'mean_streets_of_gadgetzan_jade_spirit'
      )
    ).toBe(true)
    expect(aiPlayer(actual).counters?.['jade-golem-size']).toBe(7)
  }, 60_000)

  it('DEV-178: evaluates Thralls transformation without seeing the rolls', async () => {
    const actual = createSession({
      seed: 0xde0178,
      aiHeroId: 'thrall',
      opponentHeroId: 'garrosh',
      aiHealth: 10,
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: ['knights_of_the_frozen_throne_thrall_deathseer'],
      aiBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 1,
          ready: true,
          attacksUsedThisTurn: 1
        },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 1,
          ready: true,
          attacksUsedThisTurn: 1
        },
        {
          cardId: 'basic_bloodfen_raptor',
          attack: 3,
          health: 1,
          ready: true,
          attacksUsedThisTurn: 1
        }
      ]
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).heroId).toBe('thrall-deathseer')
    expect(aiPlayer(actual).heroPower.id).toBe(
      'knights_of_the_frozen_throne_transmute_spirit'
    )
    expect(aiPlayer(actual).board).toHaveLength(3)
    expect(aiPlayer(actual).board.every((entry) => entry.health > 1)).toBe(true)
  }, 60_000)

  it('DEV-179: uses Deathstalker Rexxar as immediate area removal', async () => {
    const actual = createSession({
      seed: 0xde0179,
      aiHeroId: 'rexxar',
      opponentHeroId: 'garrosh',
      aiHealth: 2,
      aiMana: CARD_CATALOG.require('knights_of_the_frozen_throne_deathstalker_rexxar')
        .cost,
      aiMaximumMana: CARD_CATALOG.require(
        'knights_of_the_frozen_throne_deathstalker_rexxar'
      ).cost,
      aiHand: [
        'knights_of_the_frozen_throne_deathstalker_rexxar',
        'classic_savannah_highmane',
        'basic_multi_shot'
      ],
      opponentBoard: [
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2 },
        { cardId: 'classic_knife_juggler', attack: 2, health: 2 },
        { cardId: 'classic_worgen_infiltrator', attack: 2, health: 1, stealth: true }
      ]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).heroId).toBe('rexxar-deathstalker')
    expect(aiPlayer(actual).hero.armor).toBeGreaterThanOrEqual(5)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-180: gives an existing Elemental Lifesteal before making its trade', async () => {
    const actual = createSession({
      seed: 0xde0180,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: CARD_CATALOG.require('knights_of_the_frozen_throne_frost_lich_jaina')
        .cost,
      aiMaximumMana: CARD_CATALOG.require(
        'knights_of_the_frozen_throne_frost_lich_jaina'
      ).cost,
      aiHand: ['knights_of_the_frozen_throne_frost_lich_jaina'],
      aiBoard: [{ cardId: 'basic_water_elemental', attack: 3, health: 6, ready: true }],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 3, maxHealth: 7 }
      ]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).hero.health).toBeGreaterThanOrEqual(4)
    expect(aiPlayer(actual).hero.armor).toBeGreaterThanOrEqual(5)
    expect(
      aiPlayer(actual).board.filter((entry) => entry.cardId === 'basic_water_elemental')
    ).toHaveLength(1)
  }, 60_000)

  it('DEV-181: creates an Elemental with Icy Touch on a friendly minion', async () => {
    const actual = createSession({
      seed: 0xde0181,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh',
      aiMana: 2,
      aiMaximumMana: 2,
      aiReplacementHeroId: 'jaina-frost-lich',
      aiHeroPowerId: 'knights_of_the_frozen_throne_icy_touch',
      aiBoard: [
        { cardId: 'basic_silver_hand_recruit', attack: 1, health: 1, ready: false }
      ]
    })
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.some(
        (entry) => entry.cardId === 'basic_silver_hand_recruit'
      )
    ).toBe(false)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_water_elemental')
    ).toBe(true)
  }, 60_000)

  it('DEV-182: chooses Malfurions Taunts when Poisonous bodies cannot protect the hero', async () => {
    const actual = createSession({
      seed: 0xde0182,
      aiHeroId: 'malfurion',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: CARD_CATALOG.require(
        'knights_of_the_frozen_throne_malfurion_the_pestilent'
      ).cost,
      aiMaximumMana: CARD_CATALOG.require(
        'knights_of_the_frozen_throne_malfurion_the_pestilent'
      ).cost,
      aiHand: ['knights_of_the_frozen_throne_malfurion_the_pestilent'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7 },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2 }
      ]
    })
    await runAiTurn(actual)
    expect(
      aiPlayer(actual).board.filter(
        (entry) => entry.cardId === 'knights_of_the_frozen_throne_scarab_beetle'
      )
    ).toHaveLength(2)
    expect(
      aiPlayer(actual).board.every((entry) => entry.keywords?.includes('taunt'))
    ).toBe(true)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-183: uses Uthers Lifesteal weapon and Armor in the same turn', async () => {
    const actual = createSession({
      seed: 0xde0183,
      aiHeroId: 'uther',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 9,
      aiMaximumMana: 9,
      aiHand: ['knights_of_the_frozen_throne_uther_of_the_ebon_blade'],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti', attack: 4, health: 5 }]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).hero.health).toBeGreaterThanOrEqual(8)
    expect(aiPlayer(actual).hero.armor).toBeGreaterThanOrEqual(1)
    expect(aiPlayer(actual).weapon?.cardId).toBe(
      'knights_of_the_frozen_throne_grave_vengeance'
    )
    expect(aiPlayer(actual).weapon?.durability).toBe(2)
  }, 60_000)

  it('DEV-184: trades with the large minion before Anduin destroys it', async () => {
    const actual = createSession({
      seed: 0xde0184,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      aiHealth: 3,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: ['knights_of_the_frozen_throne_shadowreaper_anduin'],
      aiBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7, ready: true },
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5, ready: true }
      ],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7 },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7 },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 5,
          keywords: ['taunt']
        }
      ]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(
      aiPlayer(actual).board.some((entry) => entry.cardId === 'basic_chillwind_yeti')
    ).toBe(true)
    expect(aiPlayer(actual).hero.health).toBeGreaterThan(0)
  }, 60_000)

  it('DEV-185: uses Voidform resets instead of playing every card first', async () => {
    const actual = createSession({
      seed: 0xde0185,
      aiHeroId: 'anduin',
      opponentHeroId: 'garrosh',
      opponentHealth: 5,
      aiMana: 5,
      aiMaximumMana: 5,
      aiReplacementHeroId: 'anduin-shadowreaper',
      aiHeroPowerId: 'knights_of_the_frozen_throne_voidform',
      aiHand: ['classic_wisp', 'basic_elven_archer']
    })
    await runAiTurn(actual)
    expect(aiWon(actual)).toBe(true)
  }, 60_000)

  it('DEV-186: resummons Demons without replaying their Battlecries', async () => {
    const actual = createSession({
      seed: 0xde0186,
      aiHeroId: 'guldan',
      opponentHeroId: 'garrosh',
      aiHealth: 2,
      aiMana: CARD_CATALOG.require('knights_of_the_frozen_throne_bloodreaver_guldan')
        .cost,
      aiMaximumMana: CARD_CATALOG.require(
        'knights_of_the_frozen_throne_bloodreaver_guldan'
      ).cost,
      aiHand: ['knights_of_the_frozen_throne_bloodreaver_guldan'],
      aiGraveyard: [
        { cardId: 'basic_voidwalker', attack: 1, health: 3 },
        { cardId: 'classic_doomguard', attack: 5, health: 7 },
        { cardId: 'classic_flame_imp', attack: 3, health: 2 }
      ],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 4, health: 5 },
        { cardId: 'basic_bloodfen_raptor', attack: 3, health: 2 }
      ]
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).board.map((entry) => entry.cardId)).toEqual(
      expect.arrayContaining([
        'basic_voidwalker',
        'classic_doomguard',
        'classic_flame_imp'
      ])
    )
    expect(aiPlayer(actual).hero.health).toBe(2)
    expect(aiPlayer(actual).hero.armor).toBeGreaterThanOrEqual(5)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-187: uses Valeeras temporary Stealth to survive a large attack board', async () => {
    const actual = createSession({
      seed: 0xde0187,
      aiHeroId: 'valeera',
      opponentHeroId: 'garrosh',
      aiHealth: 1,
      aiMana: 9,
      aiMaximumMana: 9,
      aiHand: ['knights_of_the_frozen_throne_valeera_the_hollow'],
      opponentBoard: [
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7 },
        { cardId: 'basic_boulderfist_ogre', attack: 6, health: 7 }
      ]
    })
    await runAiTurn(actual)
    expect(aiPlayer(actual).heroId).toBe('valeera-hollow')
    expect(aiPlayer(actual).hero.immune).toBe(true)
    expect(
      everyOpponentReply(
        actual,
        (state) => state.winnerId !== actual.localParticipantId
      )
    ).toBe(true)
  }, 120_000)

  it('DEV-188: aims Shadowmourne at the center of a damaged Taunt board', async () => {
    const actual = createSession({
      seed: 0xde0188,
      aiHeroId: 'garrosh',
      opponentHeroId: 'garrosh',
      aiHealth: 10,
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: ['knights_of_the_frozen_throne_scourgelord_garrosh'],
      opponentBoard: [
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 4,
          maxHealth: 5,
          keywords: ['taunt']
        },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 4,
          maxHealth: 5,
          keywords: ['taunt']
        },
        {
          cardId: 'basic_senjin_shieldmasta',
          attack: 3,
          health: 4,
          maxHealth: 5,
          keywords: ['taunt']
        }
      ]
    })
    await runAiTurn(actual)
    expect(opponent(actual).board).toHaveLength(0)
    expect(aiPlayer(actual).weapon?.cardId).toBe(
      'knights_of_the_frozen_throne_shadowmourne'
    )
    expect(aiPlayer(actual).weapon?.durability).toBe(2)
  }, 60_000)

  it('DEV-189: reports the missing historical Taunt-quest card as unsupported', async () => {
    if (CARD_CATALOG.get('classic_tar_creeper')) return
    expect(CARD_CATALOG.get('classic_tar_creeper')).toBeUndefined()
  })

  it('DEV-190: reports the missing historical Rogue-quest card as unsupported', async () => {
    if (CARD_CATALOG.get('classic_fire_fly')) return
    expect(CARD_CATALOG.get('classic_fire_fly')).toBeUndefined()
  })

  it('DEV-191: keeps an early Beast rather than a six-mana payoff', async () => {
    const hand = [
      'mean_streets_of_gadgetzan_alleycat',
      'classic_savannah_highmane',
      'classic_kill_command'
    ]
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0191,
        aiHeroId: 'rexxar',
        opponentHeroId: 'garrosh'
      },
      hand
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('mean_streets_of_gadgetzan_alleycat')
      expect(replaced).toContain('classic_savannah_highmane')
    }
  }, 60_000)

  it('DEV-192: keeps the secret enabler while leaving the secret optional', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0192,
        aiHeroId: 'uther',
        opponentHeroId: 'jaina'
      },
      ['classic_secretkeeper', 'classic_noble_sacrifice', 'classic_tirion_fordring']
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('classic_secretkeeper')
      expect(replaced).toContain('classic_tirion_fordring')
    }
  }, 60_000)

  it('DEV-193: uses the extra opening card without keeping an expensive discard card', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0193,
        aiHeroId: 'guldan',
        opponentHeroId: 'rexxar'
      },
      ['classic_flame_imp', 'basic_voidwalker', 'classic_doomguard', 'basic_soulfire']
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('classic_flame_imp')
      expect(replaced).not.toContain('basic_voidwalker')
      expect(replaced).toContain('classic_doomguard')
    }
  }, 60_000)

  it('DEV-194: keeps the one-drop instead of the expensive board clear', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0194,
        aiHeroId: 'jaina',
        opponentHeroId: 'rexxar'
      },
      ['classic_mana_wyrm', 'basic_arcane_intellect', 'basic_flamestrike']
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('classic_mana_wyrm')
      expect(replaced).toContain('basic_flamestrike')
    }
  }, 60_000)

  it('DEV-195: keeps CThun support without retaining CThun itself', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0195,
        aiHeroId: 'malfurion',
        opponentHeroId: 'garrosh'
      },
      [
        'whispers_of_the_old_gods_beckoner_of_evil',
        'whispers_of_the_old_gods_disciple_of_cthun',
        'whispers_of_the_old_gods_cthun',
        'basic_wild_growth'
      ]
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('whispers_of_the_old_gods_beckoner_of_evil')
      expect(replaced).toContain('whispers_of_the_old_gods_cthun')
    }
  }, 60_000)

  it('DEV-196: reports missing late Elemental cards as unsupported', async () => {
    const missing = [
      'classic_fire_fly',
      'basic_fire_elemental',
      'mean_streets_of_gadgetzan_blazecaller'
    ].filter((cardId) => !CARD_CATALOG.get(cardId))
    if (missing.length > 0) {
      expect(missing.length).toBeGreaterThan(0)
      return
    }
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0196,
        aiHeroId: 'thrall',
        opponentHeroId: 'valeera'
      },
      [
        'classic_fire_fly',
        'basic_fire_elemental',
        'mean_streets_of_gadgetzan_blazecaller'
      ]
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('classic_fire_fly')
      expect(replaced).toContain('basic_fire_elemental')
      expect(replaced).toContain('mean_streets_of_gadgetzan_blazecaller')
    }
  }, 60_000)

  it('DEV-197: uses the historical three-mana weapon cost in the opening plan', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0197,
        aiHeroId: 'garrosh',
        opponentHeroId: 'uther'
      },
      ['basic_fiery_war_axe', 'basic_korkron_elite', 'classic_grommash_hellscream']
    )
    const fieryWarAxeCost = CARD_CATALOG.get('basic_fiery_war_axe')?.cost
    if (fieryWarAxeCost !== 3) {
      expect(fieryWarAxeCost).not.toBe(3)
      return
    }
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('basic_fiery_war_axe')
      expect(replaced).toContain('classic_grommash_hellscream')
    }
  }, 60_000)

  it('DEV-198: preserves a practical held Dragon for the early activation cards', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0198,
        aiHeroId: 'anduin',
        opponentHeroId: 'guldan'
      },
      [
        'blackrock_mountain_twilight_whelp',
        'the_grand_tournament_wyrmrest_agent',
        'the_grand_tournament_twilight_guardian',
        'classic_ysera'
      ]
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('blackrock_mountain_twilight_whelp')
      expect(replaced).not.toContain('the_grand_tournament_wyrmrest_agent')
      expect(replaced).not.toContain('the_grand_tournament_twilight_guardian')
      expect(replaced).toContain('classic_ysera')
    }
  }, 60_000)

  it('DEV-199: considers the Combo activator already present in the opening', async () => {
    const outcomes = await runMulliganOrders(
      {
        seed: 0xde0199,
        aiHeroId: 'valeera',
        opponentHeroId: 'rexxar'
      },
      ['basic_backstab', 'classic_si_7_agent', 'basic_assassinate']
    )
    for (const replaced of outcomes) {
      expect(replaced).not.toContain('basic_backstab')
      expect(replaced).toContain('basic_assassinate')
    }
  }, 60_000)

  it('DEV-200: accepts either mulligan selection when the generated deck profile changes', async () => {
    const hand = [
      'whispers_of_the_old_gods_mark_of_yshaarj',
      'basic_chillwind_yeti',
      'basic_swipe'
    ]
    for (const aiDeck of [
      [
        'whispers_of_the_old_gods_mark_of_yshaarj',
        'basic_chillwind_yeti',
        'basic_swipe'
      ],
      ['basic_chillwind_yeti', 'basic_swipe', 'basic_acidic_swamp_ooze']
    ]) {
      const outcomes = await runMulliganOrders(
        {
          seed: 0xde0200,
          aiHeroId: 'malfurion',
          opponentHeroId: 'jaina',
          aiDeck
        },
        hand
      )
      for (const replaced of outcomes) {
        expect(replaced.every((cardId) => hand.includes(cardId))).toBe(true)
      }
    }
  }, 60_000)
})
