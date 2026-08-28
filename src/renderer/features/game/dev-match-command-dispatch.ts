import type { OpeningCommandResult, PlayerId } from '../../../game/match'
import type { DevCommand, DevMatchTarget } from '../../../shared/dev-menu'

type Dispatch = (command: unknown) => OpeningCommandResult

/**
 * Translates the development menu's renderer-safe commands into the canonical
 * match command boundary. Presentation remains the board view's concern.
 */
export function dispatchDevMatchCommand(
  dispatch: Dispatch,
  command: DevCommand,
  participantIdForTarget: (target: DevMatchTarget) => PlayerId
): OpeningCommandResult | null {
  if (command.type === 'game:draw')
    return dispatch({
      type: 'dev-draw',
      participantId: participantIdForTarget(command.target)
    })
  if (command.type === 'game:set-mana')
    return dispatch({
      type: 'dev-set-mana',
      participantId: participantIdForTarget(command.target),
      available: command.available,
      maximum: command.maximum
    })
  if (command.type === 'game:set-hero')
    return dispatch({
      type: 'dev-set-hero',
      participantId: participantIdForTarget(command.target),
      health: command.health,
      armor: command.armor,
      attack: command.attack
    })
  if (command.type === 'game:set-hero-power')
    return dispatch({
      type: 'dev-set-hero-power',
      participantId: participantIdForTarget(command.target),
      cost: command.cost,
      available: command.action === undefined ? undefined : command.action === 'reset'
    })
  if (command.type === 'game:set-fatigue')
    return dispatch({
      type: 'dev-set-fatigue',
      participantId: participantIdForTarget(command.target),
      nextDamage: command.nextDamage
    })
  if (command.type === 'game:clear-zone')
    return dispatch({
      type: 'dev-clear-zone',
      participantId: participantIdForTarget(command.target),
      zone: command.zone
    })
  if (command.type === 'game:remove-weapon')
    return dispatch({
      type: 'dev-remove-weapon',
      participantId: participantIdForTarget(command.target)
    })
  return null
}
