import { CARD_CATALOG } from '../../content/cards'
import { HERO_CATALOG } from '../../content/heroes'
import type { OpeningMatchPublicEvent, OpeningMatchState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { AiResourceReleaseTrigger, AiStrategicPlanView } from './ai-types'

export type AiOpponentPosture =
  'aggression' | 'tempo' | 'control' | 'value' | 'survival' | 'combo-preparation'

export interface AiStrategicEvidence {
  readonly key: string
  readonly revision: number
  readonly posture: AiOpponentPosture
  readonly summary: string
  readonly cardId: string | null
}

export interface AiOpponentHypothesis {
  readonly posture: AiOpponentPosture
  readonly confidence: number
  readonly evidenceKeys: readonly string[]
}

export interface AiComboStatus {
  readonly purpose: string
  readonly cardIds: readonly string[]
  readonly heldPieces: number
  readonly deployedPieces: number
  readonly readyPieces: number
  readonly requiredPieces: number
  readonly viable: boolean
  readonly ready: boolean
}

export interface AiResourceStatus {
  readonly cardIds: readonly string[]
  readonly heldCardIds: readonly string[]
  readonly active: boolean
  readonly releasedBy: readonly AiResourceReleaseTrigger[]
}

export interface AiStrategicSnapshot {
  readonly memoryVersion: 1
  readonly revision: number
  readonly comboViability: number
  readonly combos: readonly AiComboStatus[]
  readonly resources: readonly AiResourceStatus[]
  readonly heldReservedResources: readonly string[]
  readonly activeReservedCardIds: readonly string[]
  readonly observedOpponentCardIds: readonly string[]
  readonly opponentHypotheses: readonly AiOpponentHypothesis[]
  readonly possibleOpponentSecretCardIds: readonly string[]
  readonly ruledOutOpponentSecretCardIds: readonly string[]
  readonly evidence: readonly AiStrategicEvidence[]
  readonly reviewReasons: readonly string[]
  readonly evidenceFingerprint: string
}

const POSTURES: readonly AiOpponentPosture[] = [
  'aggression',
  'tempo',
  'control',
  'value',
  'survival',
  'combo-preparation'
]
const STRATEGY_REVIEW_EVIDENCE_THRESHOLD = 2
const MAX_BOARD_SIZE = 7
const MAX_HAND_SIZE = 10

function countCards(cardIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cardId of cardIds) counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
  return counts
}

function evidenceCardId(event: OpeningMatchPublicEvent): string | null {
  if (event.type === 'history-action-resolved') return event.source.cardId
  if (event.type === 'minion-played') return String(event.minion.cardId)
  if (event.type === 'weapon-equipped') return String(event.weapon.cardId)
  if (event.type === 'effect-resolved') return event.sourceCardId
  if (event.type === 'card-burned') return event.card.cardId
  return null
}

/**
 * Match-scoped deterministic strategic memory. It consumes the public event
 * projection and never reads opposing hidden cards, deck identities, secret
 * identities, or deck order.
 */
export class AiStrategicTracker {
  private snapshotValue: AiStrategicSnapshot
  private processedEventCount = 0
  private readonly evidenceValue: AiStrategicEvidence[] = []
  private readonly observedOpponentCards = new Set<string>()
  private readonly postureScores = new Map<AiOpponentPosture, number>(
    POSTURES.map((posture) => [posture, 0])
  )
  private readonly pendingReviewReasons = new Set<string>()
  private readonly unreviewedEvidenceSummaries = new Set<string>()
  private unreviewedEvidenceWeight = 0
  private readonly ruledOutSecretCards = new Set<string>()
  private previousOpponentSecretCount: number

  constructor(
    private readonly perspectivePlayerId: PlayerId,
    private plan: AiStrategicPlanView,
    initialState: OpeningMatchState
  ) {
    this.previousOpponentSecretCount = this.opponentSecretCount(initialState)
    this.snapshotValue = this.compute(initialState)
  }

  get snapshot(): AiStrategicSnapshot {
    return structuredClone(this.snapshotValue)
  }

  markReviewed(evidenceFingerprint: string): void {
    if (evidenceFingerprint !== this.snapshotValue.evidenceFingerprint) return
    this.pendingReviewReasons.clear()
    this.unreviewedEvidenceSummaries.clear()
    this.unreviewedEvidenceWeight = 0
    this.snapshotValue = { ...this.snapshotValue, reviewReasons: [] }
  }

