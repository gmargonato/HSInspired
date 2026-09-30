import {
  CARD_CATALOG,
  type CardId,
  type CardDefinition,
  type CardTrigger
} from '../../content/cards'
import type { EntityRef } from './effect-context'

export const MAX_BOARD_SIZE = 7

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function integer(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, integer(value)))
}

export function cardDefinition(cardId: CardId): CardDefinition | undefined {
  return CARD_CATALOG.get(cardId)
}

export function cardHasTrigger(card: CardDefinition, trigger: CardTrigger): boolean {
  return card.effects.some((effect) => effect.trigger === trigger)
}

export function entityKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.instanceId}`
}

export const MAX_MANA = 10

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
