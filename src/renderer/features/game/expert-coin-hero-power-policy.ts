import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import { asClassId } from '../../../game/content/cards/card-definition'
import type { TurnMatchCommand, TurnMatchState } from '../../../game/match'

const THE_COIN_CARD_ID = 'basic_the_coin'
const MAGE_CLASS_ID = asClassId('Mage')

/** A large recommendation adjustment so an empty first-turn Coin line ranks last. */
export const EXPERT_COIN_HERO_POWER_PENALTY = 3

function playerFor(state: TurnMatchState, participantId: string) {
  return state.players.find((player) => player.participantId === participantId)
}

function isWinningLine(after: TurnMatchState, participantId: string): boolean {
  return after.phase === 'ended' && after.winnerId === participantId
}

function mageKillsEnemyMinion(
  command: Extract<TurnMatchCommand, { readonly type: 'use-hero-power' }>,
  before: TurnMatchState,
  after: TurnMatchState,
  participantId: string
): boolean {
  const target = command.target
  if (!target || target.kind !== 'minion' || target.participantId === participantId)
    return false

  const player = playerFor(before, participantId)
  const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
  if (power?.classId !== MAGE_CLASS_ID) return false

  const targetWasOnBoard = before.players
    .find((entry) => entry.participantId === target.participantId)
    ?.board.some((minion) => minion.instanceId === target.instanceId)
  if (!targetWasOnBoard) return false

  const targetStillOnBoard = after.players
    .find((entry) => entry.participantId === target.participantId)
    ?.board.some((minion) => minion.instanceId === target.instanceId)
  return targetStillOnBoard === false
}

function penaltyForHeroPower(
  command: TurnMatchCommand,
  before: TurnMatchState,
  after: TurnMatchState,
  participantId: string,
  coinPlayedThisTurn: boolean
): number {
  const player = playerFor(before, participantId)
  if (
    !coinPlayedThisTurn ||
    player?.mana.maximum !== 1 ||
    command.type !== 'use-hero-power'
  )
    return 0

  if (
    isWinningLine(after, participantId) ||
    mageKillsEnemyMinion(command, before, after, participantId)
  )
    return 0

  return EXPERT_COIN_HERO_POWER_PENALTY
}

/** Penalizes a turn line whose opening actions are The Coin then a hero power. */
export function expertCoinHeroPowerSequencePenalty(
  sequence: readonly TurnMatchCommand[],
  before: TurnMatchState,
  afterHeroPower: TurnMatchState,
  participantId: string
): number {
  const player = playerFor(before, participantId)
  if (!player || player.mana.maximum !== 1) return 0

  const actions = sequence.filter((command) => command.type !== 'end-turn')
  const coin = actions[0]
  const heroPower = actions[1]
  if (
    coin?.type !== 'play-card' ||
    heroPower?.type !== 'use-hero-power' ||
    !player.hand.some(
      (card) =>
        card.instanceId === coin.cardInstanceId && card.cardId === THE_COIN_CARD_ID
    )
  )
    return 0

  return penaltyForHeroPower(heroPower, before, afterHeroPower, participantId, true)
}

/** Applies the same policy in fallback after The Coin has already been played. */
export function expertCoinHeroPowerActionPenalty(
  command: TurnMatchCommand,
  beforeHeroPower: TurnMatchState,
  afterHeroPower: TurnMatchState,
  participantId: string,
  coinPlayedThisTurn: boolean
): number {
  return penaltyForHeroPower(
    command,
    beforeHeroPower,
    afterHeroPower,
    participantId,
    coinPlayedThisTurn
  )
}
