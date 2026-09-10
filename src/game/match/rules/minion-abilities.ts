import { effectiveBoardMinionKeywords } from './minion-attack-state'
import type { CardDefinition, CardEffectBlock, CardTrigger } from '../../content/cards'
import type { BoardMinion } from '../opening-match-types'

export interface BoardAbilityMarkers {
  readonly taunt: boolean
  readonly divineShield: boolean
  readonly stealth: boolean
  readonly deathrattle: boolean
  readonly poisonous: boolean
  readonly trigger: boolean
  readonly inspire: boolean
  readonly windfury: boolean
  readonly spellDamage: boolean
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

/** Maps authored gameplay metadata to the static indicators shown while in play. */
export function boardAbilityMarkers(
  definition: Pick<CardDefinition, 'keywords' | 'effects'>
): BoardAbilityMarkers {
  const keywords = new Set(definition.keywords)
  const deathrattle = definition.effects.some(
    (effect) => effect.trigger === 'deathrattle'
  )
  const poisonous = definition.effects.some(isPoisonEffect)
  const inspire = definition.effects.some((effect) => effect.trigger === 'inspire')
  const trigger =
    definition.effects.some(
      (effect) => IN_PLAY_TRIGGER_TYPES.has(effect.trigger) && !isPoisonEffect(effect)
    ) || keywords.has('attack-wrong-enemy-chance-50')

  return {
    taunt: keywords.has('taunt'),
    divineShield: keywords.has('divine-shield'),
    stealth: keywords.has('stealth'),
    deathrattle,
    poisonous,
    trigger,
    inspire,
    windfury: keywords.has('windfury') || keywords.has('mega-windfury'),
    spellDamage: keywords.has('spell-damage'),
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
  turnNumber: number
): Pick<
  BoardAbilityMarkers,
  | 'taunt'
  | 'divineShield'
  | 'stealth'
  | 'windfury'
  | 'spellDamage'
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
  turnNumber: number
): BoardAbilityMarkers {
  const authored = boardAbilityMarkers(
    minion.silenced ? { keywords: [], effects: [] } : definition
  )
  const runtime = boardMinionRuntimeMarkers(minion, turnNumber)
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
    trigger: authored.trigger || grantedTrigger,
    inspire: authored.inspire || grantedInspire,
    deathrattle:
      authored.deathrattle ||
      grantedDeathrattle ||
      (minion.deathrattles?.length ?? 0) > 0
  }
}
