import { CARD_CATALOG, type CardDefinition } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type { OpeningMatchState, OpeningPlayerState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { AiEvaluationComponents, AiStrategicPlanView } from './ai-types'

export interface AiEvaluatorWeights {
  readonly version: 3
  readonly components: Readonly<Record<keyof AiEvaluationComponents, number>>
}

export const STRATEGIC_AI_EVALUATOR_WEIGHTS: AiEvaluatorWeights = {
  version: 3,
  components: {
    terminal: 1,
    lethalPressure: 1.35,
    // Board tempo retains enough weight that strategic lookahead is an
    // addition to sound tactical play, rather than a reason to pass a
    // productive early turn. Immediate health/board swings are also grounded
    // by the search layer's deterministic tactical delta.
    effectiveHealth: 0.75,
    incomingReach: 1.2,
    boardAttack: 1.6,
    boardHealth: 0.6,
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
    informationValue: 0.7,
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

function publicIncomingFaceDamage(
  state: OpeningMatchState,
  self: OpeningPlayerState,
  opponent: OpeningPlayerState
): number {
  const rawAttack =
    Math.max(
      0,
      boardAttack(opponent) - immediatelyAnswerableAttack(state, self, opponent)
    ) + (opponent.weapon?.attack ?? 0)
  const publicTauntHealth = self.board.reduce((total, minion) => {
    const hasTaunt = (minion.keywords ?? []).includes('taunt')
    return total + (hasTaunt ? Math.max(0, minion.health) : 0)
  }, 0)
  // This is deliberately an upper-bound public prior: it uses only board,
  // weapon, and Taunt health. Hidden opposing cards never contribute reach.
  return Math.max(0, rawAttack - publicTauntHealth)
}

function publicSurvivalMargin(
  state: OpeningMatchState,
  self: OpeningPlayerState,
  opponent: OpeningPlayerState
): number {
  const margin = effectiveHealth(self) - publicIncomingFaceDamage(state, self, opponent)
  if (margin <= 0) return -4
  if (margin <= 3) return -1 + margin / 3
  return clamp(margin / 30)
}

const REPEATABLE_ENGINE_TRIGGERS = new Set([
  'inspire',
  'start-of-turn',
  'end-of-turn',
  'on-card-played',
  'on-cast',
  'on-summon'
])

function persistentEngineValue(
  player: OpeningPlayerState,
  minion: OpeningPlayerState['board'][number]
): number {
  const definition = CARD_CATALOG.get(minion.cardId)
  if (!definition) return 0
  return definition.effects.reduce((total, block) => {
    if (block.trigger === 'aura') {
      return total + 1.5 + Math.max(0, player.board.length - 1) * 1.25
    }
    if (REPEATABLE_ENGINE_TRIGGERS.has(block.trigger)) return total + 0.75
    return total
  }, 0)
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
      ((minion.deathrattles?.length ?? 0) > 0 ? 0.35 : 0) +
      persistentEngineValue(player, minion)
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
  const combos = plan?.selfCombos ?? []
  if (combos.length === 0) return 0
  const prepared = new Map<string, number>()
  for (const cardId of [
    ...player.hand.map((card) => String(card.cardId)),
    ...player.board.map((minion) => String(minion.cardId))
  ]) {
    prepared.set(cardId, (prepared.get(cardId) ?? 0) + 1)
  }
  return Math.max(
    ...combos.map((combo) => {
      const required = new Map<string, number>()
      for (const cardId of combo.cardIds)
        required.set(cardId, (required.get(cardId) ?? 0) + 1)
      const readyPieces = [...required.entries()].reduce(
        (total, [cardId, count]) => total + Math.min(count, prepared.get(cardId) ?? 0),
        0
      )
      return readyPieces / Math.max(1, combo.cardIds.length)
    })
  )
}

function matchupProgress(
  opponent: OpeningPlayerState,
  plan?: AiStrategicPlanView
): number {
  const threats = new Set(plan?.observedOpponentThreatCardIds ?? [])
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
  const reserved = new Set(plan?.activeReservedCardIds ?? plan?.reservedCardIds ?? [])
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
  weights: AiEvaluatorWeights = STRATEGIC_AI_EVALUATOR_WEIGHTS
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
  const publicIncomingDamage = publicIncomingFaceDamage(state, self, opponent)
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
    incomingReach: publicSurvivalMargin(state, self, opponent),
    boardAttack: relative(selfAttack, opponentAttack, 20),
    boardHealth: relative(boardHealth(self), boardHealth(opponent), 30),
    boardKeywords: relative(keywordValue(self), keywordValue(opponent), 6),
    initiative: state.activePlayerId === self.participantId ? 1 : -1,
    boardSlots: relative(7 - self.board.length, 7 - opponent.board.length, 7),
    // Opposing card identities are private. Hand size is public, so use a
    // neutral size-only prior instead of inspecting the authoritative hand.
    handQuality: relative(handQuality(self), opponent.hand.length * 0.35, 4),
    cardAdvantage: relative(self.hand.length, opponent.hand.length, 8),
    manaEfficiency:
      state.activePlayerId === self.participantId
        ? clamp(1 - self.mana.available / Math.max(1, self.mana.maximum), 0, 1)
        : 0,
    futureCurve: relative(handQuality(self), opponent.hand.length * 0.35, 8),
    weapon: relative(selfWeapon, opponentWeapon, 16),
    // Availability is a tactical resource only during this player's live
    // turn. After End Turn, an unused power must not look like persistent
    // value: both powers refresh on their respective next turns.
    heroPower:
      state.activePlayerId === self.participantId
        ? relative(
            self.heroPower.available ? 1 : 0,
            opponent.heroPower.available ? 1 : 0,
            1
          )
        : 0,
    removal: relative(
      handFeature(self, /destroy|damage|silence|transform/),
      opponent.hand.length * 0.25,
      5
    ),
    draw: relative(handFeature(self, /draw|discover/), opponent.hand.length * 0.15, 4),
    informationValue: 0,
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
    threatExposure: clamp(-publicIncomingDamage / Math.max(1, effectiveHealth(self))),
    reservedResourceCost: -reservedResourceCost(self, plan)
  }
  const score = (Object.keys(components) as (keyof AiEvaluationComponents)[]).reduce(
    (total, key) => total + components[key] * weights.components[key],
    0
  )
  return { score, components }
}
