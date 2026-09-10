import { CARD_CATALOG } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  CardPlayTargetRef,
  OpeningMatchCommand,
  OpeningMatchEvent,
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningPlayerState,
  HeroPowerTargetRef
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

export const AI_POLICY_RISK_FLAGS = [
  'no-effect',
  'ineffective-hero-freeze',
  'immediate-loss',
  'draws-from-empty-deck',
  'hand-overflow',
  'burns-card',
  'fatigue-lethal'
] as const

export type AiPolicyRiskFlag = (typeof AI_POLICY_RISK_FLAGS)[number]
export type AiPolicyCertainty = 'proven' | 'bounded' | 'unknown'

export interface AiPolicyEffectSummary {
  readonly manaSpent: number
  readonly damageDealt: number
  readonly damageToSelf: number
  readonly damageToOpponent: number
  readonly healthRestored: number
  readonly armorGained: number
  readonly cardsDrawn: number
  readonly cardsGenerated: number
  readonly cardsBurned: number
  readonly fatigueDamage: number
  readonly triggeredEffects: number
}

export interface AiPolicyActionAssessment {
  readonly index: number
  readonly action: string
  readonly manaSpent: number
  readonly damageDealt: number
  readonly healthRestored: number
  readonly cardsDrawn: number
  readonly cardsGenerated: number
  readonly cardsBurned: number
  readonly fatigueDamage: number
  readonly riskFlags: readonly AiPolicyRiskFlag[]
  readonly hasBeneficialEffect: boolean
  readonly beneficialTrigger: boolean
}

export interface AiPolicyDeferredEffects {
  /** The automatic draw that occurs when the AI next starts its own turn. */
  readonly trigger: 'next-own-turn-draw'
  readonly cardsDrawn: number
  readonly cardsBurned: number
  readonly fatigueDamage: number
  readonly riskFlags: readonly AiPolicyRiskFlag[]
}

export interface AiPolicyAssessment {
  readonly certainty: AiPolicyCertainty
  readonly riskFlags: readonly AiPolicyRiskFlag[]
  readonly effectSummary: AiPolicyEffectSummary
  readonly actions: readonly AiPolicyActionAssessment[]
  readonly deferredEffects?: AiPolicyDeferredEffects
  readonly guaranteedLethal: boolean
  readonly immediateLoss: boolean
  readonly hasBeneficialEffect: boolean
  /** True only when an existing safe alternative should replace this policy. */
  readonly rejectable: boolean
}

const MAX_HAND_SIZE = 10

export interface AiPolicyAssessmentStep {
  readonly command: OpeningMatchCommand
  readonly action: string
  readonly before: OpeningMatchState
  readonly after: OpeningMatchState
  readonly events: readonly OpeningMatchEvent[]
}

interface EventSummary {
  damageDealt: number
  damageToSelf: number
  damageToOpponent: number
  healthRestored: number
  armorGained: number
  cardsDrawn: number
  cardsGenerated: number
  cardsBurned: number
  fatigueDamage: number
  selfFatigueDamage: number
  triggeredEffects: number
  boardEvents: number
  weaponEvents: number
  heroEvents: number
  deaths: number
}

interface CharacterState {
  readonly participantId: PlayerId
  readonly health: number
  readonly attack: number
  readonly armor: number
  readonly weaponAttack: number
}

function player(
  state: OpeningMatchState,
  participantId: PlayerId
): OpeningPlayerState | undefined {
  return state.players.find((candidate) => candidate.participantId === participantId)
}

function findMinion(
  state: OpeningMatchState,
  instanceId: string
): { readonly player: OpeningPlayerState; readonly index: number } | undefined {
  for (const candidate of state.players) {
    const index = candidate.board.findIndex(
      (minion) => minion.instanceId === instanceId
    )
    if (index >= 0) return { player: candidate, index }
  }
  return undefined
}

function characterState(
  state: OpeningMatchState,
  target: CardPlayTargetRef | HeroPowerTargetRef
): CharacterState | undefined {
  if (target.kind === 'hero') {
    const owner = player(state, target.participantId)
    if (!owner) return undefined
    return {
      participantId: owner.participantId,
      health: owner.hero.health,
      attack: owner.hero.attack,
      armor: owner.hero.armor,
      weaponAttack: owner.weapon?.attack ?? 0
    }
  }
  if (target.kind !== 'minion') return undefined
  const found = findMinion(state, target.instanceId)
  if (!found) return undefined
  return {
    participantId: found.player.participantId,
    health: found.player.board[found.index]!.health,
    attack: found.player.board[found.index]!.attack,
    armor: 0,
    weaponAttack: 0
  }
}

