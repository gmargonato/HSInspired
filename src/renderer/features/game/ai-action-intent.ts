import type { TurnMatchCommand } from '../../../game/match'
import { sameAiIntent, type AiActionIntent } from '../../../shared/ipc/ai-deliberation'

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

export type AiCommitIntentValidation =
  | { readonly ok: true; readonly intent: AiActionIntent; readonly normalized: boolean }
  | {
      readonly ok: false
      readonly expected: AiActionIntent
      readonly returned: AiActionIntent
    }

function sameIntentExceptPosition(a: AiActionIntent, b: AiActionIntent): boolean {
  return (
    a.type === b.type &&
    a.source === b.source &&
    a.option === b.option &&
    a.targets.length === b.targets.length &&
    a.targets.every((target, index) => target === b.targets[index])
  )
}

function expectedTargetsPresent(
  expected: AiActionIntent,
  returned: AiActionIntent
): boolean {
  const returnedSet = new Set(returned.targets)
  return expected.targets.every((target) => returnedSet.has(target))
}

/** Accept the selected action ID when only cosmetic intent fields disagree. */
export function validateAiCommitIntent(
  returned: AiActionIntent,
  command: TurnMatchCommand,
  opponentId: string
): AiCommitIntentValidation {
  const expected = aiActionIntent(command, opponentId)
  if (sameAiIntent(returned, expected)) {
    return { ok: true, intent: expected, normalized: false }
  }
  if (sameIntentExceptPosition(returned, expected)) {
    return { ok: true, intent: expected, normalized: true }
  }
  if (
    expected.targets.length === 0 &&
    returned.targets.length > 0 &&
    returned.type === expected.type &&
    returned.source === expected.source &&
    returned.option === expected.option &&
    returned.position === expected.position
  ) {
    return { ok: true, intent: expected, normalized: true }
  }
  if (
    expected.type === 'confirm-mulligan' &&
    returned.type === expected.type &&
    returned.source === expected.source &&
    returned.option === expected.option &&
    returned.position === expected.position
  ) {
    return { ok: true, intent: expected, normalized: true }
  }
  if (
    returned.type === expected.type &&
    returned.source === expected.source &&
    returned.option === expected.option &&
    expectedTargetsPresent(expected, returned)
  ) {
    return { ok: true, intent: expected, normalized: true }
  }
  return { ok: false, expected, returned }
}
