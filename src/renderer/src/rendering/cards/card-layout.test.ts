import { describe, expect, it } from 'vitest'
import { asCardId, CARD_CATALOG } from '../../../../game/content/cards'
import {
  hasCardAsset,
  hasCardArtwork
} from '../../ui/asset-registry/card-asset-resolver'
import {
  buildCardLayout,
  CARD_NAME_FIT,
  CARD_CANVAS,
  CARD_PROFILES,
  CARD_STAT_LABEL_OFFSETS,
  markHearthstoneKeywords,
  type CardLayout
} from './card-layout'
import type { CardDefinition } from '../../../../game/content/cards'
import { flattenCardRenderTree, type CardRenderNode } from './card-render-tree'

function collectNodePaths(node: CardRenderNode, parentPath = ''): string[] {
  const path = parentPath ? `${parentPath}.${node.id}` : node.id
  if (node.kind !== 'group') return [path]
  return [path, ...node.children.flatMap((child) => collectNodePaths(child, path))]
}

function textureAssets(card: CardDefinition): string[] {
  return flattenCardRenderTree(buildCardLayout(card).tree)
    .filter((layer) => layer.kind === 'texture')
    .map((layer) => layer.assetKey)
}

function layersOf(plan: CardLayout) {
  return flattenCardRenderTree(plan.tree)
}

describe('Card catalog', () => {
  it('normalizes every Basic and Classic card without duplicate ids', () => {
    expect(CARD_CATALOG.size).toBeGreaterThan(0)
    expect(new Set(CARD_CATALOG.all.map((card) => card.id)).size).toBe(
      CARD_CATALOG.size
    )
  })

  it('maps a weapon health value to durability', () => {
    const card = CARD_CATALOG.require('basic_fiery_war_axe')

    expect(card.type).toBe('Weapon')
    expect(card).not.toHaveProperty('health')
    expect(card).not.toHaveProperty('armor')
    expect(card.type === 'Weapon' ? card.durability : undefined).toBe(2)
  })

  it('normalizes hero armor separately from minion health', () => {
    const card = CARD_CATALOG.require('classic_lord_jaraxxus')

    expect(card.type).toBe('Hero')
    expect(card).not.toHaveProperty('attack')
    expect(card).not.toHaveProperty('health')
    expect(card.type === 'Hero' ? card.armor : undefined).toBe(5)
    expect(card).not.toHaveProperty('durability')
  })

  it('defaults omitted token costs to zero for display', () => {
    expect(CARD_CATALOG.require('classic_hogger_smash').cost).toBe(0)
    expect(CARD_CATALOG.require('classic_millhouse_manastorm').cost).toBe(0)
  })
})

