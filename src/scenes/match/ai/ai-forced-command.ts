import type { TurnMatchCommand } from '../../../game-rules/match'

/** Skip the model only when there is exactly one legal command. */
export function forcedLegalCommand(
  commands: readonly TurnMatchCommand[]
): TurnMatchCommand | null {
  if (commands.length === 1) return commands[0]!
  return null
}
