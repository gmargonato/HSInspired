import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asHeroId, type CardDefinition } from '../../content/cards'
import { HERO_CATALOG } from '../../content/heroes'
import { countDeckCards, DECK_RULES, type Deck } from '../../decks'
import { createOpeningMatch } from '../opening-match'
import type {
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import { asPlayerId, type MatchSetup, type PlayerId } from '../match-types'
import { evaluatePosition } from './evaluator'
import { canonicalCommandKey, enumerateLegalCommands } from './legal-commands'
import { searchCompetitiveTurn } from './search'
import { AiTranspositionCache } from './state-hash'

const RUN_BENCHMARK = process.env['HSINSPIRED_RUN_AI_BENCHMARK'] === '1'
const COMPETITIVE_ID = asPlayerId('benchmark-competitive')
const LEGACY_ID = asPlayerId('benchmark-legacy')

function effectText(card: CardDefinition): string {
  return JSON.stringify(card.effects).toLowerCase()
}

function archetypeScore(card: CardDefinition, archetype: number): number {
  const effects = effectText(card)
  const stats = card.type === 'Minion' ? card.attack + card.health : 0
  switch (archetype) {
    case 0:
      return 30 - card.cost * 4 + stats + (/charge|damage/.test(effects) ? 8 : 0)
    case 1:
      return (
        24 - Math.abs(card.cost - 3) * 3 + stats + (/summon|draw/.test(effects) ? 5 : 0)
      )
    case 2:
      return stats + card.cost + (/buff|modify|summon/.test(effects) ? 7 : 0)
    case 3:
      return card.cost * 2 + (/destroy|damage|heal|armor/.test(effects) ? 12 : 0)
    case 4:
      return (
        (/condition|repeat|draw|discover|freeze/.test(effects) ? 18 : 0) + card.cost
      )
    default:
      return card.cost * 2 + (/draw|heal|armor|fatigue/.test(effects) ? 14 : 0)
  }
}

function benchmarkDeck(heroId: string, archetype: number): Deck {
  const hero = HERO_CATALOG.require(asHeroId(heroId))
  const candidates = CARD_CATALOG.all
    .filter(
      (card) =>
        card.collectible &&
        card.deckLegal &&
        card.rarity !== 'Legendary' &&
        (card.cardClass === 'Neutral' || card.cardClass === hero.classId)
    )
    .sort(
      (left, right) =>
        archetypeScore(right, archetype) - archetypeScore(left, archetype) ||
        String(left.id).localeCompare(String(right.id))
    )
    .slice(0, 15)
  const deck: Deck = {
    id: `bench-${archetype}-${heroId.slice(0, 4)}`,
    name: `Bench ${archetype} ${heroId.slice(0, 4)}`,
    heroId: hero.id,
    cards: Object.fromEntries(candidates.map((card) => [card.id, 2])),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  const errors = DECK_RULES.validate(deck)
  if (countDeckCards(deck) !== 30 || errors.length > 0) {
    throw new Error(`Invalid benchmark deck ${deck.id}: ${errors.join('; ')}`)
  }
  return deck
}

export const COMPETITIVE_BENCHMARK_DECKS = [
  benchmarkDeck('rexxar', 0),
  benchmarkDeck('jaina', 1),
  benchmarkDeck('malfurion', 2),
  benchmarkDeck('garrosh', 3),
  benchmarkDeck('guldan', 4),
  benchmarkDeck('anduin', 5)
] as const

function legacyScore(
  before: OpeningMatchState,
  after: OpeningMatchState,
  perspectiveId: PlayerId
): number {
  const beforeSelf = before.players.find(
    (player) => player.participantId === perspectiveId
  )!
  const beforeEnemy = before.players.find(
    (player) => player.participantId !== perspectiveId
  )!
  const self = after.players.find((player) => player.participantId === perspectiveId)!
  const enemy = after.players.find((player) => player.participantId !== perspectiveId)!
  const health = (player: typeof self): number => player.hero.health + player.hero.armor
  const attack = (player: typeof self): number =>
    player.board.reduce((total, minion) => total + minion.attack, 0)
  const boardHealth = (player: typeof self): number =>
    player.board.reduce((total, minion) => total + minion.health, 0)
  return (
    (after.winnerId === perspectiveId ? 500_000 : 0) -
    (after.loserId === perspectiveId ? 500_000 : 0) +
    (health(self) - health(beforeSelf)) * 12 -
    (health(enemy) - health(beforeEnemy)) * 12 +
    (attack(self) - attack(beforeSelf)) * 8 -
    (attack(enemy) - attack(beforeEnemy)) * 8 +
    (boardHealth(self) - boardHealth(beforeSelf)) * 2 -
    (boardHealth(enemy) - boardHealth(beforeEnemy)) * 2
  )
}

function chooseLegacy(
  match: OpeningMatchInstance,
  participantId: PlayerId,
  rejected: ReadonlySet<string>
): TurnMatchCommand {
  const before = match.getState()
  const commands = match
    .analyze((fork) => enumerateLegalCommands(fork, participantId))
    .filter((command) => !rejected.has(canonicalCommandKey(command)))
  const evaluated = commands.map((command) => {
    const result = match.preview(command)
    return {
      command,
      score: result.accepted
        ? legacyScore(before, result.state, participantId)
        : Number.NEGATIVE_INFINITY
    }
  })
  return (
    evaluated.sort(
      (left, right) =>
        right.score - left.score ||
        canonicalCommandKey(left.command).localeCompare(
          canonicalCommandKey(right.command)
        )
    )[0]?.command ?? { type: 'end-turn', participantId }
  )
}

function chooseCompetitive(
  match: OpeningMatchInstance,
  participantId: PlayerId,
  rejected: ReadonlySet<string>,
  cache: AiTranspositionCache<Readonly<{ readonly score: number }>>
): TurnMatchCommand {
  const commands = match
    .analyze((fork) => enumerateLegalCommands(fork, participantId))
    .filter((command) => !rejected.has(canonicalCommandKey(command)))
  const roots = commands.map((command, index) => ({
    actionId: `benchmark-action-${index}`,
    command
  }))
  const result = searchCompetitiveTurn(
    match,
    participantId,
    roots,
    {
      timeBudgetMs: 60_000,
      nodeLimit: 12,
      atomicDepth: 4,
      ownTurnBeam: 4,
      opponentTurnBeam: 2,
      determinizations: 2,
      randomOutcomeSamples: 2,
      transpositionCapacity: 5_000
    },
    undefined,
    cache
  )
  return (
    result.dossiers[0]?.firstCommand ?? chooseLegacy(match, participantId, rejected)
  )
}

function playGame(
  seed: number,
  competitiveDeck: Deck,
  legacyDeck: Deck,
  swapped: boolean
): 'win' | 'loss' | 'draw' {
  const competitiveSetup = {
    participantId: COMPETITIVE_ID,
    controllerKind: 'ai' as const,
    heroId: competitiveDeck.heroId,
    deckId: competitiveDeck.id
  }
  const legacySetup = {
    participantId: LEGACY_ID,
    controllerKind: 'ai' as const,
    heroId: legacyDeck.heroId,
    deckId: legacyDeck.id
  }
  const setup: MatchSetup = {
    seed,
    participants: swapped
      ? [legacySetup, competitiveSetup]
      : [competitiveSetup, legacySetup]
  }
  const match = createOpeningMatch(setup, [competitiveDeck, legacyDeck])
  for (const participantId of [COMPETITIVE_ID, LEGACY_ID]) {
    const result = match.dispatch({
      type: 'confirm-mulligan',
      participantId,
      replaceInstanceIds: []
    })
    if (!result.accepted) throw new Error(result.message)
  }
  const cache = new AiTranspositionCache<Readonly<{ readonly score: number }>>(5_000)
  let rejectedRevision = -1
  const rejected = new Set<string>()
  for (
    let action = 0;
    action < 400 && match.getState().phase !== 'ended';
    action += 1
  ) {
    const state = match.getState()
    const participantId =
      state.pendingDiscover?.participantId ??
      state.pendingCardChoice?.participantId ??
      state.activePlayerId
    if (!participantId) break
    if (state.revision !== rejectedRevision) {
      rejected.clear()
      rejectedRevision = state.revision
    }
    const command =
      participantId === COMPETITIVE_ID
        ? chooseCompetitive(match, participantId, rejected, cache)
        : chooseLegacy(match, participantId, rejected)
    const result = match.dispatch(command)
    if (!result.accepted) rejected.add(canonicalCommandKey(command))
  }
  const final = match.getState()
  if (final.winnerId === COMPETITIVE_ID) return 'win'
  if (final.loserId === COMPETITIVE_ID) return 'loss'
  return 'draw'
}

describe('competitive AI v2 benchmark', () => {
  const benchmark = RUN_BENCHMARK ? it : it.skip
  benchmark(
    'scores at least 65% over 600 seeded seat-swapped games',
    async () => {
      let wins = 0
      let draws = 0
      for (let pair = 0; pair < 300; pair += 1) {
        const competitiveDeck = COMPETITIVE_BENCHMARK_DECKS[pair % 6]!
        const legacyDeck = COMPETITIVE_BENCHMARK_DECKS[(pair + 1) % 6]!
        for (const swapped of [false, true]) {
          const result = playGame(50_000 + pair, competitiveDeck, legacyDeck, swapped)
          if (result === 'win') wins += 1
          else if (result === 'draw') draws += 1
        }
        // Yield to Vitest's timeout and reporters without changing any game
        // seed, state, or policy decision.
        if (pair % 5 === 4) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
      const score = (wins + draws * 0.5) / 600
      expect(score).toBeGreaterThanOrEqual(0.65)
    },
    30 * 60_000
  )

  it('contains six legal 30-card archetype decks', () => {
    expect(COMPETITIVE_BENCHMARK_DECKS).toHaveLength(6)
    for (const deck of COMPETITIVE_BENCHMARK_DECKS) {
      expect(countDeckCards(deck)).toBe(30)
      expect(DECK_RULES.validate(deck)).toEqual([])
    }
  })

  it('keeps the benchmark evaluator deterministic', () => {
    const deck = COMPETITIVE_BENCHMARK_DECKS[0]
    const opponent = COMPETITIVE_BENCHMARK_DECKS[1]
    const setup: MatchSetup = {
      seed: 99,
      participants: [
        {
          participantId: COMPETITIVE_ID,
          controllerKind: 'ai',
          heroId: deck.heroId,
          deckId: deck.id
        },
        {
          participantId: LEGACY_ID,
          controllerKind: 'ai',
          heroId: opponent.heroId,
          deckId: opponent.id
        }
      ]
    }
    const state = createOpeningMatch(setup, [deck, opponent]).getState()
    expect(evaluatePosition(state, COMPETITIVE_ID)).toEqual(
      evaluatePosition(state, COMPETITIVE_ID)
    )
  })
})
