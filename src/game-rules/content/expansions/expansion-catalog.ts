import {
  asExpansionId,
  type CardDefinition,
  type ExpansionId
} from '../cards/card-definition'
import {
  BASIC_CARD_SOURCE,
  BLACKROCK_MOUNTAIN_CARD_SOURCE,
  CLASSIC_CARD_SOURCE,
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
