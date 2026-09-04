import { describe, expect, it } from 'vitest'
import { isDevCommand, isDevSceneId } from './dev-menu'

describe('dev deck menu commands', () => {
  it('accepts Arena as a development scene id', () => {
    expect(isDevSceneId('arena')).toBe(true)
  })

  it('accepts Tavern Brawl as a development scene id', () => {
    expect(isDevSceneId('tavern-brawl')).toBe(true)
  })

  it('accepts Shader Lab as a development scene id', () => {
    expect(isDevSceneId('outline-lab')).toBe(true)
  })

  it.each([
    { type: 'game:modify-deck', target: 'local', action: 'destroy' },
    { type: 'game:modify-deck', target: 'remote', action: 'refill' }
  ])('accepts a valid deck command', (command) => {
    expect(isDevCommand(command)).toBe(true)
  })

  it.each([
    { type: 'game:modify-deck', target: 'other', action: 'destroy' },
    { type: 'game:modify-deck', target: 'local', action: 'empty' },
    { type: 'game:modify-deck', target: 'local' }
  ])('rejects an invalid deck command', (command) => {
    expect(isDevCommand(command)).toBe(false)
  })
})
