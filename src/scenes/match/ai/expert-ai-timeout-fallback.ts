import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { HERO_POWER_CATALOG } from '../../../game-rules/content/hero-powers'
import type { AiObservation, AiObservedPlayer } from '../../../game-rules/match/ai'
import type { TurnMatchCommand } from '../../../game-rules/match'
import type { PlayCardInput } from '../../../game-rules/match/opening-match-types'
import { effectiveBoardMinionKeywords } from '../../../game-rules/match/rules/minion-attack-state'
import { aiActions } from './ai-context'
import type { GameBoardSession } from '../game-board-session'
import { expertCoinHeroPowerActionPenalty } from './expert-coin-hero-power-policy'
import { immediateExpertWin } from './expert-tactics'
import { findExpertTimeoutCombatRescue } from './expert-timeout-combat-rescue'
import {
  createExpertActionInspector,
  createExpertTerminalInspector,
  EXPERT_TERMINAL_SAFETY_MAX_MS
} from './expert-action-outcome'
import { unpaidActionPenalty } from './expert-ai-action-safety'
import { canonicalCommandKey } from '../../../game-rules/match/ai/legal-commands'

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
  readonly legalActions: readonly LocalAction[]
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
    const keywordScore = definition.keywords.reduce(
      (total, keyword) => total + knownKeywordScore(keyword),
      0
    )
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

function effectRecord(value: unknown): EffectRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as EffectRecord)
    : undefined
}

/** Only immediate instruction lists are traversed. Installed payloads are opaque. */
function immediateActions(value: unknown, output: EffectRecord[]): boolean {
  if (!Array.isArray(value)) return true
  for (const valueAction of value) {
    const action = effectRecord(valueAction)
    if (!action || typeof action.action !== 'string') continue
    if (action.action === 'damage-group') {
      // This is an immediate simultaneous group, unlike granted/scheduled actions.
      for (const child of Array.isArray(action.actions) ? action.actions : []) {
        const damage = effectRecord(child)
        if (damage?.action === 'damage') output.push(damage)
      }
    } else {
      output.push(action)
      if (action.action === 'discover') return false
      if (
        ![
          'damage',
          'destroy',
          'transform',
          'silence',
          'return-to-hand',
          'freeze',
          'restore',
          'draw',
          'gain-armor',
          'summon',
          'modify',
          'grant-keyword',
          'grant-keywords',
          'grant-deathrattle',
          'grant-trigger',
          'schedule'
        ].includes(action.action)
      )
        return false
    }
  }
  return true
}

export function immediateExpertTimeoutActions(
  cardId: string,
  command: Extract<TurnMatchCommand, { type: 'play-card' }>,
  input: PlayCardInput | undefined
): readonly EffectRecord[] {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return []
  const result: EffectRecord[] = []
  let uninterrupted = true
  definition.effects.forEach((effect, effectIndex) => {
    if (!uninterrupted || (effect.trigger !== 'cast' && effect.trigger !== 'battlecry'))
      return
    if (
      effect.condition &&
      !input?.battlecryConditions?.some(
        (fact) => fact.effectIndex === effectIndex && fact.status === 'met'
      )
    )
      return
    if (effect.choice) {
      const options = effectRecord(effect.choice)?.options
      if (
        !Array.isArray(options) ||
        command.choice === undefined ||
        !input?.legalChoices.includes(command.choice)
      )
        return
      const selected = command.choice === -1 ? options : [options[command.choice]]
      for (const option of selected) {
        if (!uninterrupted) break
        uninterrupted = immediateActions(effectRecord(option)?.actions, result)
      }
    } else uninterrupted = immediateActions(effect.actions, result)
    const then = effectRecord(effect.then)
    // A condition after earlier actions is not certified by pre-play readiness.
    if (uninterrupted && then && !then.condition)
      uninterrupted = immediateActions(then.actions, result)
  })
  return result
}

type EffectTarget = {
  readonly kind: string
  readonly participantId?: unknown
  readonly instanceId?: unknown
}

