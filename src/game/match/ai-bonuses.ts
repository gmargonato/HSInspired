import { asCardId, CARD_CATALOG, type CardId } from '../content/cards'
import type { OpeningMatchState, PendingCardChoice } from './opening-match-types'
import type { PlayerId } from './match-types'
import type { DeterministicRng } from './rng'

/** Edit these settings, then restart and start a new match. */
export const AI_BONUS_SETTINGS = {
  // The first turn adds one crystal: 0 here means a normal 1-mana opening.
  startingManaCrystals: 0,
  startingHealth: 30,
  upgradedHeroPower: false,
  ravenIdolEnabled: false,
  ravenIdolFirstPersonalTurn: 3,
  ravenIdolIntervalPersonalTurns: 3,
  bonusSecretsEnabled: false,
  bonusSecretIntervalPersonalTurns: 2
}

/** Secrets are independent of the Discover bonus and can come from any class. */
export function eligibleAiBonusSecrets(
  state: OpeningMatchState,
  participantId: PlayerId
): readonly CardId[] {
  const player = state.players.find((entry) => entry.participantId === participantId)
  const interval = AI_BONUS_SETTINGS.bonusSecretIntervalPersonalTurns
  if (
    !AI_BONUS_SETTINGS.bonusSecretsEnabled ||
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

/** Raven Idol resolves at turn end; the discovered card is added to hand. */
export function createAiBonusChoice(
  state: OpeningMatchState,
  participantId: PlayerId,
  _rng: DeterministicRng
): PendingCardChoice | undefined {
  const player = state.players.find((entry) => entry.participantId === participantId)
  const personalTurn = Math.ceil(state.turnNumber / 2)
  if (
    !AI_BONUS_SETTINGS.ravenIdolEnabled ||
    !player ||
    player.controllerKind !== 'ai' ||
    state.phase !== 'turns' ||
    state.activePlayerId !== participantId ||
    personalTurn < AI_BONUS_SETTINGS.ravenIdolFirstPersonalTurn ||
    (personalTurn - AI_BONUS_SETTINGS.ravenIdolFirstPersonalTurn) %
      AI_BONUS_SETTINGS.ravenIdolIntervalPersonalTurns !==
      0 ||
    state.aiBonusTurn === state.turnNumber
  )
    return undefined

  return {
    participantId,
    sourceCardInstanceId: `${participantId}:turn-bonus:${state.turnNumber}`,
    sourceCardId: asCardId('league_of_explorers_raven_idol'),
    resolution: { type: 'bonus-spell' },
    options: ['minion', 'spell'].map((kind, choice) => ({
      choice,
      label: `Discover a ${kind}`,
      presentationCardId: asCardId(`league_of_explorers_raven_idol_${kind}`)
    }))
  }
}
