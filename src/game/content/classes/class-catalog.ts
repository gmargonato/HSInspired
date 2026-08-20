import {
  asClassId,
  asHeroId,
  CARD_CLASSES,
  type ClassId,
  type HeroId,
  type KnownClassId
} from '../cards/card-definition'

export interface ClassDefinition {
  readonly id: ClassId
  readonly displayName: string
  readonly presentationKey: string
  readonly heroIds: readonly HeroId[]
}

const CLASS_NAMES: Readonly<Record<KnownClassId, string>> = {
  Druid: 'Druid',
  Hunter: 'Hunter',
  Mage: 'Mage',
  Neutral: 'Neutral',
  Paladin: 'Paladin',
  Priest: 'Priest',
  Rogue: 'Rogue',
  Shaman: 'Shaman',
  Warlock: 'Warlock',
  Warrior: 'Warrior'
}

const HERO_IDS_BY_CLASS: Readonly<Record<KnownClassId, readonly string[]>> = {
  Druid: ['malfurion'],
  Hunter: ['rexxar'],
  Mage: ['jaina'],
  Neutral: [],
  Paladin: ['uther'],
  Priest: ['anduin'],
  Rogue: ['valeera'],
  Shaman: ['thrall'],
  Warlock: ['guldan'],
  Warrior: ['garrosh']
}

export const CLASS_DEFINITIONS: readonly ClassDefinition[] = CARD_CLASSES.map((id) => ({
  id: asClassId(id),
  displayName: CLASS_NAMES[id],
  presentationKey: `class-${id.toLowerCase()}`,
  heroIds: HERO_IDS_BY_CLASS[id].map(asHeroId)
}))

export class ClassCatalog {
  private readonly definitions: ReadonlyMap<ClassId, ClassDefinition>

  constructor(definitions: readonly ClassDefinition[] = CLASS_DEFINITIONS) {
    const definitionsById = new Map<ClassId, ClassDefinition>()
    for (const definition of definitions) {
      if (definitionsById.has(definition.id)) {
        throw new Error(`Duplicate class id: ${definition.id}`)
      }
      definitionsById.set(definition.id, definition)
    }
    this.definitions = definitionsById
  }

  get all(): readonly ClassDefinition[] {
    return [...this.definitions.values()]
  }

  get(id: ClassId | string): ClassDefinition | undefined {
    return this.definitions.get(id as ClassId)
  }

  require(id: ClassId | string): ClassDefinition {
    const definition = this.get(id)
    if (!definition) throw new Error(`Unknown class id: ${id}`)
    return definition
  }
}

export const CLASS_CATALOG = new ClassCatalog()
