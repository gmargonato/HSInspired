import { buildCardRenderTree } from '../../visual-components/cards/card-render-builder'
import { afterEach, describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../game-rules/content/cards'
import {
  CARD_BODY_BOUNDS,
  cardFrameTransform
} from '../../visual-components/cards/card-layout'
import {
  getClassFrameConfig,
  updateClassFrameConfig
} from '../../visual-components/cards/class-frame-colors'
import { CardInspectorModel } from './card-inspector-model'

const original = structuredClone(getClassFrameConfig())
afterEach(() => updateClassFrameConfig(original))

describe('Card Lab migrated frames', () => {
  it('keeps standard and Neutral previews read-only while all premium class templates can be tuned', () => {
    const model = new CardInspectorModel()
    for (const template of ['minion', 'spell', 'weapon', 'hero'] as const) {
      model.selectedTemplate = template
      model.selectedPremium = false
      const before = structuredClone(model.config)
      model.setNumeric('primary', 'offsetX', 30)
      model.setBlendMode('primary', 'add')
      expect(model.maskTemplate).toBeUndefined()
      expect(model.config).toEqual(before)
      model.selectedPremium = true
      expect(model.maskTemplate).toBe(template)
      model.setNumeric('primary', 'offsetX', 30)
      expect(model.getNumeric('primary', 'offsetX')).toBe(30)
      expect(model.hasSecondaryMask).toBe(false)
    }
    model.selectedClass = 'Neutral'
    const before = structuredClone(model.config)
    model.setNumeric('primary', 'hue', 40)
    expect(model.maskTemplate).toBeUndefined()
    expect(model.config).toEqual(before)
  })

  it('keeps premium offsets independent by template and preserves colors during selection', () => {
    const model = new CardInspectorModel()
    const before = structuredClone(model.config)
    model.selectedPremium = true
    model.selectedTemplate = 'spell'
    expect(model.config).toEqual(before)
    model.setNumeric('primary', 'offsetX', -12.7)
    expect(model.getNumeric('primary', 'offsetX')).toBe(-13)
    model.selectedTemplate = 'minion'
    expect(model.getNumeric('primary', 'offsetX')).toBe(
      before.offsets.premium.minion.primary.x
    )
    model.setNumeric('primary', 'offsetX', 300)
    expect(model.getNumeric('primary', 'offsetX')).toBe(200)
  })

  it('can select specific cards and includes Neutral previews', () => {
    const model = new CardInspectorModel()
    model.selectedClass = 'Neutral'
    const card = model.availableCards.at(-1)!
    model.selectedCardId = card.id
    expect(model.selectedCard).toBe(card)
    model.selectedTemplate = 'hero'
    expect(model.selectedCard?.type).toBe('Hero')
  })

  it('selects baked-in class frames and mounts hidden premium masks for every type', () => {
    for (const type of ['Minion', 'Spell', 'Weapon', 'Hero'] as const) {
      const card = CARD_CATALOG.all.find(
        (card) => card.type === type && card.cardClass !== 'Neutral'
      )!
      const standard = buildCardRenderTree(card).root.children
      const premium = buildCardRenderTree(card, { premium: true }).root.children
      expect(standard.find((node) => node.id === 'frame')).toMatchObject({
        assetKey: `card.frame.${type.toLowerCase()}.${card.cardClass.toLowerCase()}`
      })
      expect(standard.find((node) => node.id === 'class-frame-mask-1')).toMatchObject({
        visible: false
      })
      expect(premium.find((node) => node.id === 'class-frame-mask-1')).toMatchObject({
        visible: true
      })
      expect(standard.some((node) => node.id === 'mana-shadow')).toBe(false)
      expect(standard.some((node) => node.id === 'class-frame-mask-2')).toBe(false)
    }
  })

  it('omits gem surrounds for gemless cards and uses the built-in premium hero surround', () => {
    const free = CARD_CATALOG.all.find((card) => card.rarity === 'Free')!
    expect(
      buildCardRenderTree(free).root.children.some((node) => node.id === 'rarity')
    ).toBe(false)
    const hero = CARD_CATALOG.all.find(
      (card) => card.type === 'Hero' && card.rarity === 'Legendary'
    )!
    const rarity = buildCardRenderTree(hero, { premium: true }).root.children.find(
      (node) => node.id === 'rarity'
    )!
    if (rarity.kind !== 'group') throw new Error('Expected rarity group')
    expect(rarity.children.find((node) => node.id === 'frame')).toMatchObject({
      visible: false
    })
    expect(rarity.children.find((node) => node.id === 'gem')).toMatchObject({
      assetKey: 'card.rarity.legendary'
    })
  })
})

describe('shared card body alignment', () => {
  it('aligns authored body edges while allowing portrait arches to protrude', () => {
    const authored = {
      minion: [65, 981],
      spell: [2, 927],
      weapon: [39, 957],
      hero: [66, 985]
    } as const
    for (const template of ['minion', 'spell', 'weapon', 'hero'] as const) {
      const frame = cardFrameTransform(template)
      const [top, bottom] = authored[template]
      expect(frame.position.y + top * frame.scale.y).toBeCloseTo(CARD_BODY_BOUNDS.y)
      expect(frame.position.y + bottom * frame.scale.y).toBeCloseTo(
        CARD_BODY_BOUNDS.y + CARD_BODY_BOUNDS.height
      )
    }
  })

  it('keeps each type’s title baseline across finishes and shares the rules baseline', () => {
    const rulesYs = new Set<number>()
    for (const type of ['Minion', 'Spell', 'Weapon', 'Hero'] as const) {
      const titleYs = new Set<number>()
      const card = CARD_CATALOG.all.find(
        (card) => card.type === type && card.rulesText
      )!
      for (const premium of [false, true]) {
        const nodes = buildCardRenderTree(card, { premium }).root.children
        const title = nodes.find((node) => node.id === 'name')!
        const rules = nodes.find((node) => node.id === 'rules')!
        if (title.kind !== 'text' || rules.kind !== 'text')
          throw new Error('Expected text')
        titleYs.add(title.box.y)
        rulesYs.add(rules.box.y)
      }
      expect(titleYs.size).toBe(1)
    }
    expect(rulesYs.size).toBe(1)
  })
})
