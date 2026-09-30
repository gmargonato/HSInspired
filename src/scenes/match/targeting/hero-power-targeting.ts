import type { HeroPowerTargetRef, PlayerId } from '../../../game-rules/match'

export interface HeroPowerTargetCandidate {
  readonly kind: 'hero' | 'minion'
  readonly participantId: PlayerId
  readonly instanceId?: string
}

/** Checks a renderer character against the domain's current hero-power targets. */
export function isLegalHeroPowerTarget(
  legalTargets: readonly HeroPowerTargetRef[],
  candidate: HeroPowerTargetCandidate
): boolean {
  return legalTargets.some((target) => {
    if (
      target.kind !== candidate.kind ||
      target.participantId !== candidate.participantId
    )
      return false
    return target.kind === 'hero' || target.instanceId === candidate.instanceId
  })
}
