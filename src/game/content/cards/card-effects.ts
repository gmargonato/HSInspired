/**
 * Declarative, JSON-safe gameplay data authored alongside a card. The match
 * domain owns interpretation; this module deliberately contains no execution
 * logic or renderer concepts.
 */
export const CARD_KEYWORDS = [
  'attack-wrong-enemy-chance-50',
  'cannot-attack',
  'cannot-attack-heroes',
  'charge',
  'lifesteal',
  'rush',
  'divine-shield',
  'immune',
  'mega-windfury',
  'secret',
  'spell-damage',
  'spell-immune',
  'stealth',
  'taunt',
  'windfury'
] as const
export type CardKeyword = (typeof CARD_KEYWORDS)[number]

export const CARD_TRIGGERS = [
  'aura',
  'battlecry',
  'cast',
  'deathrattle',
  'end-of-turn',
  'inspire',
  'on-attack',
  'on-card-played',
  'on-cast',
  'on-damage',
  'on-death',
  'on-discard',
  'on-draw',
  'on-equip',
  'on-gain-armor',
  'on-heal',
  'overheal',
  'on-overload',
  'on-play',
  'on-secret-played',
  'on-secret-revealed',
  'on-summon',
  'secret',
  'start-of-turn',
  'while-in-hand',
  'while-in-deck'
] as const
export type CardTrigger = (typeof CARD_TRIGGERS)[number]

/** Placement policies for minions created by summon actions. */
export const CARD_SUMMON_PLACEMENTS = [
  'right-of-source',
  'far-right',
  'alternating-around-source'
] as const
export type CardSummonPlacement = (typeof CARD_SUMMON_PLACEMENTS)[number]

export const CARD_EVENT_TYPES = [
  'card-played',
  'card-discarded',
  'character-attacked',
  'attack-resolved',
  'damage-dealt',
  'first-minion-played-this-turn',
  'friendly-minion-attacked',
  'health-restored',
  'hero-attacked',
  'hero-damaged',
  'hero-power-used',
  'hero-would-die',
  'minion-attacked',
  'minion-attacks-hero',
  'minion-destroyed',
  'minion-died',
  'minion-played',
  'minion-summoned',
  'overload-applied',
  'weapon-died',
  'weapon-equipped',
  'secret-played',
  'secret-revealed',
  'spell-cast',
  'spell-resolved',
  'spell',
  'spell-targeted-minion',
  'turn-ended',
  'turn-started'
] as const
export type CardEventType = (typeof CARD_EVENT_TYPES)[number]

export const CARD_CONDITIONS = [
  'player-turn',
  'card-died-this-game',
  'combo',
  'combo-active',
  'drawn-card-matches',
  'board-has-minion-count',
  'event-player-had-minion-count',
  'not-combo',
  'player-controls-secret',
  'player-has-damaged-minion',
  'player-has-hand-count',
  'player-has-minion',
  'player-has-minion-count',
  'player-deck-has-no-duplicates',
  'cthun-attack-at-least',
  'defender-died-from-combat',
  'player-has-secret',
  'player-has-spell-damage',
  'player-has-weapon',
  'player-health-gt',
  'player-health-lte',
  'player-lacks-minion',
  'player-lacks-weapon',
  'source-damaged',
  'target-damaged',
  'target-died',
  'target-frozen',
  'target-is-friendly-demon',
  'target-is-not-friendly-demon',
  'target-not-frozen',
  'target-matches',
  'target-survived',
  'player-has-card-in-hand'
] as const
export type CardConditionType = (typeof CARD_CONDITIONS)[number]

export const CARD_DURATIONS = [
  'next-turn',
  'permanent',
  'this-attack',
  'this-turn',
  'this-game',
  'until-next-turn',
  'while-condition',
  'while-damaged',
  'while-in-hand',
  'while-source-in-play',
  'while-source-equipped'
] as const
export type CardDuration = (typeof CARD_DURATIONS)[number]

export const CARD_SELECTOR_CONTROLLERS = ['self', 'opponent', 'any'] as const
export type CardSelectorController = (typeof CARD_SELECTOR_CONTROLLERS)[number]

export const CARD_SELECTOR_TYPES = [
  'added-card',
  'card',
  'character',
  'drawn-card',
  'event-card',
  'hero',
  'hero-power',
  'minion',
  'minion-card',
  'secret',
  'spell',
  'spell-card',
  'weapon'
] as const
export type CardSelectorType = (typeof CARD_SELECTOR_TYPES)[number]

