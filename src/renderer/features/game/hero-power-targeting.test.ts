import { describe, expect, it } from 'vitest'
import { isLegalHeroPowerTarget } from './hero-power-targeting'

describe('hero-power target presentation', () => {
  const remote = 'remote' as never

  it('uses domain targets rather than a static hero-power targeting definition', () => {
    const legalTargets = [
      { kind: 'minion' as const, participantId: remote, instanceId: 'enemy-minion' }
    ]

    expect(
      isLegalHeroPowerTarget(legalTargets, {
        kind: 'minion',
        participantId: remote,
        instanceId: 'enemy-minion'
      })
    ).toBe(true)
    expect(
      isLegalHeroPowerTarget(legalTargets, { kind: 'hero', participantId: remote })
    ).toBe(false)
  })
})
