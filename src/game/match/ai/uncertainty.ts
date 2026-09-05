import { CARD_CATALOG, type CardDefinition } from '../../content/cards'
import { HERO_CATALOG } from '../../content/heroes'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  OpeningMatchCommand as TurnMatchCommand,
  OpeningMatchState
} from '../opening-match-types'

const UNKNOWN_INFORMATION_PATTERN =
  /random|discover|shuffle|generate|draw|joust|reveal|deck-top|random-card|other-player-hand|player-has-card-in-hand|"action":"discard"|"source":"deck"|"zone":"deck"/

interface TriggerBlockView {
  readonly trigger: string
  readonly event?: Readonly<Record<string, unknown>>
}

/** Whether authored mechanics would consume an unknown card/order/random result. */
export function usesUnknownInformation(value: unknown): boolean {
  return UNKNOWN_INFORMATION_PATTERN.test(JSON.stringify(value ?? []).toLowerCase())
}

/** Effects that resolve as part of playing the card, excluding later triggers. */
export function immediateCardEffects(
  definition: CardDefinition
): readonly CardDefinition['effects'][number][] {
  const immediateTriggers =
    definition.type === 'Minion' || definition.type === 'Hero'
      ? new Set(['on-play', 'battlecry'])
      : definition.type === 'Weapon'
        ? new Set(['on-play'])
        : definition.keywords.includes('secret')
          ? new Set(['on-secret-played'])
          : new Set(['on-play', 'cast'])
  return definition.effects.filter((block) => immediateTriggers.has(block.trigger))
}

function commandCardDefinition(
  command: TurnMatchCommand,
  state: OpeningMatchState
): CardDefinition | undefined {
  if (command.type !== 'play-card') return undefined
  const card = state.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  return card ? CARD_CATALOG.get(card.cardId) : undefined
}

function addEffectEventTypes(value: unknown, result: Set<string>): void {
  const serialized = JSON.stringify(value ?? []).toLowerCase()
  if (
    serialized.includes('"action":"damage"') ||
    /"kind":"(?:damage-character|damage-enemy-hero|damage-random-enemy|draw-and-self-damage)"/.test(
      serialized
    )
  ) {
    result.add('damage-dealt')
    result.add('hero-damaged')
    result.add('hero-would-die')
    result.add('minion-died')
    result.add('minion-destroyed')
  }
  if (
    /"action":"(?:destroy|destroy-all-but-highest-attack|destroy-and-gain-stats|sacrifice-and-damage|transform)"/.test(
      serialized
    )
  ) {
    result.add('minion-destroyed')
    result.add('minion-died')
    result.add('weapon-died')
  }
  if (
    /"action":"(?:restore|return-to-play)"/.test(serialized) ||
    serialized.includes('"kind":"restore-character"')
  )
    result.add('health-restored')
  if (
    /"action":"(?:gain-armor|give-armor)"/.test(serialized) ||
    /"kind":"(?:gain-armor|gain-attack-and-armor)"/.test(serialized)
  )
    result.add('armor-gained')
  if (
    /"action":"(?:summon|summon-copy|summon-for-each|summon-random)"/.test(
      serialized
    ) ||
    /"kind":"(?:summon|summon-random-totem)"/.test(serialized)
  )
    result.add('minion-summoned')
  if (
    /"action":"(?:equip|equip-random)"/.test(serialized) ||
    serialized.includes('"kind":"equip-weapon"')
  )
    result.add('weapon-equipped')
  if (serialized.includes('"kind":"draw-and-self-damage"')) result.add('card-drawn')
  if (serialized.includes('"action":"overload"')) result.add('overload-applied')
}

