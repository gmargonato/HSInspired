import {
  CARD_CATALOG,
  asCardId,
  asHeroId,
  asHeroPowerId,
  type CardKeyword
} from '../../content/cards'
import { HERO_CATALOG } from '../../content/heroes'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type { Deck } from '../../decks'
import { asPlayerId, type MatchSetup, type PlayerId } from '../match-types'
import type {
  BoardMinion,
  BoardWeapon,
  OpeningCard,
  OpeningMatchCheckpoint,
  OpeningMatchState,
  OpeningPlayerState,
  PendingCardChoice,
  RuntimeCostAdjustment,
  RuntimeEnchantment,
  SecretState
} from '../opening-match-types'
import { createOpeningMatch } from '../opening-match'
import { createSeededRng } from '../rng'

export interface AiFixtureMinion {
  readonly cardId: string
  readonly attack?: number
  readonly health?: number
  readonly maxHealth?: number
  /** Printed stats used when the current values include an active aura. */
  readonly baseAttack?: number
  readonly baseHealth?: number
  readonly ready?: boolean
  readonly attacksUsedThisTurn?: number
  readonly divineShield?: boolean
  readonly divineShieldConsumed?: boolean
  readonly stealth?: boolean
  readonly frozen?: boolean
  readonly frozenUntilTurn?: number
  readonly immune?: boolean
  readonly spellImmune?: boolean
  readonly keywords?: readonly CardKeyword[]
  readonly enchantments?: readonly RuntimeEnchantment[]
}

export interface AiFixtureCard {
  readonly cardId: string
  readonly baseCost?: number
  readonly currentCost?: number
  readonly costAdjustments?: readonly RuntimeCostAdjustment[]
  readonly enchantments?: readonly RuntimeEnchantment[]
}

export type AiFixtureCardInput = string | AiFixtureCard

export interface AiFixtureWeapon {
  readonly cardId: string
  readonly attack?: number
  readonly durability?: number
  readonly maxDurability?: number
}

export interface AiFixtureSecret {
  readonly cardId: string
  readonly revealed?: boolean
}

export interface AiFixtureQuest {
  readonly cardId: string
  readonly progress: number
  readonly playedNames?: Readonly<Record<string, number>>
}

export interface AiFixtureDiscover {
  readonly candidates: readonly AiFixtureCardInput[]
  readonly sourceCardId?: string
  readonly sourceCardInstanceId?: string
  readonly origin?: 'deck' | 'generated' | 'opponent-deck'
}

export interface AiFixtureCardChoice {
  readonly sourceCardId: string
  readonly sourceCardInstanceId?: string
  readonly targetCardId?: string
  readonly options: readonly {
    readonly choice: number
    readonly label: string
    readonly presentationCardId?: string
    readonly presentationCost?: number
  }[]
  readonly resolution?: PendingCardChoice['resolution']
}

