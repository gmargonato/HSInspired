import { createOpeningMatchFromCheckpoint } from '../../../game/match/opening-match'
import { createFairHypothesisCheckpoint } from '../../../game/match/ai/fair-hypothesis-checkpoint'
import { searchTactics } from '../../../game/match/ai/tactical-search'
import type {
  OpeningMatchCheckpoint,
  PlayerId,
  TurnMatchCommand
} from '../../../game/match'

/** Fast guard shared by cached decisions and the timeout policy. No hidden state. */
export function immediateExpertWin(
  checkpoint: OpeningMatchCheckpoint,
  playerId: PlayerId,
  commands: readonly TurnMatchCommand[]
): TurnMatchCommand | undefined {
  if (
    checkpoint.state.phase !== 'turns' ||
    checkpoint.state.activePlayerId !== playerId
  )
    return undefined
  const fair = createFairHypothesisCheckpoint(checkpoint, playerId, 0x71ac71c)
  const match = createOpeningMatchFromCheckpoint(fair)
  return match.analyze(
    (fork) =>
      searchTactics(fork, playerId, {
        commands,
        maxDepth: 1,
        maxNodes: commands.length
      }).win?.commands[0]
  )
}
