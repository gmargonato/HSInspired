import {
  CARD_CATALOG,
  asCardId,
  type CardId,
  type HeroId,
  type HeroPowerId
} from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import type { HeroDefinition } from '../content/heroes'
import { HERO_POWER_CATALOG } from '../content/hero-powers'
import { countDeckCards, type Deck } from '../decks'
import { createSeededRng, type DeterministicRng } from './rng'
import type {
  ControllerKind,
  MatchParticipantSetup,
  MatchSetup,
  PlayerId
} from './match-types'

export type OpeningPhase = 'mulligan' | 'turns' | 'ended'

/** Maximum number of cards a player may hold in hand. */
export const MAX_HAND_SIZE = 10

/** Maximum number of mana crystals a player may accumulate. */
export const MAX_MANA = 10

/** Maximum number of minions a player may have on their board. */
export const MAX_BOARD_SIZE = 7

export interface OpeningCard {
  readonly instanceId: string
  readonly cardId: CardId
}

/** A minion in play. Stats are current values (base today; buffs later). */
export interface BoardMinion {
  readonly instanceId: string
  readonly cardId: CardId
  readonly attack: number
  readonly health: number
  readonly maxHealth: number
  /** Turn on which the minion entered play; it cannot attack the same turn (summoning sickness). */
  readonly summonedOnTurn: number
  /** Global turn number on which this minion last attacked, or null if it has not attacked. */
  readonly lastAttackedOnTurn: number | null
}

/** A weapon equipped to a hero. Durability is current and maxDurability is its original value. */
export interface BoardWeapon {
  readonly instanceId: string
  readonly cardId: CardId
  readonly attack: number
  readonly durability: number
  readonly maxDurability: number
}

/**
 * A hero's own combat state. `attack` deliberately excludes weapon Attack;
 * `getHeroAttack` combines the two at the point where combat is resolved.
 * This keeps temporary/inherent hero Attack distinct from an equipped weapon.
 */
export interface PlayerHeroState {
  readonly health: number
  readonly maxHealth: number
  readonly armor: number
  readonly attack: number
  readonly lastAttackedOnTurn: number | null
}

/** A player's mana crystals: available spendable mana and the grown maximum. */
export interface PlayerMana {
  readonly available: number
  readonly maximum: number
}

/**
 * A player's hero power. `cost` starts at the class definition's cost; future
 * card effects may raise or lower it (the renderer tints the cost red/green
 * accordingly). `available` is reset at the start of the owner's turn.
 */
export interface PlayerHeroPower {
  readonly id: HeroPowerId
  readonly cost: number
  readonly available: boolean
}

export interface OpeningPlayerState {
  readonly participantId: PlayerId
  readonly controllerKind: ControllerKind
  readonly heroId: HeroId
  readonly hero: PlayerHeroState
  readonly playerNumber: 1 | 2
  readonly deck: readonly OpeningCard[]
  readonly hand: readonly OpeningCard[]
  readonly board: readonly BoardMinion[]
  readonly weapon: BoardWeapon | null
  readonly mana: PlayerMana
  readonly heroPower: PlayerHeroPower
  /** Damage dealt by the next failed draw; starts at 1 and rises after each fatigue hit. */
  readonly fatigueDamage: number
  readonly mulliganConfirmed: boolean
}

export interface OpeningMatchState {
  readonly phase: OpeningPhase
  readonly playerOneId: PlayerId
  readonly playerTwoId: PlayerId
  readonly activePlayerId: PlayerId | null
  readonly turnNumber: number
  readonly winnerId: PlayerId | null
  readonly loserId: PlayerId | null
  readonly players: readonly [OpeningPlayerState, OpeningPlayerState]
  readonly revision: number
}

export interface ConfirmMulliganCommand {
  readonly type: 'confirm-mulligan'
  readonly participantId: PlayerId
  readonly replaceInstanceIds: readonly string[]
}

export interface EndTurnCommand {
  readonly type: 'end-turn'
  readonly participantId: PlayerId
}

export interface UseHeroPowerCommand {
  readonly type: 'use-hero-power'
  readonly participantId: PlayerId
  readonly target?: HeroPowerTargetRef
}

export type HeroPowerTargetRef =
  | { readonly kind: 'hero'; readonly participantId: PlayerId }
  | {
      readonly kind: 'minion'
      readonly participantId: PlayerId
      readonly instanceId: string
    }

export interface PlayMinionCommand {
  readonly type: 'play-minion'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
  /** Insertion index into the player's board row: 0..board.length inclusive. */
  readonly position: number
}

export interface PlayWeaponCommand {
  readonly type: 'play-weapon'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
}

export interface PlayHeroCommand {
  readonly type: 'play-hero'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
}

export interface AttackMinionCommand {
  readonly type: 'attack-minion'
  readonly participantId: PlayerId
  readonly attackerInstanceId: string
  readonly defenderInstanceId: string
}

export type AttackCharacterRef =
  { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }

/** General direct-attack command. References are relative to the command owner. */
export interface AttackCharacterCommand {
  readonly type: 'attack-character'
  readonly participantId: PlayerId
  readonly attacker: AttackCharacterRef
  readonly defender: AttackCharacterRef
}

export interface DevAddCardCommand {
  readonly type: 'dev-add-card'
  readonly participantId: PlayerId
  readonly cardId: CardId
}

export interface DevSetManaCommand {
  readonly type: 'dev-set-mana'
  readonly participantId: PlayerId
  readonly available: number
  readonly maximum: number
}

export type DevDeckAction = 'destroy' | 'refill'

export interface DevModifyDeckCommand {
  readonly type: 'dev-modify-deck'
  readonly participantId: PlayerId
  readonly action: DevDeckAction
}

export interface DevSummonMinionCommand {
  readonly type: 'dev-summon-minion'
  readonly participantId: PlayerId
  readonly cardId: CardId
}

export interface DevEndMatchCommand {
  readonly type: 'dev-end-match'
  readonly participantId: PlayerId
  readonly winnerId: PlayerId
}

export interface DevSetHeroCommand {
  readonly type: 'dev-set-hero'
  readonly participantId: PlayerId
  readonly health?: number
  readonly armor?: number
  readonly attack?: number
}
export interface DevSetHeroPowerCommand {
  readonly type: 'dev-set-hero-power'
  readonly participantId: PlayerId
  readonly cost?: number
  readonly available?: boolean
}
export interface DevClearZoneCommand {
  readonly type: 'dev-clear-zone'
  readonly participantId: PlayerId
  readonly zone: 'hand' | 'board'
}
export interface DevSetFatigueCommand {
  readonly type: 'dev-set-fatigue'
  readonly participantId: PlayerId
  readonly nextDamage: number
}
export interface DevRemoveWeaponCommand {
  readonly type: 'dev-remove-weapon'
  readonly participantId: PlayerId
}
export interface DevDrawCommand {
  readonly type: 'dev-draw'
  readonly participantId: PlayerId
}

export type OpeningMatchCommand =
  | ConfirmMulliganCommand
  | EndTurnCommand
  | UseHeroPowerCommand
  | PlayMinionCommand
  | PlayWeaponCommand
  | PlayHeroCommand
  | AttackMinionCommand
  | AttackCharacterCommand
  | DevAddCardCommand
  | DevSetManaCommand
  | DevModifyDeckCommand
  | DevSummonMinionCommand
  | DevEndMatchCommand
  | DevSetHeroCommand
  | DevSetHeroPowerCommand
  | DevClearZoneCommand
  | DevSetFatigueCommand
  | DevRemoveWeaponCommand
  | DevDrawCommand

export interface MulliganResolvedEvent {
  readonly type: 'mulligan-resolved'
  readonly participantId: PlayerId
  readonly returnedCards: readonly OpeningCard[]
  readonly replacementCards: readonly OpeningCard[]
}