export interface AiFixtureOptions {
  readonly seed: number
  readonly aiHeroId: string
  readonly opponentHeroId: string
  readonly aiHand?: readonly AiFixtureCardInput[]
  readonly opponentHand?: readonly AiFixtureCardInput[]
  readonly aiDeck?: readonly string[]
  readonly opponentDeck?: readonly string[]
  readonly aiBoard?: readonly AiFixtureMinion[]
  readonly opponentBoard?: readonly AiFixtureMinion[]
  readonly aiHealth?: number
  readonly aiArmor?: number
  readonly aiAttack?: number
  readonly opponentHealth?: number
  readonly opponentArmor?: number
  readonly opponentAttack?: number
  readonly aiMana?: number
  readonly aiMaximumMana?: number
  readonly aiTemporaryMana?: number
  readonly aiOverloadLocked?: number
  readonly opponentMaximumMana?: number
  readonly aiHeroPowerCost?: number
  readonly aiHeroPowerAvailable?: boolean
  readonly opponentHeroPowerAvailable?: boolean
  readonly aiWeapon?: AiFixtureWeapon
  readonly opponentWeapon?: AiFixtureWeapon
  readonly aiSecrets?: readonly AiFixtureSecret[]
  readonly opponentSecrets?: readonly AiFixtureSecret[]
  readonly aiQuest?: AiFixtureQuest
  readonly opponentQuest?: AiFixtureQuest
  readonly pendingDiscover?: AiFixtureDiscover
  readonly pendingCardChoice?: AiFixtureCardChoice
  readonly aiFatigueDamage?: number
  readonly opponentFatigueDamage?: number
  readonly aiDeckHasNoDuplicates?: boolean
  readonly aiReplacementHeroId?: string
  readonly opponentReplacementHeroId?: string
  readonly aiHeroPowerId?: string
  readonly opponentHeroPowerId?: string
  readonly aiHeroPowerUsesThisTurn?: number
  readonly opponentHeroPowerUsesThisTurn?: number
  readonly aiCthun?: { readonly attack: number; readonly health: number; readonly taunt?: boolean }
  readonly opponentCthun?: {
    readonly attack: number
    readonly health: number
    readonly taunt?: boolean
  }
  readonly aiCounters?: Readonly<Record<string, number>>
  readonly opponentCounters?: Readonly<Record<string, number>>
  readonly aiGraveyard?: readonly AiFixtureMinion[]
  readonly opponentGraveyard?: readonly AiFixtureMinion[]
  readonly aiElementalPlayedLastTurn?: boolean
  readonly opponentElementalPlayedLastTurn?: boolean
  readonly turnNumber?: number
}

export interface AiFixture {
  readonly setup: MatchSetup
  readonly decks: readonly [Deck, Deck]
  readonly checkpoint: OpeningMatchCheckpoint
  readonly localParticipantId: PlayerId
  readonly aiParticipantId: PlayerId
}

const LOCAL_ID = asPlayerId('fixture-player-one')
const AI_ID = asPlayerId('fixture-player-two')

function cardDefinition(cardId: string) {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) throw new Error(`Unknown AI fixture card: ${cardId}`)
  return definition
}

function countCards(cards: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const cardId of cards) {
    cardDefinition(cardId)
    counts[cardId] = (counts[cardId] ?? 0) + 1
  }
  return counts
}

function fixtureDeck(
  id: string,
  heroId: string,
  cards: readonly string[]
): Deck {
  const normalized = [
    ...(cards.length > 0 ? cards : ['basic_acidic_swamp_ooze'])
  ]
  while (normalized.length < 30) normalized.push('basic_acidic_swamp_ooze')
  if (normalized.length > 30) normalized.length = 30
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: countCards(normalized),
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z'
  }
}

function makeCard(
  input: AiFixtureCardInput,
  participantId: PlayerId,
  ordinal: number,
  zone: 'deck' | 'hand' | 'revealed'
): OpeningCard {
  const cardId = typeof input === 'string' ? input : input.cardId
  const definition = cardDefinition(cardId)
  return {
    instanceId: `${participantId}:fixture-card:${ordinal}`,
    cardId: asCardId(cardId),
    ownerId: participantId,
    controllerId: participantId,
    creationOrdinal: ordinal,
    baseCost: typeof input === 'string' ? definition.cost : input.baseCost ?? definition.cost,
    currentCost:
      typeof input === 'string' ? definition.cost : input.currentCost ?? definition.cost,
    zone,
    revealed: zone === 'hand' || zone === 'revealed',
    startedInDeck: zone === 'deck',
    ...(typeof input !== 'string' && input.costAdjustments
      ? { costAdjustments: input.costAdjustments }
      : {}),
    ...(typeof input !== 'string' && input.enchantments
      ? { enchantments: input.enchantments }
      : {})
  }
}

