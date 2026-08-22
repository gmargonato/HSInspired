import { CARD_CATALOG, asCardId, type CardId, type HeroId } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { HERO_POWER_CATALOG } from '../content/hero-powers'
import { countDeckCards, type Deck } from '../decks'
import { createSeededRng, type DeterministicRng } from './rng'
import type {
  ControllerKind,
  MatchParticipantSetup,
  MatchSetup,
  PlayerId
} from './match-types'

export type OpeningPhase = 'mulligan' | 'turns'

/** Maximum number of cards a player may hold in hand. */
export const MAX_HAND_SIZE = 10

/** Maximum number of mana crystals a player may accumulate. */
export const MAX_MANA = 10

/** Maximum number of minions a player may have on their board. */
export const MAX_BOARD_SIZE = 7

export interface OpeningCard {
  readonly instanceId: string
  readonly cardId: CardId
}

/** A minion in play. Stats are current values (base today; buffs later). */
export interface BoardMinion {
  readonly instanceId: string
  readonly cardId: CardId
  readonly attack: number
  readonly health: number
}

/** A player's mana crystals: available spendable mana and the grown maximum. */
export interface PlayerMana {
  readonly available: number
  readonly maximum: number
}

/**
 * A player's hero power. `cost` starts at the class definition's cost; future
 * card effects may raise or lower it (the renderer tints the cost red/green
 * accordingly). `available` is reset at the start of the owner's turn.
 */
export interface PlayerHeroPower {
  readonly cost: number
  readonly available: boolean
}

export interface OpeningPlayerState {
  readonly participantId: PlayerId
  readonly controllerKind: ControllerKind
  readonly heroId: HeroId
  readonly playerNumber: 1 | 2
  readonly deck: readonly OpeningCard[]
  readonly hand: readonly OpeningCard[]
  readonly board: readonly BoardMinion[]
  readonly mana: PlayerMana
  readonly heroPower: PlayerHeroPower
  readonly mulliganConfirmed: boolean
}

export interface OpeningMatchState {
  readonly phase: OpeningPhase
  readonly playerOneId: PlayerId
  readonly playerTwoId: PlayerId
  readonly activePlayerId: PlayerId | null
  readonly turnNumber: number
  readonly players: readonly [OpeningPlayerState, OpeningPlayerState]
  readonly revision: number
}

export interface ConfirmMulliganCommand {
  readonly type: 'confirm-mulligan'
  readonly participantId: PlayerId
  readonly replaceInstanceIds: readonly string[]
}

export interface EndTurnCommand {
  readonly type: 'end-turn'
  readonly participantId: PlayerId
}

export interface UseHeroPowerCommand {
  readonly type: 'use-hero-power'
  readonly participantId: PlayerId
}

export interface PlayMinionCommand {
  readonly type: 'play-minion'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
  /** Insertion index into the player's board row: 0..board.length inclusive. */
  readonly position: number
}

export type OpeningMatchCommand =
  ConfirmMulliganCommand | EndTurnCommand | UseHeroPowerCommand | PlayMinionCommand

export interface MulliganResolvedEvent {
  readonly type: 'mulligan-resolved'
  readonly participantId: PlayerId
  readonly returnedCards: readonly OpeningCard[]
  readonly replacementCards: readonly OpeningCard[]
}