export const CARD_SELECTOR_SELECTIONS = [
  'adjacent',
  'all',
  'chosen',
  'chosen-and-adjacent',
  'event-source',
  'event-target',
  'hero',
  'next',
  'other-player-hand',
  'random',
  'source',
  'stored'
] as const
export type CardSelectorSelection = (typeof CARD_SELECTOR_SELECTIONS)[number]

export const CARD_SELECTOR_EXCLUDES = ['event-target', 'source'] as const
export type CardSelectorExclude = (typeof CARD_SELECTOR_EXCLUDES)[number]

export const CARD_SELECTOR_ZONES = ['deck', 'hand', 'revealed'] as const
export type CardSelectorZone = (typeof CARD_SELECTOR_ZONES)[number]

export const CARD_SELECTOR_FIELDS = [
  'adjacentTo',
  'controller',
  'count',
  'distinct',
  'distinctDeathEvents',
  'exclude',
  'excludeCardId',
  'filter',
  'preserve',
  'position',
  'reference',
  'selection',
  'order',
  'type',
  'zone'
] as const

export const CARD_FILTER_FIELDS = [
  'cardId',
  'cardClassIn',
  'cardClass',
  'cardType',
  'cost',
  'damaged',
  'frozen',
  'collectible',
  'hasBattlecry',
  'hasDeathrattle',
  'keyword',
  'negate',
  'operator',
  'overload',
  'rarity',
  'sparePart',
  'stat',
  'mortallyWounded',
  'printedOnly',
  'tribe',
  'type',
  'value'
] as const

export const CARD_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte'] as const
export type CardOperator = (typeof CARD_OPERATORS)[number]

/** Closed references used by numeric effect values. */
export const CARD_VALUE_REFERENCES = [
  'available-board-slots',
  'beasts-summoned-this-game',
  'friendly-spells-cast-this-game',
  'friendly-totems-summoned-this-game',
  'friendly-secrets-played-this-game',
  'cards-played-earlier-this-turn',
  'damage-dealt',
  'last-damage-amount',
  'destroyed-weapon.attack',
  'destroyed-weapon.durability',
  'drawn-card.cost',
  'event-target.attack',
  'event-target.durability',
  'event.damage',
  'event.amount',
  'event-card-cost',
  'hand-size-difference',
  'health',
  'hero-powers-used-this-game',
  'hero-damage',
  'minions-died-this-turn',
  'matching-entity-count',
  'other-cards-in-hand',
  'other-minions-on-board',
  'removed-keyword-count',
  'self.hero.armor',
  'self.hero.attack',
  'source.attack',
  'source.health',
  'source.weapon.attack',
  'target.attack',
  'target.health',
  'destroyed-target.attack',
  'destroyed-target.health',
  'manaSpent',
  'secretsDestroyed.count',
  'summonedJade',
  'returnedCard',
  'discoveredCard.cost',
  'target.baseCost'
] as const
export type CardValueReference = (typeof CARD_VALUE_REFERENCES)[number]

export const CARD_VALUE_OPERATIONS = ['multiply', 'set', 'subtract'] as const
export type CardValueOperation = (typeof CARD_VALUE_OPERATIONS)[number]

export const CARD_ACTION_PLAYERS = ['each', 'opponent', 'self', 'turn-player'] as const
export const CARD_ACTION_SOURCES = [
  'deck',
  'deck-top',
  'destroyed-minions',
  'friendly-minions-died-this-turn',
  'friendly-minions-died-this-game',
  'minions-died-this-game',
  'hand',
  'discarded-event-card',
  'opponent-deck',
  'random-card'
] as const
export const CARD_ACTION_DESTINATIONS = ['cast-on-source', 'deck', 'hand'] as const
export const CARD_ACTION_RESOURCES = ['weapon-durability'] as const
export const CARD_ACTION_FIELDS = ['health'] as const
export const CARD_CRYSTAL_MODES = ['empty', 'full'] as const