function effectTargets(
  action: EffectRecord,
  command: Extract<TurnMatchCommand, { type: 'play-card' }>,
  input: PlayCardInput | undefined,
  context: FallbackContext
): readonly EffectTarget[] {
  const selector = effectRecord(action.target)
  if (!selector) {
    if (action.target !== undefined) return []
    if (action.player === 'self')
      return [{ kind: 'hero', participantId: context.self.participantId }]
    if (action.player === 'opponent')
      return [{ kind: 'hero', participantId: context.opponent.participantId }]
    if (action.player === 'each')
      return [context.self, context.opponent].map((p) => ({
        kind: 'hero',
        participantId: p.participantId
      }))
    return []
  }
  if (selector.selection === 'chosen') {
    // Multiple chosen targets require the runtime's action cursor and filters.
    // Do not assign one target to an unrelated effect or duplicate that engine.
    if (input?.targetSelectionRandomized || command.targets?.length !== 1) return []
    const target = command.targets[0]!
    const valid = input?.targetSelectors.some((candidate, index) => {
      const fields = Object.entries(candidate).filter(([key]) => !key.startsWith('__'))
      return (
        fields.length === Object.keys(selector).length &&
        fields.every(
          ([key, value]) => JSON.stringify(value) === JSON.stringify(selector[key])
        ) &&
        input.legalTargetOptions[index]?.some(
          (option) =>
            option.kind === target.kind &&
            option.participantId === target.participantId &&
            (option.kind !== 'minion' ||
              (target.kind === 'minion' && option.instanceId === target.instanceId))
        )
      )
    })
    return valid ? [target] : []
  }
  if (
    selector.selection !== 'all' ||
    Object.keys(selector).some(
      (key) => !['controller', 'type', 'selection'].includes(key)
    )
  )
    return []
  const players =
    selector.controller === 'self'
      ? [context.self]
      : selector.controller === 'opponent'
        ? [context.opponent]
        : selector.controller === 'any'
          ? [context.self, context.opponent]
          : []
  return players.flatMap((player) => [
    ...(['minion', 'character'].includes(String(selector.type))
      ? player.board.map((minion) => ({
          kind: 'minion',
          participantId: player.participantId,
          instanceId: minion.instanceId
        }))
      : []),
    ...(['hero', 'character'].includes(String(selector.type))
      ? [{ kind: 'hero', participantId: player.participantId }]
      : [])
  ])
}

/** Keep the existing positive maximum, but never erase known simultaneous harm. */
function signedMaximum(values: readonly number[]): number {
  return (
    Math.max(0, ...values) +
    values.reduce((harm, value) => harm + Math.min(0, value), 0)
  )
}

function statDelta(value: unknown, current: number): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.max(0, current + value) - current
  const operation = effectRecord(value)
  if (
    !operation ||
    Object.keys(operation).some((key) => key !== 'operation' && key !== 'value') ||
    typeof operation.value !== 'number' ||
    !Number.isFinite(operation.value)
  )
    return 0
  if (operation.operation === 'set') return Math.max(0, operation.value) - current
  if (operation.operation === 'multiply')
    return Math.max(0, current * operation.value) - current
  if (operation.operation === 'subtract')
    return Math.max(0, current - operation.value) - current
  return 0
}

function knownKeywordScore(keyword: string): number {
  switch (keyword) {
    case 'taunt':
      return 3.5
    case 'charge':
    case 'rush':
      return 2.5
    case 'divine-shield':
    case 'poisonous':
      return 2
    case 'lifesteal':
    case 'windfury':
      return 1.5
    default:
      return 0
  }
}

function containsGlobalMinionDestroy(value: unknown, depth = 0): boolean {
  if (depth >= 8) return false
  if (Array.isArray(value))
    return value.some((entry) => containsGlobalMinionDestroy(entry, depth + 1))
  if (!value || typeof value !== 'object') return false
  const entry = value as EffectRecord
  const target = entry.target
  if (
    entry.action === 'destroy' &&
    target &&
    typeof target === 'object' &&
    !Array.isArray(target) &&
    (target as EffectRecord).controller === 'any' &&
    (target as EffectRecord).type === 'minion' &&
    (target as EffectRecord).selection === 'all'
  )
    return true
  return Object.values(entry).some((child) =>
    containsGlobalMinionDestroy(child, depth + 1)
  )
}

