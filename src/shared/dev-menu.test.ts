import { describe, expect, it } from 'vitest'
import { isDevCommand } from './dev-menu'

describe('dev deck menu commands', () => {
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
