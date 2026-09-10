import {
  asClassId,
  asCardId,
  asHeroPowerId,
  type CardId,
  type ClassId,
  type HeroPowerId
} from '../cards/card-definition'

export type HeroPowerTargeting = 'none' | 'any-character'

export type HeroPowerEffect =
  | {
      readonly kind: 'gain-attack-and-armor'
      readonly attack: number
      readonly armor: number
    }
  | { readonly kind: 'damage-enemy-hero'; readonly amount: number }
  | { readonly kind: 'damage-character'; readonly amount: number }
  | { readonly kind: 'damage-random-enemy'; readonly amount: number }
  | { readonly kind: 'summon'; readonly cardId: CardId; readonly count?: number }
  | { readonly kind: 'restore-character'; readonly amount: number }
  | { readonly kind: 'equip-weapon'; readonly cardId: CardId }
  | { readonly kind: 'summon-random-totem'; readonly cardIds: readonly CardId[] }
  | {
      readonly kind: 'draw-and-self-damage'
      readonly count: number
      readonly amount: number
    }
  | { readonly kind: 'gain-armor'; readonly amount: number }

/** Basic powers that can be upgraded by Justicar Trueheart. */
export const BASIC_HERO_POWER_UPGRADES: Readonly<Record<string, string>> = {
  'druid-shapeshift': 'druid-dire-shapeshift',
  'hunter-steady-shot': 'hunter-ballista-shot',
  'mage-fireblast': 'mage-fireblast-rank-2',
  'paladin-reinforce': 'paladin-the-silver-hand',
  'priest-lesser-heal': 'priest-heal',
  'rogue-dagger-mastery': 'rogue-poisoned-daggers',
  'shaman-totemic-call': 'shaman-totemic-slam',
  'warlock-life-tap': 'warlock-soul-tap',
  'warrior-armor-up': 'warrior-tank-up'
}

export interface HeroPowerDefinition {
  readonly id: HeroPowerId
  readonly classId: ClassId
  readonly displayName: string
  readonly cost: number
  readonly rulesText: string
  readonly presentationAssetKey: string
  readonly targeting: HeroPowerTargeting
  readonly effect: HeroPowerEffect
}