export interface CoinGrantedEvent {
  readonly type: 'coin-granted'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface OpeningTurnStartedEvent {
  readonly type: 'opening-turn-started'
  readonly participantId: PlayerId
  readonly playerNumber: 1 | 2
  readonly mana: PlayerMana
}

export interface OpeningCardDrawnEvent {
  readonly type: 'opening-card-drawn'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface TurnStartedEvent {
  readonly type: 'turn-started'
  readonly participantId: PlayerId
  readonly turnNumber: number
  readonly mana: PlayerMana
}

export interface CardDrawnEvent {
  readonly type: 'card-drawn'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface CardBurnedEvent {
  readonly type: 'card-burned'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface HeroPowerUsedEvent {
  readonly type: 'hero-power-used'
  readonly participantId: PlayerId
  readonly cost: number
  readonly mana: PlayerMana
}

export interface MinionPlayedEvent {
  readonly type: 'minion-played'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export type OpeningMatchEvent =
  | MulliganResolvedEvent
  | CoinGrantedEvent
  | OpeningTurnStartedEvent
  | OpeningCardDrawnEvent
  | TurnStartedEvent
  | CardDrawnEvent
  | CardBurnedEvent
  | HeroPowerUsedEvent
  | MinionPlayedEvent

export interface OpeningAcceptedResult {
  readonly accepted: true
  readonly state: OpeningMatchState
  readonly events: readonly OpeningMatchEvent[]
}

export type OpeningRejectionCode =
  | 'invalid-command'
  | 'unknown-participant'
  | 'wrong-phase'
  | 'already-confirmed'
  | 'invalid-card-selection'
  | 'not-active-player'
  | 'hero-power-unavailable'
  | 'insufficient-mana'
  | 'not-a-minion'
  | 'board-full'
  | 'invalid-position'

export interface OpeningRejectedResult {
  readonly accepted: false
  readonly code: OpeningRejectionCode
  readonly message: string
  readonly state: OpeningMatchState
  readonly events: readonly []
}

export type OpeningCommandResult = OpeningAcceptedResult | OpeningRejectedResult

export interface OpeningMatchInstance {
  readonly setup: MatchSetup
  getState(): OpeningMatchState
  dispatch(command: unknown): OpeningCommandResult
}

const COIN_CARD_ID = asCardId('basic_the_coin')

function cloneCard(card: OpeningCard): OpeningCard {
  return { ...card }
}

function cloneBoardMinion(minion: BoardMinion): BoardMinion {
  return { ...minion }
}

function clonePlayer(player: OpeningPlayerState): OpeningPlayerState {
  return {
    ...player,
    deck: player.deck.map(cloneCard),
    hand: player.hand.map(cloneCard),
    board: player.board.map(cloneBoardMinion),
    mana: { ...player.mana },
    heroPower: { ...player.heroPower }
  }
}

export function cloneOpeningMatchState(state: OpeningMatchState): OpeningMatchState {
  return {
    ...state,
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCommand(value: unknown): OpeningMatchCommand | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null

  if (value.type === 'confirm-mulligan') {
    if (!Array.isArray(value.replaceInstanceIds)) return null
    if (!value.replaceInstanceIds.every((id) => typeof id === 'string')) return null
    return {
      type: 'confirm-mulligan',
      participantId: value.participantId as PlayerId,
      replaceInstanceIds: value.replaceInstanceIds
    }
  }

  if (value.type === 'end-turn') {
    return { type: 'end-turn', participantId: value.participantId as PlayerId }
  }

  if (value.type === 'use-hero-power') {
    return {
      type: 'use-hero-power',
      participantId: value.participantId as PlayerId
    }
  }

  if (value.type === 'play-minion') {
    if (typeof value.cardInstanceId !== 'string') return null
    if (typeof value.position !== 'number' || !Number.isInteger(value.position)) {
      return null
    }
    return {
      type: 'play-minion',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId,
      position: value.position
    }
  }

  return null
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

function expandDeck(deck: Deck, participant: MatchParticipantSetup): OpeningCard[] {
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
        cardId: definition.id
      })
      ordinal += 1
    }
  }
  return cards
}

function findPlayerIndex(
  players: readonly [OpeningPlayerState, OpeningPlayerState],
  participantId: PlayerId
): 0 | 1 | -1 {
  if (players[0].participantId === participantId) return 0
  if (players[1].participantId === participantId) return 1
  return -1
}

function drawCards(
  player: OpeningPlayerState,
  count: number
): { player: OpeningPlayerState; cards: OpeningCard[] } {
  const cards = player.deck.slice(0, count).map(cloneCard)
  return {
    cards,
    player: {
      ...player,
      deck: player.deck.slice(cards.length),
      hand: [...player.hand, ...cards]
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

/**
 * Mana growth at the start of a player's turn: the crystal maximum grows by one
 * (capped at MAX_MANA) and available mana refills to the new maximum.
 */
function growMana(mana: PlayerMana): PlayerMana {
  const maximum = Math.min(MAX_MANA, mana.maximum + 1)
  return { available: maximum, maximum }
}

/**
 * Ends the active player's turn: passes play to the other player, increments
 * the turn counter, and draws one card for the new active player. The draw is
 * skipped when the deck is empty; when the hand is already full the drawn card
 * is burned (removed from the deck) per the Hearthstone rule. The new active
 * player's mana grows and refills at the start of their turn.
 */
function applyEndTurn(
  state: OpeningMatchState,
  playerIndex: 0 | 1
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  if (state.activePlayerId !== state.players[playerIndex].participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can end the turn.'
    )
  }

  const nextPlayerIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const nextPlayer = state.players[nextPlayerIndex]
  const nextMana = growMana(nextPlayer.mana)
  const events: OpeningMatchEvent[] = []

  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]

  const card = nextPlayer.deck[0]
  if (card && nextPlayer.hand.length >= MAX_HAND_SIZE) {
    const burned: OpeningCard = cloneCard(card)
    nextPlayers[nextPlayerIndex] = {
      ...nextPlayer,
      deck: nextPlayer.deck.slice(1)
    }
    events.push({
      type: 'card-burned',
      participantId: nextPlayer.participantId,
      card: burned
    })
  } else if (card) {
    const drawn = drawCards(nextPlayer, 1)
    nextPlayers[nextPlayerIndex] = drawn.player
    const drawnCard = drawn.cards[0]
    if (drawnCard) {
      events.push({
        type: 'card-drawn',
        participantId: nextPlayer.participantId,
        card: cloneCard(drawnCard)
      })
    }
  }
  nextPlayers[nextPlayerIndex] = {
    ...nextPlayers[nextPlayerIndex],
    mana: nextMana,
    heroPower: { ...nextPlayers[nextPlayerIndex].heroPower, available: true }
  }

  const turnNumber = state.turnNumber + 1
  const nextState: OpeningMatchState = {
    ...state,
    activePlayerId: nextPlayer.participantId,
    turnNumber,
    players: nextPlayers,
    revision: state.revision + 1
  }
  events.unshift({
    type: 'turn-started',
    participantId: nextPlayer.participantId,
    turnNumber,
    mana: nextMana
  })

  return { accepted: true, state: cloneOpeningMatchState(nextState), events }
}

/**
 * Uses the active player's hero power: spends its cost from the available mana
 * pool and exhausts it until the owner's next turn start. The effects of the
 * power itself arrive with future gameplay; for now the command only consumes
 * mana and flips the card to its exhausted state.
 */
function applyUseHeroPower(
  state: OpeningMatchState,
  playerIndex: 0 | 1
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can use their hero power.'
    )
  }
  if (!player.heroPower.available) {
    return reject(
      state,
      'hero-power-unavailable',
      'The hero power was already used this turn.'
    )
  }
  if (player.mana.available < player.heroPower.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to use the hero power.')
  }

