import {
  asClassId,
  asHeroId,
  asHeroPowerId,
  type ClassId,
  type HeroId,
  type HeroPowerId
} from '../cards/card-definition'

export interface HeroDefinition {
  readonly id: HeroId
  readonly classId: ClassId
  readonly displayName: string
  readonly startingHealth: number
  readonly heroPowerId: HeroPowerId
  readonly presentationAssetKey: HeroPresentationAssetKey
  /** Whether this hero may be chosen as a deck's starting hero. */
  readonly deckSelectable: boolean
}

export type HeroPresentationAssetKey =
  | 'hero-guldan'
  | 'hero-rexxar'
  | 'hero-valeera'
  | 'hero-garrosh'
  | 'hero-malfurion'
  | 'hero-uther'
  | 'hero-anduin'
  | 'hero-jaina'
  | 'hero-thrall'
  | 'hero-jaraxxus'
  | 'hero-ragnaros'
  | 'hero-malfurion-pestilent'
  | 'hero-rexxar-deathstalker'
  | 'hero-jaina-frost-lich'
  | 'hero-uther-ebon-blade'
  | 'hero-anduin-shadowreaper'
  | 'hero-valeera-hollow'
  | 'hero-thrall-deathseer'
  | 'hero-guldan-bloodreaver'
  | 'hero-garrosh-scourgelord'

const HERO_DATA = [
  ['guldan', 'Warlock', "Gul'dan", 'warlock-life-tap', 'hero-guldan', true],
  ['rexxar', 'Hunter', 'Rexxar', 'hunter-steady-shot', 'hero-rexxar', true],
  [
    'valeera',
    'Rogue',
    'Valeera Sanguinar',
    'rogue-dagger-mastery',
    'hero-valeera',
    true
  ],
  [
    'garrosh',
    'Warrior',
    'Garrosh Hellscream',
    'warrior-armor-up',
    'hero-garrosh',
    true
  ],
  [
    'malfurion',
    'Druid',
    'Malfurion Stormrage',
    'druid-shapeshift',
    'hero-malfurion',
    true
  ],
  ['uther', 'Paladin', 'Uther Lightbringer', 'paladin-reinforce', 'hero-uther', true],
  ['anduin', 'Priest', 'Anduin Wrynn', 'priest-lesser-heal', 'hero-anduin', true],
  ['jaina', 'Mage', 'Jaina Proudmoore', 'mage-fireblast', 'hero-jaina', true],
  ['thrall', 'Shaman', 'Thrall', 'shaman-totemic-call', 'hero-thrall', true],
  ['jaraxxus', 'Warlock', 'Lord Jaraxxus', 'jaraxxus-inferno', 'hero-jaraxxus', false],
  [
    'ragnaros',
    'Warrior',
    'Ragnaros the Firelord',
    'ragnaros-die-insects',
    'hero-ragnaros',
    false
  ],
  [
    'malfurion-pestilent',
    'Druid',
    'Malfurion the Pestilent',
    'knights_of_the_frozen_throne_plague_lord',
    'hero-malfurion-pestilent',
    false
  ],
  [
    'rexxar-deathstalker',
    'Hunter',
    'Deathstalker Rexxar',
    'knights_of_the_frozen_throne_build_a_beast',
    'hero-rexxar-deathstalker',
    false
  ],
  [
    'jaina-frost-lich',
    'Mage',
    'Frost Lich Jaina',
    'knights_of_the_frozen_throne_icy_touch',
    'hero-jaina-frost-lich',
    false
  ],
  [
    'uther-ebon-blade',
    'Paladin',
    'Uther of the Ebon Blade',
    'knights_of_the_frozen_throne_the_four_horsemen',
    'hero-uther-ebon-blade',
    false
  ],
  [
    'anduin-shadowreaper',
    'Priest',
    'Shadowreaper Anduin',
    'knights_of_the_frozen_throne_voidform',
    'hero-anduin-shadowreaper',
    false
  ],
  [
    'valeera-hollow',
    'Rogue',
    'Valeera the Hollow',
    'knights_of_the_frozen_throne_deaths_shadow',
    'hero-valeera-hollow',
    false
  ],
  [
    'thrall-deathseer',
    'Shaman',
    'Thrall, Deathseer',
    'knights_of_the_frozen_throne_transmute_spirit',
    'hero-thrall-deathseer',
    false
  ],
  [
    'guldan-bloodreaver',
    'Warlock',
    "Bloodreaver Gul'dan",
    'knights_of_the_frozen_throne_siphon_life',
    'hero-guldan-bloodreaver',
    false
  ],
  [
    'garrosh-scourgelord',
    'Warrior',
    'Scourgelord Garrosh',
    'knights_of_the_frozen_throne_bladestorm',
    'hero-garrosh-scourgelord',
    false
  ]
] as const

export const HERO_DEFINITIONS: readonly HeroDefinition[] = HERO_DATA.map(
  ([id, classId, displayName, heroPowerId, presentationAssetKey, deckSelectable]) => ({
    id: asHeroId(id),
    classId: asClassId(classId),
    displayName,
    startingHealth: id === 'ragnaros' ? 8 : 30,
    heroPowerId: asHeroPowerId(heroPowerId),
    presentationAssetKey,
    deckSelectable
  })
)

export class HeroCatalog {
  private readonly definitions: ReadonlyMap<HeroId, HeroDefinition>

  constructor(definitions: readonly HeroDefinition[] = HERO_DEFINITIONS) {
    const definitionsById = new Map<HeroId, HeroDefinition>()
    for (const definition of definitions) {
      if (definitionsById.has(definition.id)) {
        throw new Error(`Duplicate hero id: ${definition.id}`)
      }
      if (definition.startingHealth <= 0) {
        throw new Error(`Hero ${definition.id} has invalid starting health`)
      }
      definitionsById.set(definition.id, definition)
    }
    this.definitions = definitionsById
  }

  get all(): readonly HeroDefinition[] {
    return [...this.definitions.values()]
  }

  get(id: HeroId | string): HeroDefinition | undefined {
    return this.definitions.get(id as HeroId)
  }

  require(id: HeroId | string): HeroDefinition {
    const definition = this.get(id)
    if (!definition) throw new Error(`Unknown hero id: ${id}`)
    return definition
  }

  getPrimaryForClass(classId: ClassId | string): HeroDefinition | undefined {
    return this.all.find((hero) => hero.classId === classId && hero.deckSelectable)
  }
}

export const HERO_CATALOG = new HeroCatalog()
