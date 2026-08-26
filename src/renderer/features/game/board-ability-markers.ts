import type {
  CardDefinition,
  CardEffectBlock,
  CardTrigger
} from '../../../game/content/cards'

export interface BoardAbilityMarkers {
  readonly taunt: boolean
  readonly divineShield: boolean
  readonly deathrattle: boolean
  readonly trigger: boolean
  /** Text-only placeholders for board visuals whose authored assets do not exist yet. */
  readonly temporaryAbilityLabels: readonly TemporaryBoardAbilityLabel[]
}

export type TemporaryBoardAbilityLabel =
  | 'Cannot Attack'
  | 'Immune'
  | 'Mega Windfury'
  | 'Poisonous'
  | 'Spell Damage'
  | 'Spell Immune'
  | 'Stealth'
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
  if (poisonous) temporaryAbilityLabels.push('Poisonous')
  if (keywords.has('stealth')) temporaryAbilityLabels.push('Stealth')
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
    deathrattle,
    trigger,
    temporaryAbilityLabels
  }
}
