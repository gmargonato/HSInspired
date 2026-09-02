import type {
  CardDefinition,
  CardEffectBlock,
  CardTrigger
} from '../../../game/content/cards'
import type { BoardMinion } from '../../../game/match'

export interface BoardAbilityMarkers {
  readonly taunt: boolean
  readonly divineShield: boolean
  readonly stealth: boolean
  readonly deathrattle: boolean
  readonly poisonous: boolean
  readonly trigger: boolean
  readonly inspire: boolean
  /** Text-only placeholders for board visuals whose authored assets do not exist yet. */
  readonly temporaryAbilityLabels: readonly TemporaryBoardAbilityLabel[]
}

export type TemporaryBoardAbilityLabel =
  | 'Cannot Attack'
  | 'Immune'
  | 'Mega Windfury'
  | 'Spell Damage'
  | 'Spell Immune'
  | 'Windfury'

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

  const temporaryAbilityLabels: TemporaryBoardAbilityLabel[] = []
  if (keywords.has('mega-windfury')) {
    temporaryAbilityLabels.push('Mega Windfury')
  } else if (keywords.has('windfury')) {
    temporaryAbilityLabels.push('Windfury')
  }
  if (keywords.has('spell-damage')) temporaryAbilityLabels.push('Spell Damage')
  if (keywords.has('spell-immune')) temporaryAbilityLabels.push('Spell Immune')
  if (keywords.has('immune')) temporaryAbilityLabels.push('Immune')
  if (keywords.has('cannot-attack')) temporaryAbilityLabels.push('Cannot Attack')

  return {
    taunt: keywords.has('taunt'),
    divineShield: keywords.has('divine-shield'),
    stealth: keywords.has('stealth'),
    deathrattle,
    poisonous,
    trigger,
    inspire,
    temporaryAbilityLabels
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
): Pick<BoardAbilityMarkers, 'taunt' | 'divineShield' | 'stealth'> {
  if (minion.silenced) {
    return { taunt: false, divineShield: false, stealth: false }
  }

  const keywords = new Set(minion.keywords ?? [])
  for (const enchantment of minion.enchantments ?? []) {
    if (
      (enchantment.startsOnTurn !== undefined &&
        enchantment.startsOnTurn > turnNumber) ||
      (enchantment.expiresOnTurn !== undefined &&
        enchantment.expiresOnTurn < turnNumber) ||
      (enchantment.duration === 'while-damaged' && minion.health >= minion.maxHealth)
    )
      continue
    for (const keyword of enchantment.keywords ?? []) keywords.add(keyword)
    for (const keyword of enchantment.removedKeywords ?? []) keywords.delete(keyword)
  }

  return {
    taunt: keywords.has('taunt'),
    divineShield: minion.divineShield === true,
    stealth: minion.stealth === true
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
  const authored = boardAbilityMarkers(definition)
  const runtime = boardMinionRuntimeMarkers(minion, turnNumber)
  if (minion.silenced) {
    return {
      taunt: false,
      divineShield: false,
      stealth: false,
      deathrattle: false,
      poisonous: false,
      trigger: false,
      inspire: false,
      temporaryAbilityLabels: []
    }
  }

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
    taunt: runtime.taunt,
    divineShield: runtime.divineShield,
    stealth: runtime.stealth,
    trigger: authored.trigger || grantedTrigger,
    inspire: authored.inspire || grantedInspire,
    deathrattle:
      authored.deathrattle ||
      grantedDeathrattle ||
      (minion.deathrattles?.length ?? 0) > 0
  }
}
