import { CARD_CATALOG } from '../../../game/content/cards'
import {
  getExpertDeckStrategyProfile,
  type ExpertDeckStrategyBinding,
  type ExpertDeckStrategyFeature,
  type ExpertDeckStrategyProfile
} from '../../../game/decks/expert-deck-strategy'
import type { AiObservation, AiObservedPlayer } from '../../../game/match/ai'
import type { OpeningCard } from '../../../game/match/opening-match-types'

interface CardStrategyFacts {
  readonly cost: number
  readonly expensiveMinion: boolean
  readonly boardBuff: boolean
  readonly cthunThresholds: readonly number[]
  readonly jade: boolean
}

const cardFactsCache = new Map<string, CardStrategyFacts>()

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Inspect implemented effects once per card, never parse display rules text. */
function cardFacts(cardId: string): CardStrategyFacts {
  const cached = cardFactsCache.get(cardId)
  if (cached) return cached
  const definition = CARD_CATALOG.get(cardId)
  let boardBuff = false
  let jade = false
  const thresholds = new Set<number>()
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    const entry = record(value)
    if (!Object.keys(entry).length) return
    const target = record(entry.target)
    if (
      entry.action === 'modify' &&
      target.controller === 'self' &&
      target.type === 'minion' &&
      target.selection === 'all' &&
      number(entry.attack) > 0
    )
      boardBuff = true
    if (entry.action === 'summon-jade-golem' && entry.player === 'self') jade = true
    if (
      entry.type === 'cthun-attack-at-least' &&
      (entry.player === undefined || entry.player === 'self') &&
      number(entry.value) > 0
    )
      thresholds.add(number(entry.value))
    Object.values(entry).forEach(inspect)
  }
  for (const effect of definition?.effects ?? []) {
    const trigger = record(effect).trigger
    if (trigger === 'cast' || trigger === 'battlecry') inspect(effect)
  }
  const facts: CardStrategyFacts = {
    cost: definition?.cost ?? 0,
    expensiveMinion: definition?.type === 'Minion' && definition.cost >= 6,
    boardBuff,
    cthunThresholds: [...thresholds],
    jade
  }
  cardFactsCache.set(cardId, facts)
  return facts
}

export interface ExpertDeckEvaluation {
  readonly profileId: string
  readonly version: number
  readonly adjustment: number
  readonly safetyFactor: number
  readonly features: readonly {
    readonly id: ExpertDeckStrategyFeature
    readonly contribution: number
  }[]
}

type KnownDeckCard = Pick<OpeningCard, 'cardId' | 'startedInDeck' | 'knownTo'>

/** Only own unordered card counts and a fair observation enter this evaluator. */
export class ExpertDeckEvaluator {
  private readonly profile: ExpertDeckStrategyProfile

  private constructor(private readonly binding: ExpertDeckStrategyBinding) {
    this.profile = getExpertDeckStrategyProfile(binding)!
  }

  static create(
    binding: ExpertDeckStrategyBinding | undefined
  ): ExpertDeckEvaluator | null {
    return binding && getExpertDeckStrategyProfile(binding)
      ? new ExpertDeckEvaluator(binding)
      : null
  }

  evaluate(
    observation: AiObservation,
    ownRemainingCards: readonly KnownDeckCard[]
  ): ExpertDeckEvaluation {
    const self = observation.players.find(
      (player) =>
        player.participantId === this.binding.participantId && player.role === 'self'
    )
    const remaining = new Map<string, number>()
    // Commutative counts: neither the next draw nor deck order is consulted.
    for (const card of self ? ownRemainingCards : []) {
      if (!card.startedInDeck && !card.knownTo?.includes(this.binding.participantId))
        continue
      remaining.set(card.cardId, (remaining.get(card.cardId) ?? 0) + 1)
    }
    const safetyFactor = self ? this.safetyFactor(observation, self) : 0
    const features = this.profile.features.map((feature) => ({
      id: feature.id,
      contribution: self
        ? feature.weight * this.featureValue(feature.id, self, remaining) * safetyFactor
        : 0
    }))
    return {
      profileId: this.profile.id,
      version: this.profile.version,
      adjustment: Math.min(
        this.profile.maximumAdjustment,
        features.reduce((sum, feature) => sum + feature.contribution, 0)
      ),
      safetyFactor,
      features
    }
  }