const HERO_POWER_DATA = [
  [
    'druid-shapeshift',
    'Druid',
    'Shapeshift',
    2,
    'Gain 1 Attack this turn. Gain 1 Armor.',
    'hero-power-druid',
    'none',
    { kind: 'gain-attack-and-armor', attack: 1, armor: 1 }
  ],
  [
    'hunter-steady-shot',
    'Hunter',
    'Steady Shot',
    2,
    'Deal 2 damage to the enemy hero.',
    'hero-power-hunter',
    'none',
    { kind: 'damage-enemy-hero', amount: 2 }
  ],
  [
    'mage-fireblast',
    'Mage',
    'Fireblast',
    2,
    'Deal 1 damage.',
    'hero-power-mage',
    'any-character',
    { kind: 'damage-character', amount: 1 }
  ],
  [
    'paladin-reinforce',
    'Paladin',
    'Reinforce',
    2,
    'Summon a 1/1 Silver Hand Recruit.',
    'hero-power-paladin',
    'none',
    { kind: 'summon', cardId: 'basic_silver_hand_recruit' }
  ],
  [
    'priest-lesser-heal',
    'Priest',
    'Lesser Heal',
    2,
    'Restore 2 Health.',
    'hero-power-priest',
    'any-character',
    { kind: 'restore-character', amount: 2 }
  ],
  [
    'rogue-dagger-mastery',
    'Rogue',
    'Dagger Mastery',
    2,
    'Equip a 1/2 Dagger.',
    'hero-power-rogue',
    'none',
    { kind: 'equip-weapon', cardId: 'basic_wicked_knife' }
  ],
  [
    'shaman-totemic-call',
    'Shaman',
    'Totemic Call',
    2,
    'Summon a random Totem.',
    'hero-power-shaman',
    'none',
    {
      kind: 'summon-random-totem',
      cardIds: [
        'basic_healing_totem',
        'basic_searing_totem',
        'basic_stoneclaw_totem',
        'basic_wrath_of_air_totem'
      ]
    }
  ],
  [
    'warlock-life-tap',
    'Warlock',
    'Life Tap',
    2,
    'Draw a card and take 2 damage.',
    'hero-power-warlock',
    'none',
    { kind: 'draw-and-self-damage', count: 1, amount: 2 }
  ],
  [
    'jaraxxus-inferno',
    'Warlock',
    'Inferno!',
    2,
    'Summon a 6/6 Infernal.',
    'hero-power-jaraxxus',
    'none',
    { kind: 'summon', cardId: 'classic_infernal' }
  ],
  [
    'ragnaros-die-insects',
    'Warrior',
    'DIE, INSECT!',
    2,
    'Deal 8 damage to a character.',
    'hero-power-ragnaros',
    'any-character',
    { kind: 'damage-character', amount: 8 }
  ],
  [
    'warrior-armor-up',
    'Warrior',
    'Armor Up!',
    2,
    'Gain 2 Armor.',
    'hero-power-warrior',
    'none',
    { kind: 'gain-armor', amount: 2 }
  ],
  [
    'druid-dire-shapeshift',
    'Druid',
    'Dire Shapeshift',
    2,
    'Gain 2 Attack this turn. Gain 2 Armor.',
    'hero-power-druid-upgraded',
    'none',
    { kind: 'gain-attack-and-armor', attack: 2, armor: 2 }
  ],
  ['hunter-ballista-shot', 'Hunter', 'Ballista Shot', 2, 'Deal 3 damage to the enemy hero.', 'hero-power-hunter-upgraded', 'none', { kind: 'damage-enemy-hero', amount: 3 }],
  ['mage-fireblast-rank-2', 'Mage', 'Fireblast Rank 2', 2, 'Deal 2 damage.', 'hero-power-mage-upgraded', 'any-character', { kind: 'damage-character', amount: 2 }],
  ['paladin-the-silver-hand', 'Paladin', 'The Silver Hand', 2, 'Summon two 1/1 Silver Hand Recruits.', 'hero-power-paladin-upgraded', 'none', { kind: 'summon', cardId: 'basic_silver_hand_recruit', count: 2 }],
  ['priest-heal', 'Priest', 'Heal', 2, 'Restore 4 Health.', 'hero-power-priest-upgraded', 'any-character', { kind: 'restore-character', amount: 4 }],
  ['rogue-poisoned-daggers', 'Rogue', 'Poisoned Daggers', 2, 'Equip a 2/2 Dagger.', 'hero-power-rogue-upgraded', 'none', { kind: 'equip-weapon', cardId: 'the_grand_tournament_poisoned_dagger' }],
  ['shaman-totemic-slam', 'Shaman', 'Totemic Slam', 2, 'Summon a basic Totem.', 'hero-power-shaman-upgraded', 'none', { kind: 'summon-random-totem', cardIds: ['basic_healing_totem', 'basic_searing_totem', 'basic_stoneclaw_totem', 'basic_wrath_of_air_totem'] }],
  ['warlock-soul-tap', 'Warlock', 'Soul Tap', 2, 'Draw 2 cards and take 2 damage.', 'hero-power-warlock-upgraded', 'none', { kind: 'draw-and-self-damage', count: 2, amount: 2 }],
  ['warrior-tank-up', 'Warrior', 'Tank Up!', 2, 'Gain 4 Armor.', 'hero-power-warrior-upgraded', 'none', { kind: 'gain-armor', amount: 4 }]
] as const

export const HERO_POWER_DEFINITIONS: readonly HeroPowerDefinition[] =
  HERO_POWER_DATA.map(
    ([
      id,
      classId,
      displayName,
      cost,
      rulesText,
      presentationAssetKey,
      targeting,
      effect
    ]) => ({
      id: asHeroPowerId(id),
      classId: asClassId(classId),
      displayName,
      cost,
      rulesText,
      presentationAssetKey,
      targeting,
      effect:
        effect.kind === 'summon-random-totem'
          ? { ...effect, cardIds: effect.cardIds.map(asCardId) }
          : effect.kind === 'summon' || effect.kind === 'equip-weapon'
            ? { ...effect, cardId: asCardId(effect.cardId) }
            : effect
    })
  )

export class HeroPowerCatalog {
  private readonly definitions: ReadonlyMap<HeroPowerId, HeroPowerDefinition>

  constructor(definitions: readonly HeroPowerDefinition[] = HERO_POWER_DEFINITIONS) {
    const definitionsById = new Map<HeroPowerId, HeroPowerDefinition>()
    for (const definition of definitions) {
      if (definitionsById.has(definition.id)) {
        throw new Error(`Duplicate hero power id: ${definition.id}`)
      }
      definitionsById.set(definition.id, definition)
    }
    this.definitions = definitionsById
  }

  get all(): readonly HeroPowerDefinition[] {
    return [...this.definitions.values()]
  }

  get(id: HeroPowerId | string): HeroPowerDefinition | undefined {
    return this.definitions.get(id as HeroPowerId)
  }

  require(id: HeroPowerId | string): HeroPowerDefinition {
    const definition = this.get(id)
    if (!definition) throw new Error(`Unknown hero power id: ${id}`)
    return definition
  }
}

export const HERO_POWER_CATALOG = new HeroPowerCatalog()
