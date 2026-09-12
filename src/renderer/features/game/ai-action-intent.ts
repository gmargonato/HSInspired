import type { TurnMatchCommand } from '../../../game/match'
import type { AiActionIntent } from '../../../shared/ipc/ai-deliberation'

/** Explicit references disambiguate hero targets; no command is reconstructed from model prose. */
export function aiActionIntent(
  command: TurnMatchCommand,
  opponentId: string
): AiActionIntent {
  const intent: AiActionIntent = {
    type: command.type,
    source: null,
    targets: [],
    position: null,
    option: null
  }
  switch (command.type) {
    case 'confirm-mulligan':
      return { ...intent, targets: [...command.replaceInstanceIds].sort() }
    case 'choose-discover-card':
      return { ...intent, source: command.cardInstanceId }
    case 'choose-card-option':
      return { ...intent, source: command.sourceCardInstanceId, option: command.choice }
    case 'play-card':
      return {
        ...intent,
        source: command.cardInstanceId,
        position: command.position ?? null,
        option: command.choice ?? null,
        targets: (command.targets ?? []).map((t) =>
          t.kind === 'hero' ? `${t.participantId}:hero` : t.instanceId
        )
      }
    case 'attack-character':
      return {
        ...intent,
        source:
          command.attacker.kind === 'hero'
            ? `${command.participantId}:hero`
            : command.attacker.instanceId,
        targets: [
          command.defender.kind === 'hero'
            ? `${opponentId}:hero`
            : command.defender.instanceId
        ]
      }
    case 'use-hero-power':
      return {
        ...intent,
        source: `${command.participantId}:hero-power`,
        targets: command.target
          ? [
              command.target.kind === 'hero'
                ? `${command.target.participantId}:hero`
                : command.target.instanceId
            ]
          : []
      }
    case 'end-turn':
      return intent
    default:
      throw new Error('Unsupported AI input type: ' + command.type)
  }
}