function frozenUntilTurn(
  state: OpeningMatchState,
  target: CardPlayTargetRef | HeroPowerTargetRef
): number | null | undefined {
  if (target.kind === 'hero')
    return player(state, target.participantId)?.hero.frozenUntilTurn
  if (target.kind !== 'minion') return undefined
  return findMinion(state, target.instanceId)?.player.board.find(
    (minion) => minion.instanceId === target.instanceId
  )?.frozenUntilTurn
}

function commandTargets(
  command: OpeningMatchCommand
): readonly (CardPlayTargetRef | HeroPowerTargetRef)[] {
  if (command.type === 'play-card') return command.targets ?? []
  if (command.type === 'use-hero-power') {
    return command.target ? [command.target] : []
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function actionNames(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) actionNames(entry, result)
    return result
  }
  if (!isRecord(value)) return result
  if (typeof value['action'] === 'string') result.add(value['action'])
  for (const entry of Object.values(value)) actionNames(entry, result)
  return result
}

function commandActionNames(
  state: OpeningMatchState,
  command: OpeningMatchCommand
): Set<string> {
  if (command.type === 'play-card') {
    const card = player(state, command.participantId)?.hand.find(
      (candidate) => candidate.instanceId === command.cardInstanceId
    )
    return actionNames(card ? CARD_CATALOG.get(card.cardId)?.effects : undefined)
  }
  if (command.type !== 'use-hero-power') return new Set()
  const owner = player(state, command.participantId)
  const power = owner ? HERO_POWER_CATALOG.get(owner.heroPower.id) : undefined
  if (!power) return new Set()
  const names = new Set<string>()
  switch (power.effect.kind) {
    case 'restore-character':
      names.add('restore')
      break
    case 'draw-and-self-damage':
      names.add('draw')
      names.add('damage')
      break
    case 'damage-character':
    case 'damage-enemy-hero':
    case 'damage-random-enemy':
      names.add('damage')
      break
    case 'gain-armor':
      names.add('gain-armor')
      break
    case 'gain-attack-and-armor':
      names.add('gain-armor')
      names.add('modify')
      break
    case 'summon':
    case 'summon-random-totem':
      names.add('summon')
      break
    case 'equip-weapon':
      names.add('equip')
      break
  }
  return names
}

function addDamage(
  summary: EventSummary,
  participantId: PlayerId,
  amount: number,
  perspective: PlayerId
): void {
  const resolved = Math.max(0, amount)
  summary.damageDealt += resolved
  if (participantId === perspective) summary.damageToSelf += resolved
  else summary.damageToOpponent += resolved
}

function summarizeEvents(
  events: readonly OpeningMatchEvent[],
  perspective: PlayerId
): EventSummary {
  const summary: EventSummary = {
    damageDealt: 0,
    damageToSelf: 0,
    damageToOpponent: 0,
    healthRestored: 0,
    armorGained: 0,
    cardsDrawn: 0,
    cardsGenerated: 0,
    cardsBurned: 0,
    fatigueDamage: 0,
    selfFatigueDamage: 0,
    triggeredEffects: 0,
    boardEvents: 0,
    weaponEvents: 0,
    heroEvents: 0,
    deaths: 0
  }
  for (const event of events) {
    switch (event.type) {
      case 'character-damaged':
        addDamage(summary, event.participantId, event.amount, perspective)
        if (event.destroyed) summary.deaths += 1
        break
      case 'character-healed':
        summary.healthRestored += Math.max(0, event.amount)
        break
      case 'armor-gained':
        summary.armorGained += Math.max(0, event.amount)
        break
      case 'card-drawn':
      case 'opening-card-drawn':
        summary.cardsDrawn += 1
        break
      case 'card-generated':
        summary.cardsGenerated += 1
        break
      case 'card-burned':
        summary.cardsBurned += 1
        break
      case 'fatigue':
        summary.fatigueDamage += Math.max(0, event.amount)
        if (event.participantId === perspective)
          summary.selfFatigueDamage += Math.max(0, event.amount)
        break
      case 'minion-played':
      case 'hero-power-minion-summoned':
      case 'minion-summoned':
        summary.boardEvents += 1
        break
      case 'weapon-equipped':
        summary.weaponEvents += 1
        break
      case 'hero-replaced':
      case 'hero-power-replaced':
        summary.heroEvents += 1
        break
      case 'minion-combat-resolved':
        addDamage(
          summary,
          event.attacker.participantId,
          event.attacker.damageDealt,
          perspective
        )
        addDamage(
          summary,
          event.defender.participantId,
          event.defender.damageDealt,
          perspective
        )
        if (event.attacker.destroyed) summary.deaths += 1
        if (event.defender.destroyed) summary.deaths += 1
        break
      case 'character-combat-resolved':
        addDamage(
          summary,
          event.attacker.participantId,
          event.attacker.damageDealt,
          perspective
        )
        addDamage(
          summary,
          event.defender.participantId,
          event.defender.damageDealt,
          perspective
        )
        if (event.attacker.destroyed) summary.deaths += 1
        if (event.defender.destroyed) summary.deaths += 1
        break
      case 'trigger-activated':
        summary.triggeredEffects += 1
        break
      case 'match-ended':
        summary.heroEvents += 1
        break
    }
  }
  return summary
}

