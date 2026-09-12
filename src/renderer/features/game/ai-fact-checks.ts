import { CARD_CATALOG } from '../../../game/content/cards'
import type { AiFactCheck } from '../../../shared/ipc/ai-deliberation'
import type { JsonObject, JsonValue } from '../../../shared/ipc/ai'
import { cardFacts } from './ai-context'

const object = (value: JsonValue | undefined): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
const array = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : []

/** Accepts only the already-fair model snapshot, never a match instance, checkpoint or RNG. */
export function answerAiChecks(
  checks: readonly AiFactCheck[],
  snapshot: JsonObject,
  actions: readonly {
    readonly id: string
    readonly description: string
    readonly intent: JsonObject
  }[],
  publicEvents: readonly string[],
  revision: number
): JsonObject[] {
  const players = array(snapshot.players).map(object)
  const entities = players
    .flatMap((p) => [
      { ...object(p.hero), ref: object(p.hero).instanceId, zone: 'hero', role: p.role },
      { ...object(p.heroPower), zone: 'hero-power', role: p.role },
      { ...object(p.weapon), zone: 'weapon', role: p.role },
      ...['hand', 'board', 'secrets'].flatMap((zone) =>
        array(p[zone]).map((v) => ({ ...object(v), zone, role: p.role }))
      )
    ])
    .concat(
      array(object(snapshot.pendingDiscover).candidates).map((v) => ({
        ...object(v),
        zone: 'discover',
        role: 'self'
      }))
    ) as JsonObject[]
  return checks.map((check) => {
    const base = { ...check, revision }
    const known = (facts: JsonValue, scope: string): JsonObject => ({
      ...base,
      status: 'known',
      facts,
      scope
    })
    const unavailable = (
      status: 'unknown' | 'unsupported',
      scope: string
    ): JsonObject => ({ ...base, status, scope })
    const entity = entities.find((e) => e.ref === check.ref)
    switch (check.topic) {
      case 'action': {
        const action = actions.find((a) => a.id === check.ref)
        return action
          ? known(
              { id: action.id, move: action.description, intent: action.intent },
              'Current legal input, not a forecast of its outcome.'
            )
          : unavailable('unknown', 'No such current legal action.')
      }
      case 'entity':
        return entity
          ? known(
              entity,
              'Current visible entity; printed and active mechanics remain distinct.'
            )
          : unavailable(
              'unknown',
              'No matching entity in the fair observation; hidden instances are not inspected.'
            )
      case 'mechanics': {
        if (check.ref.startsWith('catalog:')) {
          const name = check.ref.slice('catalog:'.length).trim()
          const byId = CARD_CATALOG.get(name)
          const matches = byId
            ? [byId]
            : CARD_CATALOG.all.filter(
                (c) => c.name.toLowerCase() === name.toLowerCase()
              )
          return matches.length === 1
            ? known(
                cardFacts(matches[0]!.id),
                'Public authored definition only; does not confirm ownership, current cost or outcome.'
              )
            : unavailable(
                'unsupported',
                'Use an unambiguous catalog card ID or exact name.'
              )
        }
        return entity
          ? known(
              entity,
              'Authored/current visible facts only; no simulation of triggers or hidden outcomes.'
            )
          : unavailable(
              'unknown',
              'No visible instance. Public definitions may be requested using catalog:<card ID or exact name>.'
            )
      }
      case 'condition':
        return entity?.battlecryConditions
          ? known(
              entity.battlecryConditions,
              'Only the stated own-hand battlecry checks, excluding the card being played. Read each met/not-met/unknown result; this does not certify the effect.'
            )
          : unavailable(
              'unsupported',
              'This entity has no supported own-hand condition preview. Refer to its authored mechanics; do not assume the condition is met.'
            )
      case 'resources': {
        const p = players.find((v) => v.role === check.ref)
        return p
          ? known(
              {
                role: p.role!,
                hero: p.hero ?? null,
                mana: p.mana ?? null,
                weapon: p.weapon ?? null,
                heroPower: p.heroPower ?? null,
                handSize: p.handSize ?? 0,
                deckSize: p.deckSize ?? 0,
                boardSize: array(p.board).length,
                fatigueDamage: p.fatigueDamage ?? 0,
                ...(p.role === 'self'
                  ? { remainingDeck: snapshot.remainingDeck ?? {} }
                  : {})
              },
              'Current public resources; remaining deck is own unordered counts, not draw order.'
            )
          : unavailable('unsupported', 'Resource ref must be self or opponent.')
      }
      case 'history': {
        const p = players.find((v) => v.role === check.ref)
        return p
          ? known(
              { graveyard: p.graveyard ?? {}, recentPublicEvents: publicEvents },
              'Public graveyard counts and recent retained events for both players. Earlier missing detail is unavailable.'
            )
          : unavailable('unsupported', 'History ref must be self or opponent.')
      }
    }
  })
}
