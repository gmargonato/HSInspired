import {
  asCardId,
  asClassId,
  asExpansionId,
  type CardDefinition,
  type CardId
} from './card-definition'
import { validateCardRecord } from './card-validator'

/**
 * Non-collectible cards created by authored effects.  They intentionally live
 * outside the authored set JSON: they are runtime tokens, not deck content.
 */
const GENERATED_EXPANSION = asExpansionId('goblins-vs-gnomes')
const GENERATED_CLASS = asClassId('Neutral')

function generatedSpell(
  id: string,
  name: string,
  rulesText: string,
  actions: readonly Record<string, unknown>[]
): CardDefinition {
  return {
    id: asCardId(id),
    expansionId: GENERATED_EXPANSION,
    set: GENERATED_EXPANSION,
    name,
    rarity: 'Free',
    cardClass: GENERATED_CLASS,
    subtype: null,
    spellSchool: null,
    cost: 1,
    rulesText,
    keywords: [],
    effects: [{ trigger: 'cast', actions } as CardDefinition['effects'][number]],
    collectible: false,
    deckLegal: false,
    type: 'Spell'
  }
}

/** The seven GvG Spare Parts used by the catalog's random-card effects. */
const GENERATED_CARD_RECORDS: readonly CardDefinition[] = [
  generatedSpell(
    'goblins_vs_gnomes_spare_part_armor_plating',
    'Armor Plating',
    'Give a friendly minion +1 Health.',
    [
      {
        action: 'modify',
        target: { type: 'minion', controller: 'self', selection: 'chosen' },
        health: 1
      }
    ]
  ),
  generatedSpell(
    'goblins_vs_gnomes_spare_part_emergency_coolant',
    'Emergency Coolant',
    'Freeze a minion.',
    [{ action: 'freeze', target: { type: 'minion', selection: 'chosen' } }]
  ),
  generatedSpell(
    'goblins_vs_gnomes_spare_part_finicky_cloakfield',
    'Finicky Cloakfield',
    'Give a friendly minion Stealth until your next turn.',
    [
      {
        action: 'grant-keyword',
        target: { type: 'minion', controller: 'self', selection: 'chosen' },
        keyword: 'stealth',
        duration: 'until-next-turn'
      }
    ]
  ),
  generatedSpell(
    'goblins_vs_gnomes_spare_part_reversing_switch',
    'Reversing Switch',
    "Swap a minion's Attack and Health.",
    [{ action: 'swap-stats', target: { type: 'minion', selection: 'chosen' } }]
  ),
  generatedSpell(
    'goblins_vs_gnomes_spare_part_rusty_horn',
    'Rusty Horn',
    'Give a minion Taunt.',
    [
      {
        action: 'grant-keyword',
        target: { type: 'minion', selection: 'chosen' },
        keyword: 'taunt'
      }
    ]
  ),
  generatedSpell(
    'goblins_vs_gnomes_spare_part_time_rewinder',
    'Time Rewinder',
    'Return a friendly minion to your hand.',
    [
      {
        action: 'return-to-hand',
        target: { type: 'minion', controller: 'self', selection: 'chosen' }
      }
    ]
  ),
  generatedSpell(
    'goblins_vs_gnomes_spare_part_whirling_blades',
    'Whirling Blades',
    'Give a friendly minion +1 Attack.',
    [
      {
        action: 'modify',
        target: { type: 'minion', controller: 'self', selection: 'chosen' },
        attack: 1
      }
    ]
  )
]

/**
 * Generated cards use the same schema validator as authored set records. They
 * are kept in TypeScript because they are runtime-only tokens, but they must
 * not bypass content validation or capability auditing.
 */
export const GENERATED_CARD_DEFINITIONS: readonly CardDefinition[] =
  GENERATED_CARD_RECORDS.map((card, index) =>
    validateCardRecord(card, GENERATED_EXPANSION, `generated[${index}]`)
  )

export function generatedCardDefinition(
  cardId: CardId | string
): CardDefinition | undefined {
  return GENERATED_CARD_DEFINITIONS.find((card) => card.id === cardId)
}