function hasImminentBoardClear(minion: AiObservedPlayer['board'][number]): boolean {
  if (minion.silenced === true) return false
  const definition = CARD_CATALOG.get(minion.cardId)
  if (
    definition?.effects.some(
      (effect) =>
        effect.trigger === 'start-of-turn' &&
        containsGlobalMinionDestroy(effect.actions)
    )
  )
    return true
  const minionRecord = minion as unknown as Record<string, unknown>
  return ['attachedEffects', 'grantedTriggers'].some((key) => {
    const effects = minionRecord[key]
    return (
      Array.isArray(effects) &&
      effects.some((effect) => {
        if (!effect || typeof effect !== 'object') return false
        const record = effect as EffectRecord
        return (
          record.trigger === 'start-of-turn' &&
          containsGlobalMinionDestroy(record.actions)
        )
      })
    )
  })
}

function attackPowerAvailableAfterHeroPower(context: FallbackContext): number {
  if (
    context.self.heroPower.available !== true ||
    context.self.heroPower.cost > context.self.mana.available ||
    (context.self.hero.attacksUsedThisTurn ?? 0) >=
      (context.self.hero.maxAttacksPerTurn ?? 1) ||
    (context.self.hero.frozenUntilTurn ?? -1) >= context.observation.turnNumber
  )
    return 0
  const power = HERO_POWER_CATALOG.get(context.self.heroPower.id)
  if (
    !power ||
    (power.effect.kind !== 'gain-attack-and-armor' &&
      power.effect.kind !== 'choose-one')
  )
    return 0
  return Math.max(0, numeric(power.effect.attack))
}

function imminentBoardClearTarget(
  target: NonNullable<ReturnType<typeof findMinion>>,
  context: FallbackContext
): boolean {
  return (
    findMinion(context.opponent, target.instanceId) !== undefined &&
    hasImminentBoardClear(target)
  )
}

function damagePotentialAgainst(
  target: NonNullable<ReturnType<typeof findMinion>>,
  context: FallbackContext
): number {
  let damage = 0
  let addedHeroAttack = 0
  for (const action of context.legalActions) {
    const command = action.command
    if (command.type === 'attack-character') {
      if (
        command.defender.kind === 'minion' &&
        command.defender.instanceId === target.instanceId
      )
        damage += attackerStats(
          command,
          context.self,
          context.observation.turnNumber
        ).attack
      continue
    }
    if (command.type !== 'use-hero-power') continue
    const effect = HERO_POWER_CATALOG.get(context.self.heroPower.id)?.effect
    if (!effect) continue
    if (
      command.target?.participantId === context.opponent.participantId &&
      command.target.kind === 'minion' &&
      command.target.instanceId === target.instanceId &&
      (effect.kind === 'damage-character' ||
        effect.kind === 'damage-and-summon-on-kill' ||
        effect.kind === 'lifesteal-damage')
    )
      damage += effect.amount
    else if (effect.kind === 'damage-all-minions') damage += effect.amount
    else if (effect.kind === 'gain-attack-and-armor' || effect.kind === 'choose-one')
      addedHeroAttack = Math.max(addedHeroAttack, numeric(effect.attack))
  }
  return damage + addedHeroAttack
}

