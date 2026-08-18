import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../card-lab/card-catalog'
import { cardDetailRows } from '../src/renderer/src/scenes/CardViewScene'

describe('Card View metadata', () => {
  it('shows health for minions, armor for heroes, and durability for weapons', () => {
    const minionRows = cardDetailRows(CARD_CATALOG.require('classic_abomination'))
    const heroRows = cardDetailRows(CARD_CATALOG.require('classic_lord_jaraxxus'))
    const weaponRows = cardDetailRows(CARD_CATALOG.require('basic_fiery_war_axe'))

    expect(minionRows).toContainEqual({ label: 'Health', value: '4' })
    expect(minionRows.some((row) => row.label === 'Durability')).toBe(false)
    expect(heroRows).toContainEqual({ label: 'Armor', value: '5' })
    expect(heroRows.some((row) => row.label === 'Attack')).toBe(false)
    expect(heroRows.some((row) => row.label === 'Health')).toBe(false)
    expect(weaponRows).toContainEqual({ label: 'Durability', value: '2' })
    expect(weaponRows.some((row) => row.label === 'Health')).toBe(false)
  })

  it('formats collection labels for current and future set identifiers', () => {
    const card = CARD_CATALOG.require('basic_fireball')
    const rows = cardDetailRows({ ...card, set: 'goblins_vs_gnomes' })

    expect(rows).toContainEqual({ label: 'Collection', value: 'Goblins vs Gnomes' })
  })
})
