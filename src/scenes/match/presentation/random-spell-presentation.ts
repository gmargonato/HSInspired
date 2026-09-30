import type { OpeningMatchEvent, OpeningMatchState } from '../../../game-rules/match'

/** Each interval reads only as far as its next spell/Secret boundary, including nesting. */
export function randomSpellPresentationStates(
  events: readonly OpeningMatchEvent[],
  finalState: OpeningMatchState
): readonly OpeningMatchState[] | null {
  if (
    !events.some(
      (event) =>
        event.type === 'random-spell-started' ||
        event.type === 'secret-resolution-started'
    )
  )
    return null
  const states = new Array<OpeningMatchState>(events.length)
  let nextState = finalState
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (
      event.type === 'random-spell-started' ||
      event.type === 'random-spell-completed' ||
      event.type === 'secret-resolution-started' ||
      event.type === 'secret-resolution-completed'
    )
      nextState = event.state
    states[index] = nextState
  }
  return states
}