function imminentBoardClearProgressScore(
  target: NonNullable<ReturnType<typeof findMinion>>,
  amount: number,
  context: FallbackContext
): number {
  if (
    !imminentBoardClearTarget(target, context) ||
    damagePotentialAgainst(target, context) < numeric(target.health)
  )
    return 0
  return 60 + Math.max(0, amount) * 1.5
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
      if (context.opponent.hero.immune === true) return 0
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
      if (keywords.includes('immune')) return 0
      const boardClearScore = shielded
        ? 0
        : imminentBoardClearProgressScore(minion, amount, context)
      if (!shielded && amount >= numeric(minion.health))
        return removalScore(minion, context) + boardClearScore
      if (boardClearScore > 0) return boardClearScore
      return shielded && amount > 0 ? 0.5 : amount * 0.35
    }
  }
  if (target.participantId === context.self.participantId) {
    if (target.kind === 'hero')
      return heroHealth(context.self) <= amount
        ? -100_000 - amount
        : -amount * (context.facingLethal ? 12 : 4)
    if (target.kind !== 'minion' || typeof target.instanceId !== 'string') return 0
    const minion = findMinion(context.self, target.instanceId)
    if (!minion) return 0
    const keywords = effectiveBoardMinionKeywords(
      minion,
      context.observation.turnNumber
    )
    if (keywords.includes('divine-shield') || keywords.includes('immune')) return -1
    const definition = CARD_CATALOG.get(minion.cardId)
    const killed = amount >= numeric(minion.health)
    if (
      definition?.effects.some((effect) =>
        killed
          ? effect.trigger === 'deathrattle' || effect.trigger === 'on-death'
          : effect.trigger === 'on-damage'
      )
    )
      return 0
    return killed
      ? -(5 + Math.max(0, numeric(minion.attack)) * 1.8 + numeric(minion.health) * 0.8)
      : -(1.5 + amount * 1.2)
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

  if (name === 'modify' || name === 'grant-keyword' || name === 'grant-keywords') {
    return signedMaximum(
      targets.map((target) => {
        const player =
          target.participantId === context.self.participantId
            ? context.self
            : target.participantId === context.opponent.participantId
              ? context.opponent
              : undefined
        if (
          !player ||
          target.kind !== 'minion' ||
          typeof target.instanceId !== 'string'
        )
          return 0
        const minion = findMinion(player, target.instanceId)
        if (!minion) return 0
        const sign = player === context.self ? 1 : -1
        if (name === 'modify')
          return (
            sign *
            (statDelta(action.attack, numeric(minion.attack)) * 2.2 +
              statDelta(action.health, numeric(minion.maxHealth)) * 1.7)
          )
        const existing = effectiveBoardMinionKeywords(
          minion,
          context.observation.turnNumber
        )
        const keywords =
          name === 'grant-keyword'
            ? [action.keyword]
            : Array.isArray(action.keywords)
              ? action.keywords
              : []
        return (
          sign *
          [...new Set(keywords)].reduce<number>(
            (sum, keyword) =>
              sum +
              (typeof keyword === 'string' &&
              !existing.includes(keyword as (typeof existing)[number])
                ? knownKeywordScore(keyword)
                : 0),
            0
          )
        )
      })
    )
  }

  if (name === 'damage')
    return signedMaximum(
      targets.map((target) => scoreDamageTarget(amount, target, context))
    )

  if (
    name === 'destroy' ||
    name === 'transform' ||
    name === 'silence' ||
    name === 'return-to-hand'
  ) {
    return signedMaximum(
      targets.map((target) => {
        const player =
          target.participantId === context.opponent.participantId
            ? context.opponent
            : target.participantId === context.self.participantId
              ? context.self
              : undefined
        const minion =
          player && target.kind === 'minion' && typeof target.instanceId === 'string'
            ? findMinion(player, target.instanceId)
            : undefined
        if (!minion) return 0
        if (player === context.opponent) return removalScore(minion, context)
        // A self-silence or transformation can remove a drawback; unknown is neutral.
        return name === 'destroy' || name === 'return-to-hand'
          ? -removalScore(minion, context)
          : 0
      })
    )
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

  if (name === 'draw' || name === 'discover') {
    const players =
      action.player === 'opponent'
        ? [context.opponent]
        : action.player === 'each'
          ? [context.self, context.opponent]
          : action.player === undefined || action.player === 'self'
            ? [context.self]
            : []
    return signedMaximum(
      players.map((player) =>
        player.handSize < 9 && player.deckSize > 0
          ? player === context.self
            ? 2.5
            : -2.5
          : 0
      )
    )
  }
  if (name === 'gain-armor')
    return signedMaximum(
      targets.map((target) =>
        target.kind !== 'hero'
          ? 0
          : target.participantId === context.self.participantId
            ? Math.max(0, amount) * (context.facingLethal ? 2 : 0.5)
            : target.participantId === context.opponent.participantId
              ? -Math.max(0, amount) * 0.5
              : 0
      )
    )
  if (name === 'summon' && typeof action.cardId === 'string') {
    // Mirrors immediate literal summons: controller, not nested payload ownership.
    const player =
      action.controller === 'opponent'
        ? context.opponent
        : action.controller === undefined || action.controller === 'self'
          ? context.self
          : undefined
    const count = action.count === undefined ? 1 : action.count
    if (!player || typeof count !== 'number' || !Number.isFinite(count)) return 0
    const accepted = Math.min(
      Math.max(0, Math.ceil(count)),
      Math.max(0, 7 - player.board.length)
    )
    return (
      (player === context.self ? 1 : -1) *
      accepted *
      cardBodyScore(action.cardId, 0, player.board.length)
    )
  }
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
  const input =
    context.session.match.getPlayInput?.(
      command.participantId,
      command.cardInstanceId,
      command.choice
    ) ?? undefined
  const effects = immediateExpertTimeoutActions(card.cardId, command, input)
  const immediateEffectScore = () =>
    signedMaximum(
      effects.map((action) =>
        effectActionScore(
          action,
          effectTargets(action, command, input, context),
          context
        )
      )
    )

  if (definition.type === 'Minion') {
    const bodyScore = cardBodyScore(card.cardId, cost, context.self.board.length)
    const taunt = definition.keywords.includes('taunt')
    const urgentBlock = taunt && context.facingLethal ? 1_000 : 0
    const effectScore = immediateEffectScore()
    const clearTrigger = context.opponent.board.find(hasImminentBoardClear)
    const canAttackImmediately = definition.keywords.some(
      (keyword) => keyword === 'charge' || keyword === 'rush'
    )
    const boardClearPenalty =
      clearTrigger &&
      !canAttackImmediately &&
      effectScore < removalScore(clearTrigger, context)
        ? 16
        : 0
    return bodyScore + urgentBlock + effectScore - boardClearPenalty
  }

  if (definition.type === 'Spell') {
    return immediateEffectScore()
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
  if (!removesTarget) {
    if (shielded) return attacker.attack > 0 ? 0.5 : 0
    const boardClearScore = imminentBoardClearProgressScore(
      target,
      attacker.attack,
      context
    )
    if (boardClearScore <= 0) return 0
    const attackerDies =
      command.attacker.kind === 'minion' &&
      !attacker.keywords.includes('divine-shield') &&
      !attacker.keywords.includes('immune') &&
      numeric(target.attack) >= attacker.health
    const friendlyLoss = attackerDies
      ? 3 + attacker.attack * 1.1 + attacker.health * 0.8
      : 0
    return Math.max(0, boardClearScore - friendlyLoss)
  }

  const attackerDies =
    command.attacker.kind === 'minion' &&
    !attacker.keywords.includes('divine-shield') &&
    !attacker.keywords.includes('immune') &&
    numeric(target.attack) >= attacker.health
  const friendlyLoss = attackerDies
    ? 3 +
      attacker.attack * 1.1 +
      attacker.health * 0.8 +
      (command.attacker.kind === 'minion' && attackPowerCanReplaceTrade(target, context)
        ? 6
        : 0)
    : 0
  return (
    6 +
    Math.max(0, numeric(target.attack)) * 1.6 +
    Math.min(12, Math.max(0, numeric(target.health))) * 0.35 -
    friendlyLoss +
    imminentBoardClearProgressScore(target, attacker.attack, context) +
    (context.facingLethal ? Math.max(0, numeric(target.attack)) * 4 : 0)
  )
}

function attackPowerCanReplaceTrade(
  target: NonNullable<ReturnType<typeof findMinion>>,
  context: FallbackContext
): boolean {
  if (
    effectiveBoardMinionKeywords(target, context.observation.turnNumber).some(
      (keyword) => keyword === 'divine-shield' || keyword === 'immune'
    )
  )
    return false
  const addedAttack = attackPowerAvailableAfterHeroPower(context)
  const otherTaunt = context.opponent.board.some(
    (minion) =>
      minion.instanceId !== target.instanceId &&
      effectiveBoardMinionKeywords(minion, context.observation.turnNumber).includes(
        'taunt'
      )
  )
  return (
    !otherTaunt &&
    addedAttack > 0 &&
    numeric(context.self.hero.attack) +
      numeric(context.self.weapon?.attack) +
      addedAttack >=
      numeric(target.health)
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
      if (!target) return 0
      {
        const targetMinion =
          target.kind === 'minion' && typeof target.instanceId === 'string'
            ? findMinion(
                target.participantId === context.self.participantId
                  ? context.self
                  : context.opponent,
                target.instanceId
              )
            : undefined
        const targetKeywords = targetMinion
          ? effectiveBoardMinionKeywords(targetMinion, context.observation.turnNumber)
          : []
        const targetDies =
          targetMinion !== undefined &&
          !targetKeywords.includes('divine-shield') &&
          !targetKeywords.includes('immune') &&
          effect.amount >= numeric(targetMinion.health)
        const friendlyTargetDies =
          targetDies && target.participantId === context.self.participantId
        const boardCountAfterDamage =
          context.self.board.length - (friendlyTargetDies ? 1 : 0)
        const summonValue =
          targetDies && boardCountAfterDamage < 7
            ? cardBodyScore(effect.cardId, 0, boardCountAfterDamage)
            : 0
        return scoreDamageTarget(effect.amount, target, context) + summonValue
      }
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
          total -
          scoreDamageTarget(
            effect.amount,
            {
              kind: 'minion',
              participantId: context.self.participantId,
              instanceId: minion.instanceId
            },
            context
          ),
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
    case 'choose-one': {
      const followupClear = context.opponent.board.some(
        (minion) =>
          imminentBoardClearTarget(minion, context) &&
          attackPowerAvailableAfterHeroPower(context) > 0 &&
          numeric(context.self.hero.attack) +
            numeric(context.self.weapon?.attack) +
            Math.max(0, numeric(effect.attack)) >=
            numeric(minion.health)
      )
      return (
        effect.armor * (context.facingLethal ? 2 : 0.5) +
        effect.attack * 0.5 +
        (followupClear ? 65 : 0)
      )
    }
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
 * match or infer concealed cards. Before passing, a bounded plain-combat rescue
 * may verify a complete two-trade answer to one public lethal attacker.
 */
export function selectExpertTimeoutFallbackAction(
  session: GameBoardSession,
  legalCommands: readonly TurnMatchCommand[]
): LocalAction | undefined {
  const actions = aiActions(session, legalCommands)
  if (!actions.length) return undefined
  const win = immediateExpertWin(
    session.match.getCheckpoint(),
    session.remoteParticipantId,
    legalCommands
  )
  if (win)
    return actions.find(
      (action) => canonicalCommandKey(action.command) === canonicalCommandKey(win)
    )
  const scores = new Map<LocalAction, number>()
  const guardTerminalLoss = (selected: LocalAction): LocalAction => {
    const started = performance.now()
    const terminal = createExpertTerminalInspector(
      session.match.getCheckpoint(),
      session.remoteParticipantId,
      undefined,
      undefined,
      () => performance.now() - started >= EXPERT_TERMINAL_SAFETY_MAX_MS
    )
    if (terminal(selected.command) !== 'loss') return selected
    const ranked = [...actions].sort(
      (left, right) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0)
    )
    return (
      ranked.find(
        (action) => action !== selected && terminal(action.command) !== 'loss'
      ) ?? selected
    )
  }
  const observation = session.getAiObservation()
  const self = observation.players.find((player) => player.role === 'self')
  const opponent = observation.players.find((player) => player.role === 'opponent')
  if (!self || !opponent)
    return guardTerminalLoss(
      actions.find((action) => action.command.type === 'end-turn') ?? actions[0]!
    )

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
    legalActions: actions,
    coinPlayedThisTurn:
      session.getState().history?.cardsPlayedThisTurn.includes('basic_the_coin') ===
      true
  }
  let best: LocalAction | undefined
  let bestScore = 0
  const inspect = createExpertActionInspector(
    session.match.getCheckpoint(),
    session.remoteParticipantId
  )
  for (const action of actions) {
    const outcome = inspect(action.command)
    const score =
      scoreAction(action, context) -
      outcome.penalty * 1_000 -
      unpaidActionPenalty(
        action.command,
        session.getState(),
        session.remoteParticipantId
      ) *
        100
    scores.set(action, score)
    if (score > bestScore) {
      best = action
      bestScore = score
    }
  }
  if (best) return guardTerminalLoss(best)
  const pass = actions.find((action) => action.command.type === 'end-turn')
  if (pass) {
    const rescue = findExpertTimeoutCombatRescue(
      session.match.getCheckpoint(),
      observation,
      legalCommands
    ).command
    if (rescue)
      return guardTerminalLoss(
        actions.find(
          (action) =>
            canonicalCommandKey(action.command) === canonicalCommandKey(rescue)
        ) ?? pass
      )
  }
  return guardTerminalLoss(pass ?? actions[0]!)
}