export const CARD_ACTIONS = [
  'add-to-hand',
  'change-cost',
  'copy',
  'counter-event',
  'damage',
  'damage-group',
  'destroy',
  'destroy-all-but-highest-attack',
  'destroy-and-gain-stats',
  'destroy-mana-crystal',
  'destroy-secrets',
  'discover',
  'discard',
  'draw',
  'draw-until',
  'equip',
  'equip-random',
  'freeze',
  'gain-armor',
  'gain-mana',
  'joust',
  'grant-deathrattle',
  'grant-keyword',
  'lock-and-load',
  'grant-keywords',
  'grant-random-keyword',
  'grant-targeting',
  'grant-trigger',
  'modify',
  'modify-hero-power-uses',
  'modify-hero-power-damage',
  'modify-weapon-on-hero-power',
  'redirect-hero-damage',
  'set-hero-power-drawn-card-cost',
  'multiply-trigger',
  'overload',
  'prevent-lethal',
  'put-into-play',
  'redirect-damage',
  'replace-hero',
  'remove-keyword',
  'replace-event',
  'restore',
  'return-to-play',
  'resurrect',
  'return-to-hand',
  'reveal',
  'sacrifice-and-damage',
  'schedule',
  'set-health',
  'set-hero-power',
  'set-turn-limit',
  'shuffle-into-deck',
  'silence',
  'summon',
  'summon-copy',
  'summon-for-each',
  'summon-random',
  'swap',
  'swap-stats',
  'take-control',
  'transform',
  'transform-random',
  'trigger-deathrattle',
  'unlock-overload',
  'combine-choose-one',
  'spend-all-mana',
  'buff-cthun',
  'copy-stats',
  'summon-jade-golem',
  'shuffle-dead-cthun',
  'cast-random-spells',
  'modify-hero-attacks',
  'refresh-mana',
  'refresh-hero-power',
  'set-hero-power-cost',
  'create-kazakus-potion'
] as const
export type CardActionName = (typeof CARD_ACTIONS)[number]

export type CardEffectValue =
  | string
  | number
  | boolean
  | null
  | readonly CardEffectValue[]
  | { readonly [key: string]: CardEffectValue }

export function isCardEffectObject(
  value: CardEffectValue | undefined
): value is Readonly<Record<string, CardEffectValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Numeric shapes accepted by the content validator; only amount/health allow full. */
export type CardNumericValue<Full extends 'full' | never = never> =
  | number
  | Full
  | {
      readonly condition: Readonly<Record<string, CardEffectValue>>
      readonly thenValue: CardNumericValue<Full>
      readonly elseValue: CardNumericValue<Full>
    }
  | { readonly random: readonly number[] }
  | ({
      readonly operation?: CardValueOperation
      readonly opponent?: boolean
      readonly keyword?: CardKeyword
      readonly multiplier?: number
      readonly selector?: Readonly<Record<string, CardEffectValue>>
      readonly value?: number
    } & (
      | { readonly reference: CardValueReference }
      | { readonly operation: CardValueOperation; readonly value: number }
    ))

export type ManaActionName =
  'gain-mana' | 'destroy-mana-crystal' | 'overload' | 'unlock-overload'

type ManaActionFields = {
  readonly player?: (typeof CARD_ACTION_PLAYERS)[number]
  readonly amount?: CardNumericValue<'full'>
  readonly crystal?: (typeof CARD_CRYSTAL_MODES)[number]
  readonly duration?: CardDuration
}

/** Other validator-supported action fields remain available during incremental typing. */
export type ManaCardAction = Readonly<Record<string, CardEffectValue>> &
  ManaActionFields &
  (
    | {
        readonly action: 'gain-mana' | 'destroy-mana-crystal'
        readonly player: (typeof CARD_ACTION_PLAYERS)[number]
        readonly amount: CardNumericValue<'full'>
      }
    | { readonly action: 'overload'; readonly amount: CardNumericValue<'full'> }
    | { readonly action: 'unlock-overload' }
  )

/** Multi-target damage is simultaneous unless explicitly resolved per target. */
export type DamageCardAction = Readonly<Record<string, CardEffectValue>> & {
  readonly action: 'damage'
  readonly damageResolution?: 'simultaneous' | 'per-target'
  readonly damageOrder?: 'play-order' | 'reverse-play-order'
}

/** Different damage amounts/selectors belonging to a single damage step. */
export type DamageGroupCardAction = Readonly<Record<string, CardEffectValue>> & {
  readonly action: 'damage-group'
  readonly actions: readonly DamageCardAction[]
}

export type CardAction =
  | ManaCardAction
  | DamageCardAction
  | DamageGroupCardAction
  | (Readonly<Record<string, CardEffectValue>> & {
      readonly action: Exclude<
        CardActionName,
        ManaActionName | 'damage' | 'damage-group'
      >
    })

export interface CardEffectBlock {
  readonly trigger: CardTrigger
  readonly actions?: readonly CardAction[]
  readonly condition?: { readonly [key: string]: CardEffectValue }
  readonly event?: { readonly [key: string]: CardEffectValue }
  readonly choice?: { readonly [key: string]: CardEffectValue }
  readonly repeat?: { readonly [key: string]: CardEffectValue }
  readonly then?: { readonly [key: string]: CardEffectValue }
  readonly [key: string]: CardEffectValue | undefined
}
