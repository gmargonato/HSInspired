import type { CardDefinition, CardType } from './card-catalog'
import type {
  CardBounds,
  CardNodeOverrides,
  CardPoint,
  CardRenderOptions,
  CardTextStyle
} from './card-render-plan'
import type { CardGroupNode, CardRenderNode, CardSize } from './card-render-tree'
import { markHearthstoneKeywords } from './card-text-markup'

/** The shared design canvas for every card profile. */
export const CARD_CANVAS = {
  width: 620,
  height: 900
} as const

type CardVisualTemplate = 'minion' | 'spell' | 'weapon' | 'hero'

interface CardProfile {
  readonly template: CardVisualTemplate
  readonly frame: string
  readonly artwork: {
    readonly bounds: CardBounds
  }
  readonly nameBox: CardBounds
  readonly rulesBox: CardBounds
  readonly stats: {
    readonly mana: CardPoint
    readonly attack: CardPoint
    readonly defense: CardPoint
    readonly weaponAttack: CardPoint
    readonly weaponDefense: CardPoint
  }
  readonly rarity: CardPoint
}

const SHARED_ARTWORK = {
  bounds: { x: 5, y: 5, width: 600, height: 600 }
} as const

const SHARED_NAME_BOX = { x: 74, y: 454, width: 472, height: 72 } as const
const SHARED_RULES_BOX = { x: 94, y: 600, width: 432, height: 190 } as const
const NAME_BANNER_SOURCE_SIZE = { width: 665, height: 198 } as const
const NAME_BANNER_SIZE = NAME_BANNER_SOURCE_SIZE
const NAME_BANNER_Z_INDEX = 110
const SHARED_STATS = {
  mana: { x: 60, y: 50 },
  attack: { x: 60, y: 800 },
  defense: { x: 570, y: 800 },
  weaponAttack: { x: 60, y: 800 },
  weaponDefense: { x: 570, y: 800 }
} as const
/** Centered below the shared title box; rarity assets are 42x58 at source size. */
const SHARED_RARITY = { x: 310, y: 560 } as const

/**
 * Geometry is centralized here. Source frame files are normalized to this
 * 620x900 design coordinate system when rendered.
 */
export const CARD_PROFILES: Readonly<Record<CardVisualTemplate, CardProfile>> = {
  minion: {
    template: 'minion',
    frame: 'FRAME_MINION.png',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  },
  spell: {
    template: 'spell',
    frame: 'FRAME_SPELL.png',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  },
  weapon: {
    template: 'weapon',
    frame: 'FRAME_WEAPON.png',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  },
  hero: {
    template: 'hero',
    frame: 'FRAME_HERO.png',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  }
} as const

export function visualTemplateFor(type: CardType): CardVisualTemplate {
  if (type === 'Spell') return 'spell'
  if (type === 'Weapon') return 'weapon'
  if (type === 'Hero') return 'hero'
  return 'minion'
}

function group(
  id: string,
  position: CardPoint,
  zIndex: number,
  children: readonly CardRenderNode[]
): CardGroupNode {
  return { kind: 'group', id, position, zIndex, children }
}

function image(
  id: string,
  assetName: string,
  position: CardPoint,
  zIndex: number,
  options: {
    readonly size?: CardSize
    readonly anchor?: CardPoint
    readonly scale?: CardPoint
  } = {}
): Extract<CardRenderNode, { kind: 'image' }> {
  return {
    kind: 'image',
    id,
    assetName,
    transform: { position, ...options },
    zIndex
  }
}

function text(
  id: string,
  value: string,
  box: CardBounds,
  style: CardTextStyle,
  zIndex: number
): Extract<CardRenderNode, { kind: 'text' }> {
  return {
    kind: 'text',
    id,
    text: value,
    box,
    style,
    anchor: { x: 0.5, y: 0.5 },
    zIndex
  }
}

function artwork(profile: CardProfile): Extract<CardRenderNode, { kind: 'artwork' }> {
  return {
    kind: 'artwork',
    id: 'artwork',
    position: { x: 0, y: 0 },
    bounds: profile.artwork.bounds,
    zIndex: 0
  }
}

