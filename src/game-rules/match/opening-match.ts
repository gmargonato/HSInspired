import { applyCthunToCard } from './cthun'
import { resolvePrinceMalchezaar } from './prince-malchezaar'
import { cloneOpeningMatchState, cloneUnknown } from './match-state-snapshot'
export { cloneOpeningMatchState } from './match-state-snapshot'
import {
  getOpeningMatchPublicState,
  getOpeningMatchPublicEvents
} from './match-public-projection'
export {
  getOpeningMatchPublicState,
  getOpeningMatchPublicEvents
} from './match-public-projection'
import {
  triggerHistoryEvents,
  withoutHistoryFacts,
  choiceHistoryEvent,
  fatigueHistoryEvents,
  cardHistoryEvent,
  heroPowerHistoryEvent,
  combatHistoryEvent
} from './match-history'
import { parseCommand } from './match-command-parser'
import { heroPowerUseLimit } from './effects/hero-power-use-limit'
import { CARD_CATALOG, asCardId } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { HERO_POWER_CATALOG, BASIC_HERO_POWER_UPGRADES } from '../content/hero-powers'
import { selectAiHeroPowerBonus } from './ai-bonuses'
import { countDeckCards, type Deck } from '../decks'
import { createSeededRng, type DeterministicRng } from './rng'
import {
  applyDrawScalingBuff,
  EffectRuntime,
  type EffectResolutionResult,
  type EffectResolutionSuccess,
  getDerivedState,
  getMatchLegality,
  getPlayInput,
  resolveAttack,
  resolveCardPlay,
  resolvePendingCardChoice,
  resolvePendingDiscoverChoice,
  resolveHeroPower,
  resolveTurnTransition
} from './effects/effect-runtime'
import type { DraftCard } from './effects/effect-context'
import { assertOpeningMatchInvariants } from './rules/invariants'
import { moveCardForPlayer, removeCardFromPlayer } from './rules/zone-state'
import { createAiObservation } from './ai/observation'
import type { MatchParticipantSetup, MatchSetup, PlayerId } from './match-types'
import type {
  OpeningCard,
  EffectTraceEntry,
  BoardMinion,
  PlayerHeroState,
  PlayerMana,
  OpeningPlayerState,
  OpeningMatchState,
  PlayCardCommand,
  ChooseDiscoverCardCommand,
  ChooseCardOptionCommand,
  DevAddCardCommand,
  DevSetManaCommand,
  DevModifyDeckCommand,
  DevSummonMinionCommand,
  DevEndMatchCommand,
  CharacterDamagedEvent,
  MinionCombatPreview,
  OpeningMatchEvent,
  OpeningAcceptedResult,
  OpeningRejectionCode,
  OpeningRejectedResult,
  OpeningCommandResult,
  OpeningMatchInstance,
  OpeningMatchCheckpoint,
  OpeningMatchPublicEvent,
  OpeningMatchPublicState,
  PlayCardInput,
  MatchLegality
} from './opening-match-types'
export type * from './opening-match-types'

/** Maximum number of cards a player may hold in hand. */
export const MAX_HAND_SIZE = 10

/** Maximum number of mana crystals a player may accumulate. */
export const MAX_MANA = 10

/** Maximum number of minions a player may have on their board. */
export const MAX_BOARD_SIZE = 7

const COIN_CARD_ID = asCardId('basic_the_coin')

function cloneCard(card: OpeningCard): OpeningCard {
  return cloneUnknown(card)
}

function cloneBoardMinion(minion: BoardMinion): BoardMinion {
  return cloneUnknown(minion)
}

export function hasSummoningSickness(
  minion: BoardMinion,
  currentTurn: number
): boolean {
  return minion.summonedOnTurn >= currentTurn
}

export function canBoardMinionAttack(
  minion: BoardMinion,
  state: OpeningMatchState,
  ownerId: PlayerId
): boolean {
  return getMatchLegality(state, ownerId).legalAttackerInstanceIds.includes(
    minion.instanceId
  )
}

/** Effective Attack shown on a hero during that hero's own turn. */
export function getHeroAttack(
  player: Pick<OpeningPlayerState, 'hero' | 'weapon'>
): number {
  return Math.max(0, player.hero.attack) + (player.weapon?.attack ?? 0)
}

export function canHeroAttack(
  _player: Pick<OpeningPlayerState, 'hero' | 'weapon'>,
  state: OpeningMatchState,
  ownerId: PlayerId
): boolean {
  return (
    getMatchLegality(state, ownerId).legalAttackTargets[`${ownerId}:hero`] !== undefined
  )
}

/** Resolves the stat-only result used both by targeting previews and combat. */
export function previewMinionCombat(
  attacker: Pick<BoardMinion, 'attack' | 'health'>,
  defender: Pick<BoardMinion, 'attack' | 'health'>
): MinionCombatPreview {
  const attackerHealthAfter = Math.max(0, attacker.health - defender.attack)
  const defenderHealthAfter = Math.max(0, defender.health - attacker.attack)
  return {
    attackerHealthAfter,
    defenderHealthAfter,
    attackerDestroyed: attackerHealthAfter === 0,
    defenderDestroyed: defenderHealthAfter === 0
  }
}

function shuffle<T>(items: readonly T[], random: DeterministicRng): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1))
    const current = result[index]
    const replacement = result[swapIndex]
    if (current === undefined || replacement === undefined) continue
    result[index] = replacement
    result[swapIndex] = current
  }
  return result
}

