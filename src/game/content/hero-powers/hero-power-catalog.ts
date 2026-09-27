import {
  asClassId,
  asCardId,
  asHeroPowerId,
  type CardId,
  type ClassId,
  type HeroPowerId
} from '../cards/card-definition'

export type HeroPowerTargeting =
  'none' | 'any-character' | 'minion' | 'enemy-minion' | 'friendly-minion'

export type HeroPowerEffect =
  | {
      readonly kind: 'gain-attack-and-armor'
      readonly attack: number
      readonly armor: number
    }
  | { readonly kind: 'damage-enemy-hero'; readonly amount: number }
  | { readonly kind: 'damage-character'; readonly amount: number }
  | { readonly kind: 'damage-all-minions'; readonly amount: number }
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
  | { readonly kind: 'buff-friendly-beast'; readonly attack: number; readonly health: number }
  | { readonly kind: 'build-a-beast' }
  | { readonly kind: 'copy-last-card-this-turn' }
  | {
      readonly kind: 'choose-one'
      readonly attack: number
      readonly armor: number
      readonly attackChoiceCardId: CardId
      readonly armorChoiceCardId: CardId
    }
  | {
      readonly kind: 'damage-and-summon-on-kill'
      readonly amount: number
      readonly cardId: CardId
    }
  | {
      readonly kind: 'summon-horseman-and-destroy-if-complete'
      readonly cardIds: readonly CardId[]
    }
  | { readonly kind: 'damage-and-refresh-after-card'; readonly amount: number }
  | {
      readonly kind: 'transform-friendly-minion-random-more-expensive'
      readonly costIncrease: number
    }
  | { readonly kind: 'lifesteal-damage'; readonly amount: number }
  | { readonly kind: 'discover-choose-one' }
  | { readonly kind: 'buff-friendly-minions'; readonly amount: number }
  | { readonly kind: 'discover-spell-discount' }
  | { readonly kind: 'summon-copy-with-stats' }
  | { readonly kind: 'restore-and-buff-minion'; readonly amount: number }
  | { readonly kind: 'double-battlecries-this-turn' }
  | { readonly kind: 'draw-with-set-cost'; readonly cost: number }
  | {
      readonly kind: 'summon-and-refresh-after-hero-attack'
      readonly cardId: CardId
    }

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
    'hunter-dinomancy',
    'Hunter',
    'Dinomancy',
    2,
    'Give a Beast +3/+3.',
    'hero-power-hunter',
    'friendly-minion',
    { kind: 'buff-friendly-beast', attack: 3, health: 3 }
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
    'paladin-the-tidal-hand',
    'Paladin',
    'The Tidal Hand',
    2,
    'Summon a 1/1 Silver Hand Murloc.',
    'hero-power-paladin-tidal-hand',
    'none',
    { kind: 'summon', cardId: 'whispers_of_the_old_gods_silver_hand_murloc' }
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
    'knights_of_the_frozen_throne_deaths_shadow',
    'Rogue',
    "Death's Shadow",
    2,
    'Add a copy of the last card you played this turn to your hand.',
    'hero-power-deaths-shadow',
    'none',
    { kind: 'copy-last-card-this-turn' }
  ],
  [
    'knights_of_the_frozen_throne_plague_lord',
    'Druid',
    'Plague Lord',
    2,
    'Choose One - +3 Attack this turn; or Gain 3 Armor.',
    'hero-power-plague-lord',
    'none',
    {
      kind: 'choose-one',
      attack: 3,
      armor: 3,
      attackChoiceCardId: asCardId('knights_of_the_frozen_throne_spider_fangs'),
      armorChoiceCardId: asCardId('knights_of_the_frozen_throne_scarab_shell')
    }
  ],
  [
    'knights_of_the_frozen_throne_build_a_beast',
    'Hunter',
    'Build-A-Beast',
    2,
    'Craft a custom Zombeast.',
    'hero-power-build-a-beast',
    'none',
    { kind: 'build-a-beast' }
  ],
  [
    'knights_of_the_frozen_throne_bladestorm',
    'Warrior',
    'Bladestorm',
    2,
    'Deal 1 damage to all minions.',
    'hero-power-bladestorm',
    'none',
    { kind: 'damage-all-minions', amount: 1 }
  ],
  [
    'knights_of_the_frozen_throne_icy_touch',
    'Mage',
    'Icy Touch',
    2,
    'Deal 1 damage. If this kills a minion, summon a Water Elemental.',
    'hero-power-icy-touch',
    'any-character',
    {
      kind: 'damage-and-summon-on-kill',
      amount: 1,
      cardId: 'basic_water_elemental'
    }
  ],
  [
    'knights_of_the_frozen_throne_the_four_horsemen',
    'Paladin',
    'The Four Horsemen',
    2,
    'Summon a 2/2 Horseman. If you have all 4, destroy the enemy hero.',
    'hero-power-the-four-horsemen',
    'none',
    {
      kind: 'summon-horseman-and-destroy-if-complete',
      cardIds: [
        'knights_of_the_frozen_throne_darion_mograine',
        'knights_of_the_frozen_throne_deathlord_nazgrim',
        'knights_of_the_frozen_throne_inquisitor_whitemane',
        'knights_of_the_frozen_throne_thoras_trollbane'
      ]
    }
  ],
  [
    'knights_of_the_frozen_throne_voidform',
    'Priest',
    'Voidform',
    2,
    'Deal 2 damage. After you play a card, refresh this.',
    'hero-power-voidform',
    'any-character',
    { kind: 'damage-and-refresh-after-card', amount: 2 }
  ],
  [
    'knights_of_the_frozen_throne_transmute_spirit',
    'Shaman',
    'Transmute Spirit',
    2,
    'Transform a friendly minion into a random one that costs (1) more.',
    'hero-power-transmute-spirit',
    'friendly-minion',
    {
      kind: 'transform-friendly-minion-random-more-expensive',
      costIncrease: 1
    }
  ],
  [
    'knights_of_the_frozen_throne_siphon_life',
    'Warlock',
    'Siphon Life',
    2,
    'Lifesteal. Deal 3 damage.',
    'hero-power-siphon-life',
    'any-character',
    { kind: 'lifesteal-damage', amount: 3 }
  ],
  [
    'saviors_of_uldum_ossirian_tear',
    'Druid',
    'Ossirian Tear',
    2,
    'Discover a Choose One card.',
    'hero-power-ossirian-tear',
    'none',
    { kind: 'discover-choose-one' }
  ],
  [
    'saviors_of_uldum_pharaohs_warmask',
    'Hunter',
    "Pharaoh's Warmask",
    2,
    'Give your minions +2 Attack.',
    'hero-power-pharaohs-warmask',
    'none',
    { kind: 'buff-friendly-minions', amount: 2 }
  ],
  [
    'saviors_of_uldum_ascendant_scroll',
    'Mage',
    'Ascendant Scroll',
    2,
    'Add a random Mage spell to your hand. It costs (2) less.',
    'hero-power-ascendant-scroll',
    'none',
    { kind: 'discover-spell-discount' }
  ],
  [
    'saviors_of_uldum_emperor_wraps',
    'Paladin',
    'Emperor Wraps',
    2,
    'Summon a 2/2 copy of a friendly minion.',
    'hero-power-emperor-wraps',
    'friendly-minion',
    { kind: 'summon-copy-with-stats' }
  ],
  [
    'saviors_of_uldum_obelisks_eye',
    'Priest',
    "Obelisk's Eye",
    2,
    "Restore 3 Health. If you target a minion, also give it +3/+3.",
    'hero-power-obelisks-eye',
    'any-character',
    { kind: 'restore-and-buff-minion', amount: 3 }
  ],
  [
    'saviors_of_uldum_ancient_blades',
    'Rogue',
    'Ancient Blades',
    2,
    'Equip a 3/2 Blade with Immune while attacking.',
    'hero-power-ancient-blades',
    'none',
    { kind: 'equip-weapon', cardId: 'journey_to_ungoro_ancient_blade' }
  ],
  [
    'saviors_of_uldum_heart_of_virnaal',
    'Shaman',
    "Heart of Vir'naal",
    2,
    'Your Battlecries trigger twice this turn.',
    'hero-power-heart-of-virnaal',
    'none',
    { kind: 'double-battlecries-this-turn' }
  ],
  [
    'saviors_of_uldum_tome_of_origination',
    'Warlock',
    'Tome of Origination',
    2,
    'Draw a card. It costs (0).',
    'hero-power-tome-of-origination',
    'none',
    { kind: 'draw-with-set-cost', cost: 0 }
  ],
  [
    'saviors_of_uldum_anraphets_core',
    'Warrior',
    "Anraphet's Core",
    2,
    'Summon a 4/3 Golem. After your hero attacks, refresh this.',
    'hero-power-anraphets-core',
    'none',
    {
      kind: 'summon-and-refresh-after-hero-attack',
      cardId: 'journey_to_ungoro_stone_golem'
    }
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
  [
    'hunter-ballista-shot',
    'Hunter',
    'Ballista Shot',
    2,
    'Deal 3 damage to the enemy hero.',
    'hero-power-hunter-upgraded',
    'none',
    { kind: 'damage-enemy-hero', amount: 3 }
  ],
  [
    'mage-fireblast-rank-2',
    'Mage',
    'Fireblast Rank 2',
    2,
    'Deal 2 damage.',
    'hero-power-mage-upgraded',
    'any-character',
    { kind: 'damage-character', amount: 2 }
  ],
  [
    'paladin-the-silver-hand',
    'Paladin',
    'The Silver Hand',
    2,
    'Summon two 1/1 Silver Hand Recruits.',
    'hero-power-paladin-upgraded',
    'none',
    { kind: 'summon', cardId: 'basic_silver_hand_recruit', count: 2 }
  ],
  [
    'priest-heal',
    'Priest',
    'Heal',
    2,
    'Restore 4 Health.',
    'hero-power-priest-upgraded',
    'any-character',
    { kind: 'restore-character', amount: 4 }
  ],
  [
    'rogue-poisoned-daggers',
    'Rogue',
    'Poisoned Daggers',
    2,
    'Equip a 2/2 Dagger.',
    'hero-power-rogue-upgraded',
    'none',
    { kind: 'equip-weapon', cardId: 'the_grand_tournament_poisoned_dagger' }
  ],
  [
    'shaman-totemic-slam',
    'Shaman',
    'Totemic Slam',
    2,
    'Summon a basic Totem.',
    'hero-power-shaman-upgraded',
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
    'warlock-soul-tap',
    'Warlock',
    'Soul Tap',
    2,
    'Draw 2 cards and take 2 damage.',
    'hero-power-warlock-upgraded',
    'none',
    { kind: 'draw-and-self-damage', count: 2, amount: 2 }
  ],
  [
    'warrior-tank-up',
    'Warrior',
    'Tank Up!',
    2,
    'Gain 4 Armor.',
    'hero-power-warrior-upgraded',
    'none',
    { kind: 'gain-armor', amount: 4 }
  ]
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
        effect.kind === 'summon-random-totem' ||
        effect.kind === 'summon-horseman-and-destroy-if-complete'
          ? { ...effect, cardIds: effect.cardIds.map(asCardId) }
          : effect.kind === 'summon' || effect.kind === 'equip-weapon'
            ? { ...effect, cardId: asCardId(effect.cardId) }
            : effect.kind === 'damage-and-summon-on-kill' ||
                effect.kind === 'summon-and-refresh-after-hero-attack'
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