function effectSnapshot(state: OpeningMatchState, ignoreFreeze: boolean): unknown {
  return {
    phase: state.phase,
    activePlayerId: state.activePlayerId,
    winnerId: state.winnerId,
    loserId: state.loserId,
    pendingDiscover: state.pendingDiscover
      ? {
          participantId: state.pendingDiscover.participantId,
          sourceCardInstanceId: state.pendingDiscover.sourceCardInstanceId,
          candidates: state.pendingDiscover.candidates.map((card) => card.cardId)
        }
      : null,
    pendingCardChoice: state.pendingCardChoice
      ? {
          participantId: state.pendingCardChoice.participantId,
          sourceCardInstanceId: state.pendingCardChoice.sourceCardInstanceId,
          sourceCardId: state.pendingCardChoice.sourceCardId,
          options: state.pendingCardChoice.options.map((option) => option.choice)
        }
      : null,
    scheduledEffects: state.scheduledEffects?.map((effect) => ({
      id: effect.id,
      sourceInstanceId: effect.sourceInstanceId,
      trigger: effect.trigger,
      executeOnTurn: effect.executeOnTurn
    })),
    players: state.players.map((candidate) => ({
      participantId: candidate.participantId,
      hero: {
        health: candidate.hero.health,
        maxHealth: candidate.hero.maxHealth,
        armor: candidate.hero.armor,
        attack: candidate.hero.attack,
        immune: candidate.hero.immune,
        spellImmune: candidate.hero.spellImmune,
        damageTaken: candidate.hero.damageTaken,
        lastAttackedOnTurn: candidate.hero.lastAttackedOnTurn,
        baseAttack: candidate.hero.baseAttack,
        baseMaxHealth: candidate.hero.baseMaxHealth,
        keywords: candidate.hero.keywords,
        enchantments: candidate.hero.enchantments,
        attacksUsedThisTurn: candidate.hero.attacksUsedThisTurn,
        maxAttacksPerTurn: candidate.hero.maxAttacksPerTurn,
        spellDamage: candidate.hero.spellDamage,
        spellDamageMultiplier: candidate.hero.spellDamageMultiplier,
        healingMultiplier: candidate.hero.healingMultiplier,
        heroPowerMultiplier: candidate.hero.heroPowerMultiplier,
        maximumDamageTaken: candidate.hero.maximumDamageTaken,
        damageTakenMultiplier: candidate.hero.damageTakenMultiplier,
        ...(ignoreFreeze ? {} : { frozenUntilTurn: candidate.hero.frozenUntilTurn })
      },
      weapon: candidate.weapon
        ? {
            cardId: candidate.weapon.cardId,
            attack: candidate.weapon.attack,
            durability: candidate.weapon.durability,
            maxDurability: candidate.weapon.maxDurability,
            controllerId: candidate.weapon.controllerId,
            enchantments: candidate.weapon.enchantments
          }
        : null,
      board: candidate.board.map((minion) => ({
        instanceId: minion.instanceId,
        cardId: minion.cardId,
        attack: minion.attack,
        health: minion.health,
        maxHealth: minion.maxHealth,
        summonedOnTurn: minion.summonedOnTurn,
        controllerChangedOnTurn: minion.controllerChangedOnTurn,
        lastAttackedOnTurn: minion.lastAttackedOnTurn,
        ownerId: minion.ownerId,
        controllerId: minion.controllerId,
        baseAttack: minion.baseAttack,
        baseHealth: minion.baseHealth,
        keywords: minion.keywords,
        enchantments: minion.enchantments,
        grantedTriggers: minion.grantedTriggers,
        attachedEffects: minion.attachedEffects,
        deathrattles: minion.deathrattles,
        damageTaken: minion.damageTaken,
        divineShield: minion.divineShield,
        divineShieldConsumed: minion.divineShieldConsumed,
        stealth: minion.stealth,
        stealthRevealed: minion.stealthRevealed,
        immune: minion.immune,
        spellImmune: minion.spellImmune,
        attacksUsedThisTurn: minion.attacksUsedThisTurn,
        maxAttacksPerTurn: minion.maxAttacksPerTurn,
        triggerMultipliers: minion.triggerMultipliers,
        spellDamage: minion.spellDamage,
        spellDamageMultiplier: minion.spellDamageMultiplier,
        healingMultiplier: minion.healingMultiplier,
        heroPowerMultiplier: minion.heroPowerMultiplier,
        silenced: minion.silenced,
        ...(ignoreFreeze ? {} : { frozenUntilTurn: minion.frozenUntilTurn })
      })),
      heroPower: {
        id: candidate.heroPower.id,
        cost: candidate.heroPower.cost,
        effectOverride: candidate.heroPower.effectOverride,
        targetingGranted: candidate.heroPower.targetingGranted,
        enchantments: candidate.heroPower.enchantments
      },
      mana: {
        maximum: candidate.mana.maximum,
        temporary: candidate.mana.temporary,
        overloadLocked: candidate.mana.overloadLocked,
        overloadNextTurn: candidate.mana.overloadNextTurn
      },
      secrets: candidate.secrets?.map((secret) => ({
        instanceId: secret.instanceId,
        cardId: secret.cardId,
        revealed: secret.revealed
      }))
    }))
  }
}

