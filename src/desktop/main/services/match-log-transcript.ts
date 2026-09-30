import {
  CARD_CATALOG,
  HERO_CATALOG,
  HERO_POWER_CATALOG
} from '../../../game-rules/content'
import type { MatchLogRecord } from '../../contracts/ipc/match-logs'

type Data = Record<string, unknown>
const object = (value: unknown): Data =>
  value && typeof value === 'object' ? (value as Data) : {}
const list = (value: unknown): Data[] => (Array.isArray(value) ? value.map(object) : [])
const values = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const line = (value: unknown): string => String(value ?? '').replace(/[\r\n\t]+/g, ' ')
const words = (value: unknown): string => line(value).replace(/[-_]/g, ' ')
const card = (value: unknown): string => {
  const id = String(value ?? '')
  return (
    CARD_CATALOG.get(id)?.name ??
    HERO_CATALOG.get(id)?.displayName ??
    HERO_POWER_CATALOG.get(id)?.displayName ??
    'an unknown card'
  )
}

/** Stateful only for participant labels; entity snapshots are refreshed per command. */
export class MatchLogTranscript {
  private readonly labels = new Map<string, string>()

  format(record: MatchLogRecord): string {
    const data = record.data as Data
    const output: string[] = []
    const add = (text: string): void => {
      output.push(text)
    }
    const who = (id: unknown): string => this.labels.get(String(id)) ?? 'A player'
    if (record.kind === 'match-start') {
      for (const participant of list(data.participants)) {
        this.labels.set(
          String(participant.participantId),
          participant.label === 'Local Player' ? 'Local Player' : 'Remote Player'
        )
        add(`${who(participant.participantId)} is playing ${card(participant.heroId)}.`)
      }
      add(`${who(data.firstPlayerId)} goes first.`)
      for (const hand of list(data.hands))
        add(
          `${who(hand.participantId)}'s opening hand: ${values(hand.cards).map(card).join(', ') || 'empty'}.`
        )
    } else if (record.kind === 'command') {
      const command = object(data.command)
      const actor = who(data.actor)
      const known = new Map(
        [...list(data.entities), ...list(data.cards)].map((entity) => [
          String(entity.id),
          { ...entity }
        ])
      )
      const boards = new Map<string, string[]>()
      for (const entity of list(data.entities)) {
        if (entity.position === undefined) continue
        const owner = String(entity.participantId)
        const board = boards.get(owner) ?? []
        board.push(String(entity.id))
        boards.set(owner, board)
      }
      const remove = (id: unknown): void => {
        for (const board of boards.values()) {
          const position = board.indexOf(String(id))
          if (position >= 0) board.splice(position, 1)
        }
      }
      const name = (value: unknown): string => {
        const ref = typeof value === 'string' ? (known.get(value) ?? {}) : object(value)
        if (ref.kind === 'hero') return `${who(ref.participantId)}'s hero`
        const id = String(ref.instanceId ?? ref.id ?? value)
        const entity = known.get(id) ?? ref
        if (id.endsWith(':hero'))
          return `${who(entity.participantId ?? id.slice(0, -5))}'s hero`
        const owner =
          entity.participantId ??
          ref.participantId ??
          [...this.labels.keys()].find((player) => id.startsWith(player + ':'))
        const board = boards.get(String(owner)) ?? []
        const duplicates =
          board.filter((item) => known.get(item)?.cardId === entity.cardId).length > 1
        return `${who(owner)}'s ${card(entity.cardId ?? ref.cardId)}${duplicates && board.includes(id) ? ` in position ${board.indexOf(id) + 1}` : ''}`
      }
      const touched = new Map<string, Set<string>>()
      const mark = (id: unknown, ...fields: string[]): void => {
        const key = String(id),
          existing = touched.get(key) ?? new Set<string>()
        fields.forEach((field) => existing.add(field))
        touched.set(key, existing)
      }
      const marked = (id: unknown, field: string): boolean =>
        touched.get(String(id))?.has(field) ?? false
      const events = list(data.events)
      const source = object(data.source)
      const attackerRef = { ...object(command.attacker), participantId: data.actor }
      const defenderRef = {
        ...object(command.defender),
        participantId: list(data.players).find(
          (player) => player.participantId !== data.actor
        )?.participantId
      }
      const targets = values(command.targets).length
        ? values(command.targets)
        : command.target
          ? [command.target]
          : []
      const targetText = targets.length
        ? `, targeting ${targets.map(name).join(' and ')}`
        : ''
      const actorState = list(data.players).find(
        (player) => player.participantId === data.actor
      )
      let action: string
      switch (command.type) {
        case 'play-card':
          action = `play ${card(source.cardId)}${source.cost !== undefined ? ` for ${source.cost} mana` : ''}${targetText}`
          break
        case 'use-hero-power':
          action = `use the hero power${targetText}`
          break
        case 'attack-character':
          action = `attack ${name(defenderRef)} with ${name(attackerRef)}`
          break
        case 'end-turn':
          action = `end the turn with ${actorState?.manaBefore ?? 0} mana remaining`
          break
        case 'confirm-mulligan':
          action = 'confirm the opening hand'
          break
        case 'choose-discover-card':
          action = `choose ${card(data.choiceCardId)}`
          break
        case 'choose-card-option':
          action = `choose ${line(data.choiceLabel) || 'a card option'}`
          break
        case 'timeout':
          action = 'end the turn because time ran out'
          break
        default:
          action = 'perform a developer action'
          break
      }
      if (data.accepted === false) {
        add(`${actor} attempts to ${action}.`)
        // Engine messages may contain IDs or developer terminology; use stable plain wording.
        const reason = words(data.code).toLowerCase()
        add(
          reason.includes('mana')
            ? 'The action fails because there is not enough mana.'
            : reason.includes('target')
              ? 'The action fails because the target is not valid.'
              : 'The action is rejected by the game rules.'
        )
      } else {
        if (command.type === 'play-card') add(`${actor} plays ${action.slice(5)}.`)
        else if (command.type === 'end-turn') add(`${actor} ends ${action.slice(4)}.`)
        else if (command.type === 'timeout') add(`${actor}'s turn timer expires.`)
        else if (
          command.type === 'attack-character' &&
          events[0]?.type !== 'combat-started'
        )
          add(
            `${actor} declares an attack on ${name(defenderRef)} with ${name(attackerRef)}.`
          )
        else if (
          command.type === 'choose-discover-card' ||
          command.type === 'choose-card-option'
        )
          add(`${actor} chooses ${action.slice(7)}.`)
        else if (String(command.type).startsWith('dev-'))
          add(
            `Developer action: ${words(command.type).replace(/^dev /, '')} for ${actor}.`
          )

        const damage = (target: string, event: Data): void => {
          if (event.shieldConsumed || event.divineShieldConsumed)
            add(`${target}'s Divine Shield absorbs the damage and is removed.`)
          else if (event.prevented) add(`Damage to ${target} is prevented.`)
          else {
            const armor = Number(
              event.armorDamage ??
                Number(event.armorBefore ?? 0) - Number(event.armorAfter ?? 0)
            )
            const health = Number(
              event.actualDamage ??
                Number(event.healthBefore) - Number(event.healthAfter)
            )
            add(
              `${target} ${armor > 0 ? `loses ${armor} armor and ` : ''}takes ${health} ${armor > 0 ? 'health ' : ''}damage${event.healthAfter !== undefined ? ` and has ${event.healthAfter} health remaining` : ''}.`
            )
          }
        }
        const observed = (id: unknown, event: Data): void => {
          const entity = known.get(String(id))
          if (!entity) return
          for (const field of ['health', 'attack', 'armor']) {
            if (event[field + 'After'] !== undefined)
              entity[field] = event[field + 'After']
          }
        }
        const deathIds = new Set(
          events
            .filter((event) => event.type === 'death-batch-started')
            .flatMap((event) =>
              list(event.deaths).map((death) => String(death.instanceId))
            )
        )
        for (const event of events) {
          const owner = who(event.participantId)
          const id = String(
            object(event.character).kind === 'hero'
              ? `${event.participantId}:hero`
              : (object(event.character).instanceId ?? '')
          )
          switch (event.type) {
            case 'turn-started':
            case 'opening-turn-started':
              if (
                event.type === 'opening-turn-started' &&
                events.some((other) => other.type === 'turn-started')
              )
                break
              add(`\nTurn ${event.turnNumber ?? 1} - ${owner}`)
              add(`${owner} has ${object(event.mana).available} mana.`)
              if (Number(object(event.mana).overloadLocked ?? 0) > 0)
                add(
                  `${owner} has ${object(event.mana).overloadLocked} mana crystals locked by Overload.`
                )
              break
            case 'mulligan-resolved': {
              const returned = list(event.returnedCards),
                received = list(event.replacementCards)
              add(
                returned.length
                  ? `${owner} replaces ${returned.map((entry) => card(entry.cardId)).join(', ')}.`
                  : `${owner} keeps all opening cards.`
              )
              if (received.length)
                add(
                  `${owner} receives ${received.map((entry) => card(entry.cardId)).join(', ')}.`
                )
              break
            }
            case 'card-drawn':
            case 'opening-card-drawn':
            case 'card-generated':
            case 'coin-granted':
            case 'card-burned':
            case 'dev-card-added': {
              const entry = object(event.card)
              known.set(String(entry.instanceId), {
                ...entry,
                participantId: event.participantId
              })
              if (event.type === 'card-burned')
                add(`${owner}'s hand is full. ${card(entry.cardId)} is burned.`)
              else if (event.type === 'card-generated')
                add(`${card(entry.cardId)} is added to ${owner}'s hand.`)
              else
                add(
                  `${owner} ${event.type === 'coin-granted' ? 'receives' : event.type === 'dev-card-added' ? 'receives a developer-added' : 'draws'} ${card(entry.cardId)}.`
                )
              break
            }
            case 'discover-started':
              add(`${owner} must choose a card.`)
              add(
                `${owner}'s options: ${list(event.candidates)
                  .map((entry) => card(entry.cardId))
                  .join(', ')}.`
              )
              break
            case 'card-choice-started':
              add(
                `${owner}'s options: ${list(event.options)
                  .map((entry) => line(entry.label))
                  .join(', ')}.`
              )
              break
            case 'hero-power-used':
              add(
                `${owner} uses ${card(event.heroPowerId)} for ${event.cost} mana${event.target ? `, targeting ${name(event.target)}` : ''}.`
              )
              break
            case 'hero-power-replaced':
              add(`${owner}'s hero power changes to ${card(event.heroPowerId)}.`)
              break
            case 'hero-replaced':
              add(`${owner}'s hero changes to ${card(event.heroId)}.`)
              break
            case 'combat-started':
              add(
                `${name({ ...object(object(event.attacker).character), participantId: object(event.attacker).participantId })} attacks ${name({ ...object(object(event.defender).character), participantId: object(event.defender).participantId })}.`
              )
              break
            case 'character-combat-resolved':
            case 'minion-combat-resolved':
              for (const fighter of events.some(
                (other) =>
                  other.type === 'combat-started' && other.combatId === event.combatId
              )
                ? []
                : [object(event.defender), object(event.attacker)]) {
                const ref = fighter.character
                  ? {
                      ...object(fighter.character),
                      participantId: fighter.participantId
                    }
                  : { instanceId: fighter.instanceId }
                const key =
                  object(ref).kind === 'hero'
                    ? `${fighter.participantId}:hero`
                    : object(ref).instanceId
                damage(name(ref), fighter)
                observed(key, fighter)
                if (
                  fighter.destroyed &&
                  object(ref).kind !== 'hero' &&
                  !deathIds.has(String(key))
                ) {
                  add(`${name(ref)} dies.`)
                  mark(key, 'left')
                  remove(key)
                }
                mark(key, 'health', 'armor', 'divine-shield')
              }
              if (
                event.weapon &&
                !marked(`${object(event.weapon).participantId}:weapon`, 'removed')
              ) {
                const weapon = object(event.weapon)
                add(
                  `${who(weapon.participantId)}'s weapon has ${weapon.durabilityAfter} durability remaining.`
                )
                mark(`${weapon.participantId}:weapon`, 'durability')
              }
              break
            case 'character-damaged':
              damage(
                name({
                  ...object(event.character),
                  participantId: event.participantId
                }),
                event
              )
              observed(id, event)
              mark(id, 'health', 'armor')
              break
            case 'character-healed':
              add(
                `${name({ ...object(event.character), participantId: event.participantId })} restores ${event.amount} health and has ${event.healthAfter} health remaining.`
              )
              observed(id, event)
              mark(id, 'health')
              break
            case 'armor-gained':
              add(
                `${owner}'s hero gains ${event.amount} armor and has ${event.armorAfter} armor.`
              )
              observed(`${event.participantId}:hero`, event)
              mark(`${event.participantId}:hero`, 'armor')
              break
            case 'fatigue':
              add(
                `${owner}'s deck is empty. The fatigue penalty is ${event.amount} damage.`
              )
              break
            case 'minion-played':
            case 'minion-summoned':
            case 'hero-power-minion-summoned':
            case 'dev-minion-summoned': {
              const minion = object(event.minion),
                key = String(minion.instanceId)
              known.set(key, { ...minion, participantId: event.participantId })
              remove(key)
              const board = boards.get(String(event.participantId)) ?? []
              board.splice(Number(event.position), 0, key)
              boards.set(String(event.participantId), board)
              mark(key, 'entered')
              if (event.type !== 'minion-played')
                add(
                  `${owner} summons ${card(minion.cardId)} with ${minion.attack} attack and ${minion.health} health in position ${Number(event.position) + 1}.`
                )
              break
            }
            case 'death-batch-started': {
              const deaths = list(event.deaths)
              const minions = deaths.filter((death) => death.kind === 'minion')
              if (minions.length)
                add(
                  `${minions.map((death) => name(death)).join(' and ')} ${minions.length > 1 ? 'die' : 'dies'}.`
                )
              for (const death of deaths) {
                if (death.kind === 'weapon') {
                  add(`${name(death)} is destroyed.`)
                  mark(`${death.participantId}:weapon`, 'removed')
                }
                remove(death.instanceId)
                mark(death.instanceId, 'left')
              }
              break
            }
            case 'trigger-activated':
              add(
                `${name({ ...object(event.source), participantId: event.participantId })}'s ${event.trigger === 'deathrattle' ? 'Deathrattle' : event.trigger === 'battlecry' ? 'Battlecry' : words(event.trigger)} activates.`
              )
              break
            case 'weapon-equipped': {
              const weapon = object(event.weapon)
              known.set(String(weapon.instanceId), {
                ...weapon,
                participantId: event.participantId
              })
              add(
                `${owner} equips ${card(weapon.cardId)} with ${weapon.attack} attack and ${weapon.durability} durability.`
              )
              mark(`${event.participantId}:weapon`, 'equipped')
              break
            }
            case 'match-ended':
              break // Emit result after final state-only changes.
            case 'dev-mana-set':
              add(`${owner} now has ${object(event.mana).available} mana.`)
              break
            case 'dev-deck-modified':
              add(`${owner}'s deck now contains ${event.deckCount} cards.`)
              break
            case 'effect-resolved': {
              const effect = object(event.data),
                key = String(effect.target ?? ''),
                target = name({ instanceId: key, cardId: effect.cardId })
              const effectOwner = who(effect.participantId ?? event.controllerId)
              observed(key, effect)
              switch (event.action) {
                case 'damage':
                  damage(target, effect)
                  mark(
                    key,
                    'health',
                    'armor',
                    ...(effect.shieldConsumed ? ['divine-shield'] : [])
                  )
                  break
                case 'restore':
                  if (!effect.replaced) {
                    add(
                      `${target} restores ${effect.amount} health${effect.healthAfter !== undefined ? ` and has ${effect.healthAfter} health remaining` : ''}.`
                    )
                    mark(key, 'health')
                  }
                  break
                case 'modify':
                  if (
                    effect.attackBefore !== effect.attackAfter ||
                    effect.healthBefore !== effect.healthAfter
                  )
                    add(
                      `${target} now has ${effect.attackAfter} attack and ${effect.healthAfter} health.`
                    )
                  mark(key, 'attack', 'health')
                  break
                case 'gain-armor':
                  add(
                    `${target} gains ${effect.amount} armor and has ${effect.armor} armor.`
                  )
                  observed(key, { armorAfter: effect.armor })
                  mark(key, 'armor')
                  break
                case 'gain-mana':
                  add(
                    `${effectOwner} now has ${object(effect.mana).available} mana and ${object(effect.mana).maximum} mana crystals.`
                  )
                  break
                case 'overload':
                  add(
                    `${effectOwner} will have ${effect.overloadNextTurn} mana crystals locked next turn.`
                  )
                  break
                case 'unlock-overload':
                  add(`${effectOwner} unlocks ${effect.amount} mana crystals.`)
                  break
                case 'destroy-mana-crystal':
                  add(`${effectOwner} loses ${effect.amount} mana crystals.`)
                  break
                case 'freeze':
                  add(`${target} is frozen.`)
                  mark(key, 'frozen')
                  break
                case 'silence':
                  add(
                    `${target} is silenced${effect.attack !== undefined ? ` and now has ${effect.attack} attack and ${effect.health} health` : ''}.`
                  )
                  observed(key, {
                    attackAfter: effect.attack,
                    healthAfter: effect.health
                  })
                  mark(key, 'silenced')
                  break
                case 'transform':
                  add(`${target} transforms into ${card(effect.cardId)}.`)
                  if (known.has(key)) known.get(key)!.cardId = effect.cardId
                  mark(key, 'cardId')
                  break
                case 'take-control':
                case 'return-control': {
                  add(`${who(effect.controllerId)} takes control of ${target}.`)
                  remove(key)
                  if (known.has(key))
                    known.get(key)!.participantId = effect.controllerId
                  const board = boards.get(String(effect.controllerId)) ?? []
                  board.push(key)
                  boards.set(String(effect.controllerId), board)
                  mark(key, 'participantId')
                  break
                }
                case 'return-to-hand':
                  add(
                    effect.burned
                      ? `${target} leaves the board and is burned because the hand is full.`
                      : `${target} returns to hand.`
                  )
                  remove(key)
                  mark(key, 'left')
                  break
                case 'discard':
                  add(`${target} is discarded.`)
                  break
                case 'destroy':
                  if (!deathIds.has(key)) add(`${target} is destroyed.`)
                  mark(key, 'left')
                  break
                case 'destroy-secrets':
                  add(`${effectOwner} loses ${effect.count} secrets.`)
                  break
                case 'counter-event':
                  add(`${card(event.sourceCardId)} counters the action.`)
                  break
                case 'prevent-lethal':
                  add(`${card(event.sourceCardId)} prevents lethal damage.`)
                  break
                case 'reveal':
                  add(
                    `${who(known.get(String(effect.secretId ?? effect.instanceId))?.participantId ?? effect.participantId ?? event.controllerId)} reveals ${card(effect.cardId)}.`
                  )
                  break
                case 'change-cost':
                  add(
                    `${target}'s mana cost changes${effect.currentCost !== undefined ? ` to ${effect.currentCost}` : ''}.`
                  )
                  break
                case 'set-health':
                  add(`${target}'s health is set to ${effect.health}.`)
                  observed(key, { healthAfter: effect.health })
                  mark(key, 'health')
                  break
                case 'remove-keyword':
                  add(`${target} loses ${words(effect.keyword)}.`)
                  mark(key, String(effect.keyword))
                  break
                case 'grant-deathrattle':
                  add(`${target} gains a Deathrattle.`)
                  break
                case 'set-turn-limit':
                  add(`The turn time limit is now ${effect.seconds} seconds.`)
                  break
                case 'schedule':
                  add(
                    `${card(event.sourceCardId)} schedules an effect${effect.executeOnTurn !== undefined ? ` for turn ${effect.executeOnTurn}` : ''}.`
                  )
                  break
                // Concrete draw/summon/equip events already describe these effects.
                case 'draw':
                case 'burn':
                case 'add-to-hand':
                case 'summon':
                case 'equip':
                  break
                default:
                  add(
                    `${card(event.sourceCardId)} resolves an effect: ${words(event.action)}${key ? ` affecting ${target}` : ''}.`
                  )
              }
              break
            }
          }
        }
        for (const change of list(data.changes)) {
          const before = object(change.before),
            after = object(change.after),
            key = String(change.id)
          if (!change.after) {
            if (!marked(key, 'left')) add(`${name(key)} leaves the board.`)
          } else if (!change.before) {
            if (!marked(key, 'entered'))
              add(
                `${who(after.participantId)}'s ${card(after.cardId)} enters the board with ${after.attack} attack and ${after.health} health.`
              )
          } else {
            if (before.cardId !== after.cardId && !marked(key, 'cardId'))
              add(`${name(key)} is now ${card(after.cardId)}.`)
            if (
              before.participantId !== after.participantId &&
              !marked(key, 'participantId')
            )
              add(`${who(after.participantId)} now controls ${card(after.cardId)}.`)
            if (
              (known.get(key)?.attack !== after.attack &&
                before.attack !== after.attack) ||
              (known.get(key)?.health !== after.health &&
                before.health !== after.health)
            )
              add(
                `${name(key)} finishes the action with ${after.attack} attack and ${after.health} health.`
              )
            if (before.armor !== after.armor && known.get(key)?.armor !== after.armor)
              add(`${name(key)} finishes the action with ${after.armor} armor.`)
            const oldFlags = values(before.flags),
              newFlags = values(after.flags)
            for (const flag of new Set([...oldFlags, ...newFlags])) {
              if (
                oldFlags.includes(flag) === newFlags.includes(flag) ||
                marked(key, String(flag))
              )
                continue
              add(
                `${name(key)} ${newFlags.includes(flag) ? 'gains' : 'loses'} ${words(flag)}.`
              )
            }
          }
        }
        for (const player of list(data.players)) {
          const key = `${player.participantId}:weapon`,
            before = object(player.weaponBefore),
            after = object(player.weaponAfter)
          if (player.weaponBefore && !player.weaponAfter && !marked(key, 'removed'))
            add(`${who(player.participantId)}'s ${card(before.cardId)} is removed.`)
          else if (
            player.weaponBefore &&
            player.weaponAfter &&
            !marked(key, 'equipped') &&
            !marked(key, 'durability') &&
            (before.attack !== after.attack || before.durability !== after.durability)
          )
            add(
              `${who(player.participantId)}'s ${card(after.cardId)} now has ${after.attack} attack and ${after.durability} durability.`
            )
        }
        const ended = events.find((event) => event.type === 'match-ended')
        if (ended)
          add(
            ended.winnerId
              ? `${who(ended.winnerId)} wins.`
              : 'The match ends in a draw.'
          )
      }
    }
    return output.length ? output.join('\n') + '\n' : ''
  }
}
