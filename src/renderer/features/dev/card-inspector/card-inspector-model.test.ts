import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG } from '../../../../game/content/cards'
import { CARD_CLASS_BLEND_MODES } from '../../../../shared/ipc/card-class-builder'
import { buildCardRenderTree } from '../../../rendering/cards/card-layout'
import {
  classFrameAppearanceFor,
  getClassFrameConfig,
  subscribeToClassFrameConfig,
  updateClassFrameConfig
} from '../../../rendering/cards/class-frame-colors'
import { CardInspectorModel, NUMERIC_CONTROL_SPECS } from './card-inspector-model'
import { CardView } from '../../../rendering/cards/card-view'
import { Container } from 'pixi.js'

describe('CardInspectorModel', () => {
  let initialConfig = structuredClone(getClassFrameConfig())

  beforeEach(() => {
    initialConfig = structuredClone(getClassFrameConfig())
  })

  afterEach(() => {
    updateClassFrameConfig(initialConfig)
  })

  it('exposes only the approved production controls and blend modes', () => {
    expect(NUMERIC_CONTROL_SPECS.map((spec) => spec.key)).toEqual([
      'hue',
      'saturation',
      'lightness',
      'opacity',
      'offsetX',
      'offsetY'
    ])
    expect(CARD_CLASS_BLEND_MODES).toEqual([
      'normal',
      'add',
      'multiply',
      'screen',
      'color',
      'overlay',
      'soft-light'
    ])
  })

  it('uses whole displayed units without rewriting saved values on selection', () => {
    const model = new CardInspectorModel()
    const before = structuredClone(model.config)
    model.selectedPremium = true
    model.selectedTemplate = 'spell'
    expect(model.config).toEqual(before)
    for (const spec of NUMERIC_CONTROL_SPECS) {
      expect(spec.step * spec.displayScale).toBe(1)
    }
    model.setNumeric('primary', 'saturation', 0.726)
    model.setNumeric('primary', 'offsetX', -12.7)
    expect(model.getNumeric('primary', 'saturation')).toBe(0.73)
    expect(model.getNumeric('primary', 'offsetX')).toBe(-13)
  })

  it('previews available weapon and hero cards without editing class masks', () => {
    const model = new CardInspectorModel()
    const before = structuredClone(model.config)
    model.selectedPremium = true
    model.selectedTemplate = 'weapon'
    expect(model.selectedCard?.type).toBe('Weapon')
    expect(model.hasCardForClass(model.selectedClass)).toBe(true)
    expect(model.maskTemplate).toBeUndefined()
    expect(model.selectedPremium).toBe(true)
    model.setNumeric('primary', 'offsetX', 50)
    model.setBlendMode('primary', 'add')
    model.selectedTemplate = 'hero'
    expect(model.selectedCard?.type).toBe('Hero')
    expect(model.selectedPremium).toBe(true)
    expect(model.maskTemplate).toBeUndefined()
    expect(model.config).toEqual(before)
    model.selectedTemplate = 'minion'
    expect(model.selectedPremium).toBe(true)
  })

  it('keeps variant offsets independent, sharing colors and offsets across classes', () => {
    const model = new CardInspectorModel()
    model.setNumeric('primary', 'offsetX', 12)
    model.selectedPremium = true
    expect(model.hasSecondaryMask).toBe(false)
    expect(model.hasSecondaryMask).toBe(false)
    model.setNumeric('primary', 'offsetX', 30)
    model.setNumeric('primary', 'offsetY', 0)
    model.setNumeric('primary', 'offsetX', 32)
    model.setNumeric('primary', 'offsetY', -5)
    model.setNumeric('primary', 'hue', 123)
    model.selectedPremium = false
    expect(model.getNumeric('primary', 'offsetX')).toBe(12)
    expect(model.getNumeric('primary', 'hue')).toBe(123)
    expect(model.hasSecondaryMask).toBe(true)
    model.selectedPremium = true
    model.selectedClass = 'Mage'
    expect(model.getNumeric('primary', 'offsetX')).toBe(32)
    expect(model.getNumeric('primary', 'offsetY')).toBe(-5)
    model.selectedTemplate = 'spell'
    model.setNumeric('primary', 'offsetX', -18)
    model.selectedTemplate = 'minion'
    expect(model.getNumeric('primary', 'offsetX')).toBe(32)
    model.setNumeric('primary', 'offsetX', 300)
    expect(model.getNumeric('primary', 'offsetX')).toBe(200)
    expect(classFrameAppearanceFor('Mage')?.primary.premiumOffsets.spell.x).toBe(-18)
  })

  it('applies live premium offsets relative to the mask base and restores standard offsets', () => {
    const model = new CardInspectorModel()
    model.setNumeric('primary', 'offsetX', 12)
    model.setNumeric('primary', 'offsetY', -4)
    model.selectedPremium = true
    model.setNumeric('primary', 'offsetX', 30)
    model.setNumeric('primary', 'offsetY', -8)
    const mask = new Container()
    const path = 'card.class-frame-mask-1'
    const view = Object.assign(Object.create(CardView.prototype), {
      activePlan: { template: 'minion' },
      premium: true,
      layerObjects: new Map([[path, [mask]]]),
      treeObjects: new Map([[path, { object: mask }]]),
      basePositions: new Map([[path, { x: 185, y: 871 }]]),
      semanticOffsets: new Map(),
      updateCacheTexture: vi.fn()
    }) as CardView
    try {
      view.setClassFrameAppearance(model.selectedClass)
      expect([mask.x, mask.y]).toEqual([215, 863])
      model.setNumeric('primary', 'offsetX', 35)
      model.setNumeric('primary', 'offsetY', -10)
      view.setClassFrameAppearance(model.selectedClass)
      expect([mask.x, mask.y]).toEqual([220, 861])
      Object.assign(view, { premium: false })
      view.setClassFrameAppearance(model.selectedClass)
      expect([mask.x, mask.y]).toEqual([197, 867])
    } finally {
      mask.destroy()
    }
  })

  it('edits the live production configuration', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToClassFrameConfig(listener)
    const model = new CardInspectorModel()
    model.selectedClass = 'Druid'
    model.setNumeric('primary', 'hue', 212.5)
    model.setNumeric('secondary', 'opacity', 0.42)
    model.setBlendMode('secondary', 'screen')

    expect(getClassFrameConfig().classes.Druid.primary.hue).toBe(213)
    expect(getClassFrameConfig().classes.Druid.secondary).toMatchObject({
      opacity: 0.42,
      blendMode: 'screen'
    })
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it('shares offsets across classes while keeping minion and spell offsets separate', () => {
    const model = new CardInspectorModel()
    model.selectedClass = 'Druid'
    model.setNumeric('primary', 'offsetX', 14.5)
    model.setNumeric('secondary', 'offsetY', -8)
    model.selectedClass = 'Mage'

    expect(model.getNumeric('primary', 'offsetX')).toBe(15)
    expect(model.getNumeric('secondary', 'offsetY')).toBe(-8)

    model.selectedTemplate = 'spell'
    expect(model.getNumeric('primary', 'offsetX')).toBe(
      initialConfig.offsets.spell.primary.x
    )
    model.setNumeric('primary', 'offsetX', -21)
    model.selectedTemplate = 'minion'
    expect(model.getNumeric('primary', 'offsetX')).toBe(15)
  })

  it('forces spells to primary-only state and render trees', () => {
    const minion = CARD_CATALOG.all.find(
      (card) => card.cardClass === 'Druid' && card.type === 'Minion'
    )!
    const spell = CARD_CATALOG.all.find(
      (card) => card.cardClass === 'Druid' && card.type === 'Spell'
    )!
    const maskIds = (card: typeof minion) =>
      buildCardRenderTree(card)
        .root.children.filter((node) => node.id.startsWith('class-frame-mask-'))
        .map((node) => node.id)

    expect(maskIds(minion)).toEqual(['class-frame-mask-1', 'class-frame-mask-2'])
    expect(maskIds(spell)).toEqual(['class-frame-mask-1'])

    const model = new CardInspectorModel()
    model.selectedTemplate = 'spell'
    expect(model.hasSecondaryMask).toBe(false)
  })

  it('aligns the full premium minion mask with the source frame bottom', () => {
    const card = CARD_CATALOG.all.find(
      (card) => card.type === 'Minion' && card.cardClass === 'Warlock'
    )!
    const mask = buildCardRenderTree(card, { premium: true }).root.children.find(
      (node) => node.id === 'class-frame-mask-1'
    )!
    expect(mask.kind).toBe('image')
    if (mask.kind !== 'image') throw new Error('Expected an image mask')
    const scaleY = mask.transform.scale!.y
    expect(mask.transform.position.x).toBe((620 - 250) / 2)
    expect(scaleY).toBeCloseTo(900 / 913)
    expect(mask.transform.position.y + 383 * scaleY).toBeCloseTo(900)
    expect(mask.transform.position.y).toBeCloseTo(530 * scaleY)
  })

  it('uses the authored secondary appearance', () => {
    for (const classId of new CardInspectorModel().classes) {
      const entry = initialConfig.classes[classId].secondary
      expect(classFrameAppearanceFor(classId)?.secondary).toMatchObject({
        blendMode: entry.blendMode,
        alpha: entry.opacity
      })
    }
  })

  it('edits masks independently and clamps values', () => {
    const model = new CardInspectorModel()
    model.setNumeric('primary', 'opacity', 1)
    model.setNumeric('secondary', 'opacity', 0.38)
    model.setNumeric('primary', 'opacity', 2)
    expect(model.getNumeric('primary', 'opacity')).toBe(1)
    model.setNumeric('primary', 'opacity', 1)
    expect(model.getNumeric('secondary', 'opacity')).toBe(0.38)
  })
})