  private safetyFactor(observation: AiObservation, self: AiObservedPlayer): number {
    const opponent = observation.players.find((player) => player.role === 'opponent')
    const health = number(self.hero.health) + number(self.hero.armor)
    // Conservative public attack envelope. Do not speculate about concealed removal.
    const attack =
      (opponent?.board.reduce((sum, minion) => sum + Math.max(0, minion.attack), 0) ??
        0) + Math.max(number(opponent?.hero.attack), number(opponent?.weapon?.attack))
    if (health <= Math.max(8, attack)) return 0
    return Math.min(1, (health - Math.max(8, attack)) / 8)
  }

  private accessibility(cost: number, self: AiObservedPlayer): number {
    const nextMana = Math.min(10, self.mana.maximum + 1)
    return Math.max(0, Math.min(1, (nextMana - cost + 3) / 3))
  }

  private drawAvailability(copies: number, self: AiObservedPlayer): number {
    // Undrawn cards are uncertain; extra shuffled copies have diminishing value.
    return Math.min(0.45, (copies * 2) / Math.max(4, self.deckSize))
  }

  private opportunities(
    self: AiObservedPlayer,
    remaining: ReadonlyMap<string, number>,
    matches: (facts: CardStrategyFacts) => boolean,
    includeHand = true
  ): number {
    let value = 0
    if (includeHand)
      for (const card of self.hand) {
        const facts = cardFacts(card.cardId)
        if (matches(facts))
          value += this.accessibility(card.currentCost ?? facts.cost, self)
      }
    for (const [cardId, copies] of remaining) {
      const facts = cardFacts(cardId)
      if (matches(facts))
        value +=
          this.drawAvailability(copies, self) * this.accessibility(facts.cost, self)
    }
    return value / (1 + value)
  }

  private featureValue(
    feature: ExpertDeckStrategyFeature,
    self: AiObservedPlayer,
    remaining: ReadonlyMap<string, number>
  ): number {
    switch (feature) {
      case 'ramp-readiness':
        // The existing scorer values available mana; this values permanent access
        // to unspent expensive threats, with no bonus for an exhausted payoff.
        return this.opportunities(self, remaining, (facts) => facts.expensiveMinion)
      case 'board-buff-potential': {
        // Future undrawn buffs only: an in-hand buff's immediate effect is already
        // simulated and scored by the existing board evaluator.
        const board = Math.min(3, self.board.length) / 3
        return (
          board * this.opportunities(self, remaining, (facts) => facts.boardBuff, false)
        )
      }
      case 'cthun-thresholds': {
        const definition = CARD_CATALOG.get('whispers_of_the_old_gods_cthun')
        const baseAttack = definition?.type === 'Minion' ? definition.attack : 0
        const attack = baseAttack + number(self.effects.cthun?.attack)
        // Generic C'Thun stats and hand thresholds already have existing scores.
        // Add only readiness of still-undrawn conditional payoffs.
        return this.opportunities(
          self,
          remaining,
          (facts) => facts.cthunThresholds.some((threshold) => attack >= threshold),
          false
        )
      }
      case 'jade-followups': {
        const nextSize = number(self.effects.counters?.['jade-golem-size'], 1)
        const growth = Math.min(6, Math.max(0, nextSize - 1)) / 6
        // Count future summons, not the Jade minions already valued on the board.
        return growth * this.opportunities(self, remaining, (facts) => facts.jade)
      }
    }
  }
}
