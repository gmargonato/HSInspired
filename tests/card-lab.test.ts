import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../card-lab/card-catalog'
import { hasCardAsset, hasCardArtwork } from '../card-lab/card-asset-manifest'
import {
  buildCardRenderPlan,
  CARD_CANVAS,
  CARD_PROFILES,
  markHearthstoneKeywords
} from '../card-lab/card-render-plan'
import { CARD_STAT_LABEL_OFFSETS } from '../card-lab/card-minion-template'
import type { CardDefinition } from '../card-lab/card-catalog'
import type { CardRenderNode } from '../card-lab/card-render-tree'

function collectNodePaths(node: CardRenderNode, parentPath = ''): string[] {
  const path = parentPath ? `${parentPath}.${node.id}` : node.id
  if (node.kind !== 'group') return [path]
  return [path, ...node.children.flatMap((child) => collectNodePaths(child, path))]
}

function textureAssets(card: CardDefinition): string[] {
  return buildCardRenderPlan(card)
    .layers.filter((layer) => layer.kind === 'texture')
    .map((layer) => layer.assetName)
}

describe('Card Lab catalog', () => {
  it('normalizes every Basic and Classic card without duplicate ids', () => {
    expect(CARD_CATALOG.size).toBeGreaterThan(0)
    expect(new Set(CARD_CATALOG.all.map((card) => card.id)).size).toBe(
      CARD_CATALOG.size
    )
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
  it('marks mechanics as boldable keywords without bolding ordinary card text', () => {
    expect(markHearthstoneKeywords("Battlecry: Destroy your opponent's weapon.")).toBe(
      "<keyword>Battlecry:</keyword> Destroy your opponent's weapon."
    )
  })

  it('resolves ID-named artwork and leaves cards without artwork unmapped', () => {
    expect(hasCardArtwork('basic_acidic_swamp_ooze')).toBe(true)
    expect(hasCardArtwork('classic_abusive_sergeant')).toBe(true)
    expect(hasCardArtwork('basic_arcanite_reaper')).toBe(false)
    expect(hasCardArtwork('basic_fireball')).toBe(true)
  })

  it('builds a standard minion plan on the shared canvas', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card)
    const assets = textureAssets(card)

    expect(plan.template).toBe('minion')
    expect(plan.width).toBe(CARD_CANVAS.width)
    expect(plan.height).toBe(CARD_CANVAS.height)
    expect(assets).toEqual(
      expect.arrayContaining([
        'FRAME_MINION.png',
        'MANA.png',
        'ATTACK.png',
        'HEALTH.png',
        'rarity-rare.png'
      ])
    )
    expect(assets.some((asset) => asset.includes('name-banner'))).toBe(false)
  })

  it('uses one semantic hierarchy with straight, shared-Y names', () => {
    const card = CARD_CATALOG.require('basic_bluegill_warrior')
    const plan = buildCardRenderPlan(card)
    const tree = plan.tree
    const paths = collectNodePaths(tree.root)

    expect(tree.root.id).toBe('card')
    expect(paths).toEqual(
      expect.arrayContaining([
        'card.artwork',
        'card.frame',
        'card.name',
        'card.rules',
        'card.stats.mana.icon',
        'card.stats.attack.icon',
        'card.stats.health.icon'
      ])
    )

    const name = plan.layers.find((layer) => layer.id === 'card.name')
    expect(name).toMatchObject({
      kind: 'text',
      position: {
        y: CARD_PROFILES.minion.nameBox.y + CARD_PROFILES.minion.nameBox.height / 2
      },
      curve: undefined
    })
  })

  it('shares card geometry across minion, spell, weapon, and hero templates', () => {
    const profiles = Object.values(CARD_PROFILES)
    const reference = profiles[0]
    expect(reference).toBeDefined()

    for (const profile of profiles) {
      expect(profile.artwork).toEqual(reference.artwork)
      expect(profile.nameBox).toEqual(reference.nameBox)
      expect(profile.rulesBox).toEqual(reference.rulesBox)
      expect(profile.stats).toEqual(reference.stats)
      expect(profile.rarity).toEqual(reference.rarity)
    }
  })

  it('renders artwork as a shared native-size rectangle behind the frame', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card)
    const artwork = plan.tree.root.children.find((node) => node.id === 'artwork')

    expect(artwork).toMatchObject({
      kind: 'artwork',
      position: { x: 0, y: 0 },
      bounds: { x: 83, y: 0, width: 454, height: 454 }
    })
    expect(plan.layers.find((layer) => layer.kind === 'placeholder')).toMatchObject({
      shape: 'rectangle',
      bounds: { x: 83, y: 0, width: 454, height: 454 }
    })
  })

  it('applies persisted builder overrides by semantic node path', () => {
    const card = CARD_CATALOG.require('basic_bluegill_warrior')
    const plan = buildCardRenderPlan(card, {
      nodeOverrides: {
        'card.stats.mana': { x: 80, y: 90 },
        'card.rules': { width: 300, fontSize: 30 }
      }
    })

    expect(
      plan.layers.find(
        (layer) => layer.kind === 'texture' && layer.assetName === 'MANA.png'
      )
    ).toMatchObject({ position: { x: 80, y: 90 } })
    expect(plan.layers.find((layer) => layer.id === 'card.rules')).toMatchObject({
      style: { fontSize: 30, wordWrapWidth: 300 }
    })
  })

  it('uses the spell profile for spells and excludes Hero Powers from cards', () => {
    const spell = CARD_CATALOG.require('basic_fireball')
    const spellPlan = buildCardRenderPlan(spell)

    expect(spellPlan.template).toBe('spell')
    expect(textureAssets(spell)).toContain('FRAME_SPELL.png')
    expect(textureAssets(spell)).not.toContain('ATTACK.png')
    expect(textureAssets(spell)).not.toContain('HEALTH.png')
    expect(spellPlan.layers.some((layer) => layer.id === 'card.rules')).toBe(true)
    expect(CARD_CATALOG.get('classic_life_tap')).toBeUndefined()
  })

  it('uses dedicated weapon attack and durability assets', () => {
    const card = CARD_CATALOG.require('basic_fiery_war_axe')
    expect(textureAssets(card)).toEqual(
      expect.arrayContaining([
        'FRAME_WEAPON.png',
        'attack-weapon.png',
        'durability.png'
      ])
    )
  })

  it('uses the standard hero frame', () => {
    const source = CARD_CATALOG.require('classic_abomination')
    const hero: CardDefinition = {
      ...source,
      id: 'test_hero',
      name: 'Test Hero',
      type: 'Hero',
      attack: null,
      health: 30,
      durability: null
    }

    expect(textureAssets(hero)).toContain('FRAME_HERO.png')
  })

  it('uses white black-stroked names and type-specific rules colors', () => {
    const minion = buildCardRenderPlan(CARD_CATALOG.require('classic_abomination'))
    const weapon = buildCardRenderPlan(CARD_CATALOG.require('classic_eaglehorn_bow'))
    const standardName = minion.layers.find((layer) => layer.id === 'card.name')
    const minionRules = minion.layers.find((layer) => layer.id === 'card.rules')
    const weaponRules = weapon.layers.find((layer) => layer.id === 'card.rules')

    expect(standardName).toMatchObject({
      style: { fill: 0xffffff, stroke: { color: 0x000000 } }
    })
    expect(minionRules).toMatchObject({ style: { fill: 0x19130e } })
    expect(weaponRules).toMatchObject({ style: { fill: 0xffffff } })
  })

  it('places rarity gems below the shared card title', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card)
    const name = plan.layers.find((layer) => layer.id === 'card.name')
    const rarity = plan.layers.find((layer) => layer.id === 'card.rarity.gem')

    expect(name).toBeDefined()
    expect(rarity).toMatchObject({
      position: CARD_PROFILES.minion.rarity,
      anchor: { x: 0.5, y: 0.5 }
    })
    const rarityY = rarity?.kind === 'texture' ? rarity.position.y : 0
    expect(rarityY).toBeGreaterThan(
      CARD_PROFILES.minion.nameBox.y + CARD_PROFILES.minion.nameBox.height / 2
    )
  })

  it('applies the centralized per-stat label offsets', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card)
    const manaLabel = plan.layers.find((layer) => layer.id === 'card.stats.mana.label')
    const attackLabel = plan.layers.find(
      (layer) => layer.id === 'card.stats.attack.label'
    )
    const healthLabel = plan.layers.find(
      (layer) => layer.id === 'card.stats.health.label'
    )

    expect(manaLabel).toMatchObject({
      position: {
        x: CARD_PROFILES.minion.stats.mana.x + CARD_STAT_LABEL_OFFSETS.mana.x,
        y: CARD_PROFILES.minion.stats.mana.y + CARD_STAT_LABEL_OFFSETS.mana.y
      }
    })
    expect(attackLabel).toMatchObject({
      position: {
        x: CARD_PROFILES.minion.stats.attack.x + CARD_STAT_LABEL_OFFSETS.attack.x,
        y: CARD_PROFILES.minion.stats.attack.y + CARD_STAT_LABEL_OFFSETS.attack.y
      }
    })
    expect(healthLabel).toMatchObject({
      position: {
        x: CARD_PROFILES.minion.stats.defense.x + CARD_STAT_LABEL_OFFSETS.health.x,
        y: CARD_PROFILES.minion.stats.defense.y + CARD_STAT_LABEL_OFFSETS.health.y
      }
    })
  })

  it('keeps stat and rarity textures at their source resolution', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card)
    const stats = plan.tree.root.children.find(
      (node): node is Extract<CardRenderNode, { kind: 'group' }> =>
        node.kind === 'group' && node.id === 'stats'
    )

    expect(stats).toBeDefined()
    for (const stat of stats?.children ?? []) {
      if (stat.kind !== 'group') continue
      const icon = stat.children.find((child) => child.kind === 'image')
      expect(icon).toMatchObject({
        kind: 'image',
        transform: { position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 } }
      })
      expect(icon?.kind === 'image' ? icon.transform.size : undefined).toBeUndefined()
    }

    const rarity = plan.tree.root.children.find(
      (node): node is Extract<CardRenderNode, { kind: 'group' }> =>
        node.kind === 'group' && node.id === 'rarity'
    )
    const rarityIcon = rarity?.children.find((child) => child.kind === 'image')
    expect(
      rarityIcon?.kind === 'image' ? rarityIcon.transform.size : undefined
    ).toBeUndefined()
  })

  it('does not produce elite overlays', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardRenderPlan(card, { elite: true })
    expect(plan.layers.some((layer) => layer.id.includes('elite'))).toBe(false)
    expect(plan.diagnostics.some((message) => message.includes('ignored'))).toBe(true)
  })

  it('resolves every current card using active standard assets', () => {
    const missing = new Set<string>()

    for (const card of CARD_CATALOG.all) {
      const plan = buildCardRenderPlan(card)
      expect(plan.width).toBe(620)
      expect(plan.height).toBe(900)
      for (const layer of plan.layers) {
        if (layer.kind === 'texture' && !hasCardAsset(layer.assetName)) {
          missing.add(layer.assetName)
        }
      }
    }

    expect([...missing]).toEqual([])
  })
})
