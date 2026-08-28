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