describe('Card semantic layouts', () => {
  it('marks mechanics as boldable keywords without bolding ordinary card text', () => {
    expect(markHearthstoneKeywords("Battlecry: Destroy your opponent's weapon.")).toBe(
      "<keyword>Battlecry:</keyword> Destroy your opponent's weapon."
    )
  })

  it('resolves ID-named artwork and leaves cards without artwork unmapped', () => {
    expect(hasCardArtwork('basic_acidic_swamp_ooze')).toBe(true)
    expect(hasCardArtwork('classic_abusive_sergeant')).toBe(true)
    expect(hasCardArtwork('basic_ancestral_healing')).toBe(false)
    expect(hasCardArtwork('basic_fireball')).toBe(true)
  })

  it('builds a standard minion plan on the shared canvas', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardLayout(card)
    const assets = textureAssets(card)

    expect(plan.template).toBe('minion')
    expect(plan.width).toBe(CARD_CANVAS.width)
    expect(plan.height).toBe(CARD_CANVAS.height)
    expect(assets).toEqual(
      expect.arrayContaining([
        'card.frame.minion',
        'card.name',
        'card.stat.mana',
        'card.stat.attack',
        'card.stat.health',
        'card.rarity.rare'
      ])
    )
  })

  it('adds the legendary frame only to legendary minions', () => {
    const deathwing = CARD_CATALOG.require('classic_deathwing')
    if (deathwing.type !== 'Minion') throw new Error('Expected a minion fixture')
    const deathwingPlan = buildCardLayout(deathwing)
    const legendaryFrame = layersOf(deathwingPlan).find(
      (layer) => layer.id === 'card.legendary-frame'
    )

    expect(legendaryFrame).toMatchObject({
      kind: 'texture',
      assetKey: 'card.frame.legendary',
      position: { x: CARD_CANVAS.width / 2 + 60, y: -35 },
      anchor: { x: 0.5, y: 0 },
      zIndex: 105
    })
    expect(textureAssets(deathwing)).toContain('card.frame.legendary')

    const ordinaryMinion = CARD_CATALOG.require('classic_abomination')
    expect(textureAssets(ordinaryMinion)).not.toContain('card.frame.legendary')

    const { type: _type, attack: _attack, health: _health, ...spellBase } = deathwing
    const legendarySpell: CardDefinition = {
      ...spellBase,
      id: asCardId('test_legendary_spell'),
      type: 'Spell'
    }
    expect(textureAssets(legendarySpell)).not.toContain('card.frame.legendary')
  })

  it('uses one semantic hierarchy with centralized name offsets', () => {
    const card = CARD_CATALOG.require('basic_bluegill_warrior')
    const plan = buildCardLayout(card)
    const tree = plan.tree
    const paths = collectNodePaths(tree.root)

    expect(tree.root.id).toBe('card')
    expect(paths).toEqual(
      expect.arrayContaining([
        'card.artwork',
        'card.frame',
        'card.name-banner',
        'card.name',
        'card.rules',
        'card.stats.mana.icon',
        'card.stats.attack.icon',
        'card.stats.health.icon'
      ])
    )

    const name = layersOf(plan).find((layer) => layer.id === 'card.name')
    expect(name).toMatchObject({
      kind: 'text',
      position: {
        x:
          CARD_PROFILES.minion.nameBox.x +
          CARD_PROFILES.minion.nameBox.width / 2 +
          CARD_STAT_LABEL_OFFSETS.name.x,
        y:
          CARD_PROFILES.minion.nameBox.y +
          CARD_PROFILES.minion.nameBox.height / 2 +
          CARD_STAT_LABEL_OFFSETS.name.y
      },
      curve: undefined
    })
  })

  it('marks card names as single-line text with width fitting enabled', () => {
    const card = CARD_CATALOG.require('classic_treant_force_of_nature')
    const plan = buildCardLayout(card)
    const name = layersOf(plan).find((layer) => layer.id === 'card.name')

    expect(name).toMatchObject({
      kind: 'text',
      text: 'Treant (Force of Nature)',
      fit: 'width',
      style: {
        fontSize: 47,
        wordWrap: false,
        breakWords: false,
        wordWrapWidth: CARD_PROFILES.minion.nameBox.width
      }
    })
    expect(CARD_NAME_FIT).toEqual({ minFontSize: 30, horizontalPadding: 16 })
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
    const plan = buildCardLayout(card)
    const artwork = plan.tree.root.children.find((node) => node.id === 'artwork')

    expect(artwork).toMatchObject({
      kind: 'artwork',
      position: { x: 0, y: 0 },
      bounds: CARD_PROFILES.minion.artwork.bounds
    })
    expect(layersOf(plan).find((layer) => layer.kind === 'placeholder')).toMatchObject({
      shape: 'rectangle',
      bounds: CARD_PROFILES.minion.artwork.bounds
    })
  })

  it('applies persisted builder overrides by semantic node path', () => {
    const card = CARD_CATALOG.require('basic_bluegill_warrior')
    const plan = buildCardLayout(card)
    const mana = plan.tree.root.children.find((node) => node.id === 'stats')
    expect(mana).toMatchObject({ kind: 'group' })
    expect(
      layersOf(plan).find((layer) => layer.id === 'card.stats.mana.icon')
    ).toMatchObject({
      assetKey: 'card.stat.mana'
    })
    expect(layersOf(plan).find((layer) => layer.id === 'card.rules')).toMatchObject({
      style: { fontSize: 44, wordWrapWidth: CARD_PROFILES.minion.rulesBox.width }
    })
  })

  it('uses the spell profile for spells and excludes Hero Powers from cards', () => {
    const spell = CARD_CATALOG.require('basic_fireball')
    const spellPlan = buildCardLayout(spell)

    expect(spellPlan.template).toBe('spell')
    expect(textureAssets(spell)).toContain('card.frame.spell')
    expect(textureAssets(spell)).not.toContain('card.stat.attack')
    expect(textureAssets(spell)).not.toContain('card.stat.health')
    expect(layersOf(spellPlan).some((layer) => layer.id === 'card.rules')).toBe(true)
    expect(CARD_CATALOG.get('classic_life_tap')).toBeUndefined()
  })

  it('uses dedicated weapon attack and durability assets', () => {
    const card = CARD_CATALOG.require('basic_fiery_war_axe')
    expect(textureAssets(card)).toEqual(
      expect.arrayContaining([
        'card.frame.weapon',
        'card.stat.weapon-attack',
        'card.stat.weapon-durability'
      ])
    )
  })

  it('uses type-specific name banners directly above the card frame', () => {
    const minionPlan = buildCardLayout(CARD_CATALOG.require('classic_abomination'))
    const weaponPlan = buildCardLayout(CARD_CATALOG.require('basic_fiery_war_axe'))

    const minionBanner = layersOf(minionPlan).find(
      (layer) => layer.id === 'card.name-banner'
    )
    const weaponBanner = layersOf(weaponPlan).find(
      (layer) => layer.id === 'card.name-banner'
    )
    const minionBannerNode = minionPlan.tree.root.children.find(
      (node) => node.id === 'name-banner'
    )
    const weaponBannerNode = weaponPlan.tree.root.children.find(
      (node) => node.id === 'name-banner'
    )
    const minionFrame = layersOf(minionPlan).find((layer) => layer.id === 'card.frame')
    const minionName = layersOf(minionPlan).find((layer) => layer.id === 'card.name')

    expect(minionBanner).toMatchObject({
      kind: 'texture',
      assetKey: 'card.name',
      zIndex: 110,
      anchor: { x: 0.5, y: 0.5 },
      position: { x: 309, y: 490 }
    })
    expect(weaponBanner).toMatchObject({
      kind: 'texture',
      assetKey: 'card.name.weapon',
      zIndex: 110
    })
    expect(minionBannerNode).toMatchObject({
      kind: 'image',
      transform: { size: { width: 665, height: 198 } }
    })
    expect(weaponBannerNode).toMatchObject({
      kind: 'image',
      transform: { size: { width: 665, height: 198 } }
    })
    expect(minionFrame?.zIndex).toBe(100)
    expect(minionBanner?.zIndex).toBeLessThan(minionName?.zIndex ?? 0)
    expect(minionBanner?.zIndex).toBeGreaterThan(minionFrame?.zIndex ?? 0)
  })

  it('renders minion races on the bottom banner with the requested typography', () => {
    const card = CARD_CATALOG.require('classic_southsea_deckhand')
    const plan = buildCardLayout(card)
    const banner = layersOf(plan).find((layer) => layer.id === 'card.race-banner')
    const race = layersOf(plan).find((layer) => layer.id === 'card.race')

    expect(banner).toMatchObject({
      kind: 'texture',
      assetKey: 'card.race-banner',
      position: { x: 310, y: 825.5 },
      anchor: { x: 0.5, y: 0.5 },
      zIndex: 230
    })
    expect(race).toMatchObject({
      kind: 'text',
      text: 'Pirate',
      position: { x: 310, y: 826 },
      style: {
        fontFamily: 'Belwe',
        fontSize: 30,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 }
      },
      zIndex: 231
    })
  })

  it('uses spell school labels and supports future spell subtype data', () => {
    const spell = CARD_CATALOG.require('basic_arcane_explosion')
    const spellRace = layersOf(buildCardLayout(spell)).find(
      (layer) => layer.id === 'card.race'
    )
    expect(spellRace).toMatchObject({ kind: 'text', text: 'Arcane' })

    const futureSpell: CardDefinition = {
      ...spell,
      id: asCardId('test_fire_spell'),
      spellSchool: null,
      subtype: 'Fire'
    }
    expect(layersOf(buildCardLayout(futureSpell))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'card.race', text: 'Fire' })
      ])
    )
  })

  it('does not render race metadata for general or unsupported card types', () => {
    const generalMinion = buildCardLayout(CARD_CATALOG.require('classic_abomination'))
    expect(
      layersOf(generalMinion).some((layer) => layer.id.startsWith('card.race'))
    ).toBe(false)

    const weapon = CARD_CATALOG.require('basic_fiery_war_axe')
    expect(
      layersOf(buildCardLayout(weapon)).some((layer) =>
        layer.id.startsWith('card.race')
      )
    ).toBe(false)
  })

  it('uses the standard hero frame', () => {
    const source = CARD_CATALOG.require('classic_abomination')
    if (source.type !== 'Minion') throw new Error('Expected a minion fixture')
    const {
      type: _sourceType,
      attack: _sourceAttack,
      health: _sourceHealth,
      ...heroBase
    } = source
    const hero: CardDefinition = {
      ...heroBase,
      id: asCardId('test_hero'),
      name: 'Test Hero',
      type: 'Hero',
      armor: 30
    }

    const assets = textureAssets(hero)
    expect(assets).toEqual(
      expect.arrayContaining(['card.frame.hero', 'card.stat.armor'])
    )
    expect(assets).not.toContain('card.stat.attack')
    expect(assets).not.toContain('card.stat.health')
  })

  it('uses white black-stroked names and type-specific rules colors', () => {
    const minion = buildCardLayout(CARD_CATALOG.require('classic_abomination'))
    const weapon = buildCardLayout(CARD_CATALOG.require('classic_eaglehorn_bow'))
    const standardName = layersOf(minion).find((layer) => layer.id === 'card.name')
    const minionRules = layersOf(minion).find((layer) => layer.id === 'card.rules')
    const weaponRules = layersOf(weapon).find((layer) => layer.id === 'card.rules')

    expect(standardName).toMatchObject({
      style: { fill: 0xffffff, stroke: { color: 0x000000 } }
    })
    expect(minionRules).toMatchObject({ style: { fill: 0x19130e } })
    expect(weaponRules).toMatchObject({ style: { fill: 0xffffff } })
  })

  it('keeps Deathwing rules data intact while matching the reference line layout', () => {
    const card = CARD_CATALOG.require('classic_deathwing')
    const rules = layersOf(buildCardLayout(card)).find(
      (layer) => layer.id === 'card.rules'
    )

    expect(card.rulesText).toBe(
      'Battlecry: Destroy all other minions and discard your hand.'
    )
    expect(rules).toMatchObject({
      kind: 'text',
      text: '<keyword>Battlecry:</keyword> Destroy all other minions and discard\nyour hand.',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 44,
        fontWeight: 'normal',
        letterSpacing: -0.5,
        stroke: { color: 0x19130e, width: 0.75 },
        lineHeight: 50,
        tagStyles: { keyword: { fontWeight: 'bold' } },
        wordWrapWidth: CARD_PROFILES.minion.rulesBox.width
      }
    })
  })

  it('places rarity gems below the shared card title', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardLayout(card)
    const name = layersOf(plan).find((layer) => layer.id === 'card.name')
    const rarity = layersOf(plan).find((layer) => layer.id === 'card.rarity.gem')

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
    const plan = buildCardLayout(card)
    const manaLabel = layersOf(plan).find(
      (layer) => layer.id === 'card.stats.mana.label'
    )
    const attackLabel = layersOf(plan).find(
      (layer) => layer.id === 'card.stats.attack.label'
    )
    const healthLabel = layersOf(plan).find(
      (layer) => layer.id === 'card.stats.health.label'
    )

    expect(manaLabel).toMatchObject({
      position: {
        x: CARD_PROFILES.minion.stats.mana.x + CARD_STAT_LABEL_OFFSETS.mana.x,
        y: CARD_PROFILES.minion.stats.mana.y + CARD_STAT_LABEL_OFFSETS.mana.y
      }
    })
    expect(manaLabel).not.toMatchObject({ style: { letterSpacing: -4 } })
    expect(attackLabel).toMatchObject({
      position: {
        x: CARD_PROFILES.minion.stats.attack.x + CARD_STAT_LABEL_OFFSETS.attack.x,
        y: CARD_PROFILES.minion.stats.attack.y + CARD_STAT_LABEL_OFFSETS.attack.y
      },
      style: { letterSpacing: -4 }
    })
    expect(healthLabel).toMatchObject({
      position: {
        x: CARD_PROFILES.minion.stats.defense.x + CARD_STAT_LABEL_OFFSETS.health.x,
        y: CARD_PROFILES.minion.stats.defense.y + CARD_STAT_LABEL_OFFSETS.health.y
      },
      style: { letterSpacing: -4 }
    })
  })

  it('keeps weapon attack label placement separate from minion attack', () => {
    const card = CARD_CATALOG.require('basic_fiery_war_axe')
    const plan = buildCardLayout(card)
    const attackLabel = layersOf(plan).find(
      (layer) => layer.id === 'card.stats.attack.label'
    )
    const durabilityLabel = layersOf(plan).find(
      (layer) => layer.id === 'card.stats.durability.label'
    )

    expect(attackLabel).toMatchObject({
      position: {
        x:
          CARD_PROFILES.weapon.stats.weaponAttack.x +
          CARD_STAT_LABEL_OFFSETS.weaponAttack.x,
        y:
          CARD_PROFILES.weapon.stats.weaponAttack.y +
          CARD_STAT_LABEL_OFFSETS.weaponAttack.y
      },
      style: { letterSpacing: -4 }
    })
    expect(durabilityLabel).toMatchObject({
      position: {
        x:
          CARD_PROFILES.weapon.stats.weaponDefense.x +
          CARD_STAT_LABEL_OFFSETS.durability.x,
        y:
          CARD_PROFILES.weapon.stats.weaponDefense.y +
          CARD_STAT_LABEL_OFFSETS.durability.y
      },
      style: { letterSpacing: -4 }
    })
  })

  it('keeps minion life and hero armor profile positions independent', () => {
    expect(CARD_PROFILES.minion.stats.defense).not.toBe(
      CARD_PROFILES.minion.stats.armor
    )
  })

  it('keeps stat and rarity textures at their source resolution', () => {
    const card = CARD_CATALOG.require('classic_abomination')
    const plan = buildCardLayout(card)
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
    const plan = buildCardLayout(card, { elite: true })
    expect(layersOf(plan).some((layer) => layer.id.includes('elite'))).toBe(false)
    expect(plan.diagnostics.some((message) => message.includes('ignored'))).toBe(true)
  })

  it('resolves every current card using active standard assets', () => {
    const missing = new Set<string>()

    for (const card of CARD_CATALOG.all) {
      const plan = buildCardLayout(card)
      expect(plan.width).toBe(620)
      expect(plan.height).toBe(900)
      for (const layer of layersOf(plan)) {
        if (layer.kind === 'texture' && !hasCardAsset(layer.assetKey)) {
          missing.add(layer.assetKey)
        }
      }
    }

    expect([...missing]).toEqual([])
  })
})
