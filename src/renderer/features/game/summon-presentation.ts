import type { OpeningMatchEvent } from '../../../game/match'

type SummonEvent = Extract<OpeningMatchEvent, { type: 'minion-summoned' }>

/** Only bookkeeping for these summons may be crossed; consequences are barriers. */
export function summonPresentationBatch(
  events: readonly OpeningMatchEvent[],
  start: number
): { summons: SummonEvent[]; bookkeeping: OpeningMatchEvent[]; end: number } | null {
  const first = events[start]
  if (first?.type !== 'minion-summoned' || !first.summonGroupId) return null
  const summons = [first]
  const bookkeeping: OpeningMatchEvent[] = []
  let end = start
  let pending: OpeningMatchEvent[] = []
  for (let index = start + 1; index < events.length; index += 1) {
    const event = events[index]!
    if (
      event.type === 'minion-summoned' &&
      event.summonGroupId === first.summonGroupId &&
      event.participantId === first.participantId
    ) {
      summons.push(event)
      bookkeeping.push(...pending)
      pending = []
      end = index
    } else if (
      ((event.type === 'effect-resolved' &&
        event.action === 'summon' &&
        !event.cardMovement &&
        event.data?.participantId === first.participantId) ||
        (event.type === 'history-action-resolved' &&
          event.participantId === first.participantId &&
          event.outcomes.every((outcome) => outcome.kind === 'summon-board'))) &&
      event.summonGroupId === first.summonGroupId
    ) {
      pending.push(event)
    } else break
  }
  return { summons, bookkeeping, end }
}
