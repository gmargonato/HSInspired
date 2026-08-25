import { describe, expect, it } from 'vitest'
import { canCommitCombatAttack, canSelectCombatAttacker } from './combat-input-window'

describe('combat input window', () => {
  it('allows normal selection and attack commits outside combat presentation', () => {
    expect(canSelectCombatAttacker(false, false)).toBe(true)
    expect(canCommitCombatAttack(false)).toBe(true)
  })

  it('blocks attacker selection and attack commits before impact', () => {
    expect(canSelectCombatAttacker(true, false)).toBe(false)
    expect(canCommitCombatAttack(true)).toBe(false)
  })

  it('allows attacker selection at impact while keeping attack commits locked', () => {
    expect(canSelectCombatAttacker(true, true)).toBe(true)
    expect(canCommitCombatAttack(true)).toBe(false)
  })
})
