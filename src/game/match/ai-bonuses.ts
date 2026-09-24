import type { MatchParticipantSetup } from './match-types'
import type { DeterministicRng } from './rng'

export type AiHeroPowerBonus = 'none' | 'upgraded' | 'cost-one'

/** Selects one startup bonus for matches that include an AI participant. */
export function selectAiHeroPowerBonus(
  participants: readonly MatchParticipantSetup[],
  rng: DeterministicRng,
  enabled = true
): AiHeroPowerBonus {
  if (!enabled) return 'none'
  if (!participants.some((participant) => participant.controllerKind === 'ai'))
    return 'none'

  const roll = rng.next()
  if (roll < 1 / 3) return 'none'
  if (roll < 2 / 3) return 'upgraded'
  return 'cost-one'
}
