import { CARD_CATALOG, asCardId } from '../../content/cards'
import { HERO_CATALOG } from '../../content/heroes'
import { createSeededRng } from '../rng'
import type { Deck } from '../../decks'
import { generateConstructedOpponent } from '../../decks/opponent-generator'
import { OPPONENT_ARCHETYPES } from '../../decks/opponent-archetypes'
import type {
  OpeningCard,
  OpeningMatchCheckpoint,
  OpeningPlayerState
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

export const EXPERT_FAIR_HYPOTHESIS_PREFIX = 'expert-hidden:'

function eligibleCards(heroId: string) {
  const heroClass = HERO_CATALOG.require(heroId).classId
  return CARD_CATALOG.all.filter(
    (card) =>
      card.collectible &&
      card.deckLegal &&
      !('quest' in card) &&
      (card.cardClass === 'Neutral' || card.cardClass === heroClass)
  )
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    )
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableValue(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function deckOrderKey(card: OpeningCard): string {
  return stableValue(
    Object.fromEntries(
      Object.entries(card).filter(
        ([key]) => !['instanceId', 'creationOrdinal', 'playOrder'].includes(key)
      )
    )
  )
}

function shuffleDeckOrder(
  cards: readonly OpeningCard[],
  next: () => number
): readonly OpeningCard[] {
  const shuffled = [...cards].sort((left, right) =>
    deckOrderKey(left).localeCompare(deckOrderKey(right))
  )
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(next() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!]
  }
  return shuffled
}

function sampleDeck(
  deck: Deck,
  cardPool: ReturnType<typeof eligibleCards>,
  next: () => number,
  count = 30,
  startingCards: Readonly<Record<string, number>> = {}
): Deck {
  const copies = new Map<string, number>(Object.entries(startingCards))
  const cards: Record<string, number> = { ...startingCards }
  const startingCount = Object.values(startingCards).reduce(
    (total, value) => total + value,
    0
  )
  for (let index = startingCount; index < count; index++) {
    const available = cardPool.filter((card) => {
      const limit = card.rarity === 'Legendary' ? 1 : 2
      return (copies.get(card.id) ?? 0) < limit
    })
    const candidate = available[Math.floor(next() * available.length)]
    if (!candidate) break
    copies.set(candidate.id, (copies.get(candidate.id) ?? 0) + 1)
    cards[candidate.id] = (cards[candidate.id] ?? 0) + 1
  }
  return {
    ...deck,
    name: 'Expert AI public-information hypothesis',
    cards
  }
}

function chooseOpponentArchetype(
  player: OpeningPlayerState,
  perspectivePlayerId: PlayerId,
  next: () => number
) {
  const heroClass = HERO_CATALOG.require(player.heroId).classId
  const candidates = OPPONENT_ARCHETYPES.filter(
    (archetype) => archetype.classId === heroClass
  )
  if (!candidates.length) return undefined

  // Use identities visible in the current public position. Do not inspect the
  // original deck ledger, which would reveal the hidden list we're modeling.
  const evidence = new Set<string>([
    ...player.board.map((minion) => minion.cardId),
    ...player.hand
      .filter((card) => card.knownTo?.includes(perspectivePlayerId))
      .map((card) => card.cardId),
    ...(player.revealedCards ?? []).map((card) => card.cardId),
    ...(player.discardedCards ?? []).map((card) => card.cardId),
    ...(player.secrets ?? [])
      .filter((secret) => secret.revealed)
      .map((secret) => secret.cardId)
  ])
  const weights = candidates.map((archetype) => {
    const matches = archetype.core.reduce(
      (total, core) => total + (evidence.has(core.id) ? core.count : 0),
      0
    )
    return 1 + matches * 5
  })
  let roll = next() * weights.reduce((total, weight) => total + weight, 0)
  for (let index = 0; index < candidates.length; index++) {
    roll -= weights[index]!
    if (roll < 0) return candidates[index]
  }
  return candidates[candidates.length - 1]
}

function knownOriginalCardCounts(
  player: OpeningPlayerState,
  perspectivePlayerId: PlayerId
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  const knownCards = [
    ...player.deck,
    ...player.hand,
    ...(player.revealedCards ?? []),
    ...(player.discardedCards ?? [])
  ].filter(
    (card) =>
      card.knownTo?.includes(perspectivePlayerId) === true &&
      card.startedInDeck !== false
  )
  for (const card of knownCards)
    counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1)
  return counts
}

