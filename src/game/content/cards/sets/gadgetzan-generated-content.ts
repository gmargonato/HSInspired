type RecordValue = Record<string, unknown>
interface CardRecord extends RecordValue {
  id: string
  name: string
  cost: number
}

const PREFIX = 'mean_streets_of_gadgetzan_'
const COSTS = [1, 5, 10] as const
// Choice order also determines the stable recipe IDs and seeded offers.
const INGREDIENTS = [
  'heart_of_fire',
  'felbloom',
  'goldthorn',
  'icecap',
  'ichor_of_undeath',
  'kingsblood',
  'netherbloom',
  'shadow_oil',
  'stonescale_oil',
  'mystic_wool'
] as const
type Ingredient = (typeof INGREDIENTS)[number]

// Transform first, then damage, then summon, then the remaining effects.
const EFFECT_ORDER: readonly Ingredient[] = [
  'mystic_wool',
  'heart_of_fire',
  'felbloom',
  'netherbloom',
  'ichor_of_undeath',
  'goldthorn',
  'icecap',
  'stonescale_oil',
  'kingsblood',
  'shadow_oil'
]

function ingredient(
  key: Ingredient,
  tier: number
): { text: string; action: RecordValue } {
  const count = tier + 1
  const damage = [3, 5, 8][tier]!
  const health = [2, 4, 6][tier]!
  const demon = [2, 5, 8][tier]!
  const armor = [4, 7, 10][tier]!
  const plural = count === 1 ? '' : 's'
  switch (key) {
    case 'heart_of_fire':
      return {
        text: `Deal ${damage} damage.`,
        action: {
          action: 'damage',
          target: { controller: 'any', type: 'character', selection: 'chosen' },
          amount: damage
        }
      }
    case 'felbloom':
      return {
        text: `Deal ${health} damage to all minions.`,
        action: {
          action: 'damage',
          target: { controller: 'any', type: 'minion', selection: 'all' },
          amount: health
        }
      }
    case 'goldthorn':
      return {
        text: `Give your minions +${health} Health.`,
        action: {
          action: 'modify',
          target: { controller: 'self', type: 'minion', selection: 'all' },
          health
        }
      }
    case 'icecap':
      return {
        text: `Freeze ${count} random enemy minion${plural}.`,
        action: {
          action: 'freeze',
          target: {
            controller: 'opponent',
            type: 'minion',
            selection: 'random',
            count,
            distinct: true,
            filter: { mortallyWounded: false }
          }
        }
      }
    case 'ichor_of_undeath':
      return {
        text: `Summon ${count} friendly minion${plural} that died this game.`,
        action: {
          action: 'resurrect',
          player: 'self',
          source: 'friendly-minions-died-this-game',
          selection: 'random',
          count,
          distinctDeathEvents: true
        }
      }
    case 'kingsblood':
      return {
        text: `Draw ${count} card${plural}.`,
        action: { action: 'draw', player: 'self', count }
      }
    case 'netherbloom':
      return {
        text: `Summon a ${demon}/${demon} Demon.`,
        action: {
          action: 'summon',
          cardId: `${PREFIX}kazakus_demon_${demon}`,
          count: 1
        }
      }
    case 'shadow_oil':
      return {
        text: `Add ${count} random Demon${plural} to your hand.`,
        action: {
          action: 'add-to-hand',
          player: 'self',
          source: 'random-card',
          filter: { tribe: 'Demon', collectible: true },
          count
        }
      }
    case 'stonescale_oil':
      return {
        text: `Gain ${armor} Armor.`,
        action: { action: 'gain-armor', player: 'self', amount: armor }
      }
    case 'mystic_wool':
      return {
        text:
          tier === 1
            ? 'Transform a random enemy minion into a 1/1 Sheep.'
            : 'Transform all minions into 1/1 Sheep.',
        action: {
          action: 'transform',
          target: {
            controller: tier === 1 ? 'opponent' : 'any',
            type: 'minion',
            selection: tier === 1 ? 'random' : 'all'
          },
          cardId: `${PREFIX}sheep`
        }
      }
  }
}

function token(id: string, name: string, cost: number, rulesText = ''): CardRecord {
  return {
    id: PREFIX + id,
    name,
    cost,
    rulesText,
    rarity: 'Summon',
    cardClass: 'Neutral',
    type: 'Spell',
    subtype: 'General',
    attack: null,
    health: null,
    keywords: [],
    effects: [],
    collectible: false
  }
}

const jadeCards = Array.from({ length: 30 }, (_, index) => {
  const size = index + 1
  return {
    ...token(`jade_golem_${size}`, 'Jade Golem', Math.min(size, 10)),
    type: 'Minion',
    attack: size,
    health: size
  }
})
const jadePool = jadeCards.map((card) => card.id)
const generatedCards: CardRecord[] = [...jadeCards]
export const KAZAKUS_POTION_COST_OPTIONS = COSTS.map((cost, tier) => {
  const keys = INGREDIENTS.filter((key) => cost !== 1 || key !== 'mystic_wool')
  const ingredientId = (key: Ingredient): string => `${PREFIX}kazakus_${cost}_${key}`
  for (const key of keys) {
    const name = key
      .split('_')
      .map((word) => (word === 'of' ? word : word[0]!.toUpperCase() + word.slice(1)))
      .join(' ')
    generatedCards.push({
      ...token(`kazakus_${cost}_${key}`, name, cost, ingredient(key, tier).text),
      rarity: 'None'
    })
  }
  const recipes = keys.flatMap((first, index) =>
    keys.slice(index + 1).map((second) => {
      const id = `kazakus_potion_${cost}_${first}_${second}`
      const ordered = [first, second].sort(
        (a, b) => EFFECT_ORDER.indexOf(a) - EFFECT_ORDER.indexOf(b)
      )
      generatedCards.push({
        ...token(
          id,
          'Kazakus Potion',
          cost,
          ordered.map((key) => ingredient(key, tier).text).join(' ')
        ),
        effects: [
          {
            trigger: 'cast',
            actions: ordered.map((key) => ingredient(key, tier).action)
          }
        ]
      })
      return {
        ingredients: [ingredientId(first), ingredientId(second)],
        cardId: PREFIX + id
      }
    })
  )
  return {
    cost,
    presentationCardId:
      PREFIX + ['lesser_potion', 'greater_potion', 'superior_potion'][tier],
    ingredientPool: keys.map(ingredientId),
    recipes
  }
})

function expandActions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandActions)
  if (typeof value !== 'object' || value === null) return value
  const record = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, expandActions(entry)])
  )
  if (record.action === 'summon-jade-golem') return { ...record, pool: jadePool }
  if (record.action === 'create-kazakus-potion')
    return { ...record, costOptions: KAZAKUS_POTION_COST_OPTIONS }
  return record
}

/** Assemble before validation so generated references receive the usual catalog checks. */
export function assembleGadgetzanCards(
  records: readonly CardRecord[]
): readonly CardRecord[] {
  // The original set ends with cost/name-sorted Kazakus/Jade tokens. Retain this
  // ordering because catalog iteration can feed seeded random card pools.
  const boundary = records.findIndex((card) => card.id === PREFIX + 'lesser_potion')
  if (boundary < 0) throw new Error('Missing Gadgetzan potion presentation card')
  const tail = [...records.slice(boundary), ...generatedCards].sort(
    (a, b) =>
      a.cost - b.cost ||
      a.name.localeCompare(b.name, 'en') ||
      a.id.localeCompare(b.id, 'en', { numeric: true })
  )
  return [...records.slice(0, boundary), ...tail].map((card) => ({
    ...card,
    effects: expandActions(card.effects)
  }))
}
