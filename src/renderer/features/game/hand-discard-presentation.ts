import type { OpeningMatchEvent } from '../../../game/match'

type DiscardEvent = Extract<OpeningMatchEvent, { type: 'effect-resolved' }>

export function isHandDiscard(event: OpeningMatchEvent): event is DiscardEvent {
  return (
    event.type === 'effect-resolved' &&
    event.action === 'discard' &&
    event.data?.fromZone === 'hand'
  )
}

/** Batch one effect's discards, without crossing another action or trigger. */
export function handDiscardBatch(
  events: readonly OpeningMatchEvent[],
  start: number
): readonly DiscardEvent[] {
  const first = events[start]
  if (!first || !isHandDiscard(first)) return []
  const batch = [first]
  for (let index = start + 1; index < events.length; index++) {
    const next = events[index]
    if (next.type === 'history-effect-recorded') continue
    if (
      !isHandDiscard(next) ||
      next.revision !== first.revision ||
      next.sourceInstanceId !== first.sourceInstanceId ||
      next.controllerId !== first.controllerId ||
      next.actionPath !== first.actionPath
    )
      break
    batch.push(next)
  }
  return batch
}
