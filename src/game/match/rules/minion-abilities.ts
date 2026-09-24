import { effectiveBoardMinionKeywords } from './minion-attack-state'
import {
  cardHasTribe,
  CARD_CATALOG,
  isCardEffectObject,
  type CardDefinition,
  type CardEffectBlock,
  type CardId,
  type CardTrigger
} from '../../content/cards'
import type { BoardMinion } from '../opening-match-types'

export interface BoardAbilityMarkers {
  readonly taunt: boolean
  readonly divineShield: boolean
  readonly enraged: boolean
  readonly stealth: boolean
  readonly deathrattle: boolean
  readonly poisonous: boolean
  readonly aura: boolean
  readonly trigger: boolean
  readonly inspire: boolean
  readonly windfury: boolean
  readonly spellDamage: boolean
  readonly lifesteal: boolean
  readonly elusive: boolean
  readonly immune: boolean
}

const IN_PLAY_TRIGGER_TYPES: ReadonlySet<CardTrigger> = new Set([
  'end-of-turn',
  'on-attack',
  'on-card-played',
  'on-cast',
  'on-damage',
  'on-death',
  'on-gain-armor',
  'on-heal',
  'on-secret-played',
  'on-secret-revealed',
  'on-summon',
  'start-of-turn'
])

/** Poison uses its own flask indicator rather than the generic lightning bolt. */
function isPoisonEffect(effect: CardEffectBlock): boolean {
  return (
    effect.trigger === 'on-damage' &&
    (effect.actions ?? []).some((action) => action.action === 'destroy')
  )
}

/** The board Aura badge represents effects that can affect another minion. */
function isBoardMinionAuraEffect(effect: CardEffectBlock): boolean {
  if (effect.trigger !== 'aura') return false

  return (effect.actions ?? []).some((action) => {
    const target = isCardEffectObject(action.target) ? action.target : undefined
    return target?.type === 'minion' && target.selection !== 'source'
  })
}

/**
 * Frost Lich Jaina grants her Elementals Lifesteal for the rest of the game.
 * This is a hero-driven aura rather than a card keyword, so it is derived from
 * the controller's hero state instead of enchantments.
 */
export function hasJainaElementalLifesteal(
  cardId: CardId,
  heroId: string | null | undefined
): boolean {
  if (heroId !== 'jaina-frost-lich') return false
  return (
    cardHasTribe(CARD_CATALOG.get(cardId), 'Elemental') ||
    cardId === 'basic_water_elemental'
  )
}

/** Maps authored gameplay metadata to the static indicators shown while in play. */
export function boardAbilityMarkers(
  definition: Pick<CardDefinition, 'keywords' | 'effects'>
): BoardAbilityMarkers {
  const keywords = new Set(definition.keywords)
  const deathrattle = definition.effects.some(
    (effect) => effect.trigger === 'deathrattle'
  )
  const poisonous = keywords.has('poisonous') || definition.effects.some(isPoisonEffect)
  const aura = definition.effects.some(isBoardMinionAuraEffect)
  const inspire = definition.effects.some((effect) => effect.trigger === 'inspire')
  const trigger =
    definition.effects.some(
      (effect) => IN_PLAY_TRIGGER_TYPES.has(effect.trigger) && !isPoisonEffect(effect)
    ) || keywords.has('attack-wrong-enemy-chance-50')

  return {
    taunt: keywords.has('taunt'),
    divineShield: keywords.has('divine-shield'),
    enraged: false,
    stealth: keywords.has('stealth'),
    deathrattle,
    poisonous,
    aura,
    trigger,
    inspire,
    windfury: keywords.has('windfury') || keywords.has('mega-windfury'),
    spellDamage: keywords.has('spell-damage'),
    lifesteal: keywords.has('lifesteal'),
    elusive: keywords.has('spell-immune'),
    immune: keywords.has('immune')
  }
}

/**
 * Derives the runtime-only markers that cannot be read from a card definition.
 * Permanent and delayed keyword enchantments stay on the board minion snapshot;
 * the match runtime has already removed expired/source-dependent enchantments.
 */
