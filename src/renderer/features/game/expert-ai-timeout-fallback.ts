import { CARD_CATALOG } from '../../../game/content/cards'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type { AiObservation, AiObservedPlayer } from '../../../game/match/ai'
import type { TurnMatchCommand } from '../../../game/match'
import { effectiveBoardMinionKeywords } from '../../../game/match/rules/minion-attack-state'
import { aiActions } from './ai-context'
import type { GameBoardSession } from './game-board-session'
import { expertCoinHeroPowerActionPenalty } from './expert-coin-hero-power-policy'

type LocalAction = ReturnType<typeof aiActions>[number]
type EffectRecord = Readonly<Record<string, unknown>>

interface FallbackContext {
  readonly session: GameBoardSession
  readonly observation: AiObservation
  readonly self: AiObservedPlayer
  readonly opponent: AiObservedPlayer
  readonly facingLethal: boolean
  readonly enemyHealth: number
  readonly coinPlayedThisTurn: boolean
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function heroHealth(player: AiObservedPlayer): number {
  return Math.max(0, numeric(player.hero.health) + numeric(player.hero.armor))
}

function nextTurnAttackDamage(player: AiObservedPlayer, turnNumber: number): number {
  const opponentTurn = turnNumber + 1
  const minionDamage = player.board.reduce((total, minion) => {
    const keywords = effectiveBoardMinionKeywords(minion, opponentTurn)
    const canAttack =
      numeric(minion.attack) > 0 &&
      numeric(minion.summonedOnTurn, -1) < opponentTurn &&
      numeric(minion.controllerChangedOnTurn, -1) < opponentTurn &&
      numeric(minion.frozenUntilTurn, -1) < opponentTurn &&
      !keywords.includes('cannot-attack')
    return total + (canAttack ? Math.max(0, numeric(minion.attack)) : 0)
  }, 0)
  return (
    minionDamage +
    Math.max(0, numeric(player.hero.attack)) +
    Math.max(0, numeric(player.weapon?.attack))
  )
}

function findMinion(player: AiObservedPlayer, instanceId: string) {
  return player.board.find((minion) => minion.instanceId === instanceId)
}

function cardBodyScore(cardId: string, cost: number, boardCount: number): number {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return 0
  if (definition.type === 'Minion') {
    const keywordScore = definition.keywords.reduce((total, keyword) => {
      switch (keyword) {
        case 'taunt':
          return total + 3.5
        case 'charge':
        case 'rush':
          return total + 2.5
        case 'divine-shield':
        case 'poisonous':
          return total + 2
        case 'lifesteal':
        case 'windfury':
          return total + 1.5
        default:
          return total
      }
    }, 0)
    const boardSpace = Math.max(-2, 3 - boardCount) * 0.75
    return (
      definition.attack * 2.2 +
      definition.health * 1.7 +
      keywordScore +
      boardSpace -
      cost * 1.35
    )
  }
  if (definition.type === 'Weapon')
    return definition.attack * 2 + definition.durability * 1.4 - cost * 1.2
  if (definition.type === 'Hero') return definition.armor * 1.5 - cost
  return 0
}

function actionRecords(value: unknown, output: EffectRecord[], depth = 0): void {
  if (depth >= 8) return
  if (Array.isArray(value)) {
    for (const entry of value) actionRecords(entry, output, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  const entry = value as EffectRecord
  if (typeof entry.action === 'string') output.push(entry)
  for (const [key, child] of Object.entries(entry)) {
    if (key !== 'action') actionRecords(child, output, depth + 1)
  }
}

function cardActions(cardId: string): readonly EffectRecord[] {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return []
  const result: EffectRecord[] = []
  for (const effect of definition.effects) {
    if (effect.trigger === 'cast' || effect.trigger === 'battlecry')
      actionRecords(effect.actions, result)
  }
  return result
}

function removalScore(
  target: NonNullable<ReturnType<typeof findMinion>>,
  context: FallbackContext
): number {
  return (
    7 +
    Math.max(0, numeric(target.attack)) * 1.8 +
    Math.min(12, Math.max(0, numeric(target.health))) * 0.35 +
    (context.facingLethal ? Math.max(0, numeric(target.attack)) * 4 : 0)
  )
}

function scoreDamageTarget(
  amount: number,
  target: {
    readonly kind: string
    readonly participantId?: unknown
    readonly instanceId?: unknown
  },
  context: FallbackContext
): number {
  if (target.participantId === context.opponent.participantId) {
    if (target.kind === 'hero') {
      if (amount >= context.enemyHealth) return 100_000 + amount
      return amount * 1.5
    }
    if (target.kind === 'minion' && typeof target.instanceId === 'string') {
      const minion = findMinion(context.opponent, target.instanceId)
      if (!minion) return 0
      const keywords = effectiveBoardMinionKeywords(
        minion,
        context.observation.turnNumber
      )
      const shielded = keywords.includes('divine-shield')
      if (!shielded && !keywords.includes('immune') && amount >= numeric(minion.health))
        return removalScore(minion, context)
      return shielded && amount > 0 ? 0.5 : amount * 0.35
    }
  }
  return 0
}

function effectActionScore(
  action: EffectRecord,
  targets: readonly {
    readonly kind: string
    readonly participantId?: unknown
    readonly instanceId?: unknown
  }[],
  context: FallbackContext
): number {
  const name = action.action
  if (typeof name !== 'string') return 0
  const amount = numeric(action.amount ?? action.damage ?? action.health)

  if (name === 'damage')
    return targets.reduce(
      (best, target) => Math.max(best, scoreDamageTarget(amount, target, context)),
      0
    )

  if (
    name === 'destroy' ||
    name === 'transform' ||
    name === 'silence' ||
    name === 'return-to-hand'
  ) {
    return targets.reduce((best, target) => {
      if (target.participantId !== context.opponent.participantId) return best
      const minion =
        target.kind === 'minion' && typeof target.instanceId === 'string'
          ? findMinion(context.opponent, target.instanceId)
          : undefined
      return minion ? Math.max(best, removalScore(minion, context)) : best
    }, 0)
  }

  if (name === 'freeze') {
    return targets.reduce((best, target) => {
      if (target.participantId !== context.opponent.participantId) return best
      const minion =
        target.kind === 'minion' && typeof target.instanceId === 'string'
          ? findMinion(context.opponent, target.instanceId)
          : undefined
      if (!minion) return best
      const value =
        1 + Math.max(0, numeric(minion.attack)) * (context.facingLethal ? 4 : 0.8)
      return Math.max(best, value)
    }, 0)
  }

  if (name === 'restore') {
    return targets.reduce((best, target) => {
      if (target.participantId !== context.self.participantId) return best
      if (target.kind === 'hero') {
        const missing = Math.max(
          0,
          numeric(context.self.hero.maxHealth) - numeric(context.self.hero.health)
        )
        return Math.max(
          best,
          Math.min(amount, missing) * (context.facingLethal ? 3 : 1.25)
        )
      }
      if (target.kind === 'minion' && typeof target.instanceId === 'string') {
        const minion = findMinion(context.self, target.instanceId)
        const missing = minion
          ? Math.max(0, numeric(minion.maxHealth) - numeric(minion.health))
          : 0
        return Math.max(best, Math.min(amount, missing) * 0.75)
      }
      return best
    }, 0)
  }

  if (name === 'draw' || name === 'discover')
    return context.self.handSize < 9 && context.self.deckSize > 0 ? 2.5 : 0
  if (name === 'gain-armor')
    return Math.max(0, amount) * (context.facingLethal ? 2 : 0.5)
  if (name === 'summon' && typeof action.cardId === 'string')
    return cardBodyScore(action.cardId, 0, context.self.board.length)
  return 0
}

function scoreCardPlay(
  command: Extract<TurnMatchCommand, { readonly type: 'play-card' }>,
  context: FallbackContext
): number {
  const card = context.self.hand.find(
    (entry) => entry.instanceId === command.cardInstanceId
  )
  if (!card) return 0
  const definition = CARD_CATALOG.get(card.cardId)
  if (!definition) return 0
  const cost = card.currentCost ?? card.baseCost ?? definition.cost

  if (definition.type === 'Minion') {
    const bodyScore = cardBodyScore(card.cardId, cost, context.self.board.length)
    const taunt = definition.keywords.includes('taunt')
    const urgentBlock = taunt && context.facingLethal ? 1_000 : 0
    const effectScore = Math.max(
      0,
      ...cardActions(card.cardId).map((action) =>
        effectActionScore(action, command.targets ?? [], context)
      )
    )
    return bodyScore + urgentBlock + effectScore
  }

  if (definition.type === 'Spell') {
    return Math.max(
      0,
      ...cardActions(card.cardId).map((action) =>
        effectActionScore(action, command.targets ?? [], context)
      )
    )
  }

  if (definition.type === 'Weapon') {
    const replacedWeaponValue = context.self.weapon
      ? numeric(context.self.weapon.attack) *
        numeric(context.self.weapon.durability) *
        0.7
      : 0
    return (
      cardBodyScore(card.cardId, cost, context.self.board.length) - replacedWeaponValue
    )
  }

  return cardBodyScore(card.cardId, cost, context.self.board.length)
}

function attackerStats(
  command: Extract<TurnMatchCommand, { readonly type: 'attack-character' }>,
  player: AiObservedPlayer,
  turnNumber: number
): {
  readonly attack: number
  readonly health: number
  readonly keywords: readonly string[]
} {
  if (command.attacker.kind === 'hero')
    return {
      attack: Math.max(0, numeric(player.hero.attack) + numeric(player.weapon?.attack)),
      health: heroHealth(player),
      keywords: []
    }
  const minion = findMinion(player, command.attacker.instanceId)
  return {
    attack: Math.max(0, numeric(minion?.attack)),
    health: Math.max(0, numeric(minion?.health)),
    keywords: minion ? effectiveBoardMinionKeywords(minion, turnNumber) : []
  }
}

function scoreAttack(
  command: Extract<TurnMatchCommand, { readonly type: 'attack-character' }>,
  context: FallbackContext
): number {
  const attacker = attackerStats(command, context.self, context.observation.turnNumber)
  if (command.defender.kind === 'hero') {
    if (attacker.attack >= context.enemyHealth) return 100_000 + attacker.attack
    const faceAttack = attacker.attack * 0.9
    return context.enemyHealth <= 6 ? faceAttack + 2 : faceAttack
  }

  const target = findMinion(context.opponent, command.defender.instanceId)
  if (!target) return 0
  const targetKeywords = effectiveBoardMinionKeywords(
    target,
    context.observation.turnNumber
  )
  const shielded = targetKeywords.includes('divine-shield')
  const poisonous = attacker.keywords.includes('poisonous')
  const removesTarget =
    !targetKeywords.includes('immune') &&
    !shielded &&
    (poisonous || attacker.attack >= numeric(target.health))
  if (!removesTarget) return shielded && attacker.attack > 0 ? 0.5 : 0

  const attackerDies =
    command.attacker.kind === 'minion' &&
    !attacker.keywords.includes('divine-shield') &&
    !attacker.keywords.includes('immune') &&
    numeric(target.attack) >= attacker.health
  const friendlyLoss = attackerDies
    ? 3 + attacker.attack * 1.1 + attacker.health * 0.8
    : 0
  return (
    6 +
    Math.max(0, numeric(target.attack)) * 1.6 +
    Math.min(12, Math.max(0, numeric(target.health))) * 0.35 -
    friendlyLoss +
    (context.facingLethal ? Math.max(0, numeric(target.attack)) * 4 : 0)
  )
}

function scoreHeroPower(
  command: Extract<TurnMatchCommand, { readonly type: 'use-hero-power' }>,
  context: FallbackContext
): number {
  const power = HERO_POWER_CATALOG.get(context.self.heroPower.id)
  if (!power) return 0
  const target = command.target
  const effect = power.effect
  switch (effect.kind) {
    case 'damage-enemy-hero':
      return effect.amount >= context.enemyHealth
        ? 100_000 + effect.amount
        : effect.amount * 1.5
    case 'damage-character':
      return target ? scoreDamageTarget(effect.amount, target, context) : 0
    case 'damage-and-summon-on-kill':
      return (
        (target ? scoreDamageTarget(effect.amount, target, context) : 0) +
        cardBodyScore(effect.cardId, 0, context.self.board.length)
      )
    case 'damage-all-minions': {
      const enemyValue = context.opponent.board.reduce((total, minion) => {
        const shielded = effectiveBoardMinionKeywords(
          minion,
          context.observation.turnNumber
        ).includes('divine-shield')
        return (
          total +
          (!shielded && effect.amount >= numeric(minion.health)
            ? removalScore(minion, context)
            : 0)
        )
      }, 0)
      const friendlyLoss = context.self.board.reduce(
        (total, minion) =>
          total +
          (!effectiveBoardMinionKeywords(
            minion,
            context.observation.turnNumber
          ).includes('divine-shield') && effect.amount >= numeric(minion.health)
            ? 5 + numeric(minion.attack) * 1.5
            : 0),
        0
      )
      return enemyValue - friendlyLoss
    }
    case 'restore-character':
      if (target?.participantId !== context.self.participantId) return 0
      if (target.kind === 'hero') {
        const missing = Math.max(
          0,
          numeric(context.self.hero.maxHealth) - numeric(context.self.hero.health)
        )
        return Math.min(effect.amount, missing) * (context.facingLethal ? 3 : 1.25)
      }
      if (target.kind === 'minion') {
        const minion = findMinion(context.self, target.instanceId)
        return minion
          ? Math.min(
              effect.amount,
              Math.max(0, numeric(minion.maxHealth) - numeric(minion.health))
            ) * 0.75
          : 0
      }
      return 0
    case 'gain-armor':
      return effect.amount * (context.facingLethal ? 2 : 0.5)
    case 'summon':
      return cardBodyScore(effect.cardId, 0, context.self.board.length)
    case 'summon-random-totem':
      return (
        effect.cardIds.reduce(
          (total, cardId) =>
            total + cardBodyScore(cardId, 0, context.self.board.length),
          0
        ) / Math.max(1, effect.cardIds.length)
      )
    case 'equip-weapon': {
      const weapon = CARD_CATALOG.get(effect.cardId)
      return weapon?.type === 'Weapon' ? weapon.attack * 2 + weapon.durability * 1.4 : 0
    }
    case 'gain-attack-and-armor':
    case 'choose-one':
      return effect.armor * (context.facingLethal ? 2 : 0.5) + effect.attack * 0.5
    case 'draw-and-self-damage':
    case 'draw-with-set-cost':
    case 'build-a-beast':
    case 'discover-choose-one':
    case 'discover-spell-discount':
    case 'copy-last-card-this-turn':
      return context.self.deckSize > 0 && context.self.handSize < 9 ? 2 : 0
    case 'buff-friendly-minions':
    case 'restore-and-buff-minion':
      return context.self.board.length ? 2 : 0
    case 'lifesteal-damage':
      return context.self.hero.health < context.self.hero.maxHealth
        ? effect.amount * 1.2
        : effect.amount * 0.5
    default:
      return 0
  }
}

function scoreAction(action: LocalAction, context: FallbackContext): number {
  const command = action.command
  if (command.type === 'end-turn') return 0
  if (command.type === 'play-card') return scoreCardPlay(command, context)
  if (command.type === 'attack-character') return scoreAttack(command, context)
  if (command.type === 'use-hero-power') {
    if (context.coinPlayedThisTurn) {
      const before = context.session.getState()
      const after = context.session.match.analyze((fork) => {
        fork.dispatch(command)
        return fork.getState()
      })
      if (
        expertCoinHeroPowerActionPenalty(
          command,
          before,
          after,
          context.session.remoteParticipantId,
          true
        ) > 0
      )
        return Number.NEGATIVE_INFINITY
    }
    return scoreHeroPower(command, context)
  }
  if (command.type === 'choose-discover-card') {
    const card = context.session
      .getState()
      .pendingDiscover?.candidates.find(
        (candidate) => candidate.instanceId === command.cardInstanceId
      )
    return card
      ? cardBodyScore(
          card.cardId,
          card.currentCost ?? card.baseCost ?? 0,
          context.self.board.length
        )
      : 0
  }
  // A pending choice must be answered with a legal option; it cannot pass.
  return 1
}

/**
 * Small deterministic timeout policy. It reads only the AI's fair observation
 * and the current authoritative legal-action list; it does not branch the live
 * match or infer concealed cards. End Turn remains the fallback when no
 * positive-value action is apparent.
 */
export function selectExpertTimeoutFallbackAction(
  session: GameBoardSession,
  legalCommands: readonly TurnMatchCommand[]
): LocalAction | undefined {
  const actions = aiActions(session, legalCommands)
  if (!actions.length) return undefined
  const observation = session.getAiObservation()
  const self = observation.players.find((player) => player.role === 'self')
  const opponent = observation.players.find((player) => player.role === 'opponent')
  if (!self || !opponent)
    return actions.find((action) => action.command.type === 'end-turn') ?? actions[0]

  const ownTaunt = self.board.some((minion) =>
    effectiveBoardMinionKeywords(minion, observation.turnNumber).includes('taunt')
  )
  const facingLethal =
    !ownTaunt &&
    nextTurnAttackDamage(opponent, observation.turnNumber) >= heroHealth(self)
  const enemyHealth = heroHealth(opponent)
  const context: FallbackContext = {
    session,
    observation,
    self,
    opponent,
    facingLethal,
    enemyHealth,
    coinPlayedThisTurn:
      session.getState().history?.cardsPlayedThisTurn.includes('basic_the_coin') === true
  }
  let best: LocalAction | undefined
  let bestScore = 0
  for (const action of actions) {
    const score = scoreAction(action, context)
    if (score > bestScore) {
      best = action
      bestScore = score
    }
  }
  return (
    best ?? actions.find((action) => action.command.type === 'end-turn') ?? actions[0]
  )
}
