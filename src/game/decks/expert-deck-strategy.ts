import type { PlayerId } from '../match/match-types'

export type ExpertDeckStrategyFeature =
  'ramp-readiness' | 'board-buff-potential' | 'cthun-thresholds' | 'jade-followups'

export interface ExpertDeckStrategyProfile {
  readonly id: string
  readonly version: 1
  readonly maximumAdjustment: number
  readonly features: readonly {
    readonly id: ExpertDeckStrategyFeature
    /** Maximum contribution in existing position-score units. */
    readonly weight: number
  }[]
}

/** Small provisional bonuses: a typical live minion already scores tens of points. */
export const EXPERT_DECK_STRATEGY_PROFILES = {
  'ramp-midrange': {
    id: 'ramp-midrange',
    version: 1,
    maximumAdjustment: 12,
    features: [{ id: 'ramp-readiness', weight: 12 }]
  },
  'cthun-midrange': {
    id: 'cthun-midrange',
    version: 1,
    maximumAdjustment: 12,
    features: [{ id: 'cthun-thresholds', weight: 12 }]
  },
  'jade-midrange': {
    id: 'jade-midrange',
    version: 1,
    maximumAdjustment: 18,
    features: [
      { id: 'jade-followups', weight: 12 },
      { id: 'board-buff-potential', weight: 6 }
    ]
  }
} as const satisfies Readonly<Record<string, ExpertDeckStrategyProfile>>

export type ExpertDeckStrategyProfileId = keyof typeof EXPERT_DECK_STRATEGY_PROFILES

/** Bound to one player; never infer a profile for a simulated opponent. */
export interface ExpertDeckStrategyBinding {
  readonly participantId: PlayerId
  readonly profileId: ExpertDeckStrategyProfileId
  readonly version: number
}

export function getExpertDeckStrategyProfile(
  binding: ExpertDeckStrategyBinding
): ExpertDeckStrategyProfile | undefined {
  const profile = Object.prototype.hasOwnProperty.call(
    EXPERT_DECK_STRATEGY_PROFILES,
    binding.profileId
  )
    ? EXPERT_DECK_STRATEGY_PROFILES[binding.profileId]
    : undefined
  return profile?.version === binding.version ? profile : undefined
}