function includeKnownOriginalCards(
  deck: Deck,
  required: ReadonlyMap<string, number>,
  archetypeCore: readonly { readonly id: string }[],
  cardPool: ReturnType<typeof eligibleCards>,
  targetSize: number,
  next: () => number
): Deck {
  const cards = { ...deck.cards }
  const protectedCards = new Set(archetypeCore.map((card) => card.id))
  const eligibleIds = new Set<string>(cardPool.map((card) => card.id))
  for (const [cardId, requiredCount] of required) {
    const definition = CARD_CATALOG.get(cardId)
    if (!definition || requiredCount > (definition.rarity === 'Legendary' ? 1 : 2))
      continue
    while ((cards[cardId] ?? 0) < requiredCount) {
      const replacement = Object.keys(cards)
        .filter((candidateId) => {
          const candidate = CARD_CATALOG.get(candidateId)
          return (
            eligibleIds.has(candidateId) &&
            !protectedCards.has(candidateId) &&
            candidate?.type !== 'Hero' &&
            !(candidate && 'quest' in candidate) &&
            (cards[candidateId] ?? 0) > (required.get(candidateId) ?? 0)
          )
        })
        .sort(
          (left, right) =>
            (cards[right] ?? 0) - (cards[left] ?? 0) || left.localeCompare(right)
        )[0]
      if (!replacement) {
        // Keep all identities the player is entitled to know. A class-legal
        // filler sample is safer than silently deleting public evidence.
        return sampleDeck(
          deck,
          cardPool,
          next,
          targetSize,
          Object.fromEntries(required)
        )
      }
      cards[replacement] = (cards[replacement] ?? 1) - 1
      if (cards[replacement] === 0) delete cards[replacement]
      cards[cardId] = (cards[cardId] ?? 0) + 1
    }
  }
  return { ...deck, cards }
}

function sampleOpponentDeck(
  deck: Deck,
  player: OpeningPlayerState,
  perspectivePlayerId: PlayerId,
  knownOriginals: ReadonlyMap<string, number>,
  seed: number,
  next: () => number,
  cardPool: ReturnType<typeof eligibleCards>,
  count: number
): Deck {
  const archetype = chooseOpponentArchetype(player, perspectivePlayerId, next)
  if (!archetype)
    return sampleDeck(deck, cardPool, next, count, Object.fromEntries(knownOriginals))

  let generated: Deck
  try {
    generated = generateConstructedOpponent(seed >>> 0, {
      heroId: player.heroId,
      archetypeId: archetype.id
    }).deck
  } catch {
    // A local archetype can become temporarily ineligible after a content
    // adjustment. Keep the search available with a legal class-pool sample.
    return sampleDeck(deck, cardPool, next, count, Object.fromEntries(knownOriginals))
  }
  const withKnownCards = includeKnownOriginalCards(
    generated,
    knownOriginals,
    archetype.core,
    cardPool,
    count,
    next
  )
  // A checkpoint can model an enlarged/custom original list. Preserve its
  // size while keeping the archetype's core intact and using legal filler.
  const sampled = sampleDeck(deck, cardPool, next, count, withKnownCards.cards)
  return {
    ...sampled,
    name: `Expert AI ${archetype.name} hypothesis`
  }
}

/**
 * Replaces concealed opponent cards with deterministic, class-legal hypotheses
 * and shuffles both remaining deck orders before a planning snapshot can leave
 * the renderer. Reapplying this function creates a fresh, independently seeded
 * world while preserving the perspective player's known deck composition.
 */