function makeMinion(
  input: AiFixtureMinion,
  participantId: PlayerId,
  turnNumber: number,
  ordinal: number
): BoardMinion {
  const definition = cardDefinition(input.cardId)
  if (definition.type !== 'Minion')
    throw new Error(`AI fixture board card is not a minion: ${input.cardId}`)
  const maxHealth = input.maxHealth ?? input.health ?? definition.health
  const health = input.health ?? maxHealth
  const attack = input.attack ?? definition.attack
  const keywords: CardKeyword[] = [
    ...new Set([...(definition.keywords ?? []), ...(input.keywords ?? [])])
  ]
  const maxAttacksPerTurn = keywords.includes('mega-windfury')
    ? 4
    : keywords.includes('windfury')
      ? 2
      : 1
  return {
    instanceId: `${participantId}:fixture-minion:${ordinal}`,
    cardId: asCardId(input.cardId),
    attack,
    health,
    maxHealth,
    summonedOnTurn: input.ready === false ? turnNumber : turnNumber - 1,
    lastAttackedOnTurn: null,
    ownerId: participantId,
    controllerId: participantId,
    creationOrdinal: ordinal,
    playOrder: ordinal,
    baseAttack: input.baseAttack ?? attack,
    baseHealth: input.baseHealth ?? maxHealth,
    keywords,
    enchantments: input.enchantments ?? [],
    grantedTriggers: [],
    attachedEffects: [],
    deathrattles: definition.effects.filter((effect) => effect.trigger === 'deathrattle'),
    silenced: false,
    frozenUntilTurn:
      input.frozenUntilTurn ?? (input.frozen ? turnNumber : null),
    divineShield:
      input.divineShield ?? definition.keywords.includes('divine-shield'),
    divineShieldConsumed: input.divineShieldConsumed ?? false,
    stealth: input.stealth ?? definition.keywords.includes('stealth'),
    immune: input.immune ?? definition.keywords.includes('immune'),
    spellImmune:
      input.spellImmune ?? definition.keywords.includes('spell-immune'),
    attacksUsedThisTurn: input.attacksUsedThisTurn ?? 0,
    maxAttacksPerTurn,
    damageTaken: Math.max(0, maxHealth - health)
  }
}

function makeWeapon(
  input: AiFixtureWeapon,
  participantId: PlayerId,
  ordinal: number
): BoardWeapon {
  const definition = cardDefinition(input.cardId)
  if (definition.type !== 'Weapon')
    throw new Error(`AI fixture weapon card is not a weapon: ${input.cardId}`)
  const maxDurability = input.maxDurability ?? definition.durability
  return {
    instanceId: `${participantId}:fixture-weapon:${ordinal}`,
    cardId: asCardId(input.cardId),
    attack: input.attack ?? definition.attack,
    durability: input.durability ?? maxDurability,
    maxDurability,
    ownerId: participantId,
    controllerId: participantId,
    creationOrdinal: ordinal,
    playOrder: ordinal,
    enchantments: []
  }
}

function makeSecret(
  input: AiFixtureSecret,
  participantId: PlayerId,
  ordinal: number
): SecretState {
  const definition = cardDefinition(input.cardId)
  if (definition.type !== 'Spell' || !definition.keywords.includes('secret'))
    throw new Error(`AI fixture secret is not a secret: ${input.cardId}`)
  return {
    instanceId: `${participantId}:fixture-secret:${ordinal}`,
    cardId: asCardId(input.cardId),
    ownerId: participantId,
    controllerId: participantId,
    creationOrdinal: ordinal,
    playOrder: ordinal,
    revealed: input.revealed ?? false
  }
}

function withQuest(
  player: OpeningPlayerState,
  quest: AiFixtureQuest | undefined
): OpeningPlayerState {
  if (!quest) return { ...player, quest: null }
  const definition = cardDefinition(quest.cardId)
  if (definition.type !== 'Spell' || !definition.quest)
    throw new Error(`AI fixture quest is not a quest: ${quest.cardId}`)
  return {
    ...player,
    quest: {
      cardId: definition.id,
      rewardCardId: definition.quest.rewardCardId,
      goal: definition.quest.goal,
      progress: quest.progress,
      target: definition.quest.target,
      playedNames: quest.playedNames
    }
  }
}

