import { CARD_CATALOG, asCardId } from '../content/cards'
import type {
  CthunProgression,
  HistoryEntitySnapshot,
  OpeningCard,
  OpeningPlayerState,
  RuntimeEnchantment
} from './opening-match-types'

export const CTHUN_ID = asCardId('whispers_of_the_old_gods_cthun')
export const EMPTY_CTHUN: CthunProgression = { attack: 0, health: 0, taunt: false }

export function cthunEnchantment(
  id: string,
  progression: CthunProgression
): RuntimeEnchantment {
  return {
    id,
    sourceInstanceId: id,
    sourceCardId: CTHUN_ID,
    cthun: true,
    attackDelta: progression.attack,
    healthDelta: progression.health,
    keywords: progression.taunt ? ['taunt'] : [],
    silenceable: true
  }
}

/** Reconcile only ritual enhancements; preserve ordinary card modifications. */
export function applyCthunToCard(
  card: OpeningCard,
  player: Pick<OpeningPlayerState, 'cthun' | 'participantId'>
): OpeningCard {
  if (card.cardId !== CTHUN_ID) return card
  const definition = CARD_CATALOG.require(CTHUN_ID)
  if (definition.type !== 'Minion') return card
  const progression = player.cthun ?? EMPTY_CTHUN
  const rituals = (card.enchantments ?? []).filter((entry) => entry.cthun)
  const previousAttack = rituals.reduce(
    (sum, entry) => sum + (entry.attackDelta ?? 0),
    0
  )
  const previousHealth = rituals.reduce(
    (sum, entry) => sum + (entry.healthDelta ?? 0),
    0
  )
  return {
    ...card,
    attack: (card.attack ?? definition.attack) - previousAttack + progression.attack,
    health: (card.health ?? definition.health) - previousHealth + progression.health,
    enchantments: [
      ...(card.enchantments ?? []).filter((entry) => !entry.cthun),
      cthunEnchantment(`${card.instanceId}:cthun`, progression)
    ]
  }
}

/** Public ritual preview, never a reference to a hidden hand or deck card. */
export function cthunSnapshot(player: OpeningPlayerState): HistoryEntitySnapshot {
  const definition = CARD_CATALOG.require(CTHUN_ID)
  const progression = player.cthun ?? EMPTY_CTHUN
  return {
    id: `${player.participantId}:cthun-progression`,
    participantId: player.participantId,
    kind: 'card',
    cardId: CTHUN_ID,
    publicIdentity: true,
    rulesText: (progression.taunt ? 'Taunt. ' : '') + definition.rulesText,
    attack: (definition.type === 'Minion' ? definition.attack : 6) + progression.attack,
    health: (definition.type === 'Minion' ? definition.health : 6) + progression.health,
    keywords: progression.taunt ? ['taunt'] : []
  }
}

/** The hidden card may carry private buffs; only add the ritual's visible keyword. */
export function cthunCardRulesText(
  card: Pick<OpeningCard, 'cardId' | 'enchantments'>,
  rulesText: string
): string {
  return card.cardId === CTHUN_ID &&
    card.enchantments?.some((entry) => entry.keywords?.includes('taunt'))
    ? 'Taunt. ' + rulesText
    : rulesText
}