function stateChanged(
  before: OpeningMatchState,
  after: OpeningMatchState,
  ignoreFreeze: boolean
): boolean {
  return (
    JSON.stringify(effectSnapshot(before, ignoreFreeze)) !==
    JSON.stringify(effectSnapshot(after, ignoreFreeze))
  )
}

function hasPositiveEvent(summary: EventSummary): boolean {
  return (
    summary.damageDealt > 0 ||
    summary.healthRestored > 0 ||
    summary.armorGained > 0 ||
    summary.cardsDrawn > 0 ||
    summary.cardsGenerated > 0 ||
    summary.boardEvents > 0 ||
    summary.weaponEvents > 0 ||
    summary.heroEvents > 0 ||
    summary.deaths > 0
  )
}

function targetForRestore(
  command: OpeningMatchCommand,
  perspective: PlayerId
): CardPlayTargetRef | HeroPowerTargetRef | undefined {
  const target = commandTargets(command).find(
    (candidate) => candidate.kind === 'hero' || candidate.kind === 'minion'
  )
  if (target) return target
  if (command.type !== 'play-card' && command.type !== 'use-hero-power')
    return undefined
  return { kind: 'hero', participantId: perspective }
}

function hasBeneficialFreeze(
  step: AiPolicyAssessmentStep,
  names: ReadonlySet<string>,
  summary: EventSummary
): boolean {
  if (!names.has('freeze')) return false
  const targets = commandTargets(step.command)
  for (const target of targets) {
    const before = characterState(step.before, target)
    const after = characterState(step.after, target)
    if (!before || !after) continue
    const freezeChanged =
      frozenUntilTurn(step.before, target) !== frozenUntilTurn(step.after, target)
    if (target.kind === 'minion') {
      if (freezeChanged && after.health > 0) return true
    }
    if (
      target.kind === 'hero' &&
      freezeChanged &&
      before.attack + before.weaponAttack > 0 &&
      after.health > 0
    ) {
      return true
    }
  }
  return summary.damageDealt > 0
}

