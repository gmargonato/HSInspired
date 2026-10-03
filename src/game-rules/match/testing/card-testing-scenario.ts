import { asCardId, CARD_CATALOG, type CardId } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import { assertOpeningMatchInvariants } from '../rules/invariants'
import type { OpeningCommandResult, OpeningMatchState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import { createMatchScenario } from './match-scenario-builder'

export type CardScenarioActor = 'first' | 'second'
export type CardScenarioFixtureProfile =
  | 'catalog-smoke-v1'
  | 'mixed-board-interaction-v2'
export type CardScenarioFollowupPolicy = 'must-accept' | 'observe-only'
export type CardScenarioFollowup =
  | { readonly type: 'play-card'; readonly cardId: string }
  | { readonly type: 'use-hero-power' }
  | { readonly type: 'attack-hero' }
  | { readonly type: 'end-turn' }

export interface CatalogCardScenarioOptions {
  readonly cardId: string
  readonly seed: number
  readonly actor?: CardScenarioActor
  readonly fixtureProfile?: CardScenarioFixtureProfile
  readonly followupPolicy?: CardScenarioFollowupPolicy
  readonly inputSelection?: 'first-legal' | 'omit-required-targets'
  readonly followups?: readonly CardScenarioFollowup[]
}

export interface CatalogCardScenarioOutcome {
  readonly cardId: string
  readonly seed: number
  readonly actor: CardScenarioActor
  readonly fixtureProfile: CardScenarioFixtureProfile
  readonly actorParticipantId: string
  readonly opponentParticipantId: string
  readonly entryPath: 'gameplay-play' | 'opening-quest'
  readonly setupCommands: readonly unknown[]
  readonly initialState: OpeningMatchState
  readonly preActionState: OpeningMatchState
  readonly state: OpeningMatchState
  readonly preActionRngState?: unknown
  readonly rngState: unknown
  readonly inputSelection?: 'first-legal' | 'omit-required-targets'
  readonly requiredTargetCount?: number
  readonly postFocalState?: OpeningMatchState
  readonly followupCommands?: readonly unknown[]
  readonly followupResults?: readonly OpeningCommandResult[]
  readonly followupStates?: readonly OpeningMatchState[]
  readonly focalInstanceId?: string
  readonly focalBoardInstanceId?: string
  readonly command?: unknown
  readonly result?: OpeningCommandResult
  readonly questRegistered: boolean
  readonly invariantError?: string
}

export class CardScenarioSetupError extends Error {
  readonly code: string

  constructor(cardId: string, code: string, message: string) {
    super(cardId + ': setup failed (' + code + '): ' + message)
    this.name = 'CardScenarioSetupError'
    this.code = code
  }
}

function requireAccepted(
  cardId: string,
  label: string,
  command: unknown,
  result: OpeningCommandResult
): void {
  if (!result.accepted)
    throw new CardScenarioSetupError(
      cardId,
      result.code,
      label + ': ' + result.message + ' command=' + JSON.stringify(command)
    )
}

function targetKey(target: {
  readonly kind: string
  readonly participantId: string
  readonly instanceId?: string
}): string {
  return target.kind + ':' + target.participantId + ':' + (target.instanceId ?? '')
}

function findPlayer(state: OpeningMatchState, participantId: PlayerId) {
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  if (!player) throw new Error('Unknown scenario participant ' + participantId)
  return player
}

function firstLegalPlay(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: PlayerId,
  cardInstanceId: string,
  inputSelection: 'first-legal' | 'omit-required-targets' = 'first-legal'
): { readonly command: unknown; readonly requiredTargetCount: number } {
  const input = scenario.match.getPlayInput?.(participantId, cardInstanceId)
  const selectedInput =
    input && input.choiceCount > 0
      ? scenario.match.getPlayInput?.(
          participantId,
          cardInstanceId,
          input.legalChoices[0]
        )
      : input
  const usedTargets = new Set<string>()
  const targets = selectedInput?.legalTargetOptions
    .map((options) => {
      const target = options.find((candidate) => !usedTargets.has(targetKey(candidate)))
      if (target) usedTargets.add(targetKey(target))
      return target
    })
    .filter((target): target is NonNullable<typeof target> => target !== undefined)
  const command = {
    type: 'play-card',
    participantId,
    cardInstanceId,
    ...(selectedInput?.requiresPosition
      ? { position: selectedInput.legalPositions[0] ?? 0 }
      : {}),
    ...(inputSelection === 'first-legal' && targets && targets.length > 0
      ? { targets }
      : {}),
    ...(input && input.choiceCount > 0 ? { choice: input.legalChoices[0] ?? 0 } : {})
  }
  return {
    command,
    requiredTargetCount: selectedInput?.legalTargetOptions.length ?? 0
  }
}

function resolvePendingChoices(
  scenario: ReturnType<typeof createMatchScenario>,
  cardId: string,
  commands: unknown[],
  results: OpeningCommandResult[],
  states: OpeningMatchState[]
): void {
  for (let step = 0; step < 16; step += 1) {
    const state = scenario.match.getState()
    let command: unknown
    let label: string
    if (state.pendingDiscover) {
      const pending = state.pendingDiscover
      const candidate = pending.candidates[0]
      if (!candidate)
        throw new CardScenarioSetupError(
          cardId,
          'empty-pending-discover',
          'A Discover choice is pending without a selectable candidate.'
        )
      command = {
        type: 'choose-discover-card',
        participantId: pending.participantId,
        cardInstanceId: candidate.instanceId
      }
      label = 'resolve the first legal Discover candidate'
    } else if (state.pendingCardChoice) {
      const pending = state.pendingCardChoice
      const option = pending.options[0]
      if (!option)
        throw new CardScenarioSetupError(
          cardId,
          'empty-pending-card-choice',
          'A card choice is pending without a selectable option.'
        )
      command = {
        type: 'choose-card-option',
        participantId: pending.participantId,
        sourceCardInstanceId: pending.sourceCardInstanceId,
        choice: option.choice
      }
      label = 'resolve the first legal card option'
    } else return

    const result = scenario.match.dispatch(command)
    commands.push(command)
    results.push(result)
    states.push(scenario.match.getState())
    requireAccepted(cardId, label, command, result)
  }
  const state = scenario.match.getState()
  if (state.pendingDiscover || state.pendingCardChoice)
    throw new CardScenarioSetupError(
      cardId,
      'choice-resolution-limit',
      'Pending choices remained after 16 deterministic selections.'
    )
}

/**
 * Builds a deterministic real-catalog scenario and attempts the focal card through
 * the public gameplay command. Setup commands are retained separately from the
 * behavior command so campaign reports can distinguish fixtures from gameplay.
 */
export function runCatalogCardScenario(
  options: CatalogCardScenarioOptions
): CatalogCardScenarioOutcome {
  const card = CARD_CATALOG.get(options.cardId)
  if (!card) throw new Error('Scenario card ' + options.cardId + ' does not exist.')

  const cardId = card.id
  const seed = options.seed
  const actor = options.actor ?? 'first'
  const scenario = createMatchScenario({
    seed,
    cardId,
    focalCardCopies: 1,
    firstHeroId: 'jaina',
    secondHeroId: 'jaina'
  })
  const setupCommands: unknown[] = []
  const confirmCommands = scenario.participants.map((participantId) => ({
    type: 'confirm-mulligan',
    participantId,
    replaceInstanceIds: []
  }))
  try {
    scenario.confirmBothMulligans()
  } catch (error) {
    throw new CardScenarioSetupError(
      cardId,
      'mulligan-setup',
      error instanceof Error ? error.message : String(error)
    )
  }
  setupCommands.push(...confirmCommands)

  const actorId = scenario.participants[actor === 'first' ? 0 : 1]
  const opponentId = scenario.participants.find((id) => id !== actorId)!
  let focalInstanceIdForFollowup: string | undefined
  const setMana = (participantId: PlayerId, available = 10): void => {
    const command = {
      type: 'dev-set-mana',
      participantId,
      available,
      maximum: 10
    }
    requireAccepted(
      cardId,
      'set fixture mana for ' + participantId,
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
  }
  const addSetupCard = (participantId: PlayerId, supportCardId: string): string => {
    const command = {
      type: 'dev-add-card',
      participantId,
      cardId: supportCardId
    }
    requireAccepted(
      cardId,
      'add setup card ' + supportCardId,
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
    const added = findPlayer(scenario.match.getState(), participantId)
      .hand.filter((candidate) => candidate.cardId === supportCardId)
      .at(-1)
    if (!added)
      throw new CardScenarioSetupError(cardId, 'added-card-not-found', supportCardId)
    return added.instanceId
  }
  const playSetupWeapon = (participantId: PlayerId): void => {
    const instanceId = addSetupCard(participantId, 'basic_fiery_war_axe')
    const command = {
      type: 'play-card',
      participantId,
      cardInstanceId: instanceId
    }
    requireAccepted(
      cardId,
      'play fixture weapon for ' + participantId,
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
  }
  const prepareActorHealFixture = (): void => {
    const command = { type: 'dev-set-hero', participantId: actorId, health: 24 }
    requireAccepted(
      cardId,
      'damage actor hero for heal interactions',
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
  }
  const setUpBothWeapons = (): void => {
    let activePlayerId = scenario.match.getState().activePlayerId
    for (let turns = 0; activePlayerId !== actorId && turns < 2; turns += 1) {
      if (!activePlayerId)
        throw new CardScenarioSetupError(
          cardId,
          'no-active-player',
          'Match has no active player before weapon fixture setup.'
        )
      const command = { type: 'end-turn', participantId: activePlayerId }
      requireAccepted(
        cardId,
        'advance to actor turn for weapon fixture',
        command,
        scenario.match.dispatch(command)
      )
      setupCommands.push(command)
      activePlayerId = scenario.match.getState().activePlayerId
    }
    if (activePlayerId !== actorId)
      throw new CardScenarioSetupError(
        cardId,
        'actor-turn',
        'Could not reach the selected actor turn for weapon fixture.'
      )
    setMana(actorId)
    playSetupWeapon(actorId)
    const actorEndTurn = { type: 'end-turn', participantId: actorId }
    requireAccepted(
      cardId,
      'advance to opponent weapon fixture turn',
      actorEndTurn,
      scenario.match.dispatch(actorEndTurn)
    )
    setupCommands.push(actorEndTurn)
    if (scenario.match.getState().activePlayerId !== opponentId)
      throw new CardScenarioSetupError(
        cardId,
        'opponent-turn',
        'Could not reach the opponent turn for weapon fixture.'
      )
    setMana(opponentId)
    playSetupWeapon(opponentId)
    const opponentEndTurn = { type: 'end-turn', participantId: opponentId }
    requireAccepted(
      cardId,
      'return to actor turn after weapon fixture',
      opponentEndTurn,
      scenario.match.dispatch(opponentEndTurn)
    )
    setupCommands.push(opponentEndTurn)
    if (scenario.match.getState().activePlayerId !== actorId)
      throw new CardScenarioSetupError(
        cardId,
        'actor-turn',
        'Could not return to the selected actor turn after weapon fixture.'
      )
    prepareActorHealFixture()
  }
  const useHeroPowerFollowup = (
    commands: unknown[],
    results: OpeningCommandResult[],
    states: OpeningMatchState[]
  ): OpeningCommandResult => {
    const manaCommand = {
      type: 'dev-set-mana',
      participantId: actorId,
      available: 10,
      maximum: 10
    }
    const manaResult = scenario.match.dispatch(manaCommand)
    commands.push(manaCommand)
    results.push(manaResult)
    states.push(scenario.match.getState())
    requireAccepted(cardId, 'refresh actor mana for hero-power follow-up', manaCommand, manaResult)
    const state = scenario.match.getState()
    const actorPlayer = findPlayer(state, actorId)
    const opponentBoard = findPlayer(state, opponentId).board
    const power = HERO_POWER_CATALOG.require(actorPlayer.heroPower.id)
    const targeting = actorPlayer.heroPower.targetingGranted ?? power.targeting
    const focalMinion = actorPlayer.board.find(
      (minion) => minion.instanceId === focalInstanceIdForFollowup
    )
    const friendlyMinion =
      focalMinion ??
      actorPlayer.board.find((minion) => (minion.damageTaken ?? 0) > 0) ??
      actorPlayer.board[0]
    const opponentMinion = opponentBoard[0]
    const friendlyBeast =
      actorPlayer.board.find(
        (minion) => CARD_CATALOG.get(minion.cardId)?.subtype === 'Beast'
      ) ?? friendlyMinion
    const targetMinion =
      targeting === 'none'
        ? undefined
        : targeting === 'enemy-minion'
          ? opponentMinion
          : targeting === 'friendly-beast' || targeting === 'friendly-minion'
            ? friendlyBeast
            : targeting === 'minion'
              ? friendlyMinion ?? opponentMinion
              : targeting === 'any-character'
                ? focalMinion ??
                  actorPlayer.board.find((minion) => (minion.damageTaken ?? 0) > 0) ??
                  friendlyMinion ??
                  opponentMinion
                : undefined
    const targetParticipantId = targetMinion
      ? state.players.find((player) =>
          player.board.some((minion) => minion.instanceId === targetMinion.instanceId)
        )?.participantId
      : undefined
    const command = {
      type: 'use-hero-power',
      participantId: actorId,
      ...(targetMinion
        ? {
            target: {
              kind: 'minion',
              participantId: targetParticipantId ?? actorId,
              instanceId: targetMinion.instanceId
            }
          }
        : {})
    }
    const result = scenario.match.dispatch(command)
    commands.push(command)
    results.push(result)
    states.push(scenario.match.getState())
    if ((options.followupPolicy ?? 'must-accept') !== 'observe-only')
      requireAccepted(cardId, 'use actor hero power after focal card', command, result)
    return result
  }
  const attackHeroFollowup = (
    commands: unknown[],
    results: OpeningCommandResult[],
    states: OpeningMatchState[]
  ): OpeningCommandResult => {
    const opponentBoard = findPlayer(scenario.match.getState(), opponentId).board
    const target =
      opponentBoard.find((minion) => minion.keywords?.includes('taunt')) ??
      opponentBoard[0]
    const command = {
      type: 'attack-character',
      participantId: actorId,
      attacker: { kind: 'hero' },
      defender: target
        ? { kind: 'minion', instanceId: target.instanceId }
        : { kind: 'hero' }
    }
    const result = scenario.match.dispatch(command)
    commands.push(command)
    results.push(result)
    states.push(scenario.match.getState())
    if ((options.followupPolicy ?? 'must-accept') !== 'observe-only')
      requireAccepted(cardId, 'attack with actor hero after focal card', command, result)
    return result
  }
  const questRegistered = Boolean(
    findPlayer(scenario.match.getState(), actorId).quest?.cardId === cardId
  )
  if (
    card.type === 'Spell' &&
    card.quest &&
    options.fixtureProfile === 'mixed-board-interaction-v2'
  ) {
    setUpBothWeapons()
    const supports: readonly (readonly [PlayerId, string])[] = [
      [actorId, 'basic_bloodfen_raptor'],
      [actorId, 'goblins_vs_gnomes_snowchugger'],
      [actorId, 'basic_boulderfist_ogre'],
      [actorId, 'basic_murloc_raider'],
      [opponentId, 'basic_senjin_shieldmasta'],
      [opponentId, 'basic_boulderfist_ogre'],
      [opponentId, 'classic_wisp'],
      [opponentId, 'naxxramas_haunted_creeper'],
      [opponentId, 'classic_argent_squire']
    ]
    for (const [participantId, supportCardId] of supports) {
      const command = {
        type: 'dev-summon-minion',
        participantId,
        cardId: supportCardId
      }
      requireAccepted(
        cardId,
        'create quest interaction fixture ' + supportCardId,
        command,
        scenario.match.dispatch(command)
      )
      setupCommands.push(command)
    }
  }
  const initialState = scenario.match.getState()

  if (card.type === 'Spell' && card.quest) {
    const followupCommands: unknown[] = []
    const followupResults: OpeningCommandResult[] = []
    const followupStates: OpeningMatchState[] = []
    let preActionState = initialState
    let preActionRngState: unknown = scenario.rng.snapshot()
    let preActionCaptured = false
    let gameplayCommand: unknown
    let gameplayResult: OpeningCommandResult | undefined

    if (options.followups && options.followups.length > 0) {
      let activePlayerId = scenario.match.getState().activePlayerId
      for (let turns = 0; activePlayerId !== actorId && turns < 2; turns += 1) {
        if (!activePlayerId)
          throw new CardScenarioSetupError(
            cardId,
            'no-active-player',
            'Match has no active player.'
          )
        const command = { type: 'end-turn', participantId: activePlayerId }
        const result = scenario.match.dispatch(command)
        requireAccepted(cardId, 'advance to quest actor turn', command, result)
        setupCommands.push(command)
        activePlayerId = scenario.match.getState().activePlayerId
      }
      if (activePlayerId !== actorId)
        throw new CardScenarioSetupError(
          cardId,
          'actor-turn',
          'Could not reach the selected quest actor turn.'
        )

      const manaCommand = {
        type: 'dev-set-mana',
        participantId: actorId,
        available: 10,
        maximum: 10
      }
      requireAccepted(
        cardId,
        'set quest actor mana',
        manaCommand,
        scenario.match.dispatch(manaCommand)
      )
      setupCommands.push(manaCommand)

      for (const followup of options.followups) {
        resolvePendingChoices(
          scenario,
          cardId,
          followupCommands,
          followupResults,
          followupStates
        )
        if (followup.type === 'end-turn') {
          const activeParticipantId = scenario.match.getState().activePlayerId
          if (!activeParticipantId)
            throw new CardScenarioSetupError(
              cardId,
              'no-active-player',
              'Match has no active player before a follow-up turn boundary.'
            )
          const command = { type: 'end-turn', participantId: activeParticipantId }
          const result = scenario.match.dispatch(command)
          followupCommands.push(command)
          followupResults.push(result)
          followupStates.push(scenario.match.getState())
          resolvePendingChoices(
            scenario,
            cardId,
            followupCommands,
            followupResults,
            followupStates
          )
          if (!preActionCaptured) {
            preActionState = scenario.match.getState()
            preActionRngState = scenario.rng.snapshot()
            preActionCaptured = true
          }
          if (!gameplayCommand) {
            gameplayCommand = command
            gameplayResult = result
          }
          if (
            !result.accepted &&
            (options.followupPolicy ?? 'must-accept') !== 'observe-only'
          )
            break
          continue
        }

        if (followup.type === 'use-hero-power') {
          const result = useHeroPowerFollowup(
            followupCommands,
            followupResults,
            followupStates
          )
          resolvePendingChoices(
            scenario,
            cardId,
            followupCommands,
            followupResults,
            followupStates
          )
          if (!preActionCaptured) {
            preActionState = scenario.match.getState()
            preActionRngState = scenario.rng.snapshot()
            preActionCaptured = true
          }
          if (!gameplayCommand) {
            gameplayCommand = { type: 'use-hero-power', participantId: actorId }
            gameplayResult = result
          }
          if (
            !result.accepted &&
            (options.followupPolicy ?? 'must-accept') !== 'observe-only'
          )
            break
          continue
        }

        if (followup.type === 'attack-hero') {
          const result = attackHeroFollowup(
            followupCommands,
            followupResults,
            followupStates
          )
          if (!preActionCaptured) {
            preActionState = scenario.match.getState()
            preActionRngState = scenario.rng.snapshot()
            preActionCaptured = true
          }
          if (!gameplayCommand) {
            gameplayCommand = { type: 'attack-character', participantId: actorId }
            gameplayResult = result
          }
          if (!result.accepted) break
          continue
        }

        const addCommand = {
          type: 'dev-add-card',
          participantId: actorId,
          cardId: followup.cardId
        }
        const addResult = scenario.match.dispatch(addCommand)
        if (!addResult.accepted && (options.followupPolicy ?? 'must-accept') !== 'observe-only')
          requireAccepted(
            cardId,
            'add quest follow-up card ' + followup.cardId,
            addCommand,
            addResult
          )
        if (!addResult.accepted) {
          followupCommands.push(addCommand)
          followupResults.push(addResult)
          followupStates.push(scenario.match.getState())
          continue
        }
        setupCommands.push(addCommand)
        const followupCard = findPlayer(scenario.match.getState(), actorId)
          .hand.filter((candidate) => candidate.cardId === followup.cardId)
          .at(-1)
        if (!followupCard)
          throw new CardScenarioSetupError(
            cardId,
            'quest-follow-up-not-found',
            followup.cardId
          )
        if (!preActionCaptured) {
          preActionState = scenario.match.getState()
          preActionRngState = scenario.rng.snapshot()
          preActionCaptured = true
        }
        const manaCommand = {
          type: 'dev-set-mana',
          participantId: actorId,
          available: 10,
          maximum: 10
        }
        const manaResult = scenario.match.dispatch(manaCommand)
        followupCommands.push(manaCommand)
        followupResults.push(manaResult)
        followupStates.push(scenario.match.getState())
        requireAccepted(
          cardId,
          'refresh actor mana for companion follow-up',
          manaCommand,
          manaResult
        )
        const selected = firstLegalPlay(scenario, actorId, followupCard.instanceId)
        const result = scenario.match.dispatch(selected.command)
        followupCommands.push(selected.command)
        followupResults.push(result)
        followupStates.push(scenario.match.getState())
        if (result.accepted)
          resolvePendingChoices(
            scenario,
            cardId,
            followupCommands,
            followupResults,
            followupStates
          )
        if (!gameplayCommand) {
          gameplayCommand = selected.command
          gameplayResult = result
        }
        if (
          !result.accepted &&
          (options.followupPolicy ?? 'must-accept') !== 'observe-only'
        )
          break
      }
    }

    const state = scenario.match.getState()
    let invariantError: string | undefined
    try {
      assertOpeningMatchInvariants(state)
    } catch (error) {
      invariantError = error instanceof Error ? error.message : String(error)
    }
    return {
      cardId,
      seed,
      actor,
      fixtureProfile: options.fixtureProfile ?? 'catalog-smoke-v1',
      actorParticipantId: actorId,
      opponentParticipantId: opponentId,
      entryPath: 'opening-quest',
      setupCommands,
      initialState,
      preActionState,
      state,
      preActionRngState,
      rngState: scenario.rng.snapshot(),
      questRegistered,
      ...(gameplayCommand ? { command: gameplayCommand } : {}),
      ...(gameplayResult ? { result: gameplayResult } : {}),
      followupCommands,
      followupResults,
      followupStates,
      invariantError
    }
  }

  let activePlayerId = scenario.match.getState().activePlayerId
  for (let turns = 0; activePlayerId !== actorId && turns < 2; turns += 1) {
    if (!activePlayerId)
      throw new CardScenarioSetupError(
        cardId,
        'no-active-player',
        'Match has no active player.'
      )
    const command = { type: 'end-turn', participantId: activePlayerId }
    const result = scenario.match.dispatch(command)
    requireAccepted(cardId, 'advance to actor turn', command, result)
    setupCommands.push(command)
    activePlayerId = scenario.match.getState().activePlayerId
  }
  if (activePlayerId !== actorId)
    throw new CardScenarioSetupError(
      cardId,
      'actor-turn',
      'Could not reach the selected actor turn.'
    )

  const manaCommand = {
    type: 'dev-set-mana',
    participantId: actorId,
    available: 10,
    maximum: 10
  }
  requireAccepted(
    cardId,
    'set actor mana',
    manaCommand,
    scenario.match.dispatch(manaCommand)
  )
  setupCommands.push(manaCommand)

  const summon = (participantId: PlayerId, supportCardId: string): string => {
    const command = {
      type: 'dev-summon-minion',
      participantId,
      cardId: supportCardId
    }
    requireAccepted(
      cardId,
      'summon setup minion ' + supportCardId,
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
    const board = findPlayer(scenario.match.getState(), participantId).board
    const minion = board[board.length - 1]
    if (!minion)
      throw new CardScenarioSetupError(
        cardId,
        'summon-empty-board',
        'Setup summon produced no minion.'
      )
    return minion.instanceId
  }
  let broadDamagedMinionId: string | undefined
  const damage = (participantId: PlayerId, instanceId: string): void => {
    playSetupCard(actorId, 'basic_arcane_shot', [
      { kind: 'minion', participantId, instanceId }
    ])
  }
  const addCard = (participantId: PlayerId, supportCardId: string): string => {
    const command = {
      type: 'dev-add-card',
      participantId,
      cardId: supportCardId
    }
    requireAccepted(
      cardId,
      'add setup card ' + supportCardId,
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
    const added = findPlayer(scenario.match.getState(), participantId)
      .hand.filter((candidate) => candidate.cardId === supportCardId)
      .at(-1)
    if (!added)
      throw new CardScenarioSetupError(cardId, 'added-card-not-found', supportCardId)
    return added.instanceId
  }
  const playSetupCard = (
    participantId: PlayerId,
    supportCardId: string,
    targets?: readonly unknown[]
  ): void => {
    const instanceId = addCard(participantId, supportCardId)
    const command = {
      type: 'play-card',
      participantId,
      cardInstanceId: instanceId,
      ...(targets && targets.length > 0 ? { targets } : {})
    }
    requireAccepted(
      cardId,
      'play setup card ' + supportCardId,
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
  }

  if (options.fixtureProfile === 'mixed-board-interaction-v2')
    setUpBothWeapons()

  for (const participantId of scenario.participants) {
    if (
      options.fixtureProfile === 'mixed-board-interaction-v2' &&
      participantId === actorId
    )
      continue
    const command = {
      type: 'dev-summon-minion',
      participantId,
      cardId: 'basic_senjin_shieldmasta'
    }
    requireAccepted(
      cardId,
      'create baseline board minion',
      command,
      scenario.match.dispatch(command)
    )
    setupCommands.push(command)
  }

  if (options.fixtureProfile === 'mixed-board-interaction-v2') {
    summon(actorId, 'basic_bloodfen_raptor')
    summon(actorId, 'goblins_vs_gnomes_snowchugger')
    broadDamagedMinionId = summon(actorId, 'basic_boulderfist_ogre')
    summon(opponentId, 'basic_boulderfist_ogre')
    summon(opponentId, 'classic_wisp')
    summon(opponentId, 'naxxramas_haunted_creeper')
    summon(opponentId, 'classic_argent_squire')
    summon(actorId, 'basic_murloc_raider')
  }

  switch (cardId) {
    case 'whispers_of_the_old_gods_shatter':
      playSetupCard(actorId, 'basic_frostbolt', [
        {
          kind: 'minion',
          participantId: opponentId,
          instanceId: findPlayer(scenario.match.getState(), opponentId).board[0]!.instanceId
        }
      ])
      break
    case 'basic_execute':
      damage(
        opponentId,
        findPlayer(scenario.match.getState(), opponentId).board[0]!.instanceId
      )
      break
    case 'basic_houndmaster':
    case 'classic_bestial_wrath':
      summon(actorId, 'basic_bloodfen_raptor')
      break
    case 'basic_sacrificial_pact':
      summon(actorId, 'classic_doomguard')
      break
    case 'basic_shadow_word_death':
      summon(opponentId, 'basic_boulderfist_ogre')
      break
    case 'classic_big_game_hunter':
      summon(opponentId, 'classic_sea_giant')
      break
    case 'classic_cabal_shadow_priest':
      summon(opponentId, 'classic_wisp')
      break
    case 'classic_blade_flurry': {
      playSetupCard(actorId, 'basic_assassins_blade')
      break
    }
    case 'classic_hungry_crab':
      summon(actorId, 'basic_murloc_raider')
      break
    case 'classic_rampage':
      damage(
        actorId,
        findPlayer(scenario.match.getState(), actorId).board[0]!.instanceId
      )
      break
    case 'classic_the_black_knight':
      summon(opponentId, 'basic_senjin_shieldmasta')
      break
    case 'knights_of_the_frozen_throne_play_dead':
      summon(actorId, 'naxxramas_haunted_creeper')
      break
    case 'knights_of_the_frozen_throne_snowfury_giant':
      playSetupCard(actorId, 'classic_lightning_bolt', [
        { kind: 'hero', participantId: opponentId }
      ])
      break
    case 'goblins_vs_gnomes_upgraded_repair_bot': {
      const mech = summon(actorId, 'goblins_vs_gnomes_snowchugger')
      damage(actorId, mech)
      break
    }
    case 'goblins_vs_gnomes_screwjank_clunker':
      summon(actorId, 'goblins_vs_gnomes_snowchugger')
      break
    case 'goblins_vs_gnomes_hemet_nesingwary':
      summon(opponentId, 'basic_bloodfen_raptor')
      break
    case 'the_grand_tournament_demonfuse':
      summon(actorId, 'classic_doomguard')
      break
    case 'classic_molten_giant': {
      const command = { type: 'dev-set-hero', participantId: actorId, health: 1 }
      requireAccepted(
        cardId,
        'lower hero health',
        command,
        scenario.match.dispatch(command)
      )
      setupCommands.push(command)
      break
    }
    case 'mean_streets_of_gadgetzan_potion_of_madness':
      summon(opponentId, 'classic_wisp')
      break
  }

  if (options.fixtureProfile === 'mixed-board-interaction-v2' && broadDamagedMinionId)
    damage(actorId, broadDamagedMinionId)
  if (options.fixtureProfile === 'mixed-board-interaction-v2') {
    const opponentOgre = findPlayer(scenario.match.getState(), opponentId).board.find(
      (minion) => minion.cardId === 'basic_boulderfist_ogre'
    )
    if (opponentOgre) damage(opponentId, opponentOgre.instanceId)
  }

  if (cardId === 'one_night_in_karazhan_arcane_giant') {
    for (let index = 0; index < 12; index += 1) {
      playSetupCard(actorId, 'basic_the_coin')
    }
  }

  if (
    !findPlayer(scenario.match.getState(), actorId).hand.some(
      (candidate) => candidate.cardId === cardId
    )
  )
    addCard(actorId, cardId)

  const refreshedManaCommand = {
    type: 'dev-set-mana',
    participantId: actorId,
    available: 10,
    maximum: 10
  }
  requireAccepted(
    cardId,
    'restore actor mana after setup',
    refreshedManaCommand,
    scenario.match.dispatch(refreshedManaCommand)
  )
  setupCommands.push(refreshedManaCommand)

  const preActionState = scenario.match.getState()
  const preActionRngState = scenario.rng.snapshot()
  const actorState = findPlayer(preActionState, actorId)
  const handCard = actorState.hand.find((candidate) => candidate.cardId === cardId)
  if (!handCard)
    throw new CardScenarioSetupError(
      cardId,
      'focal-card-not-drawn',
      'Focal card is absent from the actor hand.'
    )

  const inputSelection = options.inputSelection ?? 'first-legal'
  focalInstanceIdForFollowup = handCard.instanceId
  const preFocalActorMinionIds = new Set(actorState.board.map((minion) => minion.instanceId))
  const selected = firstLegalPlay(
    scenario,
    actorId,
    handCard.instanceId,
    inputSelection
  )
  const command = selected.command
  const result = scenario.match.dispatch(command)
  let postFocalState = scenario.match.getState()
  let focalBoardInstanceId: string | undefined
  if (result.accepted && card.type === 'Minion') {
    const newActorMinions = findPlayer(postFocalState, actorId).board.filter(
      (minion) => !preFocalActorMinionIds.has(minion.instanceId)
    )
    const focalMinion =
      newActorMinions.find((minion) => minion.cardId === cardId) ??
      newActorMinions.at(-1)
    focalBoardInstanceId = focalMinion?.instanceId
    focalInstanceIdForFollowup = focalBoardInstanceId
  }
  const followupCommands: unknown[] = []
  const followupResults: OpeningCommandResult[] = []
  const followupStates: OpeningMatchState[] = []
  if (result.accepted) {
    resolvePendingChoices(
      scenario,
      cardId,
      followupCommands,
      followupResults,
      followupStates
    )
    postFocalState = scenario.match.getState()
    for (const followup of options.followups ?? []) {
      resolvePendingChoices(
        scenario,
        cardId,
        followupCommands,
        followupResults,
        followupStates
      )
      if (followup.type === 'end-turn') {
        const activeParticipantId = scenario.match.getState().activePlayerId
        if (!activeParticipantId)
          throw new CardScenarioSetupError(
            cardId,
            'no-active-player',
            'Match has no active player before a follow-up turn boundary.'
          )
        const followupCommand = {
          type: 'end-turn',
          participantId: activeParticipantId
        }
        const followupResult = scenario.match.dispatch(followupCommand)
        followupCommands.push(followupCommand)
        followupResults.push(followupResult)
        followupStates.push(scenario.match.getState())
        if (followupResult.accepted)
          resolvePendingChoices(
            scenario,
            cardId,
            followupCommands,
            followupResults,
            followupStates
          )
        if (
          !followupResult.accepted &&
          (options.followupPolicy ?? 'must-accept') !== 'observe-only'
        )
          break
        continue
      }

      if (followup.type === 'use-hero-power') {
        const followupResult = useHeroPowerFollowup(
          followupCommands,
          followupResults,
          followupStates
        )
        if (
          !followupResult.accepted &&
          (options.followupPolicy ?? 'must-accept') !== 'observe-only'
        )
          break
        continue
      }

      if (followup.type === 'attack-hero') {
        const followupResult = attackHeroFollowup(
          followupCommands,
          followupResults,
          followupStates
        )
        if (
          !followupResult.accepted &&
          (options.followupPolicy ?? 'must-accept') !== 'observe-only'
        )
          break
        continue
      }

      const addCommand = {
        type: 'dev-add-card',
        participantId: actorId,
        cardId: followup.cardId
      }
      const addResult = scenario.match.dispatch(addCommand)
      if (!addResult.accepted && (options.followupPolicy ?? 'must-accept') !== 'observe-only')
        requireAccepted(
          cardId,
          'add follow-up card ' + followup.cardId,
          addCommand,
          addResult
        )
      if (!addResult.accepted) {
        followupCommands.push(addCommand)
        followupResults.push(addResult)
        followupStates.push(scenario.match.getState())
        continue
      }
      setupCommands.push(addCommand)
      const added = findPlayer(scenario.match.getState(), actorId)
        .hand.filter((candidate) => candidate.cardId === followup.cardId)
        .at(-1)
      if (!added)
        throw new CardScenarioSetupError(
          cardId,
          'follow-up-card-not-found',
          followup.cardId
        )
      const instanceId = added.instanceId
      const manaCommand = {
        type: 'dev-set-mana',
        participantId: actorId,
        available: 10,
        maximum: 10
      }
      const manaResult = scenario.match.dispatch(manaCommand)
      followupCommands.push(manaCommand)
      followupResults.push(manaResult)
      followupStates.push(scenario.match.getState())
      requireAccepted(
        cardId,
        'refresh actor mana for companion follow-up',
        manaCommand,
        manaResult
      )
      const followupPlay = firstLegalPlay(scenario, actorId, instanceId)
      const followupResult = scenario.match.dispatch(followupPlay.command)
      followupCommands.push(followupPlay.command)
      followupResults.push(followupResult)
      followupStates.push(scenario.match.getState())
      if (
        !followupResult.accepted &&
        (options.followupPolicy ?? 'must-accept') !== 'observe-only'
      )
        break
      resolvePendingChoices(
        scenario,
        cardId,
        followupCommands,
        followupResults,
        followupStates
      )
    }
  }
  const state = scenario.match.getState()
  let invariantError: string | undefined
  try {
    assertOpeningMatchInvariants(state)
  } catch (error) {
    invariantError = error instanceof Error ? error.message : String(error)
  }
  return {
    cardId,
    seed,
    actor,
    fixtureProfile: options.fixtureProfile ?? 'catalog-smoke-v1',
    actorParticipantId: actorId,
    opponentParticipantId: opponentId,
    entryPath: 'gameplay-play',
    setupCommands,
    initialState,
    preActionState,
    state,
    preActionRngState,
    rngState: scenario.rng.snapshot(),
    inputSelection,
    requiredTargetCount: selected.requiredTargetCount,
    ...(focalBoardInstanceId ? { focalBoardInstanceId } : {}),
    postFocalState,
    followupCommands,
    followupResults,
    followupStates,
    focalInstanceId: handCard.instanceId,
    command,
    result,
    questRegistered,
    invariantError
  }
}

export function cardIdForScenario(cardId: string): CardId {
  if (!CARD_CATALOG.get(cardId))
    throw new Error('Scenario card ' + cardId + ' does not exist.')
  return asCardId(cardId)
}