function commandEventTypes(
  command: TurnMatchCommand,
  state: OpeningMatchState
): ReadonlySet<string> {
  const result = new Set<string>()
  if (command.type === 'play-card') {
    result.add('card-played')
    const definition = commandCardDefinition(command, state)
    if (definition?.type === 'Spell') {
      result.add('spell-cast')
      if ((command.targets ?? []).some((target) => target.kind === 'minion'))
        result.add('spell-targeted-minion')
    }
    if (definition?.type === 'Minion') {
      result.add('minion-played')
      result.add('first-minion-played-this-turn')
      result.add('minion-summoned')
    }
    if (definition?.type === 'Weapon') result.add('weapon-equipped')
    if (definition?.keywords.includes('secret')) result.add('secret-played')
    if (definition) addEffectEventTypes(immediateCardEffects(definition), result)
  } else if (command.type === 'attack-character') {
    result.add('character-attacked')
    result.add('damage-dealt')
    result.add('hero-damaged')
    result.add('minion-died')
    result.add('minion-destroyed')
    if (command.defender.kind === 'hero') {
      result.add('hero-attacked')
      if (command.attacker.kind === 'minion') result.add('minion-attacks-hero')
    } else {
      result.add('minion-attacked')
      result.add('friendly-minion-attacked')
    }
  } else if (command.type === 'use-hero-power') {
    result.add('hero-power-used')
    const self = state.players.find(
      (player) => player.participantId === command.participantId
    )
    const power = self ? HERO_POWER_CATALOG.get(self.heroPower.id) : undefined
    if (power) addEffectEventTypes(power.effect, result)
  } else if (command.type === 'end-turn') {
    result.add('turn-ended')
    result.add('turn-started')
  }
  return result
}

function couldTriggerFacedownSecret(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  events: ReadonlySet<string>,
  perspectivePlayerId: string
): boolean {
  const opponent = state.players.find(
    (player) => player.participantId !== command.participantId
  )
  if (!opponent?.secrets?.some((secret) => !secret.revealed)) return false
  // The perspective player knows its own Secrets even while they are facedown
  // to the acting opponent, so simulating those does not cross hidden state.
  if (opponent.participantId === perspectivePlayerId) return false
  const opponentClass = HERO_CATALOG.require(opponent.heroId).classId
  return CARD_CATALOG.all.some(
    (definition) =>
      definition.keywords.includes('secret') &&
      (definition.cardClass === opponentClass || definition.cardClass === 'Neutral') &&
      definition.effects.some(
        (block) =>
          block.trigger === 'secret' &&
          typeof block.event?.['type'] === 'string' &&
          events.has(block.event['type'])
      )
  )
}

/** Whether the command publicly tests at least one still-facedown enemy Secret. */
export function commandTestsFacedownSecret(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  perspectivePlayerId: string = command.participantId
): boolean {
  return couldTriggerFacedownSecret(
    command,
    state,
    commandEventTypes(command, state),
    perspectivePlayerId
  )
}

function commandTargetsMinion(
  command: TurnMatchCommand,
  participantId: string,
  instanceId: string
): boolean {
  if (command.type === 'attack-character') {
    return (
      (command.participantId === participantId &&
        command.attacker.kind === 'minion' &&
        command.attacker.instanceId === instanceId) ||
      (command.defender.kind === 'minion' && command.defender.instanceId === instanceId)
    )
  }
  const targets: readonly CardPlayTargetRef[] =
    command.type === 'play-card'
      ? (command.targets ?? [])
      : command.type === 'use-hero-power' && command.target
        ? [command.target]
        : []
  return targets.some(
    (target) =>
      target.kind === 'minion' &&
      target.participantId === participantId &&
      target.instanceId === instanceId
  )
}

function boardMinion(
  state: OpeningMatchState,
  participantId: string,
  instanceId: string
) {
  return state.players
    .find((player) => player.participantId === participantId)
    ?.board.find((minion) => minion.instanceId === instanceId)
}

function attackingCharacterDamage(
  state: OpeningMatchState,
  participantId: string,
  ref: AttackCharacterRef
): number {
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  if (!player) return 0
  if (ref.kind === 'hero')
    return Math.max(0, player.hero.attack + (player.weapon?.attack ?? 0))
  return Math.max(
    0,
    player.board.find((minion) => minion.instanceId === ref.instanceId)?.attack ?? 0
  )
}