export function createFairHypothesisCheckpoint(
  source: OpeningMatchCheckpoint,
  perspectivePlayerId: PlayerId,
  seed: number
): OpeningMatchCheckpoint {
  const checkpoint = structuredClone(source)
  const hiddenSetup = checkpoint.setup.participants.find(
    (participant) => participant.participantId !== perspectivePlayerId
  )
  const hiddenPlayer = checkpoint.state.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )
  const perspectivePlayer = checkpoint.state.players.find(
    (player) => player.participantId === perspectivePlayerId
  )
  if (!hiddenSetup || !hiddenPlayer || !perspectivePlayer)
    throw new Error('Expert AI requires a two-player checkpoint and perspective.')

  const pool = eligibleCards(hiddenPlayer.heroId)
  const perspectivePool = eligibleCards(perspectivePlayer.heroId)
  const secretPool = pool.filter((card) => card.keywords.includes('secret'))
  if (!pool.length || !perspectivePool.length)
    throw new Error('No public card pool exists for this hero.')
  const rng = createSeededRng(seed)
  const perspectiveDeckSampleRng = createSeededRng(seed ^ 0x4f574e53)
  const perspectiveDeckOrderRng = createSeededRng(seed ^ 0x4f574e44)
  const hiddenDeckOrderRng = createSeededRng(seed ^ 0x48494444)
  let syntheticOrdinal = 0
  const sampleCard = (
    cardPool: ReturnType<typeof eligibleCards> = pool,
    sampleRng = rng,
    secretsOnly = false
  ) => {
    const cards = secretsOnly
      ? cardPool === pool && secretPool.length
        ? secretPool
        : cardPool.filter((card) => card.keywords.includes('secret'))
      : cardPool
    const candidates = cards.length > 0 ? cards : cardPool
    return candidates[Math.floor(sampleRng.next() * candidates.length)]!
  }

  const hideCard = (
    card: OpeningCard,
    zone: string,
    cardPool: ReturnType<typeof eligibleCards> = pool,
    sampleRng = rng,
    startedInDeck = true
  ): OpeningCard => {
    const knownIdentity = card.knownTo?.includes(perspectivePlayerId) === true
    const definition = knownIdentity
      ? CARD_CATALOG.get(card.cardId)
      : startedInDeck
        ? sampleOriginalCard()
        : sampleCard(cardPool, sampleRng)
    if (!definition) throw new Error('A known hidden card is missing its definition.')
    const {
      attack: _attack,
      health: _health,
      enchantments: _enchantments,
      costAdjustments: _costAdjustments,
      startedInDeck: _startedInDeck,
      creationOrdinal: _creationOrdinal,
      playOrder: _playOrder,
      ...visibleFields
    } = card
    return {
      ...visibleFields,
      instanceId: knownIdentity
        ? card.instanceId
        : `${EXPERT_FAIR_HYPOTHESIS_PREFIX}${zone}:${syntheticOrdinal++}`,
      cardId: definition.id,
      baseCost: definition.cost,
      currentCost: definition.cost,
      startedInDeck,
      ...(knownIdentity ? {} : { knownTo: [], revealed: false })
    }
  }

  const hiddenDeck = checkpoint.decks.find((deck) => deck.id === hiddenSetup.deckId)
  if (!hiddenDeck)
    throw new Error('Expert AI checkpoint is missing the opponent deck snapshot.')
  const sampledDeck = sampleOpponentDeck(
    hiddenDeck,
    hiddenPlayer,
    perspectivePlayerId,
    knownOriginalCardCounts(hiddenPlayer, perspectivePlayerId),
    seed ^ 0x41524348,
    () => rng.next(),
    pool,
    Math.max(30, hiddenPlayer.originalDeckCardIds?.length ?? 30)
  )
  const sampledDeckCardIds = Object.entries(sampledDeck.cards)
    .flatMap(([cardId, count]) => Array.from({ length: count }, () => asCardId(cardId)))
    .sort((left, right) => left.localeCompare(right))
  const unknownOriginalCards = [...sampledDeckCardIds]
  for (let index = unknownOriginalCards.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng.next() * (index + 1))
    ;[unknownOriginalCards[index], unknownOriginalCards[swapIndex]] = [
      unknownOriginalCards[swapIndex]!,
      unknownOriginalCards[index]!
    ]
  }
  for (const [cardId, count] of knownOriginalCardCounts(
    hiddenPlayer,
    perspectivePlayerId
  )) {
    for (let copy = 0; copy < count; copy++) {
      const index = unknownOriginalCards.indexOf(asCardId(cardId))
      if (index < 0)
        throw new Error('Opponent hypothesis omitted a publicly known original card.')
      unknownOriginalCards.splice(index, 1)
    }
  }
  const sampleOriginalCard = () => {
    const cardId = unknownOriginalCards.pop()
    const definition = cardId ? CARD_CATALOG.get(cardId) : undefined
    if (!definition)
      throw new Error('Opponent hypothesis ran out of original-deck cards.')
    return definition
  }

  const sanitizePlayer = (player: OpeningPlayerState): OpeningPlayerState => {
    if (player.participantId === perspectivePlayerId) {
      const { originalDeckCardIds, ...knownPlayer } = player
      const deck = player.deck.map((card, index) =>
        card.startedInDeck || card.knownTo?.includes(perspectivePlayerId)
          ? card
          : hideCard(
              card,
              `perspective-deck:${index}`,
              perspectivePool,
              perspectiveDeckSampleRng,
              false
            )
      )
      return {
        ...knownPlayer,
        deck: shuffleDeckOrder(deck, () => perspectiveDeckOrderRng.next()),
        ...(originalDeckCardIds
          ? {
              originalDeckCardIds: [...originalDeckCardIds].sort((left, right) =>
                left.localeCompare(right)
              )
            }
          : {})
      }
    }
    const { pendingCostModifiers: _pendingCostModifiers, ...publicPlayer } = player
    return {
      ...publicPlayer,
      deck: shuffleDeckOrder(
        player.deck.map((card, index) =>
          hideCard(card, `deck:${index}`, pool, rng, true)
        ),
        () => hiddenDeckOrderRng.next()
      ),
      hand: player.hand.map((card, index) =>
        hideCard(card, `hand:${index}`, pool, rng, card.startedInDeck ?? true)
      ),
      revealedCards: player.revealedCards?.map((card, index) =>
        hideCard(card, `revealed:${index}`, pool, rng, card.startedInDeck ?? true)
      ),
      discardedCards: player.discardedCards?.map((card, index) =>
        hideCard(card, `discarded:${index}`, pool, rng, card.startedInDeck ?? true)
      ),
      secrets: player.secrets?.map((secret, index) => {
        if (secret.revealed) return secret
        return {
          ...secret,
          instanceId: `${EXPERT_FAIR_HYPOTHESIS_PREFIX}secret:${index}`,
          cardId: sampleCard(pool, rng, true).id
        }
      }),
      originalDeckCardIds: sampledDeckCardIds,
      deckHasNoDuplicates: false
    }
  }

  const decks = checkpoint.decks.map((deck) =>
    deck.id === hiddenSetup.deckId ? sampledDeck : deck
  )

  const history = checkpoint.state.history
  const sanitizedHistory = history
    ? {
        ...history,
        cardsPlayedThisGame: history.cardsPlayedThisGame.filter((cardId) => {
          const card = CARD_CATALOG.get(cardId)
          return !card?.keywords.includes('secret')
        })
      }
    : undefined
  return {
    ...checkpoint,
    setup: { ...checkpoint.setup, seed: seed >>> 0 },
    decks,
    state: {
      ...checkpoint.state,
      history: sanitizedHistory,
      players: checkpoint.state.players.map(sanitizePlayer) as [
        OpeningPlayerState,
        OpeningPlayerState
      ],
      openingHistory: undefined,
      effectTrace: undefined
    },
    rngState: seed >>> 0
  }
}