  replacePlan(plan: AiStrategicPlanView, state: OpeningMatchState): void {
    this.plan = plan
    this.snapshotValue = this.compute(state)
  }

  update(
    state: OpeningMatchState,
    publicEvents: readonly OpeningMatchPublicEvent[] = []
  ): AiStrategicSnapshot {
    if (state.revision < this.snapshotValue.revision) {
      throw new Error('AI strategic tracker cannot move to an older revision.')
    }
    const opponentSecretCount = this.opponentSecretCount(state)
    const canRuleOutSecrets =
      opponentSecretCount > 0 &&
      opponentSecretCount === this.previousOpponentSecretCount
    if (opponentSecretCount !== this.previousOpponentSecretCount) {
      // A reveal or a newly played secret starts a fresh belief set for the
      // currently facedown entities; deductions cannot be transferred safely.
      this.ruledOutSecretCards.clear()
    }
    this.consumePublicEvents(state, publicEvents, canRuleOutSecrets)
    this.previousOpponentSecretCount = opponentSecretCount
    const previousActive = new Set(this.snapshotValue.activeReservedCardIds)
    const previousCombos = new Map(
      this.snapshotValue.combos.map((combo) => [
        `${combo.purpose}:${combo.cardIds.join('|')}`,
        combo
      ])
    )
    this.snapshotValue = this.compute(state)
    if (
      previousActive.size !== this.snapshotValue.activeReservedCardIds.length ||
      [...previousActive].some(
        (cardId) => !this.snapshotValue.activeReservedCardIds.includes(cardId)
      )
    ) {
      this.pendingReviewReasons.add('A reserved-resource release state changed.')
      this.snapshotValue = this.compute(state)
    }
    for (const combo of this.snapshotValue.combos) {
      const previous = previousCombos.get(`${combo.purpose}:${combo.cardIds.join('|')}`)
      if (previous && !previous.ready && combo.ready) {
        this.pendingReviewReasons.add(`A planned combo became ready: ${combo.purpose}`)
      }
      if (previous?.viable && !combo.viable) {
        this.pendingReviewReasons.add(
          `A planned combo is no longer viable: ${combo.purpose}`
        )
      }
    }
    if (this.snapshotValue.reviewReasons.length !== this.pendingReviewReasons.size) {
      this.snapshotValue = this.compute(state)
    }
    return this.snapshot
  }

  private addEvidence(
    revision: number,
    eventIndex: number,
    posture: AiOpponentPosture,
    summary: string,
    cardId: string | null,
    weight = 1
  ): void {
    const key = `${revision}:${eventIndex}:${posture}:${cardId ?? 'none'}`
    if (this.evidenceValue.some((entry) => entry.key === key)) return
    this.evidenceValue.push({ key, revision, posture, summary, cardId })
    if (this.evidenceValue.length > 64) this.evidenceValue.shift()
    this.postureScores.set(posture, (this.postureScores.get(posture) ?? 0) + weight)
    this.unreviewedEvidenceWeight += weight
    this.unreviewedEvidenceSummaries.add(summary)
    if (this.unreviewedEvidenceSummaries.size > 16) {
      const oldest = this.unreviewedEvidenceSummaries.values().next().value
      if (oldest) this.unreviewedEvidenceSummaries.delete(oldest)
    }
    if (
      weight >= 1.5 ||
      this.unreviewedEvidenceWeight >= STRATEGY_REVIEW_EVIDENCE_THRESHOLD
    ) {
      for (const reason of this.unreviewedEvidenceSummaries) {
        this.pendingReviewReasons.add(reason)
      }
    }
  }