function commandCouldDamageMinion(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  participantId: string,
  instanceId: string,
  broadDamageImpact: boolean
): boolean {
  const minion = boardMinion(state, participantId, instanceId)
  if (!minion) return false
  if (!broadDamageImpact && !commandTargetsMinion(command, participantId, instanceId))
    return false
  const hasDivineShield =
    minion.divineShield || (minion.keywords ?? []).includes('divine-shield')
  if (command.type === 'attack-character') {
    let damage = 0
    if (
      command.attacker.kind === 'minion' &&
      command.participantId === participantId &&
      command.attacker.instanceId === instanceId
    ) {
      const defender = command.defender
      const defenderPlayer = state.players.find((player) =>
        defender.kind === 'hero'
          ? player.participantId !== command.participantId
          : player.board.some(
              (candidate) => candidate.instanceId === defender.instanceId
            )
      )
      if (defenderPlayer)
        damage = attackingCharacterDamage(state, defenderPlayer.participantId, defender)
    } else if (
      command.defender.kind === 'minion' &&
      command.defender.instanceId === instanceId
    ) {
      damage = attackingCharacterDamage(state, command.participantId, command.attacker)
    }
    return !hasDivineShield && damage > 0
  }
  if (command.type === 'use-hero-power') {
    const player = state.players.find(
      (candidate) => candidate.participantId === command.participantId
    )
    const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
    const damage =
      power?.effect.kind === 'damage-character'
        ? (player?.heroPower.effectOverride?.damage ?? power.effect.amount)
        : 0
    return !hasDivineShield && damage > 0
  }
  const definition = commandCardDefinition(command, state)
  if (!definition) return false
  return JSON.stringify(immediateCardEffects(definition))
    .toLowerCase()
    .includes('"action":"damage"')
}

function commandCouldKillMinion(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  participantId: string,
  instanceId: string,
  broadMinionImpact: boolean
): boolean {
  const minion = boardMinion(state, participantId, instanceId)
  if (!minion) return false
  if (broadMinionImpact) return true
  if (!commandTargetsMinion(command, participantId, instanceId)) return false
  const hasDivineShield =
    minion.divineShield || (minion.keywords ?? []).includes('divine-shield')
  if (command.type === 'attack-character') {
    let damage = 0
    if (
      command.attacker.kind === 'minion' &&
      command.participantId === participantId &&
      command.attacker.instanceId === instanceId
    ) {
      const defender = command.defender
      const defenderPlayer = state.players.find((player) =>
        defender.kind === 'hero'
          ? player.participantId !== command.participantId
          : player.board.some(
              (candidate) => candidate.instanceId === defender.instanceId
            )
      )
      if (defenderPlayer) {
        damage = attackingCharacterDamage(state, defenderPlayer.participantId, defender)
      }
    } else if (
      command.defender.kind === 'minion' &&
      command.defender.instanceId === instanceId
    ) {
      damage = attackingCharacterDamage(state, command.participantId, command.attacker)
    }
    return !hasDivineShield && damage >= minion.health
  }
  if (command.type === 'use-hero-power') {
    const player = state.players.find(
      (candidate) => candidate.participantId === command.participantId
    )
    const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
    const damage =
      power?.effect.kind === 'damage-character'
        ? (player?.heroPower.effectOverride?.damage ?? power.effect.amount)
        : 0
    return !hasDivineShield && damage >= minion.health
  }
  const definition = commandCardDefinition(command, state)
  if (!definition) return false
  const immediate = immediateCardEffects(definition)
  const serialized = JSON.stringify(immediate).toLowerCase()
  if (/"action":"(?:destroy|transform)"/.test(serialized)) return true
  let damage = 0
  for (const block of immediate) {
    for (const action of block.actions ?? []) {
      if (action.action !== 'damage') continue
      if (typeof action.amount !== 'number') return true
      damage += action.amount
    }
  }
  if (damage <= 0 || hasDivineShield) return false
  const player = state.players.find(
    (candidate) => candidate.participantId === command.participantId
  )
  const spellDamage =
    player?.board.reduce(
      (total, candidate) => total + (candidate.spellDamage ?? 0),
      0
    ) ?? 0
  return damage + spellDamage >= minion.health
}

function hasBroadMinionImpact(
  command: TurnMatchCommand,
  state: OpeningMatchState
): boolean {
  const definition = commandCardDefinition(command, state)
  if (!definition) return false
  const serialized = JSON.stringify(immediateCardEffects(definition)).toLowerCase()
  return (
    /"action":"(?:damage|destroy|transform)"/.test(serialized) &&
    /"selection":"(?:all|adjacent|chosen-and-adjacent)"/.test(serialized)
  )
}

function hasBroadDamageImpact(
  command: TurnMatchCommand,
  state: OpeningMatchState
): boolean {
  const definition = commandCardDefinition(command, state)
  if (!definition) return false
  const serialized = JSON.stringify(immediateCardEffects(definition)).toLowerCase()
  return (
    serialized.includes('"action":"damage"') &&
    /"selection":"(?:all|adjacent|chosen-and-adjacent)"/.test(serialized)
  )
}

