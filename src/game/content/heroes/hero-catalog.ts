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

const HERO_DATA = [
  ['guldan', 'Warlock', "Gul'dan", 'warlock-life-tap', 'hero-guldan'],
  ['rexxar', 'Hunter', 'Rexxar', 'hunter-steady-shot', 'hero-rexxar'],
  ['valeera', 'Rogue', 'Valeera Sanguinar', 'rogue-dagger-mastery', 'hero-valeera'],
  ['garrosh', 'Warrior', 'Garrosh Hellscream', 'warrior-armor-up', 'hero-garrosh'],
  ['malfurion', 'Druid', 'Malfurion Stormrage', 'druid-shapeshift', 'hero-malfurion'],
  ['uther', 'Paladin', 'Uther Lightbringer', 'paladin-reinforce', 'hero-uther'],
  ['anduin', 'Priest', 'Anduin Wrynn', 'priest-lesser-heal', 'hero-anduin'],
  ['jaina', 'Mage', 'Jaina Proudmoore', 'mage-fireblast', 'hero-jaina'],
  ['thrall', 'Shaman', 'Thrall', 'shaman-totemic-call', 'hero-thrall']
] as const

export const HERO_DEFINITIONS: readonly HeroDefinition[] = HERO_DATA.map(
  ([id, classId, displayName, heroPowerId, presentationAssetKey]) => ({
    id: asHeroId(id),
    classId: asClassId(classId),
    displayName,
    startingHealth: 30,
    heroPowerId: asHeroPowerId(heroPowerId),
    presentationAssetKey
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
    return this.all.find((hero) => hero.classId === classId)
  }
}

export const HERO_CATALOG = new HeroCatalog()
