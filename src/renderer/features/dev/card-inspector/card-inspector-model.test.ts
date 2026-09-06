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

  it('edits the live production configuration', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToClassFrameConfig(listener)
    const model = new CardInspectorModel()
    model.selectedClass = 'Druid'
    model.setNumeric('primary', 'hue', 212.5)
    model.setNumeric('secondary', 'opacity', 0.42)
    model.setBlendMode('secondary', 'screen')

    expect(getClassFrameConfig().classes.Druid.primary.hue).toBe(212.5)
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

    expect(model.getNumeric('primary', 'offsetX')).toBe(14.5)
    expect(model.getNumeric('secondary', 'offsetY')).toBe(-8)

    model.selectedTemplate = 'spell'
    expect(model.getNumeric('primary', 'offsetX')).toBe(0)
    model.setNumeric('primary', 'offsetX', -21)
    model.selectedTemplate = 'minion'
    expect(model.getNumeric('primary', 'offsetX')).toBe(14.5)
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
    model.activeChannel = 'secondary'
    model.linked = true
    model.selectedTemplate = 'spell'
    expect(model.activeChannel).toBe('primary')
    expect(model.linked).toBe(false)
  })

  it('uses the visible additive secondary baseline', () => {
    for (const entry of Object.values(getClassFrameConfig().classes)) {
      expect(entry.secondary.blendMode).toBe('add')
      expect(entry.secondary.opacity).toBe(0.38)
    }
    expect(classFrameAppearanceFor('Druid')?.secondary.alpha).toBe(0.38)
  })

  it('preserves linked differences and clamps both masks', () => {
    const model = new CardInspectorModel()
    model.linked = true
    model.setNumeric('primary', 'opacity', 0.95)
    expect(model.getNumeric('secondary', 'opacity')).toBe(0.33)
    model.setNumeric('primary', 'opacity', 1)
    expect(model.getNumeric('secondary', 'opacity')).toBe(0.38)
  })
})
