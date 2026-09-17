import type { CardEffectBlock, CardEffectValue, CardKeyword } from './card-effects'

/** Stable identifiers shared by authored content and platform-neutral systems. */
export type CardId = string & { readonly __cardId: unique symbol }
export type ClassId = string & { readonly __classId: unique symbol }
export type ExpansionId = string & { readonly __expansionId: unique symbol }
export type HeroId = string & { readonly __heroId: unique symbol }
export type HeroPowerId = string & { readonly __heroPowerId: unique symbol }

export function asCardId(value: string): CardId {
  return value as CardId
}

export function asClassId(value: string): ClassId {
  return value as ClassId
}

export function asExpansionId(value: string): ExpansionId {
  return value as ExpansionId
}

export function asHeroId(value: string): HeroId {
  return value as HeroId
}

export function asHeroPowerId(value: string): HeroPowerId {
  return value as HeroPowerId
}

export const CARD_TYPES = ['Minion', 'Spell', 'Weapon', 'Hero'] as const
export type CardType = (typeof CARD_TYPES)[number]

export const CARD_CLASSES = [
  'Druid',
  'Hunter',
  'Mage',
  'Neutral',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior'
] as const
export type KnownClassId = (typeof CARD_CLASSES)[number]
export type CardClass = KnownClassId

export const PLAYABLE_CLASSES = CARD_CLASSES.filter(
  (cardClass) => cardClass !== 'Neutral'
) as readonly Exclude<KnownClassId, 'Neutral'>[]
export type DeckClass = (typeof PLAYABLE_CLASSES)[number]

export const CARD_RARITIES = [
  'Common',
  'Rare',
  'Epic',
  'Legendary',
  'Free',
  'None',
  'Summon',
  'Dream'
] as const
export type CardRarity = (typeof CARD_RARITIES)[number]

export const EXPANSION_IDS = [
  'basic',
  'classic',
  'goblins-vs-gnomes',
  'naxxramas',
  'blackrock-mountain',
  'league-of-explorers',
  'the-grand-tournament',
  'one-night-in-karazhan',
  'whispers-of-the-old-gods',
  'mean-streets-of-gadgetzan',
  'journey-to-ungoro',
  'knights-of-the-frozen-throne'
] as const
export type KnownExpansionId = (typeof EXPANSION_IDS)[number]

export interface CardMetadata {
  readonly id: CardId
  readonly expansionId: ExpansionId
  /** Alias retained for display and collection code; it is never persisted. */
  readonly set: ExpansionId
  readonly name: string
  readonly rarity: CardRarity
  readonly cardClass: ClassId
  readonly subtype: string | null
  readonly spellSchool: string | null
  readonly cost: number
  readonly spellDamage?: number
  readonly rulesText: string
  readonly keywords: readonly CardKeyword[]
  readonly effects: readonly CardEffectBlock[]
  /** Optional condition that must be true before the card can be played. */
  readonly playCondition?: Readonly<Record<string, CardEffectValue>>
  readonly collectible: boolean
  readonly deckLegal: boolean
}

export interface MinionCardDefinition extends CardMetadata {
  readonly type: 'Minion'
  readonly attack: number
  readonly health: number
}

export interface SpellCardDefinition extends CardMetadata {
  readonly type: 'Spell'
  /** Opening-match objective; Quests are removed from the drawable deck. */
  readonly quest?: {
    readonly goal:
      | 'summon-attack-5'
      | 'play-cost-1-minion'
      | 'cast-generated-spell'
      | 'target-friendly-minion'
      | 'summon-deathrattle'
      | 'play-deathrattle-minion'
      | 'play-same-name'
      | 'discard-card'
      | 'play-taunt-minion'
      | 'end-turn-unspent-mana'
      | 'summon-minion'
      | 'summon-murloc'
      | 'cast-spell'
      | 'restore-health'
      | 'add-other-class-card'
      | 'play-battlecry-minion'
      | 'draw-card'
      | 'hero-attack'
    readonly target: number
    readonly rewardCardId: CardId
  }
}

export interface WeaponCardDefinition extends CardMetadata {
  readonly type: 'Weapon'
  readonly attack: number
  readonly durability: number
}

export interface HeroCardDefinition extends CardMetadata {
  readonly type: 'Hero'
  readonly armor: number
  /** The in-match hero identity that replaces the player's current hero. */
  readonly replacementHeroId: HeroId
}

export type CardDefinition =
  MinionCardDefinition | SpellCardDefinition | WeaponCardDefinition | HeroCardDefinition

export function isCollectibleCard(card: Pick<CardDefinition, 'collectible'>): boolean {
  return card.collectible
}

export function formatExpansionName(expansionId: ExpansionId | string): string {
  const labels: Readonly<Record<string, string>> = {
    basic: 'Basic',
    classic: 'Classic',
    'goblins-vs-gnomes': 'Goblins vs Gnomes',
    goblins_vs_gnomes: 'Goblins vs Gnomes',
    naxxramas: 'Curse of Naxxramas',
    'blackrock-mountain': 'Blackrock Mountain',
    'league-of-explorers': 'League of Explorers',
    'the-grand-tournament': 'The Grand Tournament',
    'one-night-in-karazhan': 'One Night in Karazhan',
    'whispers-of-the-old-gods': 'Whispers of the Old Gods',
    'mean-streets-of-gadgetzan': 'Mean Streets of Gadgetzan',
    'journey-to-ungoro': "Journey to Un'Goro",
    'knights-of-the-frozen-throne': 'Knights of the Frozen Throne'
  }
  const knownLabel = labels[expansionId]
  if (knownLabel) return knownLabel

  return expansionId
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