export interface CoinGrantedEvent {
  readonly type: 'coin-granted'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface OpeningTurnStartedEvent {
  readonly type: 'opening-turn-started'
  readonly participantId: PlayerId
  readonly playerNumber: 1 | 2
  readonly mana: PlayerMana
}

export interface OpeningCardDrawnEvent {
  readonly type: 'opening-card-drawn'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface TurnStartedEvent {
  readonly type: 'turn-started'
  readonly participantId: PlayerId
  readonly turnNumber: number
  readonly mana: PlayerMana
}

export interface CardDrawnEvent {
  readonly type: 'card-drawn'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface CardBurnedEvent {
  readonly type: 'card-burned'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface HeroPowerUsedEvent {
  readonly type: 'hero-power-used'
  readonly participantId: PlayerId
  readonly heroPowerId: HeroPowerId
  readonly target?: HeroPowerTargetRef
  readonly cost: number
  readonly mana: PlayerMana
}

export interface CharacterDamagedEvent {
  readonly type: 'character-damaged'
  readonly source: 'hero-power' | 'fatigue'
  readonly participantId: PlayerId
  readonly character:
    { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }
  readonly amount: number
  readonly healthBefore: number
  readonly healthAfter: number
  readonly armorBefore: number
  readonly armorAfter: number
  readonly destroyed: boolean
}

export interface CharacterHealedEvent {
  readonly type: 'character-healed'
  readonly participantId: PlayerId
  readonly character:
    { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }
  readonly amount: number
  readonly healthBefore: number
  readonly healthAfter: number
}

export interface ArmorGainedEvent {
  readonly type: 'armor-gained'
  readonly participantId: PlayerId
  readonly amount: number
  readonly armorBefore: number
  readonly armorAfter: number
}

export interface HeroPowerMinionSummonedEvent {
  readonly type: 'hero-power-minion-summoned'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export interface FatigueEvent {
  readonly type: 'fatigue'
  readonly participantId: PlayerId
  readonly amount: number
  readonly nextDamage: number
}

export interface MinionPlayedEvent {
  readonly type: 'minion-played'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export interface WeaponEquippedEvent {
  readonly type: 'weapon-equipped'
  readonly participantId: PlayerId
  readonly weapon: BoardWeapon
  readonly replacedWeapon: BoardWeapon | null
}

export interface HeroReplacedEvent {
  readonly type: 'hero-replaced'
  readonly participantId: PlayerId
  readonly previousHeroId: HeroId
  readonly heroId: HeroId
  readonly armorGained: number
}

export interface MinionCombatantResult {
  readonly participantId: PlayerId
  readonly instanceId: string
  readonly attack: number
  readonly damageDealt: number
  readonly healthBefore: number
  readonly healthAfter: number
  readonly destroyed: boolean
}

export interface MinionCombatPreview {
  readonly attackerHealthAfter: number
  readonly defenderHealthAfter: number
  readonly attackerDestroyed: boolean
  readonly defenderDestroyed: boolean
}

export interface MinionCombatResolvedEvent {
  readonly type: 'minion-combat-resolved'
  readonly attacker: MinionCombatantResult
  readonly defender: MinionCombatantResult
}

export interface CharacterCombatantResult {
  readonly participantId: PlayerId
  readonly character: AttackCharacterRef
  readonly attack: number
  readonly damageDealt: number
  readonly healthBefore: number
  readonly healthAfter: number
  readonly armorBefore: number
  readonly armorAfter: number
  readonly destroyed: boolean
}

export interface CharacterCombatResolvedEvent {
  readonly type: 'character-combat-resolved'
  readonly attacker: CharacterCombatantResult
  readonly defender: CharacterCombatantResult
  readonly weapon: {
    readonly participantId: PlayerId
    readonly durabilityBefore: number
    readonly durabilityAfter: number
    readonly destroyed: boolean
  } | null
}

export interface MatchEndedEvent {
  readonly type: 'match-ended'
  readonly winnerId: PlayerId
  readonly loserId: PlayerId
  readonly reason: 'hero-health-depleted' | 'dev-forced'
}

export interface DevCardAddedEvent {
  readonly type: 'dev-card-added'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface DevManaSetEvent {
  readonly type: 'dev-mana-set'
  readonly participantId: PlayerId
  readonly mana: PlayerMana
}

export interface DevDeckModifiedEvent {
  readonly type: 'dev-deck-modified'
  readonly participantId: PlayerId
  readonly action: DevDeckAction
  readonly deckCount: number
}

export interface DevMinionSummonedEvent {
  readonly type: 'dev-minion-summoned'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export interface DevStateChangedEvent {
  readonly type: 'dev-state-changed'
  readonly participantId: PlayerId
}

export type OpeningMatchEvent =
  | MulliganResolvedEvent
  | CoinGrantedEvent
  | OpeningTurnStartedEvent
  | OpeningCardDrawnEvent
  | TurnStartedEvent
  | CardDrawnEvent
  | CardBurnedEvent
  | HeroPowerUsedEvent
  | CharacterDamagedEvent
  | CharacterHealedEvent
  | ArmorGainedEvent
  | HeroPowerMinionSummonedEvent
  | FatigueEvent
  | MinionPlayedEvent
  | WeaponEquippedEvent
  | HeroReplacedEvent
  | MinionCombatResolvedEvent
  | CharacterCombatResolvedEvent
  | MatchEndedEvent
  | DevCardAddedEvent
  | DevManaSetEvent
  | DevDeckModifiedEvent
  | DevMinionSummonedEvent
  | DevStateChangedEvent

export interface OpeningAcceptedResult {
  readonly accepted: true
  readonly state: OpeningMatchState
  readonly events: readonly OpeningMatchEvent[]
}

export type OpeningRejectionCode =
  | 'invalid-command'
  | 'unknown-participant'
  | 'wrong-phase'
  | 'already-confirmed'
  | 'invalid-card-selection'
  | 'not-active-player'
  | 'hero-power-unavailable'
  | 'insufficient-mana'
  | 'not-a-minion'
  | 'not-a-weapon'
  | 'not-a-hero'
  | 'board-full'
  | 'invalid-position'
  | 'invalid-attacker'
  | 'invalid-target'
  | 'minion-cannot-attack'
  | 'hero-cannot-attack'
  | 'match-ended'
  | 'hand-full'
  | 'unknown-card'
  | 'invalid-mana'

export interface OpeningRejectedResult {
  readonly accepted: false
  readonly code: OpeningRejectionCode
  readonly message: string
  readonly state: OpeningMatchState
  readonly events: readonly []
}

export type OpeningCommandResult = OpeningAcceptedResult | OpeningRejectedResult

export interface OpeningMatchInstance {
  readonly setup: MatchSetup
  getState(): OpeningMatchState
  dispatch(command: unknown): OpeningCommandResult
}

const COIN_CARD_ID = asCardId('basic_the_coin')

function cloneCard(card: OpeningCard): OpeningCard {
  return { ...card }
}

function cloneBoardMinion(minion: BoardMinion): BoardMinion {
  return { ...minion }
}

function cloneBoardWeapon(weapon: BoardWeapon): BoardWeapon {
  return { ...weapon }
}

function cloneHero(hero: PlayerHeroState): PlayerHeroState {
  return { ...hero }
}

export function hasSummoningSickness(
  minion: BoardMinion,
  currentTurn: number
): boolean {
  return minion.summonedOnTurn >= currentTurn
}

export function canBoardMinionAttack(
  minion: BoardMinion,
  state: OpeningMatchState,
  ownerId: PlayerId
): boolean {
  if (state.phase !== 'turns') return false
  if (state.activePlayerId !== ownerId) return false
  if (minion.attack <= 0 || minion.health <= 0) return false
  if (hasSummoningSickness(minion, state.turnNumber)) return false
  return minion.lastAttackedOnTurn !== state.turnNumber
}

/** Effective Attack shown on a hero during that hero's own turn. */
export function getHeroAttack(
  player: Pick<OpeningPlayerState, 'hero' | 'weapon'>
): number {
  return Math.max(0, player.hero.attack) + (player.weapon?.attack ?? 0)
}

export function canHeroAttack(
  player: Pick<OpeningPlayerState, 'hero' | 'weapon'>,
  state: OpeningMatchState,
  ownerId: PlayerId
): boolean {
  if (state.phase !== 'turns') return false
  if (state.activePlayerId !== ownerId) return false
  if (player.hero.health <= 0 || getHeroAttack(player) <= 0) return false
  return player.hero.lastAttackedOnTurn !== state.turnNumber
}

/** Resolves the stat-only result used both by targeting previews and combat. */
export function previewMinionCombat(
  attacker: Pick<BoardMinion, 'attack' | 'health'>,
  defender: Pick<BoardMinion, 'attack' | 'health'>
): MinionCombatPreview {
  const attackerHealthAfter = Math.max(0, attacker.health - defender.attack)
  const defenderHealthAfter = Math.max(0, defender.health - attacker.attack)
  return {
    attackerHealthAfter,
    defenderHealthAfter,
    attackerDestroyed: attackerHealthAfter === 0,
    defenderDestroyed: defenderHealthAfter === 0
  }
}

function clonePlayer(player: OpeningPlayerState): OpeningPlayerState {
  return {
    ...player,
    hero: cloneHero(player.hero),
    deck: player.deck.map(cloneCard),
    hand: player.hand.map(cloneCard),
    board: player.board.map(cloneBoardMinion),
    weapon: player.weapon ? cloneBoardWeapon(player.weapon) : null,
    mana: { ...player.mana },
    heroPower: { ...player.heroPower }
  }
}

export function cloneOpeningMatchState(state: OpeningMatchState): OpeningMatchState {
  return {
    ...state,
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHeroPowerTarget(value: unknown): HeroPowerTargetRef | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null
  if (value.kind === 'hero') {
    return { kind: 'hero', participantId: value.participantId as PlayerId }
  }
  if (value.kind === 'minion' && typeof value.instanceId === 'string') {
    return {
      kind: 'minion',
      participantId: value.participantId as PlayerId,
      instanceId: value.instanceId
    }
  }
  return null
}

function parseCommand(value: unknown): OpeningMatchCommand | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null

  if (value.type === 'confirm-mulligan') {
    if (!Array.isArray(value.replaceInstanceIds)) return null
    if (!value.replaceInstanceIds.every((id) => typeof id === 'string')) return null
    return {
      type: 'confirm-mulligan',
      participantId: value.participantId as PlayerId,
      replaceInstanceIds: value.replaceInstanceIds
    }
  }

  if (value.type === 'end-turn') {
    return { type: 'end-turn', participantId: value.participantId as PlayerId }
  }

  if (value.type === 'use-hero-power') {
    const target =
      value.target === undefined ? undefined : parseHeroPowerTarget(value.target)
    if (value.target !== undefined && !target) return null
    return {
      type: 'use-hero-power',
      participantId: value.participantId as PlayerId,
      ...(target ? { target } : {})
    }
  }

  if (value.type === 'play-minion') {
    if (typeof value.cardInstanceId !== 'string') return null
    if (typeof value.position !== 'number' || !Number.isInteger(value.position)) {
      return null
    }
    return {
      type: 'play-minion',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId,
      position: value.position
    }
  }

  if (value.type === 'play-weapon') {
    if (typeof value.cardInstanceId !== 'string') return null
    return {
      type: 'play-weapon',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId
    }
  }

  if (value.type === 'play-hero') {
    if (typeof value.cardInstanceId !== 'string') return null
    return {
      type: 'play-hero',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId
    }
  }

  if (value.type === 'attack-minion') {
    if (
      typeof value.attackerInstanceId !== 'string' ||
      typeof value.defenderInstanceId !== 'string'
    ) {
      return null
    }
    return {
      type: 'attack-minion',
      participantId: value.participantId as PlayerId,
      attackerInstanceId: value.attackerInstanceId,
      defenderInstanceId: value.defenderInstanceId
    }
  }

  if (value.type === 'attack-character') {
    const parseRef = (ref: unknown): AttackCharacterRef | null => {
      if (!isRecord(ref) || typeof ref.kind !== 'string') return null
      if (ref.kind === 'hero') return { kind: 'hero' }
      if (ref.kind === 'minion' && typeof ref.instanceId === 'string') {
        return { kind: 'minion', instanceId: ref.instanceId }
      }
      return null
    }
    const attacker = parseRef(value.attacker)
    const defender = parseRef(value.defender)
    if (!attacker || !defender) return null
    return {
      type: 'attack-character',
      participantId: value.participantId as PlayerId,
      attacker,
      defender
    }
  }

  if (value.type === 'dev-add-card') {
    if (typeof value.cardId !== 'string') return null
    return {
      type: 'dev-add-card',
      participantId: value.participantId as PlayerId,
      cardId: value.cardId as CardId
    }
  }

  if (value.type === 'dev-set-mana') {
    if (typeof value.available !== 'number' || !Number.isInteger(value.available))
      return null
    if (typeof value.maximum !== 'number' || !Number.isInteger(value.maximum))
      return null
    return {
      type: 'dev-set-mana',
      participantId: value.participantId as PlayerId,
      available: value.available,
      maximum: value.maximum
    }
  }

  if (value.type === 'dev-modify-deck') {
    if (value.action !== 'destroy' && value.action !== 'refill') return null
    return {
      type: 'dev-modify-deck',
      participantId: value.participantId as PlayerId,
      action: value.action
    }
  }

  if (value.type === 'dev-summon-minion') {
    if (typeof value.cardId !== 'string') return null
    return {
      type: 'dev-summon-minion',
      participantId: value.participantId as PlayerId,
      cardId: value.cardId as CardId
    }
  }

  if (value.type === 'dev-end-match') {
    if (typeof value.winnerId !== 'string') return null
    return {
      type: 'dev-end-match',
      participantId: value.participantId as PlayerId,
      winnerId: value.winnerId as PlayerId
    }
  }

  if (value.type === 'dev-set-hero') {
    const health = value.health
    const armor = value.armor
    const attack = value.attack
    if (
      ![health, armor, attack].some(
        (entry) => typeof entry === 'number' && Number.isInteger(entry)
      )
    )
      return null
    return {
      type: 'dev-set-hero',
      participantId: value.participantId as PlayerId,
      ...(typeof health === 'number' ? { health } : {}),
      ...(typeof armor === 'number' ? { armor } : {}),
      ...(typeof attack === 'number' ? { attack } : {})
    }
  }
  if (value.type === 'dev-set-hero-power') {
    const cost = value.cost
    const available = value.available
    if (typeof cost !== 'number' && typeof available !== 'boolean') return null
    return {
      type: 'dev-set-hero-power',
      participantId: value.participantId as PlayerId,
      ...(typeof cost === 'number' ? { cost } : {}),
      ...(typeof available === 'boolean' ? { available } : {})
    }
  }
  if (
    value.type === 'dev-clear-zone' &&
    (value.zone === 'hand' || value.zone === 'board')
  )
    return {
      type: 'dev-clear-zone',
      participantId: value.participantId as PlayerId,
      zone: value.zone
    }
  if (
    value.type === 'dev-set-fatigue' &&
    typeof value.nextDamage === 'number' &&
    Number.isInteger(value.nextDamage)
  )
    return {
      type: 'dev-set-fatigue',
      participantId: value.participantId as PlayerId,
      nextDamage: value.nextDamage
    }
  if (value.type === 'dev-remove-weapon')
    return { type: 'dev-remove-weapon', participantId: value.participantId as PlayerId }
  if (value.type === 'dev-draw')
    return { type: 'dev-draw', participantId: value.participantId as PlayerId }

  return null
}

function shuffle<T>(items: readonly T[], random: DeterministicRng): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1))
    const current = result[index]
    const replacement = result[swapIndex]
    if (current === undefined || replacement === undefined) continue
    result[index] = replacement
    result[swapIndex] = current
  }
  return result
}

function expandDeck(deck: Deck, participant: MatchParticipantSetup): OpeningCard[] {
  if (countDeckCards(deck) !== 30) {
    throw new Error(`Deck ${deck.id} must contain exactly 30 cards.`)
  }

  const cards: OpeningCard[] = []
  let ordinal = 0
  for (const [cardId, count] of Object.entries(deck.cards)) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Deck ${deck.id} contains an invalid count for ${cardId}.`)
    }
    const definition = CARD_CATALOG.get(cardId)
    if (!definition)
      throw new Error(`Deck ${deck.id} references unknown card ${cardId}.`)

    for (let copy = 0; copy < count; copy += 1) {
      cards.push({
        instanceId: `${participant.participantId}:deck:${ordinal}`,
        cardId: definition.id
      })
      ordinal += 1
    }
  }
  return cards
}

function findPlayerIndex(
  players: readonly [OpeningPlayerState, OpeningPlayerState],
  participantId: PlayerId
): 0 | 1 | -1 {
  if (players[0].participantId === participantId) return 0
  if (players[1].participantId === participantId) return 1
  return -1
}

function drawCards(
  player: OpeningPlayerState,
  count: number
): { player: OpeningPlayerState; cards: OpeningCard[] } {
  const cards = player.deck.slice(0, count).map(cloneCard)
  return {
    cards,
    player: {
      ...player,
      deck: player.deck.slice(cards.length),
      hand: [...player.hand, ...cards]
    }
  }
}

interface HeroDamageResult {
  readonly hero: PlayerHeroState
  readonly event: CharacterDamagedEvent
}

function damageHero(
  player: OpeningPlayerState,
  amount: number,
  source: CharacterDamagedEvent['source']
): HeroDamageResult {
  const armorDamage = Math.min(player.hero.armor, amount)
  const healthDamage = Math.max(0, amount - armorDamage)
  const hero = {
    ...player.hero,
    armor: player.hero.armor - armorDamage,
    health: Math.max(0, player.hero.health - healthDamage)
  }
  return {
    hero,
    event: {
      type: 'character-damaged',
      source,
      participantId: player.participantId,
      character: { kind: 'hero' },
      amount,
      healthBefore: player.hero.health,
      healthAfter: hero.health,
      armorBefore: player.hero.armor,
      armorAfter: hero.armor,
      destroyed: hero.health === 0
    }
  }
}

function withLethalResult(
  state: OpeningMatchState,
  events: OpeningMatchEvent[]
): OpeningAcceptedResult {
  const loserIndex = state.players.findIndex((player) => player.hero.health <= 0)
  if (loserIndex < 0) {
    return { accepted: true, state: cloneOpeningMatchState(state), events }
  }
  const winnerIndex: 0 | 1 = loserIndex === 0 ? 1 : 0
  const winnerId = state.players[winnerIndex].participantId
  const loserId = state.players[loserIndex as 0 | 1].participantId
  const endedState: OpeningMatchState = {
    ...state,
    phase: 'ended',
    activePlayerId: null,
    winnerId,
    loserId
  }
  events.push({
    type: 'match-ended',
    winnerId,
    loserId,
    reason: 'hero-health-depleted'
  })
  return { accepted: true, state: cloneOpeningMatchState(endedState), events }
}

function createBoardMinion(
  cardId: CardId,
  instanceId: string,
  turnNumber: number
): BoardMinion {
  const definition = CARD_CATALOG.require(cardId)
  if (definition.type !== 'Minion') throw new Error(`${cardId} is not a minion.`)
  return {
    instanceId,
    cardId: definition.id,
    attack: definition.attack,
    health: definition.health,
    maxHealth: definition.health,
    summonedOnTurn: turnNumber,
    lastAttackedOnTurn: null
  }
}

function reject(
  state: OpeningMatchState,
  code: OpeningRejectionCode,
  message: string
): OpeningRejectedResult {
  return {
    accepted: false,
    code,
    message,
    state: cloneOpeningMatchState(state),
    events: []
  }
}

/**
 * Mana growth at the start of a player's turn: the crystal maximum grows by one
 * (capped at MAX_MANA) and available mana refills to the new maximum.
 */
function growMana(mana: PlayerMana): PlayerMana {
  const maximum = Math.min(MAX_MANA, mana.maximum + 1)
  return { available: maximum, maximum }
}

/**
 * Ends the active player's turn: passes play to the other player, increments
 * the turn counter, and draws one card for the new active player. The draw is
 * becomes escalating fatigue damage when the deck is empty; when the hand is
 * already full the drawn card is burned (removed from the deck). The new active
 * player's mana grows and refills at the start of their turn.
 */
function applyEndTurn(
  state: OpeningMatchState,
  playerIndex: 0 | 1
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  if (state.activePlayerId !== state.players[playerIndex].participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can end the turn.'
    )
  }

  const nextPlayerIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const nextPlayer = state.players[nextPlayerIndex]
  const nextMana = growMana(nextPlayer.mana)
  const events: OpeningMatchEvent[] = []

  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]

  // Non-weapon hero Attack is temporary in this phase's combat model. Any
  // future effect that grants it must be cleared when its owner's turn ends.
  nextPlayers[playerIndex] = {
    ...nextPlayers[playerIndex],
    hero: { ...nextPlayers[playerIndex].hero, attack: 0 }
  }

  const card = nextPlayer.deck[0]
  if (card && nextPlayer.hand.length >= MAX_HAND_SIZE) {
    const burned: OpeningCard = cloneCard(card)
    nextPlayers[nextPlayerIndex] = {
      ...nextPlayer,
      deck: nextPlayer.deck.slice(1)
    }
    events.push({
      type: 'card-burned',
      participantId: nextPlayer.participantId,
      card: burned
    })
  } else if (card) {
    const drawn = drawCards(nextPlayer, 1)
    nextPlayers[nextPlayerIndex] = drawn.player
    const drawnCard = drawn.cards[0]
    if (drawnCard) {
      events.push({
        type: 'card-drawn',
        participantId: nextPlayer.participantId,
        card: cloneCard(drawnCard)
      })
    }
  } else {
    const damaged = damageHero(nextPlayer, nextPlayer.fatigueDamage, 'fatigue')
    nextPlayers[nextPlayerIndex] = {
      ...nextPlayer,
      hero: damaged.hero,
      fatigueDamage: nextPlayer.fatigueDamage + 1
    }
    events.push({
      type: 'fatigue',
      participantId: nextPlayer.participantId,
      amount: nextPlayer.fatigueDamage,
      nextDamage: nextPlayer.fatigueDamage + 1
    })
    events.push(damaged.event)
  }
  nextPlayers[nextPlayerIndex] = {
    ...nextPlayers[nextPlayerIndex],
    mana: nextMana,
    heroPower: { ...nextPlayers[nextPlayerIndex].heroPower, available: true }
  }

  const turnNumber = state.turnNumber + 1
  const nextState: OpeningMatchState = {
    ...state,
    activePlayerId: nextPlayer.participantId,
    turnNumber,
    players: nextPlayers,
    revision: state.revision + 1
  }
  events.unshift({
    type: 'turn-started',
    participantId: nextPlayer.participantId,
    turnNumber,
    mana: nextMana
  })

  return withLethalResult(nextState, events)
}

function applyUseHeroPower(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: UseHeroPowerCommand,
  rng: DeterministicRng,
  counter: number
): OpeningCommandResult & { nextCounter?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can use their hero power.'
    )
  }
  if (!player.heroPower.available) {
    return reject(
      state,
      'hero-power-unavailable',
      'The hero power was already used this turn.'
    )
  }
  if (player.mana.available < player.heroPower.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to use the hero power.')
  }
  const definition = HERO_POWER_CATALOG.require(player.heroPower.id)
  if (definition.targeting === 'any-character' && !command.target) {
    return reject(state, 'invalid-target', 'This hero power requires a target.')
  }
  if (definition.targeting === 'none' && command.target) {
    return reject(state, 'invalid-target', 'This hero power does not accept a target.')
  }

  let targetIndex: 0 | 1 | null = null
  if (command.target) {
    const found = findPlayerIndex(state.players, command.target.participantId)
    if (found === -1) {
      return reject(
        state,
        'invalid-target',
        'The selected hero power target is invalid.'
      )
    }
    targetIndex = found
    const targetPlayer = state.players[found]
    if (command.target.kind === 'hero') {
      if (targetPlayer.hero.health <= 0) {
        return reject(state, 'invalid-target', 'The selected hero is not alive.')
      }
    } else {
      const instanceId = command.target.instanceId
      const minion = targetPlayer.board.find(
        (candidate) => candidate.instanceId === instanceId
      )
      if (!minion || minion.health <= 0) {
        return reject(state, 'invalid-target', 'The selected minion is not in play.')
      }
    }
  }

  if (
    (definition.effect.kind === 'summon' ||
      definition.effect.kind === 'summon-random-totem') &&
    player.board.length >= MAX_BOARD_SIZE
  ) {
    return reject(state, 'board-full', 'The board is full.')
  }

  let selectedTotem: CardId | null = null
  if (definition.effect.kind === 'summon-random-totem') {
    const controlled = new Set(player.board.map((minion) => minion.cardId))
    const eligible = definition.effect.cardIds.filter(
      (cardId) => !controlled.has(cardId)
    )
    if (eligible.length === 0) {
      return reject(
        state,
        'hero-power-unavailable',
        'All four basic Totems are in play.'
      )
    }
    selectedTotem =
      eligible[Math.floor(rng.next() * eligible.length)] ?? eligible[0] ?? null
  }

  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = {
    ...player,
    mana: { ...player.mana, available: player.mana.available - player.heroPower.cost },
    heroPower: { ...player.heroPower, available: false }
  }
  const events: OpeningMatchEvent[] = [
    {
      type: 'hero-power-used',
      participantId: player.participantId,
      heroPowerId: definition.id,
      ...(command.target ? { target: command.target } : {}),
      cost: player.heroPower.cost,
      mana: nextPlayers[playerIndex].mana
    }
  ]

  const gainArmor = (amount: number): void => {
    const current = nextPlayers[playerIndex]
    const armorBefore = current.hero.armor
    nextPlayers[playerIndex] = {
      ...current,
      hero: { ...current.hero, armor: armorBefore + amount }
    }
    events.push({
      type: 'armor-gained',
      participantId: current.participantId,
      amount,
      armorBefore,
      armorAfter: armorBefore + amount
    })
  }

  switch (definition.effect.kind) {
    case 'gain-attack-and-armor': {
      const current = nextPlayers[playerIndex]
      nextPlayers[playerIndex] = {
        ...current,
        hero: {
          ...current.hero,
          attack: current.hero.attack + definition.effect.attack
        }
      }
      gainArmor(definition.effect.armor)
      break
    }
    case 'gain-armor':
      gainArmor(definition.effect.amount)
      break
    case 'damage-enemy-hero': {
      const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
      const opponent = nextPlayers[opponentIndex]
      const damaged = damageHero(opponent, definition.effect.amount, 'hero-power')
      nextPlayers[opponentIndex] = { ...opponent, hero: damaged.hero }
      events.push(damaged.event)
      break
    }
    case 'damage-character': {
      if (targetIndex === null || !command.target) break
      const targetPlayer = nextPlayers[targetIndex]
      if (command.target.kind === 'hero') {
        const damaged = damageHero(targetPlayer, definition.effect.amount, 'hero-power')
        nextPlayers[targetIndex] = { ...targetPlayer, hero: damaged.hero }
        events.push(damaged.event)
      } else {
        const instanceId = command.target.instanceId
        const minion = targetPlayer.board.find(
          (candidate) => candidate.instanceId === instanceId
        )!
        const healthAfter = Math.max(0, minion.health - definition.effect.amount)
        nextPlayers[targetIndex] = {
          ...targetPlayer,
          board: targetPlayer.board
            .map((candidate) =>
              candidate.instanceId === minion.instanceId
                ? { ...candidate, health: healthAfter }
                : cloneBoardMinion(candidate)
            )
            .filter((candidate) => candidate.health > 0)
        }
        events.push({
          type: 'character-damaged',
          source: 'hero-power',
          participantId: targetPlayer.participantId,
          character: { kind: 'minion', instanceId: minion.instanceId },
          amount: definition.effect.amount,
          healthBefore: minion.health,
          healthAfter,
          armorBefore: 0,
          armorAfter: 0,
          destroyed: healthAfter === 0
        })
      }
      break
    }
    case 'restore-character': {
      if (targetIndex === null || !command.target) break
      const targetPlayer = nextPlayers[targetIndex]
      if (command.target.kind === 'hero') {
        const healthAfter = Math.min(
          targetPlayer.hero.maxHealth,
          targetPlayer.hero.health + definition.effect.amount
        )
        nextPlayers[targetIndex] = {
          ...targetPlayer,
          hero: { ...targetPlayer.hero, health: healthAfter }
        }
        events.push({
          type: 'character-healed',
          participantId: targetPlayer.participantId,
          character: { kind: 'hero' },
          amount: healthAfter - targetPlayer.hero.health,
          healthBefore: targetPlayer.hero.health,
          healthAfter
        })
      } else {
        const instanceId = command.target.instanceId
        const minion = targetPlayer.board.find(
          (candidate) => candidate.instanceId === instanceId
        )!
        const healthAfter = Math.min(
          minion.maxHealth,
          minion.health + definition.effect.amount
        )
        nextPlayers[targetIndex] = {
          ...targetPlayer,
          board: targetPlayer.board.map((candidate) =>
            candidate.instanceId === minion.instanceId
              ? { ...candidate, health: healthAfter }
              : cloneBoardMinion(candidate)
          )
        }
        events.push({
          type: 'character-healed',
          participantId: targetPlayer.participantId,
          character: { kind: 'minion', instanceId: minion.instanceId },
          amount: healthAfter - minion.health,
          healthBefore: minion.health,
          healthAfter
        })
      }
      break
    }
    case 'summon':
    case 'summon-random-totem': {
      const cardId =
        definition.effect.kind === 'summon' ? definition.effect.cardId : selectedTotem
      if (!cardId) break
      const current = nextPlayers[playerIndex]
      const minion = createBoardMinion(
        cardId,
        `${current.participantId}:hero-power:${counter}`,
        state.turnNumber
      )
      const position = current.board.length
      nextPlayers[playerIndex] = {
        ...current,
        board: [...current.board.map(cloneBoardMinion), minion]
      }
      events.push({
        type: 'hero-power-minion-summoned',
        participantId: current.participantId,
        minion: cloneBoardMinion(minion),
        position
      })
      counter += 1
      break
    }
    case 'equip-weapon': {
      const current = nextPlayers[playerIndex]
      const weaponDefinition = CARD_CATALOG.require(definition.effect.cardId)
      if (weaponDefinition.type !== 'Weapon') {
        throw new Error(`${definition.effect.cardId} is not a weapon.`)
      }
      const weapon: BoardWeapon = {
        instanceId: `${current.participantId}:hero-power:${counter}`,
        cardId: weaponDefinition.id,
        attack: weaponDefinition.attack,
        durability: weaponDefinition.durability,
        maxDurability: weaponDefinition.durability
      }
      nextPlayers[playerIndex] = { ...current, weapon }
      events.push({
        type: 'weapon-equipped',
        participantId: current.participantId,
        weapon: cloneBoardWeapon(weapon),
        replacedWeapon: current.weapon ? cloneBoardWeapon(current.weapon) : null
      })
      counter += 1
      break
    }
    case 'draw-and-self-damage': {
      for (let draw = 0; draw < definition.effect.count; draw += 1) {
        let current = nextPlayers[playerIndex]
        const card = current.deck[0]
        if (card) {
          current = { ...current, deck: current.deck.slice(1) }
          if (current.hand.length >= MAX_HAND_SIZE) {
            events.push({
              type: 'card-burned',
              participantId: current.participantId,
              card: cloneCard(card)
            })
          } else {
            current = { ...current, hand: [...current.hand, cloneCard(card)] }
            events.push({
              type: 'card-drawn',
              participantId: current.participantId,
              card: cloneCard(card)
            })
          }
          nextPlayers[playerIndex] = current
        } else {
          const damaged = damageHero(current, current.fatigueDamage, 'fatigue')
          nextPlayers[playerIndex] = {
            ...current,
            hero: damaged.hero,
            fatigueDamage: current.fatigueDamage + 1
          }
          events.push({
            type: 'fatigue',
            participantId: current.participantId,
            amount: current.fatigueDamage,
            nextDamage: current.fatigueDamage + 1
          })
          events.push(damaged.event)
        }
      }
      const current = nextPlayers[playerIndex]
      const damaged = damageHero(current, definition.effect.amount, 'hero-power')
      nextPlayers[playerIndex] = { ...current, hero: damaged.hero }
      events.push(damaged.event)
      break
    }
  }

  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }
  return {
    ...withLethalResult(nextState, events),
    nextCounter: counter
  }
}

function applyPlayMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: PlayMinionCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can play a minion.'
    )
  }

  const card = player.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  if (!card) {
    return reject(
      state,
      'invalid-card-selection',
      'The selected card is not in the player hand.'
    )
  }

  const definition = CARD_CATALOG.get(card.cardId)
  if (!definition || definition.type !== 'Minion') {
    return reject(state, 'not-a-minion', 'Only minion cards can be played here.')
  }
  // TODO: AI plays any minion regardless of cost — cost check is bypassed for AI participants; remove when mana enforcement is generic.
  const isAi = player.controllerKind === 'ai'
  if (!isAi && player.mana.available < definition.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to play that minion.')
  }
  if (player.board.length >= MAX_BOARD_SIZE) {
    return reject(state, 'board-full', 'The board is full.')
  }
  if (
    !Number.isInteger(command.position) ||
    command.position < 0 ||
    command.position > player.board.length
  ) {
    return reject(state, 'invalid-position', 'The minion position is invalid.')
  }

  const minion: BoardMinion = {
    instanceId: card.instanceId,
    cardId: card.cardId,
    attack: definition.attack,
    health: definition.health,
    maxHealth: definition.health,
    summonedOnTurn: state.turnNumber,
    lastAttackedOnTurn: null
  }
  const nextBoard = player.board.map(cloneBoardMinion)
  nextBoard.splice(command.position, 0, minion)
  const nextPlayer: OpeningPlayerState = {
    ...player,
    hand: player.hand.filter(
      (candidate) => candidate.instanceId !== command.cardInstanceId
    ),
    board: nextBoard,
    mana: isAi
      ? player.mana
      : {
          ...player.mana,
          available: player.mana.available - definition.cost
        }
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'minion-played',
        participantId: player.participantId,
        minion: cloneBoardMinion(minion),
        position: command.position
      }
    ]
  }
}

function applyPlayWeapon(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: PlayWeaponCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(
      state,
      'not-active-player',
      'Only the active player can play a weapon.'
    )
  }

  const card = player.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  if (!card) {
    return reject(
      state,
      'invalid-card-selection',
      'The selected card is not in the player hand.'
    )
  }

  const definition = CARD_CATALOG.get(card.cardId)
  if (!definition || definition.type !== 'Weapon') {
    return reject(state, 'not-a-weapon', 'Only weapon cards can be played here.')
  }

  // Keep the opening AI behavior consistent with minions: it may play cards
  // without spending mana until generic AI mana enforcement is introduced.
  const isAi = player.controllerKind === 'ai'
  if (!isAi && player.mana.available < definition.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to play that weapon.')
  }

  const weapon: BoardWeapon = {
    instanceId: card.instanceId,
    cardId: card.cardId,
    attack: definition.attack,
    durability: definition.durability,
    maxDurability: definition.durability
  }
  const nextPlayer: OpeningPlayerState = {
    ...player,
    hand: player.hand.filter(
      (candidate) => candidate.instanceId !== command.cardInstanceId
    ),
    weapon,
    mana: isAi
      ? player.mana
      : {
          ...player.mana,
          available: player.mana.available - definition.cost
        }
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'weapon-equipped',
        participantId: player.participantId,
        weapon: cloneBoardWeapon(weapon),
        replacedWeapon: player.weapon ? cloneBoardWeapon(player.weapon) : null
      }
    ]
  }
}

/**
 * Replaces the active in-match hero while retaining only the persistent combat
 * state requested by the replacement effect. Temporary Attack never carries
 * over to a new hero identity.
 */
function replaceHero(
  player: OpeningPlayerState,
  replacementHero: HeroDefinition,
  armorGained: number
): { readonly player: OpeningPlayerState; readonly event: HeroReplacedEvent } {
  const heroPower = HERO_POWER_CATALOG.require(replacementHero.heroPowerId)
  return {
    player: {
      ...player,
      heroId: replacementHero.id,
      hero: {
        ...player.hero,
        armor: player.hero.armor + armorGained,
        attack: 0,
        lastAttackedOnTurn: null
      },
      heroPower: {
        id: heroPower.id,
        cost: heroPower.cost,
        available: player.heroPower.available
      }
    },
    event: {
      type: 'hero-replaced',
      participantId: player.participantId,
      previousHeroId: player.heroId,
      heroId: replacementHero.id,
      armorGained
    }
  }
}

/** Plays a Hero card, replacing the player's in-match hero identity and power. */
function applyPlayHero(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: PlayHeroCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (state.activePlayerId !== player.participantId) {
    return reject(state, 'not-active-player', 'Only the active player can play a hero.')
  }

  const card = player.hand.find(
    (candidate) => candidate.instanceId === command.cardInstanceId
  )
  if (!card) {
    return reject(
      state,
      'invalid-card-selection',
      'The selected card is not in the player hand.'
    )
  }

  const definition = CARD_CATALOG.get(card.cardId)
  if (!definition || definition.type !== 'Hero') {
    return reject(state, 'not-a-hero', 'Only hero cards can be played here.')
  }
  if (player.mana.available < definition.cost) {
    return reject(state, 'insufficient-mana', 'Not enough mana to play that hero.')
  }

  const replaceHeroAction = definition.effects
    .filter((effect) => effect.trigger === 'battlecry')
    .flatMap((effect) => effect.actions ?? [])
    .find((action) => action.action === 'replace-hero')
  const replacementHeroId = replaceHeroAction?.heroId
  if (replacementHeroId !== definition.replacementHeroId) {
    throw new Error(`Hero card ${definition.id} has no matching replacement action.`)
  }
  const replacementHero = HERO_CATALOG.get(replacementHeroId)
  if (!replacementHero || replacementHero.classId !== definition.cardClass) {
    throw new Error(`Hero card ${definition.id} has an invalid replacement hero.`)
  }
  const replacement = replaceHero(player, replacementHero, definition.armor)
  const nextPlayer: OpeningPlayerState = {
    ...replacement.player,
    hand: player.hand.filter((candidate) => candidate.instanceId !== card.instanceId),
    mana: { ...player.mana, available: player.mana.available - definition.cost }
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const events: OpeningMatchEvent[] = [replacement.event]

  const equipAction = definition.effects
    .filter((effect) => effect.trigger === 'battlecry')
    .flatMap((effect) => effect.actions ?? [])
    .find((action) => action.action === 'equip')
  const equippedCardId = equipAction?.cardId
  if (typeof equippedCardId === 'string') {
    const weaponDefinition = CARD_CATALOG.require(equippedCardId)
    if (weaponDefinition.type !== 'Weapon') {
      throw new Error(`${equippedCardId} is not a weapon.`)
    }
    const weapon: BoardWeapon = {
      instanceId: `${card.instanceId}:battlecry-weapon`,
      cardId: weaponDefinition.id,
      attack: weaponDefinition.attack,
      durability: weaponDefinition.durability,
      maxDurability: weaponDefinition.durability
    }
    nextPlayers[playerIndex] = { ...nextPlayer, weapon }
    events.push({
      type: 'weapon-equipped',
      participantId: player.participantId,
      weapon: cloneBoardWeapon(weapon),
      replacedWeapon: player.weapon ? cloneBoardWeapon(player.weapon) : null
    })
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState({
      ...state,
      players: nextPlayers,
      revision: state.revision + 1
    }),
    events
  }
}

/** Resolves direct combat between any two opposing characters. */
function applyAttackCharacter(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: AttackCharacterCommand
): OpeningCommandResult {
  return resolveAttackCharacter(state, playerIndex, command, false)
}

/** Compatibility adapter for the original minion-only command contract. */
function applyAttackMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: AttackMinionCommand
): OpeningCommandResult {
  return resolveAttackCharacter(
    state,
    playerIndex,
    {
      type: 'attack-character',
      participantId: command.participantId,
      attacker: { kind: 'minion', instanceId: command.attackerInstanceId },
      defender: { kind: 'minion', instanceId: command.defenderInstanceId }
    },
    true
  )
}

function resolveAttackCharacter(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: AttackCharacterCommand,
  legacyMinionEvent: boolean
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const attackerPlayer = state.players[playerIndex]
  if (state.activePlayerId !== attackerPlayer.participantId) {
    return reject(state, 'not-active-player', 'Only the active player can attack.')
  }

  const attackerLookupId =
    command.attacker.kind === 'minion' ? command.attacker.instanceId : null
  const attackerMinion =
    attackerLookupId === null
      ? undefined
      : attackerPlayer.board.find(
          (candidate) => candidate.instanceId === attackerLookupId
        )
  if (command.attacker.kind === 'minion' && !attackerMinion) {
    return reject(
      state,
      'invalid-attacker',
      'The selected attacker is not on your board.'
    )
  }
  if (command.attacker.kind === 'hero') {
    if (!canHeroAttack(attackerPlayer, state, attackerPlayer.participantId)) {
      return reject(state, 'hero-cannot-attack', 'Your hero cannot attack right now.')
    }
  } else if (
    attackerMinion &&
    !canBoardMinionAttack(attackerMinion, state, attackerPlayer.participantId)
  ) {
    return reject(state, 'minion-cannot-attack', 'That minion cannot attack right now.')
  }

  const defenderIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const defenderPlayer = state.players[defenderIndex]
  const defenderLookupId =
    command.defender.kind === 'minion' ? command.defender.instanceId : null
  const defenderMinion =
    defenderLookupId === null
      ? undefined
      : defenderPlayer.board.find(
          (candidate) => candidate.instanceId === defenderLookupId
        )
  if (command.defender.kind === 'minion' && !defenderMinion) {
    return reject(
      state,
      'invalid-target',
      'The selected target is not an opposing minion.'
    )
  }

  const attackerAttack =
    command.attacker.kind === 'hero'
      ? getHeroAttack(attackerPlayer)
      : (attackerMinion?.attack ?? 0)
  const defenderAttack =
    command.defender.kind === 'minion' ? (defenderMinion?.attack ?? 0) : 0
  const attackerHealth =
    command.attacker.kind === 'hero'
      ? attackerPlayer.hero.health
      : (attackerMinion?.health ?? 0)
  const defenderHealth =
    command.defender.kind === 'hero'
      ? defenderPlayer.hero.health
      : (defenderMinion?.health ?? 0)
  const attackerArmor = command.attacker.kind === 'hero' ? attackerPlayer.hero.armor : 0
  const defenderArmor = command.defender.kind === 'hero' ? defenderPlayer.hero.armor : 0
  const attackerArmorAfter = Math.max(0, attackerArmor - defenderAttack)
  const defenderArmorAfter = Math.max(0, defenderArmor - attackerAttack)
  const attackerHealthAfter = Math.max(
    0,
    attackerHealth - Math.max(0, defenderAttack - attackerArmor)
  )
  const defenderHealthAfter = Math.max(
    0,
    defenderHealth - Math.max(0, attackerAttack - defenderArmor)
  )
  const attackerDestroyed = attackerHealthAfter === 0
  const defenderDestroyed = defenderHealthAfter === 0

  let weaponResult: CharacterCombatResolvedEvent['weapon'] = null
  let nextAttackerWeapon = attackerPlayer.weapon
  if (command.attacker.kind === 'hero' && attackerPlayer.weapon) {
    const weapon = attackerPlayer.weapon
    const durabilityAfter = Math.max(0, weapon.durability - 1)
    weaponResult = {
      participantId: attackerPlayer.participantId,
      durabilityBefore: weapon.durability,
      durabilityAfter,
      destroyed: durabilityAfter === 0
    }
    nextAttackerWeapon =
      durabilityAfter > 0 ? { ...weapon, durability: durabilityAfter } : null
  }

  const attackerInstanceId =
    command.attacker.kind === 'minion' ? command.attacker.instanceId : null
  const defenderInstanceId =
    command.defender.kind === 'minion' ? command.defender.instanceId : null
  const nextAttackerBoard = attackerPlayer.board
    .map((candidate) => {
      if (attackerInstanceId === null || candidate.instanceId !== attackerInstanceId) {
        return cloneBoardMinion(candidate)
      }
      if (attackerDestroyed) return null
      return {
        ...cloneBoardMinion(candidate),
        health: attackerHealthAfter,
        lastAttackedOnTurn: state.turnNumber
      }
    })
    .filter((candidate): candidate is BoardMinion => candidate !== null)
  const nextDefenderBoard = defenderPlayer.board
    .map((candidate) => {
      if (defenderInstanceId === null || candidate.instanceId !== defenderInstanceId) {
        return cloneBoardMinion(candidate)
      }
      if (defenderDestroyed) return null
      return { ...cloneBoardMinion(candidate), health: defenderHealthAfter }
    })
    .filter((candidate): candidate is BoardMinion => candidate !== null)

  const nextAttackerHero =
    command.attacker.kind === 'hero'
      ? {
          ...attackerPlayer.hero,
          health: attackerHealthAfter,
          armor: attackerArmorAfter,
          lastAttackedOnTurn: state.turnNumber
        }
      : attackerPlayer.hero
  const nextDefenderHero =
    command.defender.kind === 'hero'
      ? {
          ...defenderPlayer.hero,
          health: defenderHealthAfter,
          armor: defenderArmorAfter
        }
      : defenderPlayer.hero
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = {
    ...attackerPlayer,
    hero: nextAttackerHero,
    board: nextAttackerBoard,
    weapon: nextAttackerWeapon
  }
  nextPlayers[defenderIndex] = {
    ...defenderPlayer,
    hero: nextDefenderHero,
    board: nextDefenderBoard
  }

  const attackerHeroDead = nextAttackerHero.health <= 0
  const defenderHeroDead = nextDefenderHero.health <= 0
  const matchEnded = attackerHeroDead || defenderHeroDead
  const winnerId = matchEnded
    ? attackerHeroDead
      ? defenderPlayer.participantId
      : attackerPlayer.participantId
    : null
  const loserId = matchEnded
    ? attackerHeroDead
      ? attackerPlayer.participantId
      : defenderPlayer.participantId
    : null
  const nextState: OpeningMatchState = {
    ...state,
    phase: matchEnded ? 'ended' : state.phase,
    activePlayerId: matchEnded ? null : state.activePlayerId,
    winnerId,
    loserId,
    players: nextPlayers,
    revision: state.revision + 1
  }

  const attackerResult = {
    participantId: attackerPlayer.participantId,
    character: command.attacker,
    attack: attackerAttack,
    damageDealt: attackerAttack,
    healthBefore: attackerHealth,
    healthAfter: attackerHealthAfter,
    armorBefore: attackerArmor,
    armorAfter: attackerArmorAfter,
    destroyed: attackerDestroyed
  } satisfies CharacterCombatantResult
  const defenderResult = {
    participantId: defenderPlayer.participantId,
    character: command.defender,
    attack: defenderAttack,
    damageDealt: defenderAttack,
    healthBefore: defenderHealth,
    healthAfter: defenderHealthAfter,
    armorBefore: defenderArmor,
    armorAfter: defenderArmorAfter,
    destroyed: defenderDestroyed
  } satisfies CharacterCombatantResult

  if (legacyMinionEvent) {
    const attacker = attackerMinion
    const defender = defenderMinion
    if (!attacker || !defender) {
      return reject(
        state,
        'invalid-target',
        'The selected target is not an opposing minion.'
      )
    }
    const legacyState: OpeningMatchState = {
      ...nextState,
      winnerId: null,
      loserId: null
    }
    return {
      accepted: true,
      state: cloneOpeningMatchState(legacyState),
      events: [
        {
          type: 'minion-combat-resolved',
          attacker: {
            participantId: attackerPlayer.participantId,
            instanceId: attacker.instanceId,
            attack: attacker.attack,
            damageDealt: attacker.attack,
            healthBefore: attacker.health,
            healthAfter: attackerHealthAfter,
            destroyed: attackerDestroyed
          },
          defender: {
            participantId: defenderPlayer.participantId,
            instanceId: defender.instanceId,
            attack: defender.attack,
            damageDealt: defender.attack,
            healthBefore: defender.health,
            healthAfter: defenderHealthAfter,
            destroyed: defenderDestroyed
          }
        }
      ]
    }
  }

  const events: OpeningMatchEvent[] = [
    {
      type: 'character-combat-resolved',
      attacker: attackerResult,
      defender: defenderResult,
      weapon: weaponResult
    }
  ]
  if (winnerId && loserId) {
    events.push({
      type: 'match-ended',
      winnerId,
      loserId,
      reason: 'hero-health-depleted'
    })
  }
  return { accepted: true, state: cloneOpeningMatchState(nextState), events }
}

function applyDevAddCard(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevAddCardCommand,
  counter: number
): OpeningCommandResult & { nextCounter?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const player = state.players[playerIndex]
  if (player.hand.length >= MAX_HAND_SIZE) {
    return reject(state, 'hand-full', 'The hand is full.')
  }

  const definition = CARD_CATALOG.get(command.cardId)
  if (!definition) {
    return reject(state, 'unknown-card', `Unknown card ${command.cardId}.`)
  }

  const card: OpeningCard = {
    instanceId: `${player.participantId}:dev:${counter}`,
    cardId: definition.id
  }

  const nextPlayer: OpeningPlayerState = {
    ...player,
    hand: [...player.hand, card]
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-card-added',
        participantId: player.participantId,
        card: cloneCard(card)
      }
    ],
    nextCounter: counter + 1
  }
}

function applyDevSummonMinion(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevSummonMinionCommand,
  counter: number
): OpeningCommandResult & { nextCounter?: number } {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  if (player.board.length >= MAX_BOARD_SIZE) {
    return reject(state, 'board-full', 'The board is full.')
  }
  const definition = CARD_CATALOG.get(command.cardId)
  if (!definition) {
    return reject(state, 'unknown-card', `Unknown card ${command.cardId}.`)
  }
  if (definition.type !== 'Minion') {
    return reject(state, 'not-a-minion', 'Only minion cards can be summoned.')
  }

  const minion: BoardMinion = {
    instanceId: `${player.participantId}:dev:${counter}`,
    cardId: definition.id,
    attack: definition.attack,
    health: definition.health,
    maxHealth: definition.health,
    summonedOnTurn: state.turnNumber,
    lastAttackedOnTurn: null
  }
  const position = player.board.length
  const nextPlayer: OpeningPlayerState = {
    ...player,
    board: [...player.board.map(cloneBoardMinion), minion]
  }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-minion-summoned',
        participantId: player.participantId,
        minion: cloneBoardMinion(minion),
        position
      }
    ],
    nextCounter: counter + 1
  }
}

function applyDevEndMatch(
  state: OpeningMatchState,
  command: DevEndMatchCommand
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }
  const winnerIndex = findPlayerIndex(state.players, command.winnerId)
  if (winnerIndex === -1) {
    return reject(
      state,
      'unknown-participant',
      `Unknown participant: ${command.winnerId}`
    )
  }
  const loserIndex: 0 | 1 = winnerIndex === 0 ? 1 : 0
  const winnerId = state.players[winnerIndex].participantId
  const loserId = state.players[loserIndex].participantId
  const nextState: OpeningMatchState = {
    ...state,
    phase: 'ended',
    activePlayerId: null,
    winnerId,
    loserId,
    revision: state.revision + 1
  }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [{ type: 'match-ended', winnerId, loserId, reason: 'dev-forced' }]
  }
}

function applyDevSetMana(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevSetManaCommand
): OpeningCommandResult {
  if (
    !Number.isInteger(command.available) ||
    command.available < 0 ||
    command.available > MAX_MANA
  ) {
    return reject(state, 'invalid-mana', 'Available mana must be between 0 and 10.')
  }
  if (
    !Number.isInteger(command.maximum) ||
    command.maximum < 0 ||
    command.maximum > MAX_MANA
  ) {
    return reject(state, 'invalid-mana', 'Maximum mana must be between 0 and 10.')
  }
  if (command.available > command.maximum) {
    return reject(state, 'invalid-mana', 'Available mana cannot exceed maximum.')
  }

  const player = state.players[playerIndex]
  const nextMana: PlayerMana = {
    available: command.available,
    maximum: command.maximum
  }
  const nextPlayer: OpeningPlayerState = { ...player, mana: nextMana }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      { type: 'dev-mana-set', participantId: player.participantId, mana: nextMana }
    ]
  }
}

function applyDevModifyDeck(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  command: DevModifyDeckCommand,
  refillDeck: () => readonly OpeningCard[]
): OpeningCommandResult {
  if (state.phase !== 'turns') {
    return reject(state, 'wrong-phase', 'Turns have not started yet.')
  }

  const player = state.players[playerIndex]
  const deck = command.action === 'destroy' ? [] : refillDeck()
  const nextPlayer: OpeningPlayerState = { ...player, deck }
  const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  nextPlayers[playerIndex] = nextPlayer
  const nextState: OpeningMatchState = {
    ...state,
    players: nextPlayers,
    revision: state.revision + 1
  }

  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [
      {
        type: 'dev-deck-modified',
        participantId: player.participantId,
        action: command.action,
        deckCount: deck.length
      }
    ]
  }
}

function applyDevStateChange(
  state: OpeningMatchState,
  playerIndex: 0 | 1,
  player: OpeningPlayerState
): OpeningAcceptedResult {
  const players = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
  players[playerIndex] = player
  const nextState = { ...state, players, revision: state.revision + 1 }
  return {
    accepted: true,
    state: cloneOpeningMatchState(nextState),
    events: [{ type: 'dev-state-changed', participantId: player.participantId }]
  }
}

/**
 * Creates the platform-neutral opening sequence used by GameScene.
 *
 * Deck contents are supplied as snapshots so the game process owns all card
 * movement while the renderer remains responsible only for presentation.
 */
export function createOpeningMatch(
  setup: MatchSetup,
  deckSnapshots: readonly Deck[],
  rng: DeterministicRng = createSeededRng(setup.seed)
): OpeningMatchInstance {
  const decksById = new Map(deckSnapshots.map((deck) => [deck.id, deck]))
  const playerOneIndex: 0 | 1 = rng.next() < 0.5 ? 0 : 1
  const playerTwoIndex: 0 | 1 = playerOneIndex === 0 ? 1 : 0
  const order = [playerOneIndex, playerTwoIndex] as const

  const createPlayer = (
    participantIndex: 0 | 1,
    seatIndex: 0 | 1
  ): OpeningPlayerState => {
    const participant = setup.participants[participantIndex]
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const hero = HERO_CATALOG.require(participant.heroId)
    const heroPower = HERO_POWER_CATALOG.require(hero.heroPowerId)
    const shuffled = shuffle(expandDeck(deck, participant), rng)
    const initialCount = seatIndex === 0 ? 3 : 4
    const initialCards = shuffled.slice(0, initialCount)
    return {
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      heroId: participant.heroId,
      hero: {
        health: hero.startingHealth,
        maxHealth: hero.startingHealth,
        armor: 0,
        attack: 0,
        lastAttackedOnTurn: null
      },
      playerNumber: (seatIndex + 1) as 1 | 2,
      deck: shuffled.slice(initialCount),
      hand: initialCards,
      board: [],
      weapon: null,
      mana: { available: 0, maximum: 0 },
      heroPower: { id: heroPower.id, cost: heroPower.cost, available: false },
      fatigueDamage: 1,
      mulliganConfirmed: false
    } satisfies OpeningPlayerState
  }
  const players = [createPlayer(order[0], 0), createPlayer(order[1], 1)] as [
    OpeningPlayerState,
    OpeningPlayerState
  ]

  let state: OpeningMatchState = {
    phase: 'mulligan',
    playerOneId: players[0].participantId,
    playerTwoId: players[1].participantId,
    activePlayerId: null,
    turnNumber: 0,
    winnerId: null,
    loserId: null,
    players,
    revision: 0
  }
  let devCardCounter = 10000
  let devDeckRefillCounter = 0

  const refillDeckFor = (participantId: PlayerId): readonly OpeningCard[] => {
    const participant = setup.participants.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!participant) throw new Error(`Unknown participant: ${participantId}`)
    const deck = decksById.get(participant.deckId)
    if (!deck) throw new Error(`Deck ${participant.deckId} is not available.`)
    const refillId = devDeckRefillCounter
    devDeckRefillCounter += 1
    return shuffle(expandDeck(deck, participant), rng).map((card, ordinal) => ({
      ...card,
      instanceId: `${participant.participantId}:dev-refill:${refillId}:${ordinal}`
    }))
  }

  return {
    setup,
    getState(): OpeningMatchState {
      return cloneOpeningMatchState(state)
    },
    dispatch(commandValue: unknown): OpeningCommandResult {
      const command = parseCommand(commandValue)
      if (!command)
        return reject(state, 'invalid-command', 'The match command is invalid.')

      const playerIndex = findPlayerIndex(state.players, command.participantId)
      if (playerIndex === -1) {
        return reject(
          state,
          'unknown-participant',
          `Unknown participant: ${command.participantId}`
        )
      }

      if (state.phase === 'ended') {
        return reject(state, 'match-ended', 'The match has already ended.')
      }

      if (command.type === 'end-turn') {
        const result = applyEndTurn(state, playerIndex)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'use-hero-power') {
        const result = applyUseHeroPower(
          state,
          playerIndex,
          command,
          rng,
          devCardCounter
        )
        if (result.accepted) {
          state = result.state
          if (result.nextCounter !== undefined) devCardCounter = result.nextCounter
        }
        return result
      }

      if (command.type === 'play-minion') {
        const result = applyPlayMinion(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'play-weapon') {
        const result = applyPlayWeapon(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'play-hero') {
        const result = applyPlayHero(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'attack-minion') {
        const result = applyAttackMinion(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'attack-character') {
        const result = applyAttackCharacter(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'dev-add-card') {
        const result = applyDevAddCard(state, playerIndex, command, devCardCounter)
        if (result.accepted) {
          state = result.state
          if (result.nextCounter !== undefined) devCardCounter = result.nextCounter
        }
        return result
      }

      if (command.type === 'dev-set-mana') {
        const result = applyDevSetMana(state, playerIndex, command)
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'dev-set-hero') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const health =
          command.health === undefined ? player.hero.health : command.health
        const armor = command.armor === undefined ? player.hero.armor : command.armor
        const attack =
          command.attack === undefined ? player.hero.attack : command.attack
        if (
          !Number.isInteger(health) ||
          health < 1 ||
          health > player.hero.maxHealth ||
          !Number.isInteger(armor) ||
          armor < 0 ||
          !Number.isInteger(attack) ||
          attack < 0
        )
          return reject(state, 'invalid-command', 'Invalid hero state.')
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          hero: { ...player.hero, health, armor, attack }
        })
        state = result.state
        return result
      }
      if (command.type === 'dev-set-hero-power') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const cost = command.cost === undefined ? player.heroPower.cost : command.cost
        const available =
          command.available === undefined
            ? player.heroPower.available
            : command.available
        if (!Number.isInteger(cost) || cost < 0 || cost > MAX_MANA)
          return reject(state, 'invalid-command', 'Invalid hero power cost.')
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          heroPower: { ...player.heroPower, cost, available }
        })
        state = result.state
        return result
      }
      if (command.type === 'dev-clear-zone') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        const result = applyDevStateChange(
          state,
          playerIndex,
          command.zone === 'hand' ? { ...player, hand: [] } : { ...player, board: [] }
        )
        state = result.state
        return result
      }
      if (command.type === 'dev-set-fatigue') {
        if (state.phase !== 'turns' || command.nextDamage < 1)
          return reject(state, 'invalid-command', 'Invalid fatigue damage.')
        const player = state.players[playerIndex]
        const result = applyDevStateChange(state, playerIndex, {
          ...player,
          fatigueDamage: command.nextDamage
        })
        state = result.state
        return result
      }
      if (command.type === 'dev-remove-weapon') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const result = applyDevStateChange(state, playerIndex, {
          ...state.players[playerIndex],
          weapon: null
        })
        state = result.state
        return result
      }
      if (command.type === 'dev-draw') {
        if (state.phase !== 'turns')
          return reject(state, 'wrong-phase', 'Turns have not started yet.')
        const player = state.players[playerIndex]
        if (player.deck.length === 0) {
          const damaged = damageHero(player, player.fatigueDamage, 'fatigue')
          const result = applyDevStateChange(state, playerIndex, {
            ...player,
            hero: damaged.hero,
            fatigueDamage: player.fatigueDamage + 1
          })
          state = result.state
          return {
            ...result,
            events: [
              {
                type: 'fatigue',
                participantId: player.participantId,
                amount: player.fatigueDamage,
                nextDamage: player.fatigueDamage + 1
              },
              damaged.event
            ]
          }
        }
        const card = cloneCard(player.deck[0]!)
        const nextPlayer =
          player.hand.length >= MAX_HAND_SIZE
            ? { ...player, deck: player.deck.slice(1) }
            : drawCards(player, 1).player
        const result = applyDevStateChange(state, playerIndex, nextPlayer)
        state = result.state
        return {
          ...result,
          events: [
            player.hand.length >= MAX_HAND_SIZE
              ? { type: 'card-burned', participantId: player.participantId, card }
              : { type: 'card-drawn', participantId: player.participantId, card }
          ]
        }
      }

      if (command.type === 'dev-modify-deck') {
        const result = applyDevModifyDeck(state, playerIndex, command, () =>
          refillDeckFor(command.participantId)
        )
        if (result.accepted) state = result.state
        return result
      }

      if (command.type === 'dev-summon-minion') {
        const result = applyDevSummonMinion(state, playerIndex, command, devCardCounter)
        if (result.accepted) {
          state = result.state
          if (result.nextCounter !== undefined) devCardCounter = result.nextCounter
        }
        return result
      }

      if (command.type === 'dev-end-match') {
        const result = applyDevEndMatch(state, command)
        if (result.accepted) state = result.state
        return result
      }

      if (state.phase !== 'mulligan') {
        return reject(state, 'wrong-phase', 'Mulligan has already ended.')
      }

      const player = state.players[playerIndex]
      if (player.mulliganConfirmed) {
        return reject(
          state,
          'already-confirmed',
          'This participant already confirmed mulligan.'
        )
      }

      const selectedIds = command.replaceInstanceIds
      if (new Set(selectedIds).size !== selectedIds.length) {
        return reject(
          state,
          'invalid-card-selection',
          'A card cannot be selected twice.'
        )
      }
      const selected = player.hand.filter((card) =>
        selectedIds.includes(card.instanceId)
      )
      if (selected.length !== selectedIds.length) {
        return reject(
          state,
          'invalid-card-selection',
          'Every selected card must be in hand.'
        )
      }

      const selectedSet = new Set(selectedIds)
      const kept = player.hand.filter((card) => !selectedSet.has(card.instanceId))
      const replacementCount = selected.length
      const replacementCards = player.deck.slice(0, replacementCount).map(cloneCard)
      const remainingDeck = player.deck.slice(replacementCount)
      const nextPlayer: OpeningPlayerState = {
        ...player,
        deck: shuffle([...remainingDeck, ...selected], rng),
        hand: [...kept, ...replacementCards],
        mulliganConfirmed: true
      }
      const nextPlayers = [...state.players] as [OpeningPlayerState, OpeningPlayerState]
      nextPlayers[playerIndex] = nextPlayer
      state = { ...state, players: nextPlayers, revision: state.revision + 1 }

      const events: OpeningMatchEvent[] = [
        {
          type: 'mulligan-resolved',
          participantId: player.participantId,
          returnedCards: selected.map(cloneCard),
          replacementCards: replacementCards.map(cloneCard)
        }
      ]

      if (nextPlayers.every((candidate) => candidate.mulliganConfirmed)) {
        const playerTwo = nextPlayers[1]
        const coin: OpeningCard = {
          instanceId: `${playerTwo.participantId}:coin`,
          cardId: COIN_CARD_ID
        }
        const playerTwoWithCoin: OpeningPlayerState = {
          ...playerTwo,
          hand: [...playerTwo.hand, coin]
        }
        nextPlayers[1] = playerTwoWithCoin
        state = { ...state, players: nextPlayers }
        events.push({
          type: 'coin-granted',
          participantId: playerTwo.participantId,
          card: cloneCard(coin)
        })

        const playerOne = nextPlayers[0]
        const drawn = drawCards(playerOne, 1)
        const playerOneMana = growMana(playerOne.mana)
        nextPlayers[0] = {
          ...drawn.player,
          mana: playerOneMana,
          heroPower: { ...drawn.player.heroPower, available: true }
        }
        state = {
          ...state,
          phase: 'turns',
          activePlayerId: playerOne.participantId,
          turnNumber: 1,
          players: nextPlayers,
          revision: state.revision + 1
        }
        events.push({
          type: 'opening-turn-started',
          participantId: playerOne.participantId,
          playerNumber: 1,
          mana: playerOneMana
        })
        const card = drawn.cards[0]
        if (card) {
          events.push({
            type: 'opening-card-drawn',
            participantId: playerOne.participantId,
            card: cloneCard(card)
          })
        }
      }

      return { accepted: true, state: cloneOpeningMatchState(state), events }
    }
  }
}
