import { CARD_CATALOG } from '../../../game-rules/content/cards'
import type { CardDefinition } from '../../../game-rules/content/cards'
import type {
  CardAction,
  CardEffectBlock,
  CardTrigger
} from '../../../game-rules/content/cards'

const GENERATED_PREVIEW_TRIGGERS: ReadonlySet<CardTrigger> = new Set([
  'deathrattle',
  'secret'
])

function actionCardId(action: CardAction): string | null {
  const value: unknown = action.cardId
  return typeof value === 'string' && value.length > 0 ? value : null
}

function effectCandidateId(block: CardEffectBlock): string | null {
  for (const action of block.actions ?? []) {
    if (action.action === 'equip' || action.action === 'equip-random') {
      return actionCardId(action)
    }
  }
  if (!GENERATED_PREVIEW_TRIGGERS.has(block.trigger)) return null
  for (const action of block.actions ?? []) {
    if (action.action === 'summon' || action.action === 'transform') {
      return actionCardId(action)
    }
  }
  return null
}

/** First generated card id worth previewing for this card, or null. */
export function resolveGeneratedPreviewCardId(card: CardDefinition): string | null {
  if (card.type === 'Spell' && card.quest) return card.quest.rewardCardId
  for (const block of card.effects) {
    const candidate = effectCandidateId(block)
    if (candidate) return candidate
  }
  return null
}

/** Resolved generated-card preview definition, or null when none applies. */
export function resolveGeneratedPreviewCard(
  card: CardDefinition
): CardDefinition | null {
  const id = resolveGeneratedPreviewCardId(card)
  return id ? CARD_CATALOG.require(id) : null
}
