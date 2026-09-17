import { CARD_CATALOG, type HeroId } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { HERO_POWER_CATALOG } from '../content/hero-powers'
import type {
  OpponentCardAssessment,
  OpponentSupport
} from './opponent-card-assessment'

export type OpponentMetric =
  | 'earlyTwo'
  | 'earlyThree'
  | 'board'
  | 'middle'
  | 'late'
  | 'expensive'
  | 'interaction'
  | 'resource'
  | 'threat'
  | 'dependent'
  | 'narrow'
  | 'weapons'
  | 'classCards'

/** New strategies supply their own bounds and brief, using the same generator. */
export interface OpponentStrategyProfile {
  readonly id: string
  readonly objective: string
  readonly bounds: Readonly<Partial<Record<OpponentMetric, readonly [number, number]>>>
  readonly themedChance: number
  readonly attempts: number
  readonly qualityExponent: number
  readonly classCardWeight: number
  readonly synergyWeight: number
}

export const MIDRANGE_TEMPO_PROFILE: OpponentStrategyProfile = {
  id: 'midrange-tempo',
  objective:
    'Win through sustained board pressure and efficient trades. Stabilize against faster opponents; pressure slower ones before they outvalue you.',
  bounds: {
    earlyTwo: [4, 30],
    earlyThree: [8, 30],
    board: [18, 30],
    middle: [8, 12],
    late: [3, 6],
    expensive: [0, 2],
    interaction: [4, 30],
    resource: [2, 30],
    threat: [3, 30],
    dependent: [0, 4],
    narrow: [0, 2],
    weapons: [0, 3],
    classCards: [6, 30]
  },
  themedChance: 0.75,
  attempts: 64,
  qualityExponent: 3,
  classCardWeight: 4,
  synergyWeight: 3
}

export const OPPONENT_STRATEGIES: Readonly<Record<string, OpponentStrategyProfile>> = {
  // aggro: AGGRO_PROFILE, // Enable after defining and validating its role bounds.
  // 'control-value': CONTROL_VALUE_PROFILE, // Shares the core/support assembly pipeline.
  'midrange-tempo': MIDRANGE_TEMPO_PROFILE
}

export function cardMetric(
  card: OpponentCardAssessment,
  metric: OpponentMetric
): boolean {
  switch (metric) {
    case 'earlyTwo':
      return card.early && card.card.cost <= 2
    case 'earlyThree':
      return card.early
    case 'middle':
      return card.card.cost >= 4 && card.card.cost <= 5
    case 'late':
      return card.card.cost >= 6
    case 'expensive':
      return card.card.cost >= 8
    case 'classCards':
      return card.card.cardClass !== 'Neutral'
    case 'weapons':
      return card.card.type === 'Weapon'
    default:
      return card[metric]
  }
}

export function opponentMetrics(
  cards: readonly OpponentCardAssessment[]
): Record<OpponentMetric, number> {
  const metrics: OpponentMetric[] = [
    'earlyTwo',
    'earlyThree',
    'board',
    'middle',
    'late',
    'expensive',
    'interaction',
    'resource',
    'threat',
    'dependent',
    'narrow',
    'weapons',
    'classCards'
  ]
  return Object.fromEntries(
    metrics.map((metric) => [
      metric,
      cards.filter((card) => cardMetric(card, metric)).length
    ])
  ) as Record<OpponentMetric, number>
}

/** Credits require the actual equipped starting power's mechanics, not its class name. */
export function heroSupport(heroId: HeroId, key: string): number {
  const hero = HERO_CATALOG.require(heroId)
  const power = HERO_POWER_CATALOG.require(hero.heroPowerId)
  // Powers are repeatable but consume tempo; they supplement, never replace a card package.
  const effect = power.effect
  if (key === 'weapons' && effect.kind === 'equip-weapon') return 2
  if (
    ['healing', 'minion-healing'].includes(key) &&
    effect.kind === 'restore-character'
  )
    return 2
  const ids =
    effect.kind === 'summon'
      ? [effect.cardId]
      : effect.kind === 'summon-random-totem'
        ? effect.cardIds
        : []
  if (
    ids.length &&
    ids.every(
      (id) =>
        key === `board:card:${id}` ||
        key === `board:tribe:${CARD_CATALOG.require(id).subtype}`
    )
  )
    return 2
  return 0
}

