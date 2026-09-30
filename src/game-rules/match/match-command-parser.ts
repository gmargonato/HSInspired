import type { CardId } from '../content/cards'
import type { PlayerId } from './match-types'
import type {
  OpeningMatchCommand,
  HeroPowerTargetRef,
  CardPlayTargetRef,
  AttackCharacterRef
} from './opening-match-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHeroPowerTarget(value: unknown): HeroPowerTargetRef | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null
  if (value.kind === 'hero') {
    return { kind: 'hero', participantId: value.participantId as PlayerId }
  }
  if (value.kind === 'minion' && typeof value.instanceId === 'string') {
    return {
      kind: 'minion',
      participantId: value.participantId as PlayerId,
      instanceId: value.instanceId
    }
  }
  return null
}

function parseCardPlayTarget(value: unknown): CardPlayTargetRef | null {
  if (
    !isRecord(value) ||
    typeof value.kind !== 'string' ||
    typeof value.participantId !== 'string'
  )
    return null
  if (value.kind === 'hero')
    return { kind: 'hero', participantId: value.participantId as PlayerId }
  if (
    (value.kind === 'minion' ||
      value.kind === 'weapon' ||
      value.kind === 'card' ||
      value.kind === 'secret') &&
    typeof value.instanceId === 'string'
  ) {
    return {
      kind: value.kind,
      participantId: value.participantId as PlayerId,
      instanceId: value.instanceId
    } as CardPlayTargetRef
  }
  return null
}