function uniqueFlags(flags: readonly AiPolicyRiskFlag[]): readonly AiPolicyRiskFlag[] {
  return [...new Set(flags)]
}

function deferredNextOwnTurnDraw(
  perspective: PlayerId,
  steps: readonly AiPolicyAssessmentStep[],
  finalState: OpeningMatchState
): AiPolicyDeferredEffects | undefined {
  const lastStep = steps[steps.length - 1]
  if (!lastStep || lastStep.command.type !== 'end-turn') return undefined
  if (finalState.phase !== 'turns' || finalState.activePlayerId === perspective)
    return undefined
  const own = player(finalState, perspective)
  if (!own) return undefined

  const hasDeckCard = own.deck.length > 0
  const cardsDrawn = hasDeckCard ? 1 : 0
  const cardsBurned = hasDeckCard && own.hand.length >= MAX_HAND_SIZE ? 1 : 0
  const fatigueDamage = hasDeckCard ? 0 : Math.max(0, own.fatigueDamage)
  const riskFlags: AiPolicyRiskFlag[] = []
  if (cardsBurned) riskFlags.push('hand-overflow', 'burns-card')
  if (fatigueDamage > 0) riskFlags.push('draws-from-empty-deck')

  return {
    trigger: 'next-own-turn-draw',
    cardsDrawn,
    cardsBurned,
    fatigueDamage,
    riskFlags: uniqueFlags(riskFlags)
  }
}

function emptySummary(): EventSummary {
  return {
    damageDealt: 0,
    damageToSelf: 0,
    damageToOpponent: 0,
    healthRestored: 0,
    armorGained: 0,
    cardsDrawn: 0,
    cardsGenerated: 0,
    cardsBurned: 0,
    fatigueDamage: 0,
    selfFatigueDamage: 0,
    triggeredEffects: 0,
    boardEvents: 0,
    weaponEvents: 0,
    heroEvents: 0,
    deaths: 0
  }
}

