export type CombatImpactBracket = 'light' | 'medium' | 'heavy' | 'devastating'

export interface CombatImpactProfile {
  readonly bracket: CombatImpactBracket
  /** Maximum board-root displacement in design pixels. */
  readonly amplitude: number
  /** Number of out-and-back shake pulses. */
  readonly pulses: number
  /** Total screen-shake duration in seconds. */
  readonly duration: number
}

const COMBAT_IMPACT_PROFILES = {
  light: {
    bracket: 'light',
    amplitude: 4,
    pulses: 2,
    duration: 0.14
  },
  medium: {
    bracket: 'medium',
    amplitude: 8,
    pulses: 3,
    duration: 0.18
  },
  heavy: {
    bracket: 'heavy',
    amplitude: 14,
    pulses: 4,
    duration: 0.24
  },
  devastating: {
    bracket: 'devastating',
    amplitude: 20,
    pulses: 5,
    duration: 0.32
  }
} as const satisfies Record<CombatImpactBracket, CombatImpactProfile>

/** Maps an attack value to a tunable, monotonic combat feedback bracket. */
export function getCombatImpactProfile(attack: number): CombatImpactProfile {
  if (attack >= 9) return COMBAT_IMPACT_PROFILES.devastating
  if (attack >= 6) return COMBAT_IMPACT_PROFILES.heavy
  if (attack >= 3) return COMBAT_IMPACT_PROFILES.medium
  return COMBAT_IMPACT_PROFILES.light
}