export function boardMinionRuntimeMarkers(
  minion: BoardMinion,
  turnNumber: number,
  heroId?: string | null
): Pick<
  BoardAbilityMarkers,
  | 'taunt'
  | 'divineShield'
  | 'stealth'
  | 'windfury'
  | 'spellDamage'
  | 'lifesteal'
  | 'elusive'
  | 'immune'
> {
  const keywords = new Set(effectiveBoardMinionKeywords(minion, turnNumber))

  return {
    taunt: keywords.has('taunt'),
    divineShield:
      minion.divineShield === true &&
      (!minion.silenced || keywords.has('divine-shield')),
    stealth: minion.stealth === true && (!minion.silenced || keywords.has('stealth')),
    windfury:
      (!minion.silenced || keywords.has('windfury') || keywords.has('mega-windfury')) &&
      (minion.maxAttacksPerTurn ??
        (keywords.has('mega-windfury') ? 4 : keywords.has('windfury') ? 2 : 1)) > 1,
    spellDamage:
      (!minion.silenced || keywords.has('spell-damage')) &&
      (minion.spellDamage !== undefined
        ? minion.spellDamage !== 0
        : keywords.has('spell-damage')),
    lifesteal:
      keywords.has('lifesteal') ||
      hasJainaElementalLifesteal(minion.cardId, heroId),
    elusive:
      (!minion.silenced || keywords.has('spell-immune')) &&
      (minion.spellImmune ?? keywords.has('spell-immune')),
    immune:
      (!minion.silenced || keywords.has('immune')) &&
      (minion.immune ?? keywords.has('immune'))
  }
}

/**
 * Combines authored card markers with runtime-only granted abilities.  This is
 * intentionally derived from the committed minion snapshot so a pulse can
 * still find a marker for effects granted by another card (and silencing can
 * hide authored markers without changing the card catalog).
 */
export function boardMinionAbilityMarkers(
  minion: BoardMinion,
  definition: Pick<CardDefinition, 'keywords' | 'effects'>,
  turnNumber: number,
  heroId?: string | null
): BoardAbilityMarkers {
  const authored = boardAbilityMarkers(
    minion.silenced ? { keywords: [], effects: [] } : definition
  )
  const runtime = boardMinionRuntimeMarkers(minion, turnNumber, heroId)
  const active = (startsOnTurn?: number, expiresOnTurn?: number): boolean =>
    (startsOnTurn === undefined || startsOnTurn <= turnNumber) &&
    (expiresOnTurn === undefined || expiresOnTurn >= turnNumber)
  const grantedTrigger = (minion.grantedTriggers ?? []).some(
    (entry) =>
      entry.trigger !== 'deathrattle' &&
      entry.trigger !== 'inspire' &&
      active(entry.startsOnTurn, entry.expiresOnTurn)
  )
  const grantedInspire = (minion.grantedTriggers ?? []).some(
    (entry) =>
      entry.trigger === 'inspire' && active(entry.startsOnTurn, entry.expiresOnTurn)
  )
  const grantedDeathrattle = (minion.grantedTriggers ?? []).some(
    (entry) =>
      entry.trigger === 'deathrattle' && active(entry.startsOnTurn, entry.expiresOnTurn)
  )

  return {
    ...authored,
    ...runtime,
    enraged:
      !minion.silenced &&
      minion.health < minion.maxHealth &&
      definition.effects.some((effect) =>
        effect.actions?.some((action) => action.duration === 'while-damaged')
      ),
    trigger: authored.trigger || grantedTrigger,
    poisonous:
      authored.poisonous ||
      new Set(effectiveBoardMinionKeywords(minion, turnNumber)).has('poisonous'),
    inspire: authored.inspire || grantedInspire,
    deathrattle:
      authored.deathrattle ||
      grantedDeathrattle ||
      (minion.deathrattles?.length ?? 0) > 0
  }
}