export function parseCommand(value: unknown): OpeningMatchCommand | null {
  if (!isRecord(value) || typeof value.participantId !== 'string') return null

  if (value.type === 'concede') {
    return { type: 'concede', participantId: value.participantId as PlayerId }
  }

  if (value.type === 'confirm-mulligan') {
    if (!Array.isArray(value.replaceInstanceIds)) return null
    if (!value.replaceInstanceIds.every((id) => typeof id === 'string')) return null
    return {
      type: 'confirm-mulligan',
      participantId: value.participantId as PlayerId,
      replaceInstanceIds: value.replaceInstanceIds
    }
  }

  if (value.type === 'end-turn') {
    return { type: 'end-turn', participantId: value.participantId as PlayerId }
  }

  if (value.type === 'use-hero-power') {
    const target =
      value.target === undefined ? undefined : parseHeroPowerTarget(value.target)
    if (value.target !== undefined && !target) return null
    if (
      value.choice !== undefined &&
      (typeof value.choice !== 'number' || !Number.isInteger(value.choice))
    )
      return null
    return {
      type: 'use-hero-power',
      participantId: value.participantId as PlayerId,
      ...(target ? { target } : {}),
      ...(value.choice === undefined ? {} : { choice: value.choice })
    }
  }

  if (value.type === 'play-card') {
    if (typeof value.cardInstanceId !== 'string') return null
    if (
      value.position !== undefined &&
      (typeof value.position !== 'number' || !Number.isInteger(value.position))
    )
      return null
    if (
      value.choice !== undefined &&
      (typeof value.choice !== 'number' || !Number.isInteger(value.choice))
    )
      return null
    let targets: CardPlayTargetRef[] | undefined
    if (value.targets !== undefined) {
      if (!Array.isArray(value.targets)) return null
      targets = []
      for (const targetValue of value.targets) {
        const target = parseCardPlayTarget(targetValue)
        if (!target) return null
        targets.push(target)
      }
    }
    return {
      type: 'play-card',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId,
      ...(value.position === undefined ? {} : { position: value.position }),
      ...(targets === undefined ? {} : { targets }),
      ...(value.choice === undefined ? {} : { choice: value.choice })
    }
  }

  if (value.type === 'choose-discover-card') {
    if (typeof value.cardInstanceId !== 'string') return null
    return {
      type: 'choose-discover-card',
      participantId: value.participantId as PlayerId,
      cardInstanceId: value.cardInstanceId
    }
  }
  if (value.type === 'choose-card-option') {
    if (
      typeof value.sourceCardInstanceId !== 'string' ||
      typeof value.choice !== 'number' ||
      !Number.isInteger(value.choice)
    )
      return null
    return {
      type: 'choose-card-option',
      participantId: value.participantId as PlayerId,
      sourceCardInstanceId: value.sourceCardInstanceId,
      choice: value.choice
    }
  }
  if (value.type === 'timeout') {
    if (
      value.elapsedSeconds !== undefined &&
      (typeof value.elapsedSeconds !== 'number' || value.elapsedSeconds < 0)
    )
      return null
    return {
      type: 'timeout',
      participantId: value.participantId as PlayerId,
      ...(value.elapsedSeconds === undefined
        ? {}
        : { elapsedSeconds: value.elapsedSeconds })
    }
  }

  if (value.type === 'attack-character') {
    const parseRef = (ref: unknown): AttackCharacterRef | null => {
      if (!isRecord(ref) || typeof ref.kind !== 'string') return null
      if (ref.kind === 'hero') return { kind: 'hero' }
      if (ref.kind === 'minion' && typeof ref.instanceId === 'string') {
        return { kind: 'minion', instanceId: ref.instanceId }
      }
      return null
    }
    const attacker = parseRef(value.attacker)
    const defender = parseRef(value.defender)
    if (!attacker || !defender) return null
    return {
      type: 'attack-character',
      participantId: value.participantId as PlayerId,
      attacker,
      defender
    }
  }

  if (value.type === 'dev-add-card') {
    if (typeof value.cardId !== 'string') return null
    return {
      type: 'dev-add-card',
      participantId: value.participantId as PlayerId,
      cardId: value.cardId as CardId
    }
  }

  if (value.type === 'dev-set-mana') {
    if (typeof value.available !== 'number' || !Number.isInteger(value.available))
      return null
    if (typeof value.maximum !== 'number' || !Number.isInteger(value.maximum))
      return null
    return {
      type: 'dev-set-mana',
      participantId: value.participantId as PlayerId,
      available: value.available,
      maximum: value.maximum
    }
  }

  if (value.type === 'dev-modify-deck') {
    if (value.action !== 'destroy' && value.action !== 'refill') return null
    return {
      type: 'dev-modify-deck',
      participantId: value.participantId as PlayerId,
      action: value.action
    }
  }

  if (value.type === 'dev-summon-minion') {
    if (typeof value.cardId !== 'string') return null
    return {
      type: 'dev-summon-minion',
      participantId: value.participantId as PlayerId,
      cardId: value.cardId as CardId
    }
  }

  if (value.type === 'dev-end-match') {
    if (typeof value.winnerId !== 'string') return null
    return {
      type: 'dev-end-match',
      participantId: value.participantId as PlayerId,
      winnerId: value.winnerId as PlayerId
    }
  }

  if (value.type === 'dev-set-hero') {
    const health = value.health
    const armor = value.armor
    const attack = value.attack
    if (
      ![health, armor, attack].some(
        (entry) => typeof entry === 'number' && Number.isInteger(entry)
      )
    )
      return null
    return {
      type: 'dev-set-hero',
      participantId: value.participantId as PlayerId,
      ...(typeof health === 'number' ? { health } : {}),
      ...(typeof armor === 'number' ? { armor } : {}),
      ...(typeof attack === 'number' ? { attack } : {})
    }
  }
  if (value.type === 'dev-set-hero-power') {
    const cost = value.cost
    const available = value.available
    if (typeof cost !== 'number' && typeof available !== 'boolean') return null
    return {
      type: 'dev-set-hero-power',
      participantId: value.participantId as PlayerId,
      ...(typeof cost === 'number' ? { cost } : {}),
      ...(typeof available === 'boolean' ? { available } : {})
    }
  }
  if (
    value.type === 'dev-clear-zone' &&
    (value.zone === 'hand' || value.zone === 'board')
  )
    return {
      type: 'dev-clear-zone',
      participantId: value.participantId as PlayerId,
      zone: value.zone
    }
  if (
    value.type === 'dev-set-fatigue' &&
    typeof value.nextDamage === 'number' &&
    Number.isInteger(value.nextDamage)
  )
    return {
      type: 'dev-set-fatigue',
      participantId: value.participantId as PlayerId,
      nextDamage: value.nextDamage
    }
  if (value.type === 'dev-remove-weapon')
    return {
      type: 'dev-remove-weapon',
      participantId: value.participantId as PlayerId
    }
  if (value.type === 'dev-draw')
    return { type: 'dev-draw', participantId: value.participantId as PlayerId }

  return null
}
