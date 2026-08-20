import { HERO_CATALOG } from '../content/heroes'
import { createMatch } from './match'
import { asPlayerId, type MatchProofOutput, type MatchSetup } from './match-types'

export function createProofSetup(seed = 12345): MatchSetup {
  return {
    seed,
    participants: [
      {
        participantId: asPlayerId('human-player'),
        controllerKind: 'human',
        heroId: HERO_CATALOG.require('jaina').id,
        deckId: 'human-deck'
      },
      {
        participantId: asPlayerId('ai-player'),
        controllerKind: 'ai',
        heroId: HERO_CATALOG.require('guldan').id,
        deckId: 'ai-deck'
      }
    ]
  }
}

/** Headless proof used by tests and CI; it contains no platform imports. */
export function runMatchArchitectureProof(
  setup: MatchSetup = createProofSetup()
): MatchProofOutput {
  const match = createMatch(setup)
  const initialState = match.getState()
  const acceptedResult = match.dispatch({
    type: 'ready',
    participantId: setup.participants[0].participantId
  })
  const rejectedResult = match.dispatch({ type: 'not-a-real-command' })
  const finalState = match.getState()
  const output = {
    setup,
    initialState,
    acceptedResult,
    rejectedResult,
    finalState
  }
  return { ...output, serialized: JSON.stringify(output) }
}
