import { describe, expect, it } from 'vitest'
import { EVENT_PRESENTATION_POLICY } from './event-presentation-policy'

describe('event presentation policy', () => {
  it('assigns an intentional policy to every public event', () => {
    expect(Object.values(EVENT_PRESENTATION_POLICY)).not.toContain(undefined)
  })

  it('presents character healing as an animation', () => {
    expect(EVENT_PRESENTATION_POLICY['character-healed']).toBe('animation')
  })
})
