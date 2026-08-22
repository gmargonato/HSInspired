import { Container, Text, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG } from '../../../game/content/cards'
import type { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { CardView } from './card-view'

function findByLabel(container: Container, label: string): Container | undefined {
  for (const child of container.children) {
    if (child.label === label) return child as Container
    if (child instanceof Container) {
      const nested = findByLabel(child, label)
      if (nested) return nested
    }
  }
  return undefined
}

describe('CardView semantic appearance', () => {
  it('applies temporary alpha, tint, and blending to one semantic layer', async () => {
    const textWidth = vi.spyOn(Text.prototype, 'width', 'get').mockReturnValue(100)
    const resolver = {
      load: vi.fn().mockResolvedValue(Texture.EMPTY)
    } as unknown as CardAssetResolver
    const card = CARD_CATALOG.require('basic_bloodfen_raptor')
    const view = await CardView.create(card, resolver, { artwork: Texture.EMPTY })

    expect(view.hasLayer('card.stats.attack.icon')).toBe(true)
    expect(view.hasLayer('card.name')).toBe(true)
    expect(view.hasLayer('missing')).toBe(false)

    view.setLayerAppearance('card.stats.attack.icon', {
      alpha: 0.45,
      tint: 0x79e9ff,
      blendMode: 'add'
    })

    const attack = findByLabel(view, `${card.id}:card.stats.attack.icon`)
    expect(attack?.alpha).toBe(0.45)
    expect(attack?.tint).toBe(0x79e9ff)
    expect(attack?.blendMode).toBe('add')

    view.destroy({ children: true })
    textWidth.mockRestore()
  })
})
