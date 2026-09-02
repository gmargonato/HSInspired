import type { OpeningMatchState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { AiStrategicPlanView } from './ai-types'

export interface AiStrategicSnapshot {
  readonly revision: number
  readonly comboViability: number
  readonly heldReservedResources: readonly string[]
  readonly remainingOpponentThreats: readonly string[]
  readonly releaseConditionsMet: boolean
}

/** Deterministic local memory; update only after an accepted authoritative action. */
export class AiStrategicTracker {
  private snapshotValue: AiStrategicSnapshot

  constructor(
    private readonly perspectivePlayerId: PlayerId,
    private readonly plan: AiStrategicPlanView,
    initialState: OpeningMatchState
  ) {
    this.snapshotValue = this.compute(initialState)
  }

  get snapshot(): AiStrategicSnapshot {
    return structuredClone(this.snapshotValue)
  }

  update(state: OpeningMatchState): AiStrategicSnapshot {
    if (state.revision < this.snapshotValue.revision) {
      throw new Error('AI strategic tracker cannot move to an older revision.')
    }
    this.snapshotValue = this.compute(state)
    return this.snapshot
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
    const held = new Set(self.hand.map((card) => String(card.cardId)))
    const combo = new Set(this.plan.selfComboCardIds ?? [])
    const comboViability =
      combo.size === 0
        ? 1
        : [...combo].filter((cardId) => held.has(cardId)).length / combo.size
    const heldReservedResources = (this.plan.reservedCardIds ?? []).filter((cardId) =>
      held.has(cardId)
    )
    const neutralized = new Set(
      (opponent.graveyard ?? []).map((entry) => String(entry.minion.cardId))
    )
    const remainingOpponentThreats = (this.plan.opponentThreatCardIds ?? []).filter(
      (cardId) => !neutralized.has(cardId)
    )
    const opponentEffectiveHealth = opponent.hero.health + opponent.hero.armor
    const availableReach =
      self.board.reduce((total, minion) => total + minion.attack, 0) +
      (self.weapon?.attack ?? 0)
    return {
      revision: state.revision,
      comboViability,
      heldReservedResources,
      remainingOpponentThreats,
      releaseConditionsMet:
        self.hero.health + self.hero.armor <= 8 ||
        opponentEffectiveHealth <= availableReach ||
        comboViability >= 1
    }
  }
}