  private consumePublicEvents(
    state: OpeningMatchState,
    events: readonly OpeningMatchPublicEvent[],
    canRuleOutSecrets: boolean
  ): void {
    const revision = state.revision
    if (events.length < this.processedEventCount) this.processedEventCount = 0
    for (let index = this.processedEventCount; index < events.length; index += 1) {
      const event = events[index]!
      const participantId =
        'participantId' in event && typeof event.participantId === 'string'
          ? event.participantId
          : 'controllerId' in event && typeof event.controllerId === 'string'
            ? event.controllerId
            : null
      if (participantId === this.perspectivePlayerId) {
        if (canRuleOutSecrets && event.type === 'history-action-resolved') {
          this.ruleOutSecretsFromAction(event, state)
        }
        continue
      }
      const cardId = evidenceCardId(event)
      if (cardId) this.observedOpponentCards.add(cardId)
      if (event.type !== 'history-action-resolved') {
        if (cardId) {
          this.addEvidence(
            revision,
            index,
            'tempo',
            `Opponent revealed ${cardId}.`,
            cardId,
            0.5
          )
        }
        continue
      }
      const damagesHero = event.outcomes.some(
        (outcome) =>
          outcome.kind === 'damage' &&
          outcome.target.participantId === this.perspectivePlayerId &&
          outcome.target.kind === 'hero'
      )
      const removesBoard = event.outcomes.some(
        (outcome) =>
          (outcome.kind === 'death' || outcome.kind === 'destroy') &&
          outcome.target.participantId === this.perspectivePlayerId
      )
      const gainsCards = event.outcomes.some(
        (outcome) => outcome.kind === 'draw' || outcome.kind === 'create-hand'
      )
      const protectsSelf = event.outcomes.some(
        (outcome) =>
          (outcome.kind === 'heal' || outcome.kind === 'armor') &&
          outcome.target.participantId !== this.perspectivePlayerId
      )
      const sourceDefinition = cardId ? CARD_CATALOG.get(cardId) : undefined
      const preparesCombo =
        /"action":"(?:add-to-hand|change-cost|copy|discover|draw|draw-until|set-hero-power-drawn-card-cost)"/.test(
          JSON.stringify(sourceDefinition?.effects ?? [])
        )
      if (damagesHero)
        this.addEvidence(
          revision,
          index,
          'aggression',
          'Opponent converted resources into hero damage.',
          cardId,
          1.5
        )
      if (removesBoard)
        this.addEvidence(
          revision,
          index,
          'control',
          'Opponent spent resources controlling the board.',
          cardId
        )
      if (gainsCards)
        this.addEvidence(
          revision,
          index,
          'value',
          'Opponent invested in additional cards or choices.',
          cardId
        )
      if (protectsSelf)
        this.addEvidence(
          revision,
          index,
          'survival',
          'Opponent prioritized health or armor.',
          cardId
        )
      if (preparesCombo)
        this.addEvidence(
          revision,
          index,
          'combo-preparation',
          'Opponent invested in a structured draw, copy, generation, or cost setup.',
          cardId,
          0.6
        )
      if (!damagesHero && !removesBoard && !gainsCards && !protectsSelf && cardId)
        this.addEvidence(
          revision,
          index,
          'tempo',
          `Opponent developed ${cardId}.`,
          cardId,
          0.5
        )
    }
    this.processedEventCount = events.length
  }

  private opponentSecretCount(state: OpeningMatchState): number {
    return (
      state.players.find((player) => player.participantId !== this.perspectivePlayerId)
        ?.secrets?.length ?? 0
    )
  }

