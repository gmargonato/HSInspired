import { asCardId, CARD_CATALOG, type CardId } from '../content/cards'
import { KAZAKUS_POTION_COST_OPTIONS } from '../content/cards/sets/gadgetzan-generated-content'
import { kazakusCostOptions, firstPotionIngredientChoice } from './kazakus-potion'
import type { OpeningMatchState, PendingCardChoice } from './opening-match-types'
import type { PlayerId } from './match-types'
import type { DeterministicRng } from './rng'

/** Edit these settings, then restart and start a new match. */
export const AI_BONUS_SETTINGS = {
  // The first turn adds one crystal: 0 here means a normal 1-mana opening.
  startingMana: 0,
  startingHealth: 30,
  upgradedHeroPower: true,
  enabled: true,
  firstPersonalTurn: 3,
  everyPersonalTurns: 3,
  secretsEnabled: true,
  secretEveryPersonalTurns: 2
}

/** Secrets are independent of potion crafting and can come from any class. */
export function eligibleAiBonusSecrets(
  state: OpeningMatchState,
  participantId: PlayerId
): readonly CardId[] {
  const player = state.players.find((entry) => entry.participantId === participantId)
  const interval = AI_BONUS_SETTINGS.secretEveryPersonalTurns
  if (
    !AI_BONUS_SETTINGS.secretsEnabled ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    state.phase !== 'turns' ||
    state.activePlayerId !== participantId ||
    player?.controllerKind !== 'ai' ||
    Math.ceil(state.turnNumber / 2) % interval !== 0
  )
    return []
  return CARD_CATALOG.all
    .filter(
      (card) =>
        card.type === 'Spell' &&
        card.collectible &&
        card.keywords.includes('secret') &&
        !(player.secrets ?? []).some((secret) => secret.cardId === card.id)
    )
    .map((card) => card.id)
}

/** The bonus grants crafting, not a free cast. Targets are chosen when played. */
export function createAiBonusChoice(
  state: OpeningMatchState,
  participantId: PlayerId,
  rng: DeterministicRng
): PendingCardChoice | undefined {
  const player = state.players.find((entry) => entry.participantId === participantId)
  const personalTurn = Math.ceil(state.turnNumber / 2)
  if (
    !AI_BONUS_SETTINGS.enabled ||
    !player ||
    player.controllerKind !== 'ai' ||
    state.phase !== 'turns' ||
    state.activePlayerId !== participantId ||
    personalTurn < AI_BONUS_SETTINGS.firstPersonalTurn ||
    (personalTurn - AI_BONUS_SETTINGS.firstPersonalTurn) %
      AI_BONUS_SETTINGS.everyPersonalTurns !==
      0 ||
    state.aiBonusTurn === state.turnNumber
  )
    return undefined

  const cost = personalTurn < 6 ? 1 : personalTurn < 9 ? 5 : 10
  const costOptions = kazakusCostOptions({
    costOptions: KAZAKUS_POTION_COST_OPTIONS
  }).filter((option) => option.cost === cost)
  const selectedCostOption = costOptions[0]!
  return firstPotionIngredientChoice(
    {
      participantId,
      sourceCardInstanceId: `${participantId}:turn-bonus:${state.turnNumber}`,
      sourceCardId: asCardId('mean_streets_of_gadgetzan_kazakus')
    },
    costOptions,
    selectedCostOption,
    rng
  )
}