function resetHistory(state: OpeningMatchState): OpeningMatchState {
  return {
    ...state,
    history: {
      cardsPlayedThisTurn: [],
      cardsCastThisTurn: [],
      cardsDrawnThisTurn: [],
      minionsSummonedThisTurn: [],
      minionsDiedThisTurn: [],
      damageDealtThisTurn: 0,
      damageTakenThisTurn: 0,
      healingThisTurn: 0,
      armorGainedThisTurn: 0,
      cardsPlayedThisGame: [],
      spellsCastThisGameByPlayer: {},
      totemsSummonedThisGameByPlayer: {},
      secretsPlayedThisGameByPlayer: {},
      cardsDiedThisGame: [],
      beastsSummonedByPlayer: {},
      heroPowersUsedByPlayer: {}
    },
    openingHistory: [],
    effectTrace: [],
    pendingResolution: false,
    pendingDiscover: undefined,
    pendingCardChoice: undefined,
    scheduledEffects: []
  }
}

/**
 * Builds a direct-load checkpoint for a scenario specification.  The returned
 * state is still consumed by createOpeningMatch and therefore receives the
 * same invariants, effect runtime, legal-action enumeration, and AI projection
 * as an ordinary match.
 */
export function createAiFixture(options: AiFixtureOptions): AiFixture {
  const aiHeroId = asHeroId(options.aiHeroId)
  const opponentHeroId = asHeroId(options.opponentHeroId)
  HERO_CATALOG.require(aiHeroId)
  HERO_CATALOG.require(opponentHeroId)
  const aiDeck = options.aiDeck ?? ['basic_acidic_swamp_ooze']
  const opponentDeck = options.opponentDeck ?? ['basic_acidic_swamp_ooze']
  const decks = [
    fixtureDeck('fixture-deck-local', options.opponentHeroId, opponentDeck),
    fixtureDeck('fixture-deck-ai', options.aiHeroId, aiDeck)
  ] as const
  const setup: MatchSetup = {
    seed: options.seed,
    startingParticipantId: LOCAL_ID,
    skipMulligan: true,
    recordEffectTrace: true,
    participants: [
      {
        participantId: LOCAL_ID,
        controllerKind: 'human',
        heroId: opponentHeroId,
        deckId: decks[0].id
      },
      {
        participantId: AI_ID,
        controllerKind: 'ai',
        heroId: aiHeroId,
        deckId: decks[1].id
      }
    ]
  }
  const initial = createOpeningMatch(setup, decks, createSeededRng(options.seed))
  const checkpoint = initial.getCheckpoint()
  const turnNumber = options.turnNumber ?? 5
  let nextOrdinal = checkpoint.nextEntityOrdinal + 1
  const allocate = (): number => nextOrdinal++

  const makePlayer = (
    player: OpeningPlayerState,
    participantId: PlayerId,
    handIds: readonly AiFixtureCardInput[],
    deckIds: readonly string[],
    boardInputs: readonly AiFixtureMinion[],
    health: number,
    armor: number,
    attack: number,
    maximumMana: number,
    availableMana: number,
    heroPowerCost: number,
    heroPowerAvailable: boolean,
    weaponInput: AiFixtureWeapon | undefined,
    secretsInput: readonly AiFixtureSecret[] | undefined,
    questInput: AiFixtureQuest | undefined,
    fatigueDamage: number,
    deckHasNoDuplicates: boolean | undefined,
    replacementHeroId: string | undefined,
    heroPowerId: string | undefined,
    heroPowerUsesThisTurn: number | undefined,
    cthunInput: AiFixtureOptions['aiCthun'],
    counters: Readonly<Record<string, number>> | undefined,
    graveyardInputs: readonly AiFixtureMinion[] | undefined,
    elementalPlayedLastTurn: boolean | undefined
  ): OpeningPlayerState => {
    const hand = handIds.map((cardId) => makeCard(cardId, participantId, allocate(), 'hand'))
    const deck = deckIds.map((cardId) => makeCard(cardId, participantId, allocate(), 'deck'))
    const board = boardInputs.map((minion) =>
      makeMinion(minion, participantId, turnNumber, allocate())
    )
    const graveyard = (graveyardInputs ?? []).map((minion, index) => ({
      minion: makeMinion(
        { ...minion, health: 0 },
        participantId,
        turnNumber - 1,
        allocate()
      ),
      ownerId: participantId,
      controllerId: participantId,
      diedOnTurn: turnNumber - 1,
      deathOrdinal: index
    }))
    const activeHeroId = asHeroId(replacementHeroId ?? player.heroId)
    const activeHero = HERO_CATALOG.require(activeHeroId)
    const activeHeroPowerId = asHeroPowerId(heroPowerId ?? activeHero.heroPowerId)
    const activeHeroPower = HERO_POWER_CATALOG.require(activeHeroPowerId)
    const heroPower = {
      ...player.heroPower,
      id: activeHeroPowerId,
      cost: heroPowerId || replacementHeroId ? activeHeroPower.cost : heroPowerCost,
      baseCost: heroPowerId || replacementHeroId ? activeHeroPower.cost : heroPowerCost,
      available: heroPowerAvailable,
      usesThisTurn: heroPowerUsesThisTurn ?? 0,
      targetType: activeHeroPower.targeting,
      targetingGranted: activeHeroPower.targeting
    }
    return withQuest(
      {
        ...player,
        heroId: activeHeroId,
        cthun: cthunInput
          ? {
              attack: cthunInput.attack,
              health: cthunInput.health,
              taunt: cthunInput.taunt ?? false
            }
          : undefined,
        elementalPlayedLastTurn,
        hero: {
          ...player.hero,
          health,
          damageTaken: Math.max(0, player.hero.maxHealth - health),
          armor,
          attack,
          baseAttack: attack,
          attacksUsedThisTurn: 0
        },
        deck,
        originalDeckCardIds: deckIds.map(asCardId),
        hand,
        board,
        weapon: weaponInput ? makeWeapon(weaponInput, participantId, allocate()) : null,
        mana: { available: availableMana, maximum: maximumMana },
        heroPower,
        fatigueDamage,
        mulliganConfirmed: true,
        secrets: (secretsInput ?? []).map((secret) =>
          makeSecret(secret, participantId, allocate())
        ),
        graveyard,
        discardedCards: [],
        deckHasNoDuplicates:
          deckHasNoDuplicates ?? new Set(deckIds).size === deckIds.length,
        counters: counters ?? {}
      },
      questInput
    )
  }

  const baseState = resetHistory(checkpoint.state)
  const players = baseState.players
  const localBase = players.find((player) => player.participantId === LOCAL_ID)
  const aiBase = players.find((player) => player.participantId === AI_ID)
  if (!localBase || !aiBase) throw new Error('Fixture participants were not created.')
  const local = makePlayer(
    localBase,
    LOCAL_ID,
    options.opponentHand ?? [],
    opponentDeck,
    options.opponentBoard ?? [],
    options.opponentHealth ?? 30,
    options.opponentArmor ?? 0,
    options.opponentAttack ?? 0,
    options.opponentMaximumMana ?? 0,
    0,
    localBase.heroPower.cost,
    options.opponentHeroPowerAvailable ?? false,
    options.opponentWeapon,
    options.opponentSecrets,
    options.opponentQuest,
    options.opponentFatigueDamage ?? 1,
    undefined,
    options.opponentReplacementHeroId,
    options.opponentHeroPowerId,
    options.opponentHeroPowerUsesThisTurn,
    options.opponentCthun,
    options.opponentCounters,
    options.opponentGraveyard,
    options.opponentElementalPlayedLastTurn
  )
  const ai = makePlayer(
    aiBase,
    AI_ID,
    options.aiHand ?? [],
    aiDeck,
    options.aiBoard ?? [],
    options.aiHealth ?? 30,
    options.aiArmor ?? 0,
    options.aiAttack ?? 0,
    options.aiMaximumMana ?? options.aiMana ?? 0,
    options.aiMana ?? 0,
    options.aiHeroPowerCost ?? aiBase.heroPower.cost,
    options.aiHeroPowerAvailable ?? true,
    options.aiWeapon,
    options.aiSecrets,
    options.aiQuest,
    options.aiFatigueDamage ?? 1,
    options.aiDeckHasNoDuplicates,
    options.aiReplacementHeroId,
    options.aiHeroPowerId,
    options.aiHeroPowerUsesThisTurn,
    options.aiCthun,
    options.aiCounters,
    options.aiGraveyard,
    options.aiElementalPlayedLastTurn
  )
  const configuredAi =
    options.aiTemporaryMana === undefined && options.aiOverloadLocked === undefined
      ? ai
      : {
          ...ai,
          mana: {
            ...ai.mana,
            ...(options.aiTemporaryMana === undefined
              ? {}
              : { temporary: options.aiTemporaryMana }),
            ...(options.aiOverloadLocked === undefined
              ? {}
              : { overloadLocked: options.aiOverloadLocked })
          }
        }
  const discoverCandidates = options.pendingDiscover?.candidates.map((candidate) =>
    makeCard(candidate, AI_ID, allocate(), 'revealed')
  )
  const aiWithPending = discoverCandidates
    ? { ...configuredAi, revealedCards: discoverCandidates }
    : configuredAi
  const pendingDiscover = discoverCandidates
    ? {
        participantId: AI_ID,
        sourceCardInstanceId:
          options.pendingDiscover?.sourceCardInstanceId ?? `${AI_ID}:fixture-discover-source`,
        candidates: discoverCandidates,
        ...(options.pendingDiscover?.sourceCardId
          ? { publicSourceCardId: asCardId(options.pendingDiscover.sourceCardId) }
          : {}),
        origin: options.pendingDiscover?.origin ?? 'generated'
      }
    : undefined
  const pendingChoiceOptions = options.pendingCardChoice?.options.map((option) => ({
    choice: option.choice,
    label: option.label,
    ...(option.presentationCardId
      ? { presentationCardId: asCardId(option.presentationCardId) }
      : {}),
    ...(option.presentationCost === undefined
      ? {}
      : { presentationCost: option.presentationCost })
  }))
  const pendingCardChoice = options.pendingCardChoice
    ? {
        participantId: AI_ID,
        sourceCardInstanceId:
          options.pendingCardChoice.sourceCardInstanceId ??
          (options.pendingCardChoice.targetCardId
            ? aiWithPending.board.find(
                (entry) => entry.cardId === options.pendingCardChoice!.targetCardId
              )?.instanceId ?? `${AI_ID}:fixture-choice-source`
            : `${AI_ID}:fixture-choice-source`),
        sourceCardId: asCardId(options.pendingCardChoice.sourceCardId),
        options: pendingChoiceOptions ?? [],
        ...(options.pendingCardChoice.resolution
          ? {
              resolution:
                options.pendingCardChoice.resolution.type === 'adapt' &&
                options.pendingCardChoice.targetCardId
                  ? {
                      ...options.pendingCardChoice.resolution,
                      targetInstanceIds: [
                        aiWithPending.board.find(
                          (entry) =>
                            entry.cardId === options.pendingCardChoice!.targetCardId
                        )?.instanceId ??
                          options.pendingCardChoice.resolution.targetInstanceIds[0]!
                      ]
                    }
                  : options.pendingCardChoice.resolution
            }
          : {})
      }
    : undefined
  const state: OpeningMatchState = {
    ...baseState,
    phase: 'turns',
    activePlayerId: AI_ID,
    turnNumber,
    winnerId: null,
    loserId: null,
    players: [local, aiWithPending],
    revision: baseState.revision + 1,
    nextEntityOrdinal: nextOrdinal,
    turnStartedAtRevision: baseState.revision + 1,
    ...(pendingDiscover ? { pendingDiscover } : {}),
    ...(pendingCardChoice ? { pendingCardChoice } : {})
  }
  const directCheckpoint: OpeningMatchCheckpoint = {
    ...checkpoint,
    state,
    nextEntityOrdinal: nextOrdinal
  }
  // Force an invariant check and derived-state construction before handing the
  // fixture to a renderer session; malformed authored data fails at setup time.
  const restored = createOpeningMatch(
    setup,
    decks,
    createSeededRng(options.seed),
    directCheckpoint
  )
  restored.getState()
  return {
    setup,
    decks,
    checkpoint: directCheckpoint,
    localParticipantId: LOCAL_ID,
    aiParticipantId: AI_ID
  }
}
