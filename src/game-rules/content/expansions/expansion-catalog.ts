import {
  asExpansionId,
  type CardDefinition,
  type ExpansionId
} from '../cards/card-definition'
import {
  BASIC_CARD_SOURCE,
  BLACKROCK_MOUNTAIN_CARD_SOURCE,
  CLASSIC_CARD_SOURCE,
  FUTURE_PAST_CARD_SOURCE,
  SHORTLIST_CARD_SOURCE,
  GOBLINS_VS_GNOMES_CARD_SOURCE,
  JOURNEY_TO_UNGORO_CARD_SOURCE,
  KNIGHTS_OF_THE_FROZEN_THRONE_CARD_SOURCE,
  LEAGUE_OF_EXPLORERS_CARD_SOURCE,
  MEAN_STREETS_OF_GADGETZAN_CARD_SOURCE,
  NAXXRAMAS_CARD_SOURCE,
  ONE_NIGHT_IN_KARAZHAN_CARD_SOURCE,
  WHISPERS_OF_THE_OLD_GODS_CARD_SOURCE,
  THE_GRAND_TOURNAMENT_CARD_SOURCE
} from '../cards/sets'

export interface ExpansionCardSourceModule {
  readonly expansionId: ExpansionId
  readonly load: () => readonly CardDefinition[] | Promise<readonly CardDefinition[]>
}

export interface ExpansionDefinition {
  readonly id: ExpansionId
  readonly displayName: string
  readonly releaseOrder: number
  readonly source: readonly CardDefinition[]
  readonly sourceModule: ExpansionCardSourceModule
}

function expansion(
  id: string,
  displayName: string,
  releaseOrder: number,
  source: readonly CardDefinition[]
): ExpansionDefinition {
  const expansionId = asExpansionId(id)
  return {
    id: expansionId,
    displayName,
    releaseOrder,
    source,
    sourceModule: {
      expansionId,
      load: () => source
    }
  }
}

