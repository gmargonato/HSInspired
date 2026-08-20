import {
  asClassId,
  asHeroPowerId,
  type ClassId,
  type HeroPowerId
} from '../cards/card-definition'

export interface HeroPowerDefinition {
  readonly id: HeroPowerId
  readonly classId: ClassId
  readonly displayName: string
  readonly cost: number
  readonly rulesText: string
  readonly presentationAssetKey: string
}

const HERO_POWER_DATA = [
  [
    'druid-shapeshift',
    'Druid',
    'Shapeshift',
    2,
    'Gain 1 Attack this turn. Gain 1 Armor.',
    'hero-power-druid'
  ],
  [
    'hunter-steady-shot',
    'Hunter',
    'Steady Shot',
    2,
    'Deal 2 damage to the enemy hero.',
    'hero-power-hunter'
  ],
  ['mage-fireblast', 'Mage', 'Fireblast', 2, 'Deal 1 damage.', 'hero-power-mage'],
  [
    'paladin-reinforce',
    'Paladin',
    'Reinforce',
    2,
    'Summon a 1/1 Silver Hand Recruit.',
    'hero-power-paladin'
  ],
  [
    'priest-lesser-heal',
    'Priest',
    'Lesser Heal',
    2,
    'Restore 2 Health.',
    'hero-power-priest'
  ],
  [
    'rogue-dagger-mastery',
    'Rogue',
    'Dagger Mastery',
    2,
    'Equip a 1/2 Dagger.',
    'hero-power-rogue'
  ],
  [
    'shaman-totemic-call',
    'Shaman',
    'Totemic Call',
    2,
    'Summon a random Totem.',
    'hero-power-shaman'
  ],
  [
    'warlock-life-tap',
    'Warlock',
    'Life Tap',
    2,
    'Draw a card and take 2 damage.',
    'hero-power-warlock'
  ],
  ['warrior-armor-up', 'Warrior', 'Armor Up!', 2, 'Gain 2 Armor.', 'hero-power-warrior']
] as const

export const HERO_POWER_DEFINITIONS: readonly HeroPowerDefinition[] =
  HERO_POWER_DATA.map(
    ([id, classId, displayName, cost, rulesText, presentationAssetKey]) => ({
      id: asHeroPowerId(id),
      classId: asClassId(classId),
      displayName,
      cost,
      rulesText,
      presentationAssetKey
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
