import type { MinionCardMovement, OpeningMatchEvent } from '../../../game-rules/match'

type ReturnEvent = Extract<OpeningMatchEvent, { type: 'effect-resolved' }> & {
  readonly cardMovement: MinionCardMovement
}

export function isMinionReturn(event: OpeningMatchEvent): event is ReturnEvent {
  return (
    event.type === 'effect-resolved' &&
    event.action === 'return-to-hand' &&
    !!event.cardMovement &&
    !event.cardMovement.copy &&
    (event.cardMovement.destination === 'hand' ||
      event.cardMovement.destination === 'discarded')
  )
}

/** Keep one action's returns together without crossing gameplay consequences. */
export function returnPresentationBatch(
  events: readonly OpeningMatchEvent[],
  start: number
): readonly ReturnEvent[] {
  const first = events[start]
  if (!first || !isMinionReturn(first)) return []
  const batch = [first]
  for (let index = start + 1; index < events.length; index++) {
    const next = events[index]!
    if (next.type === 'history-effect-recorded') continue
    if (
      !isMinionReturn(next) ||
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