function nameBanner(
  card: CardDefinition,
  profile: CardProfile
): Extract<CardRenderNode, { kind: 'image' }> {
  return image(
    'name-banner',
    card.type === 'Weapon' ? 'WEAPON_NAME.png' : 'CARD_NAME.png',
    {
      x: profile.nameBox.x + profile.nameBox.width / 2,
      y: profile.nameBox.y + profile.nameBox.height / 2
    },
    NAME_BANNER_Z_INDEX,
    {
      size: NAME_BANNER_SIZE,
      anchor: { x: 0.5, y: 0.5 }
    }
  )
}

const NAME_STYLE_BASE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 42,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x000000, width: 7 },
  wordWrap: true,
  breakWords: true
}

const RULES_STYLE_BASE: CardTextStyle = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 34,
  fill: 0x19130e,
  align: 'center',
  fontWeight: 'normal',
  lineHeight: 38,
  breakWords: true,
  tagStyles: { keyword: { fontWeight: 'bold' } }
}

const WEAPON_RULES_STYLE: CardTextStyle = {
  ...RULES_STYLE_BASE,
  fill: 0xffffff
}

const STAT_STYLE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 150,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x17120f, width: 8 }
}

const STAT_VALUE_BOX: CardBounds = {
  x: -55,
  y: -55,
  width: 110,
  height: 110
}

/**
 * Per-stat label calibration, in pixels relative to each stat group's center.
 * Edit these values when a number needs to move without moving its icon.
 */
export const CARD_STAT_LABEL_OFFSETS = {
  mana: { x: 0, y: -10 },
  attack: { x: 20, y: 15 },
  health: { x: 0, y: 15 },
  armor: { x: 0, y: 15 },
  durability: { x: 0, y: 15 },
  name: { x: 0, y: -15 }
} as const

type CardStatId = Exclude<keyof typeof CARD_STAT_LABEL_OFFSETS, 'name'>

function stat(
  id: CardStatId,
  value: number,
  position: CardPoint,
  assetName: string
): CardGroupNode {
  const labelOffset = CARD_STAT_LABEL_OFFSETS[id]
  const labelBox: CardBounds = {
    ...STAT_VALUE_BOX,
    x: STAT_VALUE_BOX.x + labelOffset.x,
    y: STAT_VALUE_BOX.y + labelOffset.y
  }

  return group(id, position, 300, [
    image('icon', assetName, { x: 0, y: 0 }, 300, {
      anchor: { x: 0.5, y: 0.5 }
    }),
    text('label', String(value), labelBox, STAT_STYLE, 301)
  ])
}

function stats(card: CardDefinition, profile: CardProfile): CardGroupNode {
  const children: CardRenderNode[] = [
    stat('mana', card.cost, profile.stats.mana, 'MANA.png')
  ]

  if ((card.type === 'Minion' || card.type === 'Weapon') && card.attack !== null) {
    const attackAsset = card.type === 'Weapon' ? 'WEAPON_ATTACK.png' : 'ATTACK.png'
    children.push(
      stat(
        'attack',
        card.attack,
        card.type === 'Weapon' ? profile.stats.weaponAttack : profile.stats.attack,
        attackAsset
      )
    )
  }

  if (card.type === 'Weapon' && card.durability !== null) {
    children.push(
      stat('durability', card.durability, profile.stats.weaponDefense, 'WEAPON_DURABILITY.png')
    )
  } else if (card.type === 'Minion' && card.health !== null) {
    children.push(stat('health', card.health, profile.stats.defense, 'HEALTH.png'))
  } else if (card.type === 'Hero' && card.armor !== null) {
    children.push(stat('armor', card.armor, profile.stats.defense, 'ARMOR.png'))
  }

  return group('stats', { x: 0, y: 0 }, 300, children)
}

function rarity(card: CardDefinition, profile: CardProfile): CardGroupNode | null {
  if (!['Common', 'Rare', 'Epic', 'Legendary'].includes(card.rarity)) return null
  return group('rarity', { x: 0, y: 0 }, 400, [
    image('gem', `RARITY_${card.rarity.toLowerCase()}.png`, profile.rarity, 400, {
      anchor: { x: 0.5, y: 0.5 }
    })
  ])
}