  private ruleOutSecretsFromAction(
    event: Extract<OpeningMatchPublicEvent, { type: 'history-action-resolved' }>,
    state: OpeningMatchState
  ): void {
    const eventControllers = new Map<string, 'self' | 'opponent'>()
    const sourceDefinition = event.source.cardId
      ? CARD_CATALOG.get(event.source.cardId)
      : undefined
    if (event.action === 'card' && sourceDefinition?.type === 'Spell') {
      eventControllers.set('spell-cast', 'opponent')
      if (event.outcomes.some((outcome) => outcome.target.kind === 'minion'))
        eventControllers.set('spell-targeted-minion', 'opponent')
    }
    if (event.action === 'card' && sourceDefinition?.type === 'Minion')
      eventControllers.set('minion-played', 'opponent')
    if (event.action === 'hero-power')
      eventControllers.set('hero-power-used', 'opponent')
    if (event.action === 'combat') {
      const hitOpponentHero = event.outcomes.some(
        (outcome) =>
          outcome.kind === 'damage' &&
          outcome.target.kind === 'hero' &&
          outcome.target.participantId !== this.perspectivePlayerId
      )
      if (hitOpponentHero) {
        eventControllers.set('character-attacked', 'self')
        eventControllers.set('hero-attacked', 'self')
        if (event.source.kind === 'minion')
          eventControllers.set('minion-attacks-hero', 'opponent')
      }
      const hitOpponentMinion = event.outcomes.some(
        (outcome) =>
          outcome.kind === 'damage' &&
          outcome.target.kind === 'minion' &&
          outcome.target.participantId !== this.perspectivePlayerId
      )
      if (hitOpponentMinion) {
        eventControllers.set('character-attacked', 'self')
        eventControllers.set('friendly-minion-attacked', 'self')
        if (event.source.kind === 'minion')
          eventControllers.set('minion-attacked', 'opponent')
      }
    }
    if (eventControllers.size === 0) return
    const opponent = state.players.find(
      (player) => player.participantId !== this.perspectivePlayerId
    )
    if (!opponent) return
    const opponentClass = HERO_CATALOG.require(opponent.heroId).classId
    const newlyRuledOut: string[] = []
    for (const definition of CARD_CATALOG.all) {
      if (
        !definition.keywords?.includes('secret') ||
        definition.cardClass !== opponentClass
      )
        continue
      const necessarilyTriggers = (definition.effects ?? []).some((block) => {
        if (block.trigger !== 'secret' || !block.event || block.condition) return false
        const triggerEvent = block.event as unknown as Record<string, unknown>
        const keys = Object.keys(triggerEvent)
        const eventMatches =
          typeof triggerEvent['type'] === 'string' &&
          eventControllers.get(triggerEvent['type']) === triggerEvent['controller'] &&
          keys.every((key) => key === 'type' || key === 'controller')
        if (!eventMatches) return false
        // A matching Secret stays facedown if none of its actions can affect
        // the live state. Preserve that possibility instead of making a false
        // deduction from, for example, Mirror Entity against a full board.
        return (block.actions ?? []).some((rawAction) => {
          const action = rawAction as Record<string, unknown>
          if (action['action'] === 'reveal') return false
          if (
            action['action'] === 'summon' ||
            action['action'] === 'summon-copy' ||
            action['action'] === 'resurrect'
          )
            return opponent.board.length < MAX_BOARD_SIZE
          if (action['action'] === 'copy' && action['destination'] !== 'deck')
            return opponent.hand.length < MAX_HAND_SIZE
          return true
        })
      })
      if (necessarilyTriggers && !this.ruledOutSecretCards.has(String(definition.id))) {
        this.ruledOutSecretCards.add(String(definition.id))
        newlyRuledOut.push(String(definition.id))
      }
    }
    if (newlyRuledOut.length > 0) {
      this.pendingReviewReasons.add(
        `Public testing ruled out secret possibilities: ${newlyRuledOut.sort().join(', ')}.`
      )
    }
  }

