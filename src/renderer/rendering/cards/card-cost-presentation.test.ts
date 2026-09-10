import { Text } from 'pixi.js'
import { vi } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import { CardView } from './card-view'
import { describe, expect, it } from 'vitest'
import { cardCostColor } from './card-cost-presentation'

describe('card cost presentation', () => {
  it('keeps an unchanged cost neutral', () => {
    expect(cardCostColor(3, 3)).toBe('normal')
  })

  it('tints a reduced cost green and an increased cost red', () => {
    expect(cardCostColor(3, 2)).toBe('reduced')
    expect(cardCostColor(3, 4)).toBe('increased')
  })
})

describe('runtime card stat presentation', () => {
  it('refreshes Cthun stats and cached texture, including resetting a previous buff', () => {
    const attack = new Text({ text: '6' })
    const health = new Text({ text: '6' })
    const refresh = vi.fn()
    const view = Object.assign(Object.create(CardView.prototype), {
      treeObjects: new Map([
        ['card.stats.attack.label', { object: attack }],
        ['card.stats.health.label', { object: health }]
      ]),
      updateCacheTexture: refresh
    }) as CardView
    const definition = CARD_CATALOG.require(asCardId('whispers_of_the_old_gods_cthun'))
    try {
      view.applySnapshot(definition, { attack: 12, health: 14 })
      expect(attack.text).toBe('12')
      expect(health.text).toBe('14')
      expect(attack.style.fill).toBe(0x6cff47)
      expect(health.style.fill).toBe(0x6cff47)
      expect(refresh).toHaveBeenCalledOnce()
      view.applySnapshot(definition, { attack: 6, health: 6 })
      expect(attack.text).toBe('6')
      expect(attack.style.fill).toBe(0xffffff)
      expect(health.style.fill).toBe(0xffffff)
      view.applySnapshot(definition, { attack: 8, health: 5, maxHealth: 8 })
      expect(health.style.fill).toBe(0xff4a4a)
    } finally {
      attack.destroy()
      health.destroy()
    }
  })
})
