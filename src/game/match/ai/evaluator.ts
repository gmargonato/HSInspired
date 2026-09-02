import { CARD_CATALOG, type CardDefinition } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type { OpeningMatchState, OpeningPlayerState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { AiEvaluationComponents, AiStrategicPlanView } from './ai-types'

export interface AiEvaluatorWeights {
  readonly version: 2
  readonly components: Readonly<Record<keyof AiEvaluationComponents, number>>
}

export const COMPETITIVE_AI_EVALUATOR_WEIGHTS: AiEvaluatorWeights = {
  version: 2,
  components: {
    terminal: 1,
    lethalPressure: 1.35,
    effectiveHealth: 0.75,
    incomingReach: 1.2,
    boardAttack: 1,
    boardHealth: 0.55,
    boardKeywords: 0.6,
    initiative: 0.5,
    boardSlots: 0.18,
    handQuality: 0.48,
    cardAdvantage: 0.7,
    manaEfficiency: 0.42,
    futureCurve: 0.28,
    weapon: 0.7,
    heroPower: 0.22,
    removal: 0.55,
    draw: 0.4,
    fatigue: 0.75,
    burnRisk: 0.8,
    matchupProgress: 0.52,
    comboProgress: 0.72,
    threatExposure: 0.9,
    reservedResourceCost: 1
  }
}

function clamp(value: number, minimum = -1, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function relative(self: number, opponent: number, scale: number): number {
  return clamp((self - opponent) / scale)
}

function effectiveHealth(player: OpeningPlayerState): number {
  return player.hero.health + player.hero.armor
}

function boardAttack(player: OpeningPlayerState): number {
  return player.board.reduce((total, minion) => total + Math.max(0, minion.attack), 0)
}

/**
 * Attack that can be removed immediately by an unused targeted-damage hero
 * power. This makes setup actions legible to the evaluator: reducing a large
 * threat to one health is valuable when the remaining mana can finish it.
 * Only guaranteed, currently affordable damage is counted.
 */
function immediatelyAnswerableAttack(
  state: OpeningMatchState,
  self: OpeningPlayerState,
  opponent: OpeningPlayerState
): number {
  if (state.activePlayerId !== self.participantId || !self.heroPower.available) return 0
  const power = HERO_POWER_CATALOG.get(self.heroPower.id)
  if (power?.effect.kind !== 'damage-character') return 0
  if (self.heroPower.cost > self.mana.available) return 0
  const damage = self.heroPower.effectOverride?.damage ?? power.effect.amount
  return opponent.board.reduce(
    (best, minion) =>
      minion.health <= damage ? Math.max(best, Math.max(0, minion.attack)) : best,
    0
  )
}

function boardHealth(player: OpeningPlayerState): number {
  return player.board.reduce((total, minion) => total + Math.max(0, minion.health), 0)
}

function keywordValue(player: OpeningPlayerState): number {
  return player.board.reduce((total, minion) => {
    const keywords = new Set(minion.keywords ?? [])
    return (
      total +
      (keywords.has('taunt') ? 1.2 : 0) +
      (keywords.has('divine-shield') || minion.divineShield ? 1.1 : 0) +
      (keywords.has('windfury') ? 0.8 : 0) +
      (keywords.has('charge') ? 0.5 : 0) +
      (keywords.has('stealth') || minion.stealth ? 0.45 : 0) +
      ((minion.deathrattles?.length ?? 0) > 0 ? 0.35 : 0)
    )
  }, 0)
}

function serializedEffects(definition: CardDefinition | undefined): string {
  return definition ? JSON.stringify(definition.effects).toLowerCase() : ''
}

function handFeature(player: OpeningPlayerState, pattern: RegExp): number {
  return player.hand.reduce((total, card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    return total + (pattern.test(serializedEffects(definition)) ? 1 : 0)
  }, 0)
}

function handQuality(player: OpeningPlayerState): number {
  if (player.hand.length === 0) return 0
  const usable = player.hand.filter(
    (card) =>
      (card.currentCost ?? CARD_CATALOG.get(card.cardId)?.cost ?? 99) <=
      player.mana.available
  ).length
  const curve = player.hand.reduce((total, card) => {
    const cost = card.currentCost ?? CARD_CATALOG.get(card.cardId)?.cost ?? 10
    return (
      total +
      Math.max(0, 1 - Math.abs(cost - Math.min(10, player.mana.maximum + 1)) / 10)
    )
  }, 0)
  return usable * 0.7 + curve / player.hand.length
}

function comboProgress(player: OpeningPlayerState, plan?: AiStrategicPlanView): number {
  const combo = new Set(plan?.selfComboCardIds ?? [])
  if (combo.size === 0) return 0
  const held = new Set(player.hand.map((card) => String(card.cardId)))
  return [...combo].filter((cardId) => held.has(cardId)).length / combo.size
}

function matchupProgress(
  opponent: OpeningPlayerState,
  plan?: AiStrategicPlanView
): number {
  const threats = new Set(plan?.opponentThreatCardIds ?? [])
  if (threats.size === 0) return 0
  const neutralized = (opponent.graveyard ?? []).filter((entry) =>
    threats.has(String(entry.minion.cardId))
  ).length
  return clamp(neutralized / threats.size, 0, 1)
}

function reservedResourceCost(
  player: OpeningPlayerState,
  plan?: AiStrategicPlanView
): number {
  const reserved = new Set(plan?.reservedCardIds ?? [])
  if (reserved.size === 0) return 0
  const remaining = player.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  return clamp((reserved.size - remaining) / reserved.size, 0, 1)
}

export function evaluatePosition(
  state: OpeningMatchState,
  perspectivePlayerId: PlayerId,
  plan?: AiStrategicPlanView,
  weights: AiEvaluatorWeights = COMPETITIVE_AI_EVALUATOR_WEIGHTS
): Readonly<{ readonly score: number; readonly components: AiEvaluationComponents }> {
  const self = state.players.find(
    (player) => player.participantId === perspectivePlayerId
  )
  const opponent = state.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )
  if (!self || !opponent)
    throw new Error('AI evaluator perspective is not in the match.')
  const selfAttack = boardAttack(self)
  const opponentAttack = boardAttack(opponent)
  const projectedOpponentAttack = Math.max(
    0,
    opponentAttack - immediatelyAnswerableAttack(state, self, opponent)
  )
  const selfWeapon = self.weapon ? self.weapon.attack * self.weapon.durability : 0
  const opponentWeapon = opponent.weapon
    ? opponent.weapon.attack * opponent.weapon.durability
    : 0
  const terminal =
    state.winnerId === self.participantId
      ? 1
      : state.loserId === self.participantId
        ? -1
        : 0
  const components: AiEvaluationComponents = {
    terminal: terminal * 1_000,
    lethalPressure: clamp((selfAttack + selfWeapon - effectiveHealth(opponent)) / 30),
    effectiveHealth: relative(effectiveHealth(self), effectiveHealth(opponent), 30),
    incomingReach: clamp(
      (effectiveHealth(self) - projectedOpponentAttack - opponentWeapon) / 30
    ),
    boardAttack: relative(selfAttack, opponentAttack, 20),
    boardHealth: relative(boardHealth(self), boardHealth(opponent), 30),
    boardKeywords: relative(keywordValue(self), keywordValue(opponent), 6),
    initiative: state.activePlayerId === self.participantId ? 1 : -1,
    boardSlots: relative(7 - self.board.length, 7 - opponent.board.length, 7),
    handQuality: relative(handQuality(self), handQuality(opponent), 4),
    cardAdvantage: relative(self.hand.length, opponent.hand.length, 8),
    manaEfficiency:
      state.activePlayerId === self.participantId
        ? clamp(1 - self.mana.available / Math.max(1, self.mana.maximum), 0, 1)
        : 0,
    futureCurve: relative(handQuality(self), handQuality(opponent), 8),
    weapon: relative(selfWeapon, opponentWeapon, 16),
    heroPower: relative(
      self.heroPower.available ? 1 : 0,
      opponent.heroPower.available ? 1 : 0,
      1
    ),
    removal: relative(
      handFeature(self, /destroy|damage|silence|transform/),
      handFeature(opponent, /destroy|damage|silence|transform/),
      5
    ),
    draw: relative(
      handFeature(self, /draw|discover/),
      handFeature(opponent, /draw|discover/),
      4
    ),
    fatigue: clamp(
      (opponent.fatigueDamage -
        self.fatigueDamage +
        (opponent.deck.length === 0 ? 2 : 0) -
        (self.deck.length === 0 ? 2 : 0)) /
        6
    ),
    burnRisk: clamp(
      (Math.max(0, 9 - self.hand.length) - Math.max(0, 9 - opponent.hand.length)) / 9
    ),
    matchupProgress: matchupProgress(opponent, plan),
    comboProgress: comboProgress(self, plan),
    threatExposure: clamp(
      -projectedOpponentAttack / Math.max(1, effectiveHealth(self))
    ),
    reservedResourceCost: -reservedResourceCost(self, plan)
  }
  const score = (Object.keys(components) as (keyof AiEvaluationComponents)[]).reduce(
    (total, key) => total + components[key] * weights.components[key],
    0
  )
  return { score, components }
}
