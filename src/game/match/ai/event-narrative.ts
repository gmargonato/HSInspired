import { CARD_CATALOG } from '../../content/cards'
import { HERO_POWER_CATALOG } from '../../content/hero-powers'
import type {
  HistoryEntitySnapshot,
  OpeningMatchPublicEvent
} from '../opening-match-types'

const cardName = (id: string | null | undefined): string =>
  id
    ? (CARD_CATALOG.get(id)?.name ?? HERO_POWER_CATALOG.get(id)?.displayName ?? id)
    : 'an unrevealed card'
/** Describes observed facts, never benefits, risks, intentions, or hidden outcomes. */
export function describeAiEvents(
  events: readonly OpeningMatchPublicEvent[],
  perspectivePlayerId: string
): readonly string[] {
  const actor = (id: string): string =>
    id === perspectivePlayerId ? 'You' : 'Your opponent'
  const possessive = (id: string): string =>
    id === perspectivePlayerId ? 'your' : "your opponent's"
  const entity = (value: HistoryEntitySnapshot): string =>
    possessive(value.participantId) +
    ' ' +
    (value.concealedAs === 'secret'
      ? 'unrevealed Secret'
      : value.heroPowerId
        ? cardName(value.heroPowerId)
        : value.kind === 'hero'
          ? 'hero'
          : cardName(value.cardId)) +
    ' [' +
    value.id +
    ']'
  return events.flatMap((event): string[] => {
    switch (event.type) {
      case 'combat-started':
        // Omit the start only when this batch also contains its resolved outcome.
        if (
          events.some(
            (other) =>
              (other.type === 'character-combat-resolved' ||
                other.type === 'minion-combat-resolved') &&
              other.combatId === event.combatId
          )
        )
          return []
        return [
          actor(event.attacker.participantId) +
            ' began an attack against ' +
            possessive(event.defender.participantId) +
            ' ' +
            (event.defender.character.kind === 'hero'
              ? 'hero'
              : 'minion [' + event.defender.character.instanceId + ']') +
            '.'
        ]
      case 'character-combat-resolved':
      case 'minion-combat-resolved': {
        const combatant = (value: typeof event.attacker): string => {
          const ref =
            'character' in value
              ? value.character
              : { kind: 'minion', instanceId: value.instanceId }
          return (
            possessive(value.participantId) +
            ' ' +
            (ref.kind === 'hero'
              ? 'hero'
              : 'minion [' + ('instanceId' in ref ? ref.instanceId : '') + ']') +
            ` (attack ${value.attack}; health ${value.healthBefore} → ${value.healthAfter}` +
            ('armorBefore' in value
              ? `; armor ${value.armorBefore} → ${value.armorAfter}`
              : '') +
            `; incoming damage attempted ${value.attemptedDamage}` +
            (value.divineShieldConsumed ? '; Divine Shield consumed' : '') +
            (value.destroyed ? '; destroyed' : '') +
            ')'
          )
        }
        return [
          'Combat: ' +
            combatant(event.attacker) +
            ' attacked ' +
            combatant(event.defender) +
            '.' +
            ('weapon' in event && event.weapon
              ? ` ${possessive(event.weapon.participantId)} weapon durability ${event.weapon.durabilityBefore} → ${event.weapon.durabilityAfter}.`
              : '')
        ]
      }
      case 'effect-resolved':
        return [] // Internal effect payloads are represented by public history outcomes.
      case 'history-action-resolved': {
        const action = {
          card: 'played',
          'hero-power': 'used',
          combat: 'attacked with',
          trigger: 'triggered',
          fatigue: 'resolved fatigue on'
        }[event.action]
        const lines = [
          actor(event.participantId) + ' ' + action + ' ' + entity(event.source) + '.'
        ]
        for (const outcome of event.outcomes) {
          const target = entity(outcome.target)
          const amount = outcome.amount === undefined ? '' : ' ' + outcome.amount
          const verbs: Record<string, string> = {
            'cast-spell': 'had a spell cast',
            damage: 'took damage',
            death: 'died',
            'summon-board': 'was summoned',
            'create-hand': 'was added to hand',
            destroy: 'was destroyed',
            buff: 'was modified',
            heal: 'was healed',
            armor: 'gained armor',
            draw: 'was drawn',
            fatigue: 'took fatigue damage',
            freeze: 'was frozen',
            silence: 'was silenced',
            'shield-lost': 'lost Divine Shield',
            prevented: 'had an effect prevented',
            'return-hand': 'returned to hand',
            'shuffle-deck': 'was shuffled into the deck',
            discard: 'was discarded',
            burn: 'was burned',
            transform: 'was transformed',
            control: 'changed controller',
            equip: 'was equipped',
            state: 'changed state'
          }
          const deltas = [
            outcome.healthDamage === undefined
              ? ''
              : 'health damage ' + outcome.healthDamage,
            outcome.armorDamage === undefined
              ? ''
              : 'armor damage ' + outcome.armorDamage,
            outcome.attackDelta === undefined
              ? ''
              : 'attack change ' + outcome.attackDelta,
            outcome.healthDelta === undefined
              ? ''
              : 'health change ' + outcome.healthDelta
          ].filter(Boolean)
          lines.push(
            target +
              ' ' +
              verbs[outcome.kind] +
              amount +
              (deltas.length ? ' (' + deltas.join(', ') + ')' : '') +
              '.'
          )
        }
        return lines
      }
      case 'minion-played':
      case 'minion-summoned':
        return [
          actor(event.participantId) +
            ': ' +
            event.type.replaceAll('-', ' ') +
            ' ' +
            cardName(event.minion.cardId) +
            ' [' +
            event.minion.instanceId +
            '], ' +
            event.minion.attack +
            '/' +
            event.minion.health +
            '.'
        ]
      case 'battlecry-repetition-started':
        return [
          actor(event.participantId) +
            ': Battlecry of ' +
            cardName(event.minion.cardId) +
            ' [' +
            event.minion.instanceId +
            '] triggers (' +
            (event.repetition + 1) +
            '/' +
            event.repetitions +
            ').'
        ]
      case 'turn-started':
      case 'opening-turn-started':
        return [
          (event.participantId === perspectivePlayerId
            ? 'Your turn'
            : "Your opponent's turn") +
            ' began (global turn ' +
            ('turnNumber' in event ? event.turnNumber : 1) +
            ').'
        ]
      case 'card-drawn':
      case 'opening-card-drawn':
      case 'card-generated':
      case 'card-burned':
      case 'coin-granted':
        return [
          actor(event.participantId) +
            ': ' +
            event.type.replaceAll('-', ' ') +
            ' ' +
            cardName(event.card.cardId) +
            ' [' +
            event.card.instanceId +
            '].'
        ]
      case 'mulligan-resolved':
        return [
          actor(event.participantId) +
            ' replaced ' +
            event.returnedCards.length +
            ' opening cards; received ' +
            event.replacementCards
              .map((card) => cardName(card.cardId) + ' [' + card.instanceId + ']')
              .join(', ') +
            '.'
        ]
      default:
        // Keep uncommon public facts structured; relabel ownership, never instance IDs.
        return [
          event.type.replaceAll('-', ' ') +
            ': ' +
            JSON.stringify(event, (key, value: unknown) =>
              ['participantId', 'ownerId', 'activePlayerId', 'winnerId'].includes(
                key
              ) && typeof value === 'string'
                ? actor(value)
                : value
            )
        ]
    }
  })
}