export const EXPANSION_DEFINITIONS: readonly ExpansionDefinition[] = [
  expansion('basic', 'Basic', 0, BASIC_CARD_SOURCE),
  expansion('classic', 'Classic', 1, CLASSIC_CARD_SOURCE),
  expansion('naxxramas', 'Curse of Naxxramas', 2, NAXXRAMAS_CARD_SOURCE),
  expansion('goblins-vs-gnomes', 'Goblins vs Gnomes', 3, GOBLINS_VS_GNOMES_CARD_SOURCE),
  expansion(
    'blackrock-mountain',
    'Blackrock Mountain',
    4,
    BLACKROCK_MOUNTAIN_CARD_SOURCE
  ),
  expansion(
    'the-grand-tournament',
    'The Grand Tournament',
    5,
    THE_GRAND_TOURNAMENT_CARD_SOURCE
  ),
  expansion(
    'league-of-explorers',
    'League of Explorers',
    6,
    LEAGUE_OF_EXPLORERS_CARD_SOURCE
  ),
  expansion(
    'whispers-of-the-old-gods',
    'Whispers of the Old Gods',
    7,
    WHISPERS_OF_THE_OLD_GODS_CARD_SOURCE
  ),
  expansion(
    'one-night-in-karazhan',
    'One Night in Karazhan',
    8,
    ONE_NIGHT_IN_KARAZHAN_CARD_SOURCE
  ),
  expansion(
    'mean-streets-of-gadgetzan',
    'Mean Streets of Gadgetzan',
    9,
    MEAN_STREETS_OF_GADGETZAN_CARD_SOURCE
  ),
  expansion(
    'journey-to-ungoro',
    "Journey to Un'Goro",
    10,
    JOURNEY_TO_UNGORO_CARD_SOURCE
  ),
  expansion(
    'knights-of-the-frozen-throne',
    'Knights of the Frozen Throne',
    11,
    KNIGHTS_OF_THE_FROZEN_THRONE_CARD_SOURCE
  ),
  expansion('future-past', 'Future Past', 12, FUTURE_PAST_CARD_SOURCE),
  expansion(
    'kobolds-and-catacombs',
    'Kobolds & Catacombs',
    13,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'kobolds-and-catacombs')
  ),
  expansion(
    'the-witchwood',
    'The Witchwood',
    14,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'the-witchwood')
  ),
  expansion(
    'the-boomsday-project',
    'The Boomsday Project',
    15,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'the-boomsday-project')
  ),
  expansion(
    'rastakhans-rumble',
    "Rastakhan's Rumble",
    16,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'rastakhans-rumble')
  ),
  expansion(
    'rise-of-shadows',
    'Rise of Shadows',
    17,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'rise-of-shadows')
  ),
  expansion(
    'saviors-of-uldum',
    'Saviors of Uldum',
    18,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'saviors-of-uldum')
  ),
  expansion(
    'descent-of-dragons',
    'Descent of Dragons',
    19,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'descent-of-dragons')
  ),
  expansion(
    'galakronds-awakening',
    "Galakrond's Awakening",
    20,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'galakronds-awakening')
  ),
  expansion(
    'ashes-of-outland',
    'Ashes of Outland',
    21,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'ashes-of-outland')
  ),
  expansion(
    'scholomance-academy',
    'Scholomance Academy',
    22,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'scholomance-academy')
  ),
  expansion(
    'madness-at-the-darkmoon-faire',
    'Madness at the Darkmoon Faire',
    23,
    SHORTLIST_CARD_SOURCE.filter(
      (card) => card.expansionId === 'madness-at-the-darkmoon-faire'
    )
  ),
  expansion(
    'forged-in-the-barrens',
    'Forged in the Barrens',
    24,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'forged-in-the-barrens')
  ),
  expansion(
    'united-in-stormwind',
    'United in Stormwind',
    25,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'united-in-stormwind')
  ),
  expansion(
    'voyage-to-the-sunken-city',
    'Voyage to the Sunken City',
    26,
    SHORTLIST_CARD_SOURCE.filter(
      (card) => card.expansionId === 'voyage-to-the-sunken-city'
    )
  ),
  expansion(
    'murder-at-castle-nathria',
    'Murder at Castle Nathria',
    27,
    SHORTLIST_CARD_SOURCE.filter(
      (card) => card.expansionId === 'murder-at-castle-nathria'
    )
  ),
  expansion(
    'march-of-the-lich-king',
    'March of the Lich King',
    28,
    SHORTLIST_CARD_SOURCE.filter(
      (card) => card.expansionId === 'march-of-the-lich-king'
    )
  ),
  expansion(
    'titans',
    'TITANS',
    29,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'titans')
  ),
  expansion(
    'showdown-in-the-badlands',
    'Showdown in the Badlands',
    30,
    SHORTLIST_CARD_SOURCE.filter(
      (card) => card.expansionId === 'showdown-in-the-badlands'
    )
  ),
  expansion(
    'whizbangs-workshop',
    "Whizbang's Workshop",
    31,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'whizbangs-workshop')
  ),
  expansion(
    'perils-in-paradise',
    'Perils in Paradise',
    32,
    SHORTLIST_CARD_SOURCE.filter((card) => card.expansionId === 'perils-in-paradise')
  ),
  expansion(
    'into-the-emerald-dream',
    'Into the Emerald Dream',
    33,
    SHORTLIST_CARD_SOURCE.filter(
      (card) => card.expansionId === 'into-the-emerald-dream'
    )
  )
]

export class ExpansionCatalog {
  private readonly definitions: ReadonlyMap<ExpansionId, ExpansionDefinition>

  constructor(definitions: readonly ExpansionDefinition[] = EXPANSION_DEFINITIONS) {
    const definitionsById = new Map<ExpansionId, ExpansionDefinition>()
    for (const definition of definitions) {
      if (definitionsById.has(definition.id)) {
        throw new Error(`Duplicate expansion id: ${definition.id}`)
      }
      definitionsById.set(definition.id, definition)
    }
    this.definitions = definitionsById
  }

  get all(): readonly ExpansionDefinition[] {
    return [...this.definitions.values()].sort(
      (left, right) => left.releaseOrder - right.releaseOrder
    )
  }

  get(id: ExpansionId | string): ExpansionDefinition | undefined {
    return this.definitions.get(id as ExpansionId)
  }

  require(id: ExpansionId | string): ExpansionDefinition {
    const definition = this.get(id)
    if (!definition) throw new Error(`Unknown expansion id: ${id}`)
    return definition
  }
}

export const EXPANSION_CATALOG = new ExpansionCatalog()