export function supportCount(
  cards: readonly OpponentCardAssessment[],
  support: OpponentSupport,
  heroId: HeroId,
  beneficiary?: OpponentCardAssessment
): { total: number; early: number } {
  let removed = false
  const providers = cards.filter((card) => {
    if (!removed && card === beneficiary) {
      removed = true
      return false
    }
    return card.provides.includes(support.key)
  })
  return {
    total: providers.length + heroSupport(heroId, support.key),
    early: providers.filter((card) => card.early && card.card.cost <= 3).length
  }
}

export function supportFailures(
  cards: readonly OpponentCardAssessment[],
  heroId: HeroId
): string[] {
  return cards.flatMap((card) =>
    card.needs.flatMap((support) => {
      const count = supportCount(cards, support, heroId, card)
      return count.total < support.minimum || count.early < support.earlyMinimum
        ? [
            `${card.card.id}: ${support.key} requires ${support.minimum} providers (${support.earlyMinimum} early), has ${count.total} (${count.early} early)`
          ]
        : []
    })
  )
}

export interface OpponentStrategyBrief {
  readonly strategy: string
  readonly theme: string
  readonly text: string
}

export function createOpponentBrief(
  profile: OpponentStrategyProfile,
  theme: string,
  cards: readonly OpponentCardAssessment[]
): OpponentStrategyBrief {
  const names = (entries: readonly OpponentCardAssessment[], limit = 3): string =>
    [...new Set(entries.map((entry) => entry.card.name))].slice(0, limit).join(', ')
  const payoffs = cards.filter((card) => card.needs.some((need) => need.key === theme))
  const providers = cards.filter((card) => card.provides.includes(theme))
  const instructions: Readonly<Record<string, string>> = {
    spells:
      'Develop a spell payoff before useful spells; do not waste spells just to trigger it.',
    weapons: 'Equip a weapon before its dependent payoff.',
    'friendly-damage':
      'Use damage triggers only when the minion survives and the exchange is beneficial.',
    'damage-body':
      'Damage-based draw needs surviving damaged characters; check them before spending it.',
    jade: 'Repeated Jade summons grow future threats; keep developing the board.',
    healing:
      'Heal missing health with a payoff in play; full-health healing gives no benefit.',
    'minion-healing':
      'Heal damaged minions with the payoff in play; healing heroes does not enable it.',
    activators:
      'Use compatible attack buffs to trade otherwise inactive deathrattle bodies.',
    overload:
      'Play the payoff before Overload; account for locked mana on the following turn.',
    'cheap-plays': 'Activate Combo with a useful affordable play before its payoff.'
  }
  const sequencing = theme.startsWith('hand:')
    ? 'Keep an enabling card in hand when its payoff matters.'
    : theme.startsWith('deck:')
      ? 'Filtered draw needs matching cards remaining in the deck.'
      : (instructions[theme] ??
        'Develop supporting bodies before buffs and payoffs; avoid overcommitting into a clear.')
  const synergy =
    payoffs.length && providers.length
      ? `Support: ${names(providers)}; payoffs: ${names(payoffs, 2)}. ${sequencing}`
      : ''
  const metrics = opponentMetrics(cards)
  return {
    strategy: profile.id,
    theme,
    text: `Original-deck plan; current state overrides it. ${profile.objective} Mulligan for independently useful early plays and a smooth curve. ${synergy} Finishers: ${names(cards.filter((card) => card.threat))}. Resources: ${names(
      cards.filter((card) => card.resource),
      2
    )}. The original deck has ${metrics.interaction} interaction cards and ${metrics.resource} resource cards: spend them purposefully. Do not hoard a payoff when survival or a winning attack takes priority.`
  }
}
