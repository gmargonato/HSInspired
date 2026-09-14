import type { OpeningMatchEvent, OpeningMatchState } from '../../../game/match'

/** Each interval reads only as far as its next spell boundary, including nested casts. */
export function randomSpellPresentationStates(
  events: readonly OpeningMatchEvent[],
  finalState: OpeningMatchState
): readonly OpeningMatchState[] | null {
  if (!events.some((event) => event.type === 'random-spell-started')) return null
  const states = new Array<OpeningMatchState>(events.length)
  let nextState = finalState
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (
      event.type === 'random-spell-started' ||
      event.type === 'random-spell-completed'
    )
      nextState = event.state
    states[index] = nextState
  }
  return states
}