  const nextPlayer: OpeningPlayerState = {
    ...player,
    mana: {
      ...player.mana,
      available: player.mana.available - player.heroPower.cost
    },
    heroPower: { ...player.heroPower, available: false }
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
        type: 'hero-power-used',
        participantId: player.participantId,
        cost: player.heroPower.cost,
        mana: nextPlayer.mana
      }
    ]
  }
}

function applyPlayMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: PlayMinionCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can play a minion.'
    )
  }

  const card = player.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  if (!card) {
    return reject(
      state,
      'invalid-card-selection',
      'The selected card is not in the player hand.'
    )
  }

  const definition = CARD_CATALOG.get(card.cardId)
  if (!definition || definition.type !== 'Minion') {
    return reject(state, 'not-a-minion', 'Only minion cards can be played here.')
  }
  if (player.mana.available < definition.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to play that minion.')
  }
  if (player.board.length >= MAX_BOARD_SIZE) {
    return reject(state, 'board-full', 'The board is full.')
  }
  if (
    !Number.isInteger(command.position) ||
    command.position < 0 ||
    command.position > player.board.length
  ) {
    return reject(state, 'invalid-position', 'The minion position is invalid.')
  }

  const minion: BoardMinion = {
    instanceId: card.instanceId,
    cardId: card.cardId,
    attack: definition.attack,
    health: definition.health
  }
  const nextBoard = player.board.map(cloneBoardMinion)
  nextBoard.splice(command.position, 0, minion)
  const nextPlayer: OpeningPlayerState = {
    ...player,
    hand: player.hand.filter(
      (candidate) => candidate.instanceId !== command.cardInstanceId
    ),
    board: nextBoard,
    mana: {
      ...player.mana,
      available: player.mana.available - definition.cost
    }
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
        type: 'minion-played',
        participantId: player.participantId,
        minion: cloneBoardMinion(minion),
        position: command.position
      }
    ]
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
  rng: DeterministicRng = createSeededRng(setup.seed)
): OpeningMatchInstance {
  const decksById = new Map(deckSnapshots.map((deck) => [deck.id, deck]))
  const playerOneIndex: 0 | 1 = rng.next() < 0.5 ? 0 : 1
  const playerTwoIndex: 0 | 1 = playerOneIndex === 0 ? 1 : 0
  const order = [playerOneIndex, playerTwoIndex] as const

  const createPlayer = (
    participantIndex: 0 | 1,
    seatIndex: 0 | 1
  ): OpeningPlayerState => {
    const participant = setup.participants[participantIndex]
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const hero = HERO_CATALOG.require(participant.heroId)
    const heroPower = HERO_POWER_CATALOG.require(hero.heroPowerId)
    const shuffled = shuffle(expandDeck(deck, participant), rng)
    const initialCount = seatIndex === 0 ? 3 : 4
    const initialCards = shuffled.slice(0, initialCount)
    return {
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      heroId: participant.heroId,
      playerNumber: (seatIndex + 1) as 1 | 2,
      deck: shuffled.slice(initialCount),
      hand: initialCards,
      board: [],
      mana: { available: 0, maximum: 0 },
      heroPower: { cost: heroPower.cost, available: false },
      mulliganConfirmed: false
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
    players,
    revision: 0
  }

  return {
    setup,
    getState(): OpeningMatchState {
      return cloneOpeningMatchState(state)
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

      if (command.type === 'end-turn') {
        const result = applyEndTurn(state, playerIndex)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'use-hero-power') {
        const result = applyUseHeroPower(state, playerIndex)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'play-minion') {
        const result = applyPlayMinion(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

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
      const replacementCards = player.deck.slice(0, replacementCount).map(cloneCard)
      const remainingDeck = player.deck.slice(replacementCount)
      const nextPlayer: OpeningPlayerState = {
        ...player,
        deck: shuffle([...remainingDeck, ...selected], rng),
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
          returnedCards: selected.map(cloneCard),
          replacementCards: replacementCards.map(cloneCard)
        }
      ]

      if (nextPlayers.every((candidate) => candidate.mulliganConfirmed)) {
        const playerTwo = nextPlayers[1]
        const coin: OpeningCard = {
          instanceId: `${playerTwo.participantId}:coin`,
          cardId: COIN_CARD_ID
        }
        const playerTwoWithCoin: OpeningPlayerState = {
          ...playerTwo,
          hand: [...playerTwo.hand, coin]
        }
        nextPlayers[1] = playerTwoWithCoin
        state = { ...state, players: nextPlayers }
        events.push({
          type: 'coin-granted',
          participantId: playerTwo.participantId,
          card: cloneCard(coin)
        })

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
          revision: state.revision + 1
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

      return { accepted: true, state: cloneOpeningMatchState(state), events }
    }
  }
}