function overlays(options: CardRenderOptions): CardGroupNode | null {
  if (!options.silenced) return null
  return group('overlays', { x: 0, y: 0 }, 500, [
    image('silence', 'silence-x.png', { x: 310, y: 475 }, 500, {
      anchor: { x: 0.5, y: 0.5 }
    })
  ])
}

function applyNodeOverrides(
  root: CardGroupNode,
  overrides: CardNodeOverrides | undefined
): CardGroupNode {
  if (!overrides || Object.keys(overrides).length === 0) return root

  function visit(node: CardRenderNode, parentPath: string): CardRenderNode {
    const path = parentPath ? `${parentPath}.${node.id}` : node.id
    const override = overrides?.[path] ?? {}

    if (node.kind === 'group') {
      return {
        ...node,
        position: {
          x: override.x ?? node.position.x,
          y: override.y ?? node.position.y
        },
        visible: override.visible ?? node.visible,
        children: node.children.map((child) => visit(child, path))
      }
    }

    if (node.kind === 'image') {
      const currentSize = node.transform.size
      const hasSizeOverride =
        override.width !== undefined || override.height !== undefined
      return {
        ...node,
        visible: override.visible ?? node.visible,
        transform: {
          ...node.transform,
          position: {
            x: override.x ?? node.transform.position.x,
            y: override.y ?? node.transform.position.y
          },
          size: hasSizeOverride
            ? {
                width: override.width ?? currentSize?.width ?? 1,
                height: override.height ?? currentSize?.height ?? 1
              }
            : currentSize
        }
      }
    }

    if (node.kind === 'text') {
      return {
        ...node,
        visible: override.visible ?? node.visible,
        box: {
          x: override.x ?? node.box.x,
          y: override.y ?? node.box.y,
          width: override.width ?? node.box.width,
          height: override.height ?? node.box.height
        },
        style: {
          ...node.style,
          fontSize: override.fontSize ?? node.style.fontSize,
          lineHeight: override.lineHeight ?? node.style.lineHeight
        }
      }
    }

    return {
      ...node,
      visible: override.visible ?? node.visible,
      position: {
        x: override.x ?? node.position.x,
        y: override.y ?? node.position.y
      },
      bounds: {
        ...node.bounds,
        width: override.width ?? node.bounds.width,
        height: override.height ?? node.bounds.height
      }
    }
  }

  return visit(root, '') as CardGroupNode
}

export function buildCardRenderTree(
  card: CardDefinition,
  options: CardRenderOptions = {}
): { readonly root: CardGroupNode } {
  const profile = CARD_PROFILES[visualTemplateFor(card.type)]
  const children: CardRenderNode[] = [
    artwork(profile),
    image('frame', profile.frame, { x: 0, y: 0 }, 100, { size: CARD_CANVAS }),
    nameBanner(card, profile),
    text(
      'name',
      card.name,
      {
        ...profile.nameBox,
        x: profile.nameBox.x + CARD_STAT_LABEL_OFFSETS.name.x,
        y: profile.nameBox.y + CARD_STAT_LABEL_OFFSETS.name.y
      },
      NAME_STYLE_BASE,
      200
    )
  ]

  if (card.effect) {
    children.push(
      text(
        'rules',
        markHearthstoneKeywords(card.effect),
        profile.rulesBox,
        card.type === 'Weapon' ? WEAPON_RULES_STYLE : RULES_STYLE_BASE,
        220
      )
    )
  }

  children.push(stats(card, profile))
  const rarityNode = rarity(card, profile)
  if (rarityNode) children.push(rarityNode)
  const overlayNode = overlays(options)
  if (overlayNode) children.push(overlayNode)

  return {
    root: applyNodeOverrides(
      group('card', { x: 0, y: 0 }, 0, children),
      options.nodeOverrides
    )
  }
}

/** Backwards-compatible name for callers that still refer to the minion builder. */
export const buildMinionRenderTree = buildCardRenderTree

export type { CardVisualTemplate }
