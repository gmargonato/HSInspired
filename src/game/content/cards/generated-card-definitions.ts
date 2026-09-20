import {
  asCardId,
  asClassId,
  asExpansionId,
  type CardDefinition,
  type CardId
} from './card-definition'
import type { CardKeyword } from './card-effects'
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

function generatedWeapon(
  id: string,
  name: string,
  attack: number,
  durability: number
): CardDefinition {
  return {
    id: asCardId(id),
    expansionId: GENERATED_EXPANSION,
    set: GENERATED_EXPANSION,
    name,
    rarity: 'None',
    cardClass: GENERATED_CLASS,
    subtype: null,
    spellSchool: null,
    cost: 0,
    rulesText: '',
    keywords: [],
    effects: [],
    collectible: false,
    deckLegal: false,
    type: 'Weapon' as const,
    attack,
    health: durability
  } as unknown as CardDefinition
}

function generatedMinion(
  id: string,
  name: string,
  attack: number,
  health: number
): CardDefinition {
  return {
    id: asCardId(id),
    expansionId: GENERATED_EXPANSION,
    set: GENERATED_EXPANSION,
    name,
    rarity: 'Summon',
    cardClass: GENERATED_CLASS,
    subtype: null,
    spellSchool: null,
    cost: 0,
    rulesText: '',
    keywords: [],
    effects: [],
    collectible: false,
    deckLegal: false,
    type: 'Minion' as const,
    attack,
    health
  } as unknown as CardDefinition
}

function generatedMinionWithKeywords(
  id: string,
  name: string,
  attack: number,
  health: number,
  keywords: readonly CardKeyword[]
): CardDefinition {
  return { ...generatedMinion(id, name, attack, health), keywords }
}

function generatedTriggeredSpell(
  id: string,
  name: string,
  rulesText: string,
  trigger: 'on-draw',
  actions: readonly Record<string, unknown>[]
): CardDefinition {
  return {
    ...generatedSpell(id, name, rulesText, []),
    effects: [{ trigger, actions } as CardDefinition['effects'][number]]
  }
}

/** The seven GvG Spare Parts used by the catalog's random-card effects. */
const GENERATED_CARD_RECORDS: readonly CardDefinition[] = [
  generatedMinion('the_grand_tournament_ambush_nerubian', 'Nerubian', 4, 4),
  generatedTriggeredSpell(
    'the_grand_tournament_ambush',
    'Ambush!',
    'When drawn, summon a 4/4 Nerubian.',
    'on-draw',
    [
      {
        action: 'summon',
        cardId: 'the_grand_tournament_ambush_nerubian',
        controller: 'opponent'
      }
    ]
  ),
  generatedMinionWithKeywords('the_grand_tournament_bear', 'Bear', 3, 3, ['taunt']),
  generatedMinionWithKeywords('the_grand_tournament_boar', 'Boar', 4, 2, ['charge']),
  generatedMinionWithKeywords(
    'the_grand_tournament_saber_charge_form',
    'Druid of the Saber',
    2,
    1,
    ['charge']
  ),
  generatedMinionWithKeywords(
    'the_grand_tournament_saber_stealth_form',
    'Druid of the Saber',
    3,
    2,
    ['stealth']
  ),
  generatedMinion('the_grand_tournament_nerubian', 'Nerubian', 4, 4),
  generatedMinion('the_grand_tournament_sapling', 'Sapling', 1, 1),
  generatedMinion('the_grand_tournament_war_kodo', 'War Kodo', 3, 5),
  generatedWeapon('the_grand_tournament_poisoned_dagger', 'Poisoned Dagger', 2, 2),
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