  private compute(state: OpeningMatchState): AiStrategicSnapshot {
    const self = state.players.find(
      (player) => player.participantId === this.perspectivePlayerId
    )
    const opponent = state.players.find(
      (player) => player.participantId !== this.perspectivePlayerId
    )
    if (!self || !opponent)
      throw new Error('AI strategic tracker perspective is invalid.')

    const held = countCards(self.hand.map((card) => String(card.cardId)))
    const deployed = countCards(self.board.map((minion) => String(minion.cardId)))
    const prepared = countCards([
      ...self.hand.map((card) => String(card.cardId)),
      ...self.board.map((minion) => String(minion.cardId))
    ])
    const available = countCards([
      ...self.hand.map((card) => String(card.cardId)),
      ...self.deck.map((card) => String(card.cardId)),
      ...self.board.map((minion) => String(minion.cardId))
    ])
    const combos: AiComboStatus[] = (this.plan.selfCombos ?? []).map((combo) => {
      const required = countCards(combo.cardIds)
      const heldPieces = [...required.entries()].reduce(
        (total, [cardId, count]) => total + Math.min(count, held.get(cardId) ?? 0),
        0
      )
      const deployedPieces = [...required.entries()].reduce(
        (total, [cardId, count]) => total + Math.min(count, deployed.get(cardId) ?? 0),
        0
      )
      const readyPieces = [...required.entries()].reduce(
        (total, [cardId, count]) => total + Math.min(count, prepared.get(cardId) ?? 0),
        0
      )
      const viable = [...required.entries()].every(
        ([cardId, count]) => (available.get(cardId) ?? 0) >= count
      )
      return {
        purpose: combo.purpose,
        cardIds: combo.cardIds,
        heldPieces,
        deployedPieces,
        readyPieces,
        requiredPieces: combo.cardIds.length,
        viable,
        ready: viable && readyPieces === combo.cardIds.length
      }
    })
    const comboViability =
      combos.length === 0
        ? 1
        : Math.max(
            ...combos.map((combo) =>
              combo.viable ? combo.readyPieces / Math.max(1, combo.requiredPieces) : 0
            )
          )
    const selfEffectiveHealth = self.hero.health + self.hero.armor
    const opponentEffectiveHealth = opponent.hero.health + opponent.hero.armor
    const publicIncomingAttack =
      opponent.board.reduce((total, minion) => total + Math.max(0, minion.attack), 0) +
      Math.max(0, opponent.weapon?.attack ?? 0) +
      Math.max(0, opponent.hero.attack)
    const availableReach =
      self.board.reduce((total, minion) => total + Math.max(0, minion.attack), 0) +
      Math.max(0, self.weapon?.attack ?? 0) +
      Math.max(0, self.hero.attack)
    const globalTriggers = new Set<AiResourceReleaseTrigger>()
    if (opponentEffectiveHealth <= availableReach) globalTriggers.add('lethal')
    if (selfEffectiveHealth <= Math.max(8, publicIncomingAttack))
      globalTriggers.add('forced-survival')
    if (publicIncomingAttack >= Math.max(5, selfEffectiveHealth * 0.5))
      globalTriggers.add('critical-threat')

    const resources: AiResourceStatus[] = (this.plan.resourceRules ?? []).map(
      (rule) => {
        const relatedCombos = combos.filter((combo) =>
          combo.cardIds.some((cardId) => rule.cardIds.includes(cardId))
        )
        const releasedBy = rule.releaseTriggers.filter((trigger) => {
          if (trigger === 'redundant-copy') {
            return rule.cardIds.some((cardId) => (held.get(cardId) ?? 0) > 1)
          }
          if (trigger === 'combo-ready') {
            return relatedCombos.some((combo) => combo.ready)
          }
          if (trigger === 'invalidated-combo') {
            return (
              relatedCombos.length > 0 && relatedCombos.every((combo) => !combo.viable)
            )
          }
          return globalTriggers.has(trigger)
        })
        const heldCardIds = rule.cardIds.filter((cardId) => held.has(cardId))
        return {
          cardIds: rule.cardIds,
          heldCardIds,
          active: heldCardIds.length > 0 && releasedBy.length === 0,
          releasedBy
        }
      }
    )
    const fallbackReserved = this.plan.reservedCardIds ?? []
    const activeReservedCardIds = [
      ...new Set(
        resources.length > 0
          ? resources.filter((rule) => rule.active).flatMap((rule) => rule.cardIds)
          : fallbackReserved
      )
    ]
    const heldReservedResources = activeReservedCardIds.filter((cardId) =>
      held.has(cardId)
    )

    const maximumPostureScore = Math.max(
      1,
      ...POSTURES.map((posture) => this.postureScores.get(posture) ?? 0)
    )
    const opponentHypotheses = POSTURES.map((posture) => ({
      posture,
      confidence: Math.min(
        1,
        (this.postureScores.get(posture) ?? 0) / maximumPostureScore
      ),
      evidenceKeys: this.evidenceValue
        .filter((entry) => entry.posture === posture)
        .slice(-8)
        .map((entry) => entry.key)
    })).filter((hypothesis) => hypothesis.confidence > 0)

    const opponentClass = HERO_CATALOG.require(opponent.heroId).classId
    const possibleOpponentSecretCardIds = (opponent.secrets ?? []).some(
      (secret) => !secret.revealed
    )
      ? CARD_CATALOG.all
          .filter(
            (definition) =>
              definition.cardClass === opponentClass &&
              definition.keywords?.includes('secret')
          )
          .map((definition) => String(definition.id))
          .filter((cardId) => !this.ruledOutSecretCards.has(cardId))
          .sort()
      : []
    const evidenceFingerprint = this.evidenceValue.map((entry) => entry.key).join('|')
    return {
      memoryVersion: 1,
      revision: state.revision,
      comboViability,
      combos,
      resources,
      heldReservedResources,
      activeReservedCardIds,
      observedOpponentCardIds: [...this.observedOpponentCards].sort(),
      opponentHypotheses,
      possibleOpponentSecretCardIds,
      ruledOutOpponentSecretCardIds: [...this.ruledOutSecretCards].sort(),
      evidence: [...this.evidenceValue],
      reviewReasons: [...this.pendingReviewReasons],
      evidenceFingerprint
    }
  }
}
