import { describe, expect, it } from 'vitest'
import { getCombatImpactProfile } from './combat-impact'

describe('getCombatImpactProfile', () => {
  it('selects the expected profile at every attack bracket boundary', () => {
    expect(getCombatImpactProfile(1).bracket).toBe('light')
    expect(getCombatImpactProfile(2).bracket).toBe('light')
    expect(getCombatImpactProfile(3).bracket).toBe('medium')
    expect(getCombatImpactProfile(5).bracket).toBe('medium')
    expect(getCombatImpactProfile(6).bracket).toBe('heavy')
    expect(getCombatImpactProfile(8).bracket).toBe('heavy')
    expect(getCombatImpactProfile(9).bracket).toBe('devastating')
    expect(getCombatImpactProfile(12).bracket).toBe('devastating')
  })

  it('increases shake intensity as attack increases', () => {
    const profiles = [1, 3, 6, 9].map(getCombatImpactProfile)

    expect(profiles.map((profile) => profile.amplitude)).toEqual([2, 4, 7, 10])
    expect(profiles.map((profile) => profile.pulses)).toEqual([2, 3, 4, 5])
    expect(profiles.map((profile) => profile.duration)).toEqual([
      0.14, 0.18, 0.24, 0.32
    ])
  })
})
