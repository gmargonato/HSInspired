import { describe, expect, it } from 'vitest'
import { isDevCommand, isDevSceneId } from './dev-menu'

describe('dev deck menu commands', () => {
  it('accepts only boolean premium settings', () => {
    for (const enabled of [true, false]) {
      expect(isDevCommand({ type: 'cards:set-premium', enabled })).toBe(true)
    }
    for (const enabled of [undefined, null, 'true', 1, {}]) {
      expect(isDevCommand({ type: 'cards:set-premium', enabled })).toBe(false)
    }
  })
  it('accepts Arena as a development scene id', () => {
    expect(isDevSceneId('arena')).toBe(true)
  })

  it('accepts Tavern Brawl as a development scene id', () => {
    expect(isDevSceneId('tavern-brawl')).toBe(true)
  })

  it('accepts Shader Lab as a development scene id', () => {
    expect(isDevSceneId('outline-lab')).toBe(true)
  })

  it('accepts Card Inspector as a development scene id', () => {
    expect(isDevSceneId('card-inspector')).toBe(true)
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
