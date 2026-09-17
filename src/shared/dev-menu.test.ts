import { describe, expect, it } from 'vitest'
import { isDevCommand, isDevSceneId, isDevArenaAvailability } from './dev-menu'

describe('dev deck menu commands', () => {
  it('accepts custom dust entry and only non-negative safe integer balances', () => {
    for (const amount of ['custom', 0, 1875, Number.MAX_SAFE_INTEGER])
      expect(isDevCommand({ type: 'progression:set-dust', amount })).toBe(true)
    for (const amount of [
      undefined,
      null,
      '1875',
      -1,
      0.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1
    ])
      expect(isDevCommand({ type: 'progression:set-dust', amount })).toBe(false)
  })
  it('accepts only the four premium modes', () => {
    for (const mode of ['unlocked', 'all', 'local', 'remote'])
      expect(isDevCommand({ type: 'cards:set-premium', mode })).toBe(true)
    for (const mode of [undefined, null, true, false, 'off', 'on', 1, {}])
      expect(isDevCommand({ type: 'cards:set-premium', mode })).toBe(false)
    expect(isDevCommand({ type: 'cards:set-premium', enabled: true })).toBe(false)
  })
  it('validates Arena commands and availability', () => {
    expect(isDevCommand({ type: 'arena:retire' })).toBe(true)
    for (const counter of ['wins', 'defeats']) {
      for (const value of [0, counter === 'wins' ? 12 : 3])
        expect(isDevCommand({ type: 'arena:set-score', counter, value })).toBe(true)
      for (const value of [-1, 0.5, NaN, Infinity, '1', counter === 'wins' ? 13 : 4])
        expect(isDevCommand({ type: 'arena:set-score', counter, value })).toBe(false)
    }
    expect(
      isDevCommand({ type: 'arena:set-score', counter: 'gamesPlayed', value: 1 })
    ).toBe(false)
    expect(isDevArenaAvailability({ retire: true, scores: false })).toBe(true)
    expect(isDevArenaAvailability({ retire: true })).toBe(false)
    expect(isDevArenaAvailability({ retire: 'yes', scores: false })).toBe(false)
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
