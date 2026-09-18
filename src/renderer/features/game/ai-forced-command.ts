import type { TurnMatchCommand } from '../../../game/match'

/** Skip the model when pass is the only alternative to one legal action. */
export function forcedLegalCommand(
  commands: readonly TurnMatchCommand[]
): TurnMatchCommand | null {
  if (commands.length === 1) return commands[0]!
  const actionable = commands.filter((command) => command.type !== 'end-turn')
  return actionable.length === 1 ? actionable[0]! : null
}
