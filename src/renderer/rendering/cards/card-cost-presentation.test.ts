import { Text, Texture, DOMAdapter } from 'pixi.js'
import { vi } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import { CardView } from './card-view'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { setPremiumMode } from '../premium-appearance'
import { describe, expect, it } from 'vitest'
import { cardCostColor } from './card-cost-presentation'
import { buildCardRenderTree } from './card-layout'
import { supportsPremiumFormat } from '../../../game/progression/premium-support'

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
  it('renders normal and premium legendary spell overlays', () => {
    const spell = CARD_CATALOG.require(asCardId('journey_to_ungoro_jungle_giants'))

    const standard = buildCardRenderTree(spell)
    const premium = buildCardRenderTree(spell, { premium: true })
    const legendaryFrame = (tree: typeof standard) =>
      tree.root.children.find((node) => node.id === 'legendary-frame')

    expect(legendaryFrame(standard)).toMatchObject({
      kind: 'image',
      assetKey: 'card.frame.legendary.spell',
      transform: {
        position: { x: 370, y: -35 },
        anchor: { x: 0.5, y: 0 }
      }
    })
    expect(legendaryFrame(premium)).toMatchObject({
      kind: 'image',
      assetKey: 'card.frame.legendary.spell.premium'
    })
  })

  it('supports the premium Hero card frame without changing Hero Power support', () => {
    const hero = CARD_CATALOG.all.find((card) => card.type === 'Hero')
    if (!hero) throw new Error('Expected a Hero card in the catalog')

    const standard = buildCardRenderTree(hero)
    const premium = buildCardRenderTree(hero, { premium: true })
    const frame = (tree: typeof standard) =>
      tree.root.children.find((node) => node.id === 'frame')

    expect(frame(standard)).toMatchObject({
      kind: 'image',
      assetKey: 'card.frame.hero'
    })
    expect(frame(premium)).toMatchObject({
      kind: 'image',
      assetKey: 'card.frame.hero.premium'
    })
    expect(supportsPremiumFormat('Hero')).toBe(true)
    expect(supportsPremiumFormat('HeroPower')).toBe(false)
  })

  it('refreshes full-card premium layouts by side and preserves explicit inspector previews', async () => {
    const canvas = vi
      .spyOn(DOMAdapter.get(), 'createCanvas')
      .mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement)
    const width = vi.spyOn(Text.prototype, 'width', 'get').mockReturnValue(100)
    const height = vi.spyOn(Text.prototype, 'height', 'get').mockReturnValue(30)
    const resolver = new CardAssetResolver()
    const load = vi.spyOn(resolver, 'load').mockResolvedValue(Texture.WHITE)
    const card = CARD_CATALOG.require(asCardId('journey_to_ungoro_jungle_giants'))
    const views: CardView[] = []
    try {
      views.push(
        await CardView.create(card, resolver, { premium: false, premiumSide: 'local' })
      )
      views.push(
        await CardView.create(card, resolver, { premium: false, premiumSide: 'remote' })
      )
      views.push(
        await CardView.create(card, resolver, { premium: true, premiumSide: 'local' })
      )
      views.push(
        await CardView.create(card, resolver, {
          premium: false,
          ignorePremiumOverride: true
        })
      )
      const frames = () =>
        views.map((view) =>
          view.plan.tree.root.children.some(
            (node) =>
              node.kind === 'image' && node.assetKey === 'card.frame.spell.premium'
          )
        )
      const legendaryFrames = () =>
        views.map((view) =>
          view.plan.tree.root.children.some(
            (node) =>
              node.kind === 'image' &&
              node.id === 'legendary-frame' &&
              node.assetKey === 'card.frame.legendary.spell.premium'
          )
        )
      setPremiumMode('local')
      expect(frames()).toEqual([true, false, true, false])
      expect(legendaryFrames()).toEqual([true, false, true, false])
      setPremiumMode('remote')
      expect(frames()).toEqual([false, true, true, false])
      expect(legendaryFrames()).toEqual([false, true, true, false])
      setPremiumMode('all')
      expect(frames()).toEqual([true, true, true, false])
      expect(legendaryFrames()).toEqual([true, true, true, false])
      setPremiumMode('unlocked')
      expect(frames()).toEqual([false, false, true, false])
      expect(legendaryFrames()).toEqual([false, false, true, false])
    } finally {
      views.forEach((view) => view.destroy({ children: true }))
      setPremiumMode('unlocked')
      load.mockRestore()
      canvas.mockRestore()
      width.mockRestore()
      height.mockRestore()
    }
  })

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
