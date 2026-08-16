import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../card-lab/card-catalog'
import { hasCardAsset } from '../card-lab/card-asset-manifest'
import { buildCardRenderPlan } from '../card-lab/card-render-plan'

describe('Card Lab catalog', () => {
  it('normalizes every Basic and Classic card without duplicate ids', () => {
    expect(CARD_CATALOG.size).toBe(475)
    expect(new Set(CARD_CATALOG.all.map((card) => card.id)).size).toBe(475)
  })

  it('maps a weapon health value to durability', () => {
    const card = CARD_CATALOG.require('basic_fiery_war_axe')

    expect(card.type).toBe('Weapon')
    expect(card.health).toBeNull()
    expect(card.durability).toBe(2)
  })

  it('defaults omitted token costs to zero for display', () => {
    expect(CARD_CATALOG.require('classic_hogger_smash').cost).toBe(0)
    expect(CARD_CATALOG.require('classic_millhouse_manastorm').cost).toBe(0)
  })
})

describe('Card Lab render plans', () => {
  it('builds a complete normal minion plan', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card)
    const assets = plan.layers
      .filter((layer) => layer.kind === 'texture')
      .map((layer) => layer.assetName)

    expect(plan.template).toBe('minion')
    expect(assets).toContain('frame-minion-neutral.png')
    expect(assets).toContain('name-banner-minion.png')
    expect(assets).toContain('cost-mana.png')
    expect(assets).toContain('attack-minion.png')
    expect(assets).toContain('health.png')
    expect(assets).toContain('rarity-minion-rare.png')
  })

  it('uses the spell template without attack or health layers', () => {
    const card = CARD_CATALOG.require('basic_fireball')
    const plan = buildCardRenderPlan(card)
    const layerIds = plan.layers.map((layer) => layer.id)

    expect(plan.template).toBe('spell')
    expect(layerIds).not.toContain('attack-icon')
    expect(layerIds).not.toContain('health-icon')
    expect(layerIds).toContain('effect-text')
  })

  it('keeps Hero Power rendering on its dedicated template', () => {
    const card = CARD_CATALOG.require('basic_fireblast')
    const plan = buildCardRenderPlan(card)
    const frame = plan.layers.find((layer) => layer.id === 'hero-power-frame')

    expect(plan.template).toBe('hero-power')
    expect(frame).toMatchObject({
      kind: 'texture',
      assetName: 'hero-power-player.png'
    })
  })

  it('can produce a premium layer plan without changing the card definition', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card, { premium: true })
    const assets = plan.layers
      .filter((layer) => layer.kind === 'texture')
      .map((layer) => layer.assetName)

    expect(card.rarity).toBe('Rare')
    expect(assets).toContain('base-minion-premium.png')
    expect(assets).toContain('frame-minion-premium-neutral.png')
    expect(assets).toContain('rarity-minion-premium-rare.png')
  })

  it('resolves every current card template to existing normal and premium assets', () => {
    const missing = new Set<string>()

    for (const card of CARD_CATALOG.all) {
      for (const premium of [false, true]) {
        const plan = buildCardRenderPlan(card, { premium })
        for (const layer of plan.layers) {
          if (layer.kind === 'texture' && !hasCardAsset(layer.assetName)) {
            missing.add(layer.assetName)
          }
        }
      }
    }

    expect([...missing]).toEqual([])
  })
})