export function assessPolicySteps(
  perspective: PlayerId,
  steps: readonly AiPolicyAssessmentStep[],
  finalState: OpeningMatchState,
  stopsAtNewInformation: boolean
): AiPolicyAssessment {
  const total = emptySummary()
  const actions: AiPolicyActionAssessment[] = []
  const policyFlags: AiPolicyRiskFlag[] = []
  let paidNoEffect = false
  let hasBeneficialEffect = false

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!
    const summary = summarizeEvents(step.events, perspective)
    total.damageDealt += summary.damageDealt
    total.damageToSelf += summary.damageToSelf
    total.damageToOpponent += summary.damageToOpponent
    total.healthRestored += summary.healthRestored
    total.armorGained += summary.armorGained
    total.cardsDrawn += summary.cardsDrawn
    total.cardsGenerated += summary.cardsGenerated
    total.cardsBurned += summary.cardsBurned
    total.fatigueDamage += summary.fatigueDamage
    total.selfFatigueDamage += summary.selfFatigueDamage
    total.triggeredEffects += summary.triggeredEffects

    const names = commandActionNames(step.before, step.command)
    const nonFreezeChange = stateChanged(step.before, step.after, true)
    const beneficialFreeze = hasBeneficialFreeze(step, names, summary)
    const beneficialTrigger = summary.cardsDrawn > 0 || summary.cardsGenerated > 0
    const hasBeneficial =
      hasPositiveEvent(summary) || nonFreezeChange || beneficialFreeze
    const flags: AiPolicyRiskFlag[] = []
    const beforePlayer = player(step.before, perspective)
    const afterPlayer = player(step.after, perspective)
    const manaSpent =
      beforePlayer && afterPlayer
        ? Math.max(0, beforePlayer.mana.available - afterPlayer.mana.available)
        : 0

    if (names.has('restore')) {
      const target = targetForRestore(step.command, perspective)
      const beforeTarget = target ? characterState(step.before, target) : undefined
      const afterTarget = target ? characterState(step.after, target) : undefined
      const healthDelta =
        beforeTarget && afterTarget ? afterTarget.health - beforeTarget.health : null
      if (healthDelta !== null && healthDelta <= 0 && !hasBeneficial) {
        flags.push('no-effect')
        if (manaSpent > 0) paidNoEffect = true
      }
    }

    if (names.has('freeze')) {
      const targets = commandTargets(step.command)
      const ineffectiveHero = targets.some((target) => {
        if (target.kind !== 'hero') return false
        const before = characterState(step.before, target)
        const after = characterState(step.after, target)
        if (!before || !after) return false
        const freezeChanged =
          frozenUntilTurn(step.before, target) !== frozenUntilTurn(step.after, target)
        return (
          (!freezeChanged || before.attack + before.weaponAttack <= 0) &&
          summary.damageDealt === 0 &&
          !nonFreezeChange &&
          !beneficialTrigger
        )
      })
      if (ineffectiveHero && !beneficialFreeze) {
        flags.push('ineffective-hero-freeze', 'no-effect')
        if (manaSpent > 0) paidNoEffect = true
      }
    }

    const canHaveNoEffect =
      step.command.type === 'play-card' ||
      step.command.type === 'use-hero-power' ||
      step.command.type === 'attack-character'
    if (canHaveNoEffect && !hasBeneficial && !flags.includes('no-effect')) {
      flags.push('no-effect')
      if (manaSpent > 0) paidNoEffect = true
    }

    if (summary.cardsBurned > 0) flags.push('hand-overflow', 'burns-card')
    if (summary.selfFatigueDamage > 0) flags.push('draws-from-empty-deck')
    if (flags.length > 0) policyFlags.push(...flags)
    hasBeneficialEffect ||= hasBeneficial
    actions.push({
      index,
      action: step.action,
      manaSpent,
      damageDealt: summary.damageDealt,
      healthRestored: summary.healthRestored,
      cardsDrawn: summary.cardsDrawn,
      cardsGenerated: summary.cardsGenerated,
      cardsBurned: summary.cardsBurned,
      fatigueDamage: summary.selfFatigueDamage,
      riskFlags: uniqueFlags(flags),
      hasBeneficialEffect: hasBeneficial,
      beneficialTrigger
    })
  }

  const manaSpent = steps.reduce((sum, step) => {
    const before = player(step.before, perspective)
    const after = player(step.after, perspective)
    return (
      sum +
      (before && after ? Math.max(0, before.mana.available - after.mana.available) : 0)
    )
  }, 0)

  const opponent = finalState.players.find(
    (candidate) => candidate.participantId !== perspective
  )?.participantId
  const immediateLoss = opponent !== undefined && finalState.winnerId === opponent
  if (immediateLoss) policyFlags.push('immediate-loss')
  if (immediateLoss && total.selfFatigueDamage > 0) policyFlags.push('fatigue-lethal')

  const deferredEffects = deferredNextOwnTurnDraw(perspective, steps, finalState)
  if (deferredEffects) policyFlags.push(...deferredEffects.riskFlags)

  const guaranteedLethal = finalState.winnerId === perspective && !stopsAtNewInformation
  return {
    certainty:
      steps.length === 0 ? 'unknown' : stopsAtNewInformation ? 'bounded' : 'proven',
    riskFlags: uniqueFlags(policyFlags),
    effectSummary: {
      manaSpent,
      damageDealt: total.damageDealt,
      damageToSelf: total.damageToSelf,
      damageToOpponent: total.damageToOpponent,
      healthRestored: total.healthRestored,
      armorGained: total.armorGained,
      cardsDrawn: total.cardsDrawn,
      cardsGenerated: total.cardsGenerated,
      cardsBurned: total.cardsBurned,
      fatigueDamage: total.fatigueDamage,
      triggeredEffects: total.triggeredEffects
    },
    actions,
    ...(deferredEffects ? { deferredEffects } : {}),
    guaranteedLethal,
    immediateLoss,
    hasBeneficialEffect,
    rejectable: paidNoEffect || immediateLoss
  }
}

/** Re-evaluates one queued command against the current live state. */
export function assessPolicyCommand(
  match: OpeningMatchInstance,
  perspective: PlayerId,
  command: OpeningMatchCommand
): AiPolicyAssessment | null {
  return match.analyze((fork) => {
    const before = fork.getState()
    const result = fork.dispatch(command)
    if (!result.accepted) return null
    return assessPolicySteps(
      perspective,
      [
        {
          command,
          action: command.type,
          before,
          after: result.state,
          events: result.events
        }
      ],
      result.state,
      false
    )
  })
}
