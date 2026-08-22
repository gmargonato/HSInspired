import { describe, expect, it } from 'vitest'
import { resolveManaCrystalStates } from './mana-tray'

describe('mana tray crystal states', () => {
  it('shows no crystals before any mana is gained', () => {
    expect(resolveManaCrystalStates({ available: 0, maximum: 0 })).toEqual([])
  })

  it('fills every crystal while none are spent', () => {
    const states = resolveManaCrystalStates({ available: 3, maximum: 3 })
    expect(states).toHaveLength(3)
    expect(states.every((state) => state.phase === 'full')).toBe(true)
    expect(states.every((state) => !state.highlighted)).toBe(true)
  })

  it('marks the tail up to the maximum as consumed', () => {
    const states = resolveManaCrystalStates({ available: 5, maximum: 7 })
    expect(states).toHaveLength(7)
    expect(states.slice(0, 5).every((state) => state.phase === 'full')).toBe(true)
    expect(states.slice(5).every((state) => state.phase === 'consumed')).toBe(true)
  })

  it('highlights exactly the first highlighted-cost full crystals', () => {
    const states = resolveManaCrystalStates({ available: 8, maximum: 10 }, 3)
    expect(states.slice(0, 3).every((state) => state.highlighted)).toBe(true)
    expect(states.slice(3).every((state) => !state.highlighted)).toBe(true)
  })

  it('caps the highlight at the available mana', () => {
    const states = resolveManaCrystalStates({ available: 2, maximum: 4 }, 5)
    expect(states.slice(0, 2).every((state) => state.highlighted)).toBe(true)
    expect(states.slice(2).every((state) => !state.highlighted)).toBe(true)
  })

  it('never highlights consumed crystals', () => {
    const states = resolveManaCrystalStates({ available: 1, maximum: 3 }, 3)
    expect(states[0]?.highlighted).toBe(true)
    expect(states[1]?.highlighted).toBe(false)
    expect(states[1]?.phase).toBe('consumed')
  })

  it('clears highlights when no card is selected', () => {
    const states = resolveManaCrystalStates({ available: 4, maximum: 4 }, null)
    expect(states.every((state) => !state.highlighted)).toBe(true)
  })

  it('caps the tray at the ten-crystal maximum', () => {
    const states = resolveManaCrystalStates({ available: 12, maximum: 12 })
    expect(states).toHaveLength(10)
    expect(states.every((state) => state.phase === 'full')).toBe(true)
  })

  it('clamps negative or fractional engine values safely', () => {
    expect(resolveManaCrystalStates({ available: -1, maximum: -1 })).toEqual([])
    const fractional = resolveManaCrystalStates({ available: 2.7, maximum: 3.9 })
    expect(fractional).toHaveLength(3)
    expect(fractional.slice(0, 2).every((state) => state.phase === 'full')).toBe(true)
    expect(fractional[2]?.phase).toBe('consumed')
  })
})