function expandDeck(
  deck: Deck,
  participant: MatchParticipantSetup,
  ordinalOffset = 0
): OpeningCard[] {
  if (countDeckCards(deck) !== 30) {
    throw new Error(`Deck ${deck.id} must contain exactly 30 cards.`)
  }

  const cards: OpeningCard[] = []
  let ordinal = 0
  for (const [cardId, count] of Object.entries(deck.cards)) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Deck ${deck.id} contains an invalid count for ${cardId}.`)
    }
    const definition = CARD_CATALOG.get(cardId)
    if (!definition)
      throw new Error(`Deck ${deck.id} references unknown card ${cardId}.`)

    for (let copy = 0; copy < count; copy += 1) {
      cards.push({
        instanceId: `${participant.participantId}:deck:${ordinal}`,
        cardId: definition.id,
        startedInDeck: true,
        ownerId: participant.participantId,
        controllerId: participant.participantId,
        creationOrdinal: ordinalOffset + ordinal,
        baseCost: definition.cost,
        currentCost: definition.cost,
        zone: 'deck',
        revealed: false
      })
      ordinal += 1
    }
  }
  return cards
}

function hasNoDuplicateCards(cards: readonly OpeningCard[]): boolean {
  return new Set(cards.map((card) => card.cardId)).size === cards.length
}

function deckDefinitionHasNoDuplicates(deck: Deck): boolean {
  return Object.values(deck.cards).every((count) => count === 1)
}

function findPlayerIndex(
  players: readonly [OpeningPlayerState, OpeningPlayerState],
  participantId: PlayerId
): 0 | 1 | -1 {
  if (players[0].participantId === participantId) return 0
  if (players[1].participantId === participantId) return 1
  return -1
}

function growMana(mana: PlayerMana): PlayerMana {
  const maximum = Math.min(MAX_MANA, mana.maximum + 1)
  return {
    available: maximum,
    maximum,
    overloadLocked: 0,
    overloadNextTurn: mana.overloadNextTurn ?? 0
  }
}

function drawCards(
  player: OpeningPlayerState,
  count: number
): { player: OpeningPlayerState; cards: OpeningCard[] } {
  const cards = player.deck.slice(0, count).map((card) => ({
    ...cloneCard(card),
    zone: 'hand' as const,
    revealed: true
  }))
  return {
    cards,
    player: {
      ...player,
      deck: player.deck.slice(cards.length),
      hand: [...player.hand, ...cards]
    }
  }
}

interface HeroDamageResult {
  readonly hero: PlayerHeroState
  readonly event: CharacterDamagedEvent
}

function damageHero(
  player: OpeningPlayerState,
  amount: number,
  source: CharacterDamagedEvent['source']
): HeroDamageResult {
  const armorDamage = Math.min(player.hero.armor, amount)
  const healthDamage = Math.max(0, amount - armorDamage)
  const hero = {
    ...player.hero,
    armor: player.hero.armor - armorDamage,
    health: Math.max(0, player.hero.health - healthDamage),
    damageTaken: Math.max(
      0,
      player.hero.maxHealth - Math.max(0, player.hero.health - healthDamage)
    )
  }
  return {
    hero,
    event: {
      type: 'character-damaged',
      source,
      participantId: player.participantId,
      character: { kind: 'hero' },
      amount,
      healthBefore: player.hero.health,
      healthAfter: hero.health,
      armorBefore: player.hero.armor,
      armorAfter: hero.armor,
      destroyed: hero.health === 0
    }
  }
}

function reject(
  state: OpeningMatchState,
  code: OpeningRejectionCode,
  message: string
): OpeningRejectedResult {
  return {
    accepted: false,
    code,
    message,
    state: cloneOpeningMatchState(state),
    events: []
  }
}

function applyDevAddCard(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevAddCardCommand,
  counter: number
): OpeningCommandResult & { nextEntityOrdinal?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const player = state.players[playerIndex]
  if (player.hand.length >= MAX_HAND_SIZE) {
    return reject(state, 'hand-full', 'The hand is full.')
  }

  const definition = CARD_CATALOG.get(command.cardId)
  if (!definition) {
    return reject(state, 'unknown-card', `Unknown card ${command.cardId}.`)
  }

  const card: OpeningCard = applyCthunToCard(
    {
      instanceId: `${player.participantId}:dev:${counter}`,
      cardId: definition.id,
      ownerId: player.participantId,
      controllerId: player.participantId,
      creationOrdinal: counter,
      baseCost: definition.cost,
      currentCost: definition.cost,
      zone: 'hand',
      revealed: true
    },
    player
  )

  const nextPlayer: OpeningPlayerState = {
    ...player,
    hand: [...player.hand, card]
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1,
    nextEntityOrdinal: counter + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-card-added',
        participantId: player.participantId,
        card: cloneCard(card)
      }
    ],
    nextEntityOrdinal: counter + 1
  }
}

function applyDevSummonMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevSummonMinionCommand,
  counter: number
): OpeningCommandResult & { nextEntityOrdinal?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (player.board.length >= MAX_BOARD_SIZE) {
    return reject(state, 'board-full', 'The board is full.')
  }
  const definition = CARD_CATALOG.get(command.cardId)
  if (!definition) {
    return reject(state, 'unknown-card', `Unknown card ${command.cardId}.`)
  }
  if (definition.type !== 'Minion') {
    return reject(state, 'not-a-minion', 'Only minion cards can be summoned.')
  }

  const runtimeCard = applyCthunToCard(
    {
      instanceId: `${player.participantId}:dev:${counter}`,
      cardId: definition.id,
      baseCost: definition.cost,
      currentCost: definition.cost,
      zone: 'hand',
      revealed: true
    },
    player
  )
  const minion: BoardMinion = {
    instanceId: `${player.participantId}:dev:${counter}`,
    cardId: definition.id,
    attack: runtimeCard.attack ?? definition.attack,
    health: runtimeCard.health ?? definition.health,
    maxHealth: runtimeCard.health ?? definition.health,
    summonedOnTurn: state.turnNumber,
    lastAttackedOnTurn: null,
    ownerId: player.participantId,
    controllerId: player.participantId,
    creationOrdinal: counter,
    playOrder: counter,
    baseAttack: definition.attack,
    baseHealth: definition.health,
    keywords: [...definition.keywords],
    enchantments: runtimeCard.enchantments ?? [],
    grantedTriggers: [],
    deathrattles: definition.effects.filter(
      (effect) => effect.trigger === 'deathrattle'
    ),
    silenced: false,
    frozenUntilTurn: null,
    divineShield: definition.keywords.includes('divine-shield'),
    stealth: definition.keywords.includes('stealth'),
    immune: definition.keywords.includes('immune'),
    spellImmune: definition.keywords.includes('spell-immune'),
    attacksUsedThisTurn: 0,
    maxAttacksPerTurn: definition.keywords.includes('mega-windfury')
      ? 4
      : definition.keywords.includes('windfury')
        ? 2
        : 1,
    damageTaken: 0
  }
  const position = player.board.length
  const nextPlayer: OpeningPlayerState = {
    ...player,
    board: [...player.board.map(cloneBoardMinion), minion]
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1,
    nextEntityOrdinal: counter + 1
  }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-minion-summoned',
        participantId: player.participantId,
        minion: cloneBoardMinion(minion),
        position
      }
    ],
    nextEntityOrdinal: counter + 1
  }
}

function applyDevEndMatch(
  state: OpeningMatchState,
  command: DevEndMatchCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const winnerIndex = findPlayerIndex(state.players, command.winnerId)
  if (winnerIndex === -1) {
    return reject(
      state,
      'unknown-participant',
      `Unknown participant: ${command.winnerId}`
    )
  }
  const loserIndex: 0 | 1 = winnerIndex === 0 ? 1 : 0
  const winnerId = state.players[winnerIndex].participantId
  const loserId = state.players[loserIndex].participantId
  const nextState: OpeningMatchState = {
    ...state,
    phase: 'ended',
    activePlayerId: null,
    winnerId,
    loserId,
    revision: state.revision + 1
  }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [{ type: 'match-ended', winnerId, loserId, reason: 'dev-forced' }]
  }
}

function applyDevSetMana(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevSetManaCommand
): OpeningCommandResult {
  if (
    !Number.isInteger(command.available) ||
    command.available < 0 ||
    command.available > MAX_MANA
  ) {
    return reject(state, 'invalid-mana', 'Available mana must be between 0 and 10.')
  }
  if (
    !Number.isInteger(command.maximum) ||
    command.maximum < 0 ||
    command.maximum > MAX_MANA
  ) {
    return reject(state, 'invalid-mana', 'Maximum mana must be between 0 and 10.')
  }
  if (command.available > command.maximum) {
    return reject(state, 'invalid-mana', 'Available mana cannot exceed maximum.')
  }

  const player = state.players[playerIndex]
  const nextMana: PlayerMana = {
    available: command.available,
    maximum: command.maximum
  }
  const nextPlayer: OpeningPlayerState = { ...player, mana: nextMana }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-mana-set',
        participantId: player.participantId,
        mana: nextMana
      }
    ]
  }
}

function applyDevModifyDeck(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevModifyDeckCommand,
  refillDeck: () => readonly OpeningCard[]
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  const deck = command.action === 'destroy' ? [] : refillDeck()
  const nextPlayer: OpeningPlayerState = {
    ...player,
    deck,
    deckHasNoDuplicates: hasNoDuplicateCards(deck)
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-deck-modified',
        participantId: player.participantId,
        action: command.action,
        deckCount: deck.length
      }
    ]
  }
}

function applyDevStateChange(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  player: OpeningPlayerState
): OpeningAcceptedResult {
  const players = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  players[playerIndex] = player
  const nextState = { ...state, players, revision: state.revision + 1 }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [{ type: 'dev-state-changed', participantId: player.participantId }]
  }
}

/**
 * Creates the platform-neutral opening sequence used by GameScene.
 *
 * Deck contents are supplied as snapshots so the game process owns all card
 * movement while the renderer remains responsible only for presentation.
 */
export function createOpeningMatch(
  setup: MatchSetup,
  deckSnapshots: readonly Deck[],
  rng: DeterministicRng = createSeededRng(setup.seed),
  checkpoint?: OpeningMatchCheckpoint
): OpeningMatchInstance {
  const recordEffectTrace = setup.recordEffectTrace === true
  const decksById = new Map(deckSnapshots.map((deck) => [deck.id, deck]))
  const configuredPlayerOneIndex =
    setup.startingParticipantId === undefined
      ? -1
      : setup.participants.findIndex(
          (participant) => participant.participantId === setup.startingParticipantId
        )
  if (
    configuredPlayerOneIndex !== -1 &&
    configuredPlayerOneIndex !== 0 &&
    configuredPlayerOneIndex !== 1
  )
    throw new Error('MatchSetup.startingParticipantId must identify a participant.')
  const playerOneIndex: 0 | 1 =
    configuredPlayerOneIndex === 0 || configuredPlayerOneIndex === 1
      ? configuredPlayerOneIndex
      : rng.next() < 0.5
        ? 0
        : 1
  const playerTwoIndex: 0 | 1 = playerOneIndex === 0 ? 1 : 0
  const order = [playerOneIndex, playerTwoIndex] as const
  const bonusRngSnapshot = rng.snapshot()
  const aiHeroPowerBonus = selectAiHeroPowerBonus(
    setup.participants,
    rng,
    setup.aiHeroPowerBonusEnabled !== false
  )
  rng.restore(bonusRngSnapshot)
  let initialEntityOrdinal = 0

  const createPlayer = (
    participantIndex: 0 | 1,
    seatIndex: 0 | 1
  ): OpeningPlayerState => {
    const participant = setup.participants[participantIndex]
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const hero = HERO_CATALOG.require(participant.heroId)
    const heroPowerBonus =
      participant.controllerKind === 'ai' ? aiHeroPowerBonus : 'none'
    const heroPower = HERO_POWER_CATALOG.require(
      heroPowerBonus === 'upgraded'
        ? (BASIC_HERO_POWER_UPGRADES[hero.heroPowerId] ?? hero.heroPowerId)
        : hero.heroPowerId
    )
    const startingHealth = hero.startingHealth
    const expanded = expandDeck(deck, participant, initialEntityOrdinal)
    initialEntityOrdinal += expanded.length
    const questCards = expanded.filter((card) => {
      const definition = CARD_CATALOG.get(card.cardId)
      return definition?.type === 'Spell' && definition.quest !== undefined
    })
    if (questCards.length > 1)
      throw new Error(`Deck ${deck.id} cannot contain more than one Quest.`)
    const questDefinition = questCards[0]
      ? CARD_CATALOG.get(questCards[0].cardId)
      : undefined
    const quest = questDefinition?.type === 'Spell' ? questDefinition.quest : undefined
    const drawable = expanded.filter((card) => !questCards.includes(card))
    const shuffled = shuffle(drawable, rng)
    const initialCount = seatIndex === 0 ? 3 : 4
    const initialCards = shuffled.slice(0, initialCount).map((card) => ({
      ...card,
      zone: 'hand' as const,
      revealed: true
    }))
    return {
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      heroId: participant.heroId,
      hero: {
        health: startingHealth,
        maxHealth: startingHealth,
        armor: 0,
        attack: 0,
        lastAttackedOnTurn: null,
        instanceId: `${participant.participantId}:hero`,
        creationOrdinal: initialEntityOrdinal++,
        baseAttack: 0,
        baseMaxHealth: startingHealth,
        baseKeywords: [],
        keywords: [],
        enchantments: [],
        frozenUntilTurn: null,
        immune: false,
        spellImmune: false,
        attacksUsedThisTurn: 0,
        maxAttacksPerTurn: 1,
        damageTaken: 0
      },
      playerNumber: (seatIndex + 1) as 1 | 2,
      deck: shuffled.slice(initialCount),
      originalDeckCardIds: drawable.map((card) => card.cardId),
      quest:
        questDefinition && quest
          ? {
              cardId: questDefinition.id,
              rewardCardId: quest.rewardCardId,
              goal: quest.goal,
              progress: 0,
              target: quest.target
            }
          : null,
      hand: initialCards,
      board: [],
      weapon: null,
      mana: {
        available: 0,
        maximum: 0
      },
      deckHasNoDuplicates: deckDefinitionHasNoDuplicates(deck),
      heroPower: {
        id: heroPower.id,
        creationOrdinal: initialEntityOrdinal++,
        cost: heroPowerBonus === 'cost-one' ? 1 : heroPower.cost,
        baseCost: heroPower.cost,
        available: false,
        targetType: heroPower.targeting,
        targetingGranted: null,
        enchantments: []
      },
      ...(heroPowerBonus === 'cost-one' ? { heroPowerCostOverride: 1 } : {}),
      fatigueDamage: 1,
      mulliganConfirmed: false,
      secrets: [],
      graveyard: [],
      discardedCards: [],
      overload: 0,
      counters: {}
    } satisfies OpeningPlayerState
  }
  const players = [createPlayer(order[0], 0), createPlayer(order[1], 1)] as [
    OpeningPlayerState,
    OpeningPlayerState
  ]

  let state: OpeningMatchState = {
    phase: 'mulligan',
    playerOneId: players[0].participantId,
    playerTwoId: players[1].participantId,
    activePlayerId: null,
    turnNumber: 0,
    winnerId: null,
    loserId: null,
    players,
    revision: 0,
    history: {
      cardsPlayedThisTurn: [],
      cardsCastThisTurn: [],
      cardsDrawnThisTurn: [],
      minionsSummonedThisTurn: [],
      minionsDiedThisTurn: [],
      damageDealtThisTurn: 0,
      damageTakenThisTurn: 0,
      healingThisTurn: 0,
      armorGainedThisTurn: 0,
      cardsPlayedThisGame: [],
      spellsCastThisGameByPlayer: {},
      totemsSummonedThisGameByPlayer: {},
      secretsPlayedThisGameByPlayer: {},
      cardsDiedThisGame: [],
      cardsDiscardedThisGameByPlayer: {},
      overloadedManaThisGameByPlayer: {},
      offClassCardsAddedToHandThisGameByPlayer: {},
      beastsSummonedByPlayer: {},
      heroPowersUsedByPlayer: {}
    },
    ...(recordEffectTrace ? { effectTrace: [] } : {}),
    nextEntityOrdinal: initialEntityOrdinal,
    turnLimitSeconds: null,
    turnStartedAtRevision: null,
    pendingResolution: false,
    scheduledEffects: []
  }
  assertOpeningMatchInvariants(state)
  let nextEntityOrdinal = state.nextEntityOrdinal ?? 0

  const commitState = (nextState: OpeningMatchState): void => {
    // Resolvers (including dev commands) may return nextState to their caller.
    // Own one isolated copy, validate it before publication, and never expose it.
    // Queries and previews continue to return their own independent snapshots.
    const committed = cloneOpeningMatchState(nextState)
    assertOpeningMatchInvariants(committed)
    state = committed
  }
  let devDeckRefillCounter = 0
  let queryRuntime: EffectRuntime | null = null
  let queryRevision = -1
  let queryState: OpeningMatchState | null = null
  let derivedStateCache: OpeningMatchState | null = null
  const playInputCache = new Map<string, PlayCardInput | null>()
  const legalityCache = new Map<PlayerId, MatchLegality>()

  /** Reuses the expensive derived-state setup across pure queries at one revision. */
  const getQueryRuntime = (): EffectRuntime => {
    if (queryRuntime && queryRevision === state.revision && queryState === state)
      return queryRuntime
    queryRuntime = new EffectRuntime(state)
    queryRevision = state.revision
    queryState = state
    derivedStateCache = null
    playInputCache.clear()
    legalityCache.clear()
    return queryRuntime
  }

  const getDerivedSnapshot = (): OpeningMatchState => {
    getQueryRuntime()
    derivedStateCache ??= queryRuntime!.getDerivedState()
    return derivedStateCache
  }

  if (checkpoint) {
    if (checkpoint.schemaVersion !== 1) {
      throw new Error(
        `Unsupported match checkpoint schema ${checkpoint.schemaVersion}.`
      )
    }
    state = cloneOpeningMatchState(checkpoint.state)
    assertOpeningMatchInvariants(state)
    rng.restore(checkpoint.rngState)
    nextEntityOrdinal = checkpoint.nextEntityOrdinal
    devDeckRefillCounter = checkpoint.devDeckRefillCounter
  }

  const completeOpening = (events: OpeningMatchEvent[]): void => {
    const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
    const playerTwo = nextPlayers[1]
    const coin: OpeningCard = {
      instanceId: `${playerTwo.participantId}:coin`,
      cardId: COIN_CARD_ID,
      ownerId: playerTwo.participantId,
      controllerId: playerTwo.participantId,
      creationOrdinal: nextEntityOrdinal++,
      baseCost: CARD_CATALOG.require(COIN_CARD_ID).cost,
      currentCost: CARD_CATALOG.require(COIN_CARD_ID).cost,
      zone: 'hand',
      revealed: true
    }
    const playerTwoWithCoin: OpeningPlayerState = {
      ...playerTwo,
      hand: [...playerTwo.hand, coin]
    }
    nextPlayers[1] = playerTwoWithCoin
    events.push({
      type: 'coin-granted',
      participantId: playerTwo.participantId,
      card: cloneCard(coin)
    })

    const openingHistory = nextPlayers.flatMap((player, index) => {
      const participant = setup.participants.find(
        (p) => p.participantId === player.participantId
      )!
      const resolved = resolvePrinceMalchezaar(
        player,
        decksById.get(participant.deckId)!,
        rng,
        () => nextEntityOrdinal++
      )
      nextPlayers[index] = resolved.player
      return resolved.history ? [resolved.history] : []
    })
    for (const player of nextPlayers) {
      if (!player.quest) continue
      openingHistory.push({
        type: 'history-action-resolved',
        entryId: `${player.participantId}:quest-opening`,
        participantId: player.participantId,
        action: 'trigger',
        source: {
          id: `${player.participantId}:quest-opening`,
          participantId: player.participantId,
          kind: 'card',
          cardId: player.quest.cardId,
          zone: 'revealed',
          publicIdentity: true
        },
        outcomes: []
      })
    }
    events.push(...openingHistory)
    const playerOne = nextPlayers[0]
    const drawn = drawCards(playerOne, 1)
    const playerOneMana = growMana(playerOne.mana)
    nextPlayers[0] = {
      ...drawn.player,
      mana: playerOneMana,
      heroPower: { ...drawn.player.heroPower, available: true }
    }
    state = {
      ...state,
      phase: 'turns',
      activePlayerId: playerOne.participantId,
      turnNumber: 1,
      players: nextPlayers,
      revision: state.revision + 1,
      turnStartedAtRevision: state.revision + 1,
      ...(openingHistory.length ? { openingHistory } : {}),
      nextEntityOrdinal
    }
    events.push({
      type: 'opening-turn-started',
      participantId: playerOne.participantId,
      playerNumber: 1,
      mana: playerOneMana
    })
    const card = drawn.cards[0]
    if (card) {
      events.push({
        type: 'opening-card-drawn',
        participantId: playerOne.participantId,
        card: cloneCard(card)
      })
    }
  }

  const refillDeckFor = (participantId: PlayerId): readonly OpeningCard[] => {
    const participant = setup.participants.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!participant) throw new Error(`Unknown participant: ${participantId}`)
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const refillId = devDeckRefillCounter
    devDeckRefillCounter += 1
    const expanded = expandDeck(deck, participant, nextEntityOrdinal).filter((card) => {
      const definition = CARD_CATALOG.get(card.cardId)
      return definition?.type !== 'Spell' || !definition.quest
    })
    nextEntityOrdinal += expanded.length
    return shuffle(expanded, rng).map((card, ordinal) => ({
      ...card,
      instanceId: `${participant.participantId}:dev-refill:${refillId}:${ordinal}`
    }))
  }

  /** Publishes successful drafts, or restores RNG and preserves rejection diagnostics. */
  const commitResolution = (
    result: EffectResolutionResult,
    rngSnapshot: unknown
  ): EffectResolutionSuccess | OpeningRejectedResult => {
    if (!result.accepted) {
      rng.restore(rngSnapshot)
      return {
        accepted: false,
        code: result.code as OpeningRejectionCode,
        message: result.message,
        state: cloneOpeningMatchState(result.state),
        events: [],
        diagnostic: result.diagnostic
      }
    }
    commitState(result.state)
    nextEntityOrdinal = result.nextEntityOrdinal
    return result
  }

  const dispatchPlayCard = (command: PlayCardCommand): OpeningCommandResult => {
    const before = state
    const rngSnapshot = rng.snapshot()
    const input = getPlayInput(
      state,
      command.participantId,
      command.cardInstanceId,
      command.choice
    )
    const deferChoice =
      command.choice === undefined && input?.choiceTiming === 'after-placement'
    const resolution = resolveCardPlay({
      state,
      rng,
      participantId: command.participantId,
      cardInstanceId: command.cardInstanceId,
      ...(command.position === undefined ? {} : { position: command.position }),
      ...(command.targets === undefined ? {} : { targets: command.targets }),
      ...(command.choice === undefined ? {} : { choice: command.choice }),
      ...(deferChoice ? { deferChoice: true } : {}),
      nextEntityOrdinal,
      recordTrace: recordEffectTrace
    })
    const result = commitResolution(resolution, rngSnapshot)
    if (!result.accepted) return result
    const history = cardHistoryEvent(before, result.state, command, result.events)
    return {
      accepted: true,
      state: cloneOpeningMatchState(state),
      events: [
        ...withoutHistoryFacts(result.events),
        ...(history ? [history] : []),
        ...triggerHistoryEvents(before, result.state, result.events, false),
        ...fatigueHistoryEvents(before, result.events)
      ]
    }
  }

  const dispatchCardChoice = (
    command: ChooseCardOptionCommand
  ): OpeningCommandResult => {
    const before = state
    const rngSnapshot = rng.snapshot()
    const resolution = resolvePendingCardChoice({
      state,
      rng,
      participantId: command.participantId,
      sourceCardInstanceId: command.sourceCardInstanceId,
      choice: command.choice,
      nextEntityOrdinal,
      recordTrace: recordEffectTrace
    })
    const result = commitResolution(resolution, rngSnapshot)
    if (!result.accepted) return result
    return {
      accepted: true,
      state: cloneOpeningMatchState(state),
      events: [
        ...withoutHistoryFacts(result.events),
        ...(() => {
          const history = choiceHistoryEvent(
            before,
            result.state,
            command.sourceCardInstanceId,
            command.participantId,
            result.events,
            command.choice
          )
          return history ? [history] : []
        })(),
        ...triggerHistoryEvents(before, result.state, result.events, false)
      ]
    }
  }

  const dispatchDiscoverChoice = (
    command: ChooseDiscoverCardCommand
  ): OpeningCommandResult => {
    const pending = state.pendingDiscover
    if (!pending)
      return reject(state, 'invalid-command', 'No Discover choice is pending.')
    if (pending.participantId !== command.participantId)
      return reject(
        state,
        'wrong-controller',
        'Only the Discover owner may choose a card.'
      )
    // Board choices require the summon resolver even without follow-up actions.
    if (pending.continuation || pending.destination === 'board') {
      const before = state
      const rngSnapshot = rng.snapshot()
      const resolution = resolvePendingDiscoverChoice({
        state,
        rng,
        participantId: command.participantId,
        cardInstanceId: command.cardInstanceId,
        nextEntityOrdinal,
        recordTrace: recordEffectTrace
      })
      const result = commitResolution(resolution, rngSnapshot)
      if (!result.accepted) return result
      const selected = result.events.find((event) => event.type === 'card-drawn')
      const events = [...withoutHistoryFacts(result.events)]
      if (selected?.type === 'card-drawn')
        events.push({
          type: 'history-action-resolved',
          append: true,
          participantId: command.participantId,
          action: 'card',
          source: {
            id: pending.sourceCardInstanceId,
            participantId: command.participantId,
            kind: 'card',
            cardId: pending.publicSourceCardId ?? null
          },
          outcomes: [
            {
              kind: 'create-hand',
              target: {
                id: selected.card.instanceId,
                participantId: command.participantId,
                kind: 'card',
                cardId: selected.card.cardId,
                zone: 'hand',
                baseCost: selected.card.baseCost,
                currentCost: selected.card.currentCost
              }
            }
          ]
        })
      return {
        accepted: true,
        state: cloneOpeningMatchState(state),
        events: [
          ...events,
          ...triggerHistoryEvents(before, result.state, result.events, false),
          ...fatigueHistoryEvents(before, result.events)
        ]
      }
    }
    if (!pending.candidates.some((card) => card.instanceId === command.cardInstanceId))
      return reject(
        state,
        'invalid-target',
        'The selected card is not a Discover candidate.'
      )

    const playerIndex = findPlayerIndex(state.players, command.participantId)
    if (playerIndex === -1)
      return reject(state, 'unknown-participant', 'Unknown participant.')
    let player = state.players[playerIndex]
    const events: OpeningMatchEvent[] = []
    const candidatesAreCopies =
      pending.origin === 'generated' || pending.origin === 'opponent-deck'
    for (const candidate of pending.candidates) {
      if (candidatesAreCopies && candidate.instanceId !== command.cardInstanceId) {
        const removed = removeCardFromPlayer(player, candidate.instanceId)
        if (!removed || removed.zone !== 'revealed')
          return reject(
            state,
            'stale-target',
            'A Discover candidate is no longer available.'
          )
        player = removed.player
        continue
      }
      const isSelected = candidate.instanceId === command.cardInstanceId
      const burned = isSelected && player.hand.length >= MAX_HAND_SIZE
      const destination = isSelected && !burned ? 'hand' : 'discarded'
      const moved = moveCardForPlayer(player, candidate.instanceId, destination)
      if (!moved || moved.from !== 'revealed')
        return reject(
          state,
          'stale-target',
          'A Discover candidate is no longer available.'
        )
      player = moved.player
      if (isSelected) {
        events.push({
          type: burned ? 'card-burned' : 'card-drawn',
          participantId: command.participantId,
          card: burned
            ? { ...moved.card, zone: 'discarded', revealed: false }
            : moved.card
        })
      }
    }
    const players = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
    players[playerIndex] = player
    const nextPending =
      pending.queued && pending.queued.length > 0
        ? {
            ...pending.queued[0]!,
            ...(pending.queued.length > 1 ? { queued: pending.queued.slice(1) } : {})
          }
        : undefined
    if (nextPending)
      events.push({
        type: 'discover-started',
        participantId: nextPending.participantId,
        sourceCardInstanceId: nextPending.sourceCardInstanceId,
        candidates: nextPending.candidates
      })
    const nextState: OpeningMatchState = {
      ...state,
      players,
      pendingDiscover: nextPending,
      revision: state.revision + 1
    }
    assertOpeningMatchInvariants(nextState)
    commitState(nextState)
    const selected = events.find((event) => event.type === 'card-drawn')
    if (selected?.type === 'card-drawn')
      events.push({
        type: 'history-action-resolved',
        append: true,
        participantId: command.participantId,
        action: 'card',
        source: {
          id: pending.sourceCardInstanceId,
          participantId: command.participantId,
          kind: 'card',
          cardId: pending.publicSourceCardId ?? null
        },
        outcomes: [
          {
            kind: 'create-hand',
            target: {
              id: selected.card.instanceId,
              participantId: command.participantId,
              kind: 'card',
              cardId: selected.card.cardId,
              zone: 'hand',
              baseCost: selected.card.baseCost,
              currentCost: selected.card.currentCost
            }
          }
        ]
      })
    return { accepted: true, state: cloneOpeningMatchState(state), events }
  }
  const dispatchTurnTransition = (participantId: PlayerId): OpeningCommandResult => {
    const before = state
    const rngSnapshot = rng.snapshot()
    const resolution = resolveTurnTransition({
      state,
      rng,
      participantId,
      nextEntityOrdinal,
      recordTrace: recordEffectTrace
    })
    const result = commitResolution(resolution, rngSnapshot)
    if (!result.accepted) return result
    const history = [
      ...triggerHistoryEvents(before, result.state, result.events),
      ...fatigueHistoryEvents(before, result.events)
    ]
    return {
      accepted: true,
      state: cloneOpeningMatchState(state),
      events: [...withoutHistoryFacts(result.events), ...history]
    }
  }

  const instance: OpeningMatchInstance = {
    setup,
    getState(): OpeningMatchState {
      return cloneOpeningMatchState(getDerivedSnapshot())
    },
    getCheckpoint(): OpeningMatchCheckpoint {
      return {
        schemaVersion: 1,
        setup,
        decks: deckSnapshots,
        state: cloneOpeningMatchState(state),
        rngState: rng.snapshot(),
        nextEntityOrdinal,
        devDeckRefillCounter
      }
    },
    getPlayInput(
      participantId: PlayerId,
      cardInstanceId: string,
      choice?: number
    ): PlayCardInput | null {
      const runtime = getQueryRuntime()
      const key = `${participantId}\u0000${cardInstanceId}\u0000${choice ?? ''}`
      if (playInputCache.has(key)) return playInputCache.get(key) ?? null
      const input = runtime.getPlayInput(participantId, cardInstanceId, choice)
      playInputCache.set(key, input)
      return input
    },
    getLegality(participantId: PlayerId): MatchLegality {
      const runtime = getQueryRuntime()
      const cached = legalityCache.get(participantId)
      if (cached) return cached
      const legality = runtime.getMatchLegality(participantId)
      legalityCache.set(participantId, legality)
      return legality
    },
    getAttackLegality(participantId: PlayerId) {
      return getQueryRuntime().getAttackLegality(participantId)
    },
    getEffectTrace(): readonly EffectTraceEntry[] {
      return state.effectTrace ? state.effectTrace.map((entry) => ({ ...entry })) : []
    },
    getPublicState(participantId: PlayerId): OpeningMatchPublicState {
      return getOpeningMatchPublicState(getDerivedSnapshot(), participantId)
    },
    getAiObservation(participantId, policy) {
      if (policy !== 'fair') {
        throw new Error(`Unsupported AI information policy: ${String(policy)}`)
      }
      return createAiObservation(
        getDerivedSnapshot(),
        setup,
        deckSnapshots,
        participantId
      )
    },
    getPublicEvents(
      participantId: PlayerId,
      events: readonly OpeningMatchEvent[]
    ): readonly OpeningMatchPublicEvent[] {
      return getOpeningMatchPublicEvents(events, participantId)
    },
    preview(commandValue: unknown): OpeningCommandResult {
      const stateSnapshot = cloneOpeningMatchState(state)
      const rngSnapshot = rng.snapshot()
      const nextEntityOrdinalSnapshot = nextEntityOrdinal
      const devDeckRefillCounterSnapshot = devDeckRefillCounter
      try {
        return instance.dispatch(commandValue)
      } finally {
        state = stateSnapshot
        rng.restore(rngSnapshot)
        nextEntityOrdinal = nextEntityOrdinalSnapshot
        devDeckRefillCounter = devDeckRefillCounterSnapshot
      }
    },
    previewSequence(commandValues: readonly unknown[]): OpeningCommandResult {
      return instance.analyze((fork) => {
        let result: OpeningCommandResult | null = null
        for (const command of commandValues) {
          result = fork.dispatch(command)
          if (!result.accepted) return result
        }
        return (
          result ??
          reject(state, 'invalid-command', 'A preview sequence must contain a command.')
        )
      })
    },
    analyze<T>(
      operation: (fork: import('./opening-match-types').OpeningMatchAnalysis) => T
    ): T {
      const stateSnapshot = cloneOpeningMatchState(state)
      const rngSnapshot = rng.snapshot()
      const nextEntityOrdinalSnapshot = nextEntityOrdinal
      const devDeckRefillCounterSnapshot = devDeckRefillCounter
      try {
        return operation({
          getState: () => instance.getState(),
          getRandomState: () => rng.snapshot(),
          getAiObservation: (participantId, policy) =>
            instance.getAiObservation!(participantId, policy),
          dispatch: (command: unknown) => instance.dispatch(command),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            instance.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => instance.getLegality!(participantId),
          getAttackLegality: (participantId) =>
            instance.getAttackLegality!(participantId),
          analyze: (nestedOperation) => instance.analyze(nestedOperation)
        })
      } finally {
        state = stateSnapshot
        rng.restore(rngSnapshot)
        nextEntityOrdinal = nextEntityOrdinalSnapshot
        devDeckRefillCounter = devDeckRefillCounterSnapshot
      }
    },
    analyzeWithSeed<T>(
      seed: number,
      operation: (fork: import('./opening-match-types').OpeningMatchAnalysis) => T
    ): T {
      const stateSnapshot = cloneOpeningMatchState(state)
      const rngSnapshot = rng.snapshot()
      const nextEntityOrdinalSnapshot = nextEntityOrdinal
      const devDeckRefillCounterSnapshot = devDeckRefillCounter
      try {
        rng.restore(seed)
        return operation({
          getState: () => instance.getState(),
          getRandomState: () => rng.snapshot(),
          getAiObservation: (participantId, policy) =>
            instance.getAiObservation!(participantId, policy),
          dispatch: (command: unknown) => instance.dispatch(command),
          getPlayInput: (participantId, cardInstanceId, choice) =>
            instance.getPlayInput!(participantId, cardInstanceId, choice),
          getLegality: (participantId) => instance.getLegality!(participantId),
          getAttackLegality: (participantId) =>
            instance.getAttackLegality!(participantId),
          analyze: (nestedOperation) => instance.analyze(nestedOperation)
        })
      } finally {
        state = stateSnapshot
        rng.restore(rngSnapshot)
        nextEntityOrdinal = nextEntityOrdinalSnapshot
        devDeckRefillCounter = devDeckRefillCounterSnapshot
      }
    },
    dispatch(commandValue: unknown): OpeningCommandResult {
      const command = parseCommand(commandValue)
      if (!command)
        return reject(state, 'invalid-command', 'The match command is invalid.')

      const playerIndex = findPlayerIndex(state.players, command.participantId)
      if (playerIndex === -1) {
        return reject(
          state,
          'unknown-participant',
          `Unknown participant: ${command.participantId}`
        )
      }

      if (command.type === 'concede') {
        if (state.phase === 'ended')
          return reject(state, 'match-ended', 'The match has already ended.')
        const winnerId = state.players[playerIndex === 0 ? 1 : 0].participantId
        const loserId = command.participantId
        commitState({
          ...state,
          phase: 'ended',
          activePlayerId: null,
          winnerId,
          loserId,
          pendingDiscover: undefined,
          pendingCardChoice: undefined,
          revision: state.revision + 1
        })
        return {
          accepted: true,
          state: cloneOpeningMatchState(state),
          events: [{ type: 'match-ended', winnerId, loserId, reason: 'concede' }]
        }
      }

      if (state.pendingDiscover && command.type !== 'choose-discover-card') {
        return reject(
          state,
          'discover-pending',
          'Resolve the pending Discover choice first.'
        )
      }
      if (command.type === 'choose-discover-card')
        return dispatchDiscoverChoice(command)
      if (state.pendingCardChoice && command.type !== 'choose-card-option') {
        return reject(
          state,
          'invalid-command',
          'Resolve the pending card choice first.'
        )
      }
      if (command.type === 'choose-card-option') return dispatchCardChoice(command)
      if (state.phase === 'ended') {
        return reject(state, 'match-ended', 'The match has already ended.')
      }

      if (command.type === 'end-turn') {
        return dispatchTurnTransition(command.participantId)
      }

      if (command.type === 'use-hero-power') {
        const before = state
        const rngSnapshot = rng.snapshot()
        const resolution = resolveHeroPower({
          state,
          rng,
          participantId: command.participantId,
          ...(command.target ? { target: command.target } : {}),
          ...(command.choice === undefined ? {} : { choice: command.choice }),
          nextEntityOrdinal,
          recordTrace: recordEffectTrace
        })
        const result = commitResolution(resolution, rngSnapshot)
        if (!result.accepted) return result
        const history = heroPowerHistoryEvent(
          before,
          result.state,
          command,
          result.events
        )
        return {
          accepted: true,
          state: cloneOpeningMatchState(state),
          events: [
            ...withoutHistoryFacts(result.events),
            history,
            ...triggerHistoryEvents(before, result.state, result.events, false),
            ...fatigueHistoryEvents(before, result.events)
          ]
        }
      }

      if (command.type === 'timeout') {
        if (state.phase !== 'turns' || state.activePlayerId !== command.participantId) {
          return reject(
            state,
            'timeout-unavailable',
            'A timeout can only be resolved for the active turn.'
          )
        }
        const turnLimitSeconds = getDerivedState(state).turnLimitSeconds
        if (
          turnLimitSeconds === null ||
          turnLimitSeconds === undefined ||
          turnLimitSeconds <= 0
        ) {
          return reject(
            state,
            'timeout-unavailable',
            'This match has no active turn limit.'
          )
        }
        if (
          command.elapsedSeconds === undefined ||
          command.elapsedSeconds < turnLimitSeconds
        ) {
          return reject(state, 'timeout-unavailable', 'The turn limit has not elapsed.')
        }
        return dispatchTurnTransition(command.participantId)
      }

      if (command.type === 'play-card') return dispatchPlayCard(command)

      if (command.type === 'attack-character') {
        const before = state
        const rngSnapshot = rng.snapshot()
        const resolution = resolveAttack({
          state,
          rng,
          participantId: command.participantId,
          attacker: command.attacker,
          defender: command.defender,
          nextEntityOrdinal,
          recordTrace: recordEffectTrace
        })
        const result = commitResolution(resolution, rngSnapshot)
        if (!result.accepted) return result
        const history = combatHistoryEvent(before, result.state, command, result.events)
        return {
          accepted: true,
          state: cloneOpeningMatchState(state),
          events: [
            ...withoutHistoryFacts(result.events),
            history,
            ...triggerHistoryEvents(before, result.state, result.events, false)
          ]
        }
      }

      if (command.type === 'dev-add-card') {
        const result = applyDevAddCard(state, playerIndex, command, nextEntityOrdinal)
        if (result.accepted) {
          commitState(result.state)
          if (result.nextEntityOrdinal !== undefined)
            nextEntityOrdinal = result.nextEntityOrdinal
        }
        return result
      }

      if (command.type === 'dev-set-mana') {
        const result = applyDevSetMana(state, playerIndex, command)
        if (result.accepted) commitState(result.state)
        return result
      }

      if (command.type === 'dev-set-hero') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const health =
          command.health === undefined ? player.hero.health : command.health
        const armor = command.armor === undefined ? player.hero.armor : command.armor
        const attack =
          command.attack === undefined ? player.hero.attack : command.attack
        if (
          !Number.isInteger(health) ||
          health < 1 ||
          health > player.hero.maxHealth ||
          !Number.isInteger(armor) ||
          armor < 0 ||
          !Number.isInteger(attack) ||
          attack < 0
        )
          return reject(state, 'invalid-command', 'Invalid hero state.')
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          hero: {
            ...player.hero,
            health,
            damageTaken: Math.max(0, player.hero.maxHealth - health),
            armor,
            attack,
            baseAttack: attack
          }
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-set-hero-power') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const cost = command.cost
        if (
          cost !== undefined &&
          (!Number.isInteger(cost) || cost < 0 || cost > MAX_MANA)
        )
          return reject(state, 'invalid-command', 'Invalid hero power cost.')
        const limit = heroPowerUseLimit(state, command.participantId)
        const availability =
          command.available === undefined
            ? {}
            : {
                usesThisTurn: command.available
                  ? 0
                  : Math.max(
                      player.heroPower.usesThisTurn ?? 0,
                      Number.isFinite(limit) ? limit : 0
                    ),
                ...(!Number.isFinite(limit) || player.heroPower.disabledThisTurn
                  ? { disabledThisTurn: !command.available }
                  : {}),
                available: command.available && limit > 0
              }
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          ...(cost !== undefined && player.heroPowerCostOverride !== undefined
            ? { heroPowerCostOverride: cost }
            : {}),
          heroPower: {
            ...player.heroPower,
            ...(cost === undefined ? {} : { cost, baseCost: cost }),
            ...availability
          }
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-clear-zone') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const result = applyDevStateChange(
          state,
          playerIndex,
          command.zone === 'hand' ? { ...player, hand: [] } : { ...player, board: [] }
        )
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-set-fatigue') {
        if (state.phase !== 'turns' || command.nextDamage < 1)
          return reject(state, 'invalid-command', 'Invalid fatigue damage.')
        const player = state.players[playerIndex]
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          fatigueDamage: command.nextDamage
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-remove-weapon') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const result = applyDevStateChange(state, playerIndex, {
          ...state.players[playerIndex],
          weapon: null
        })
        commitState(result.state)
        return result
      }
      if (command.type === 'dev-draw') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        if (player.deck.length === 0) {
          const before = state
          const damaged = damageHero(player, player.fatigueDamage, 'fatigue')
          const result = applyDevStateChange(state, playerIndex, {
            ...player,
            hero: damaged.hero,
            fatigueDamage: player.fatigueDamage + 1
          })
          commitState(result.state)
          const fatigue = {
            type: 'fatigue' as const,
            participantId: player.participantId,
            amount: player.fatigueDamage,
            nextDamage: player.fatigueDamage + 1
          }
          return {
            ...result,
            events: [fatigue, damaged.event, ...fatigueHistoryEvents(before, [fatigue])]
          }
        }
        const card = cloneCard(player.deck[0]!)
        const fullHand = player.hand.length >= MAX_HAND_SIZE
        let counters = player.counters
        let drawnCard = card
        let nextPlayer: OpeningPlayerState
        if (fullHand) {
          nextPlayer = { ...player, deck: player.deck.slice(1) }
        } else {
          const drawn = drawCards(player, 1)
          const handCard = drawn.cards[0]
          if (handCard?.scalingCounter) {
            counters = applyDrawScalingBuff(handCard as unknown as DraftCard, counters)
            drawnCard = { ...handCard }
          }
          nextPlayer = { ...drawn.player, counters }
        }
        const result = applyDevStateChange(state, playerIndex, nextPlayer)
        commitState(result.state)
        return {
          ...result,
          events: [
            fullHand
              ? {
                  type: 'card-burned',
                  origin: 'deck',
                  participantId: player.participantId,
                  card
                }
              : {
                  type: 'card-drawn',
                  origin: 'deck',
                  participantId: player.participantId,
                  card: drawnCard
                }
          ]
        }
      }

      if (command.type === 'dev-modify-deck') {
        const result = applyDevModifyDeck(state, playerIndex, command, () =>
          refillDeckFor(command.participantId)
        )
        if (result.accepted) {
          commitState({ ...result.state, nextEntityOrdinal })
          return { ...result, state: cloneOpeningMatchState(state) }
        }
        return result
      }

      if (command.type === 'dev-summon-minion') {
        const result = applyDevSummonMinion(
          state,
          playerIndex,
          command,
          nextEntityOrdinal
        )
        if (result.accepted) {
          commitState(result.state)
          if (result.nextEntityOrdinal !== undefined)
            nextEntityOrdinal = result.nextEntityOrdinal
        }
        return result
      }

      if (command.type === 'dev-end-match') {
        const result = applyDevEndMatch(state, command)
        if (result.accepted) commitState(result.state)
        return result
      }

      if (command.type !== 'confirm-mulligan')
        return reject(state, 'invalid-command', 'The match command is invalid.')

      if (state.phase !== 'mulligan') {
        return reject(state, 'wrong-phase', 'Mulligan has already ended.')
      }

      const player = state.players[playerIndex]
      if (player.mulliganConfirmed) {
        return reject(
          state,
          'already-confirmed',
          'This participant already confirmed mulligan.'
        )
      }

      const selectedIds = command.replaceInstanceIds
      if (new Set(selectedIds).size !== selectedIds.length) {
        return reject(
          state,
          'invalid-card-selection',
          'A card cannot be selected twice.'
        )
      }
      const selected = player.hand.filter((card) =>
        selectedIds.includes(card.instanceId)
      )
      if (selected.length !== selectedIds.length) {
        return reject(
          state,
          'invalid-card-selection',
          'Every selected card must be in hand.'
        )
      }

      const selectedSet = new Set(selectedIds)
      const kept = player.hand.filter((card) => !selectedSet.has(card.instanceId))
      const replacementCount = selected.length
      const replacementCards = player.deck.slice(0, replacementCount).map((card) => ({
        ...cloneCard(card),
        zone: 'hand' as const,
        revealed: true
      }))
      const remainingDeck = player.deck.slice(replacementCount)
      const returnedCards = selected.map((card) => ({
        ...cloneCard(card),
        zone: 'deck' as const,
        revealed: false
      }))
      const nextPlayer: OpeningPlayerState = {
        ...player,
        deck: shuffle([...remainingDeck, ...returnedCards], rng),
        hand: [...kept, ...replacementCards],
        mulliganConfirmed: true
      }
      const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
      nextPlayers[playerIndex] = nextPlayer
      state = { ...state, players: nextPlayers, revision: state.revision + 1 }

      const events: OpeningMatchEvent[] = [
        {
          type: 'mulligan-resolved',
          participantId: player.participantId,
          returnedCards: returnedCards.map(cloneCard),
          replacementCards: replacementCards.map(cloneCard)
        }
      ]

      if (nextPlayers.every((candidate) => candidate.mulliganConfirmed))
        completeOpening(events)

      assertOpeningMatchInvariants(state)
      return { accepted: true, state: cloneOpeningMatchState(state), events }
    }
  }
  if (!checkpoint && setup.skipMulligan) {
    const confirmedPlayers = state.players.map((player) => ({
      ...player,
      mulliganConfirmed: true
    })) as [OpeningPlayerState, OpeningPlayerState]
    state = { ...state, players: confirmedPlayers, revision: state.revision + 1 }
    completeOpening([])
    assertOpeningMatchInvariants(state)
  }
  return instance
}

/** Restores an independent match instance from a structured-cloned checkpoint. */
export function createOpeningMatchFromCheckpoint(
  checkpoint: OpeningMatchCheckpoint
): OpeningMatchInstance {
  return createOpeningMatch(
    checkpoint.setup,
    checkpoint.decks,
    createSeededRng(checkpoint.setup.seed),
    checkpoint
  )
}