function blockCouldTrigger(
  block: TriggerBlockView,
  command: TurnMatchCommand,
  state: OpeningMatchState,
  events: ReadonlySet<string>,
  sourceParticipantId: string,
  sourceInstanceId: string,
  broadMinionImpact: boolean,
  sourceIsWeapon: boolean
): boolean {
  if (block.trigger === 'aura' || block.trigger === 'while-in-hand') return false
  if (block.trigger === 'end-of-turn' || block.trigger === 'start-of-turn')
    return command.type === 'end-turn'
  if (block.trigger === 'inspire') return command.type === 'use-hero-power'
  if (block.trigger === 'on-attack') {
    return (
      command.type === 'attack-character' &&
      command.participantId === sourceParticipantId &&
      ((command.attacker.kind === 'hero' && sourceIsWeapon) ||
        (command.attacker.kind === 'minion' &&
          command.attacker.instanceId === sourceInstanceId))
    )
  }
  if (block.trigger === 'on-damage') {
    return commandCouldDamageMinion(
      command,
      state,
      sourceParticipantId,
      sourceInstanceId,
      hasBroadDamageImpact(command, state)
    )
  }
  if (block.trigger === 'on-death' || block.trigger === 'deathrattle') {
    if (sourceIsWeapon) {
      const weapon = state.players.find(
        (player) => player.participantId === sourceParticipantId
      )?.weapon
      return (
        command.type === 'attack-character' &&
        command.participantId === sourceParticipantId &&
        command.attacker.kind === 'hero' &&
        weapon?.instanceId === sourceInstanceId &&
        weapon.durability <= 1
      )
    }
    return commandCouldKillMinion(
      command,
      state,
      sourceParticipantId,
      sourceInstanceId,
      broadMinionImpact
    )
  }
  if (typeof block.event?.['type'] === 'string') return events.has(block.event['type'])
  if (block.trigger === 'on-card-played') return command.type === 'play-card'
  if (block.trigger === 'on-cast')
    return command.type === 'play-card' && events.has('spell-cast')
  if (block.trigger === 'on-summon') return events.has('minion-summoned')
  if (block.trigger === 'on-secret-played') return events.has('secret-played')
  return false
}

function couldTriggerUnknownPermanent(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  events: ReadonlySet<string>
): boolean {
  const broadMinionImpact = hasBroadMinionImpact(command, state)
  for (const player of state.players) {
    for (const minion of player.board) {
      const blocks = [
        ...(CARD_CATALOG.get(minion.cardId)?.effects ?? []),
        ...(minion.grantedTriggers ?? []),
        ...(minion.attachedEffects ?? []),
        ...(minion.deathrattles ?? [])
      ]
      if (
        blocks.some(
          (block) =>
            usesUnknownInformation(block) &&
            blockCouldTrigger(
              block,
              command,
              state,
              events,
              player.participantId,
              minion.instanceId,
              broadMinionImpact,
              false
            )
        )
      )
        return true
    }
    if (player.weapon) {
      const blocks = CARD_CATALOG.get(player.weapon.cardId)?.effects ?? []
      if (
        blocks.some(
          (block) =>
            usesUnknownInformation(block) &&
            blockCouldTrigger(
              block,
              command,
              state,
              events,
              player.participantId,
              player.weapon!.instanceId,
              false,
              true
            )
        )
      )
        return true
    }
  }
  return false
}

/**
 * True only when resolving this command could cross a private/random boundary.
 * It uses public class/count information for opposing Secrets and never reads
 * their authoritative card IDs.
 */
export function commandUsesUncertainty(
  command: TurnMatchCommand,
  state: OpeningMatchState,
  perspectivePlayerId: string = command.participantId
): boolean {
  const events = commandEventTypes(command, state)
  if (couldTriggerFacedownSecret(command, state, events, perspectivePlayerId))
    return true
  const self = state.players.find(
    (player) => player.participantId === command.participantId
  )
  if (command.type === 'use-hero-power') {
    const power = self ? HERO_POWER_CATALOG.get(self.heroPower.id) : undefined
    if (usesUnknownInformation(power?.effect)) return true
  }
  const definition = commandCardDefinition(command, state)
  if (definition && usesUnknownInformation(immediateCardEffects(definition)))
    return true
  if (couldTriggerUnknownPermanent(command, state, events)) return true
  // Turn handoff consumes an unknown top card and may fire its on-draw effect.
  // Search must stop before dispatch even when the resulting card would remain
  // hidden, because its mechanics could alter public health or board state.
  if (command.type === 'end-turn') return true
  return false
}
