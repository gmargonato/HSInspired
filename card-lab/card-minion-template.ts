import type { CardDefinition, CardType } from './card-catalog'
import type {
  CardArtworkPlacement,
  CardBounds,
  CardNodeOverrides,
  CardPoint,
  CardRenderOptions,
  CardShape,
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
  readonly frame: { readonly normal: string; readonly premium: string }
  readonly artwork: {
    readonly bounds: CardBounds
    readonly shape: CardShape
    readonly placement: CardArtworkPlacement
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

/**
 * Geometry is centralized here. Source frame files are normalized to this
 * 620x900 design coordinate system when rendered.
 */
export const CARD_PROFILES: Readonly<Record<CardVisualTemplate, CardProfile>> = {
  minion: {
    template: 'minion',
    frame: {
      normal: 'FRAME_MINION.png',
      premium: 'FRAME_MINION_PREMIUM.png'
    },
    artwork: {
      bounds: { x: 100, y: 5, width: 405, height: 550 },
      shape: 'ellipse',
      placement: { offset: { x: 0, y: 26 }, overscan: 1.02 }
    },
    nameBox: { x: 74, y: 450, width: 472, height: 72 },
    rulesBox: { x: 94, y: 560, width: 432, height: 230 },
    stats: {
      mana: { x: 60, y: 70 },
      attack: { x: 60, y: 800 },
      defense: { x: 570, y: 800 },
      weaponAttack: { x: 68, y: 834 },
      weaponDefense: { x: 557, y: 830 }
    },
    rarity: { x: 310, y: 563 }
  },
  spell: {
    template: 'spell',
    frame: {
      normal: 'FRAME_SPELL.png',
      premium: 'FRAME_SPELL_PREMIUM.png'
    },
    artwork: {
      bounds: { x: 76, y: 58, width: 468, height: 386 },
      shape: 'rounded-rectangle',
      placement: { offset: { x: 0, y: 0 }, overscan: 1.02 }
    },
    nameBox: { x: 74, y: 454, width: 472, height: 72 },
    rulesBox: { x: 94, y: 555, width: 432, height: 245 },
    stats: {
      mana: { x: 77, y: 91 },
      attack: { x: 102, y: 775 },
      defense: { x: 542, y: 790 },
      weaponAttack: { x: 68, y: 834 },
      weaponDefense: { x: 557, y: 830 }
    },
    rarity: { x: 310, y: 842 }
  },
  weapon: {
    template: 'weapon',
    frame: {
      normal: 'FRAME_WEAPON.png',
      premium: 'FRAME_WEAPON_PREMIUM.png'
    },
    artwork: {
      bounds: { x: 95, y: 58, width: 430, height: 390 },
      shape: 'circle',
      placement: { offset: { x: 0, y: 0 }, overscan: 1.02 }
    },
    nameBox: { x: 74, y: 454, width: 472, height: 72 },
    rulesBox: { x: 94, y: 555, width: 432, height: 245 },
    stats: {
      mana: { x: 77, y: 91 },
      attack: { x: 102, y: 775 },
      defense: { x: 542, y: 790 },
      weaponAttack: { x: 68, y: 834 },
      weaponDefense: { x: 557, y: 830 }
    },
    rarity: { x: 310, y: 842 }
  },
  hero: {
    template: 'hero',
    frame: {
      normal: 'FRAME_HERO.png',
      premium: 'FRAME_HERO_PREMIUM.png'
    },
    artwork: {
      bounds: { x: 92, y: 48, width: 436, height: 408 },
      shape: 'arch',
      placement: { offset: { x: 0, y: 0 }, overscan: 1.02 }
    },
    nameBox: { x: 74, y: 454, width: 472, height: 72 },
    rulesBox: { x: 94, y: 555, width: 432, height: 245 },
    stats: {
      mana: { x: 77, y: 91 },
      attack: { x: 102, y: 775 },
      defense: { x: 542, y: 790 },
      weaponAttack: { x: 68, y: 834 },
      weaponDefense: { x: 557, y: 830 }
    },
    rarity: { x: 310, y: 842 }
  }
} as const

export function visualTemplateFor(type: CardType): CardVisualTemplate {
  if (type === 'Spell' || type === 'Hero Power') return 'spell'
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
    position: { x: profile.artwork.bounds.x, y: profile.artwork.bounds.y },
    mask: {
      bounds: {
        x: 0,
        y: 0,
        width: profile.artwork.bounds.width,
        height: profile.artwork.bounds.height
      },
      shape: profile.artwork.shape,
      color: 0x535b65
    },
    artwork: profile.artwork.placement,
    zIndex: 0
  }
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

const PREMIUM_NAME_STYLE: CardTextStyle = {
  ...NAME_STYLE_BASE,
  fill: 0xffffff,
  stroke: { color: 0x17120f, width: 5 }
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

const PREMIUM_RULES_STYLE: CardTextStyle = {
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
  durability: { x: 0, y: 0 }
} as const

type CardStatId = keyof typeof CARD_STAT_LABEL_OFFSETS

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

function stats(
  card: CardDefinition,
  profile: CardProfile,
  premium: boolean
): CardGroupNode {
  const children: CardRenderNode[] = [
    stat('mana', card.cost, profile.stats.mana, 'MANA.png')
  ]

  if (card.attack !== null && card.type !== 'Spell' && card.type !== 'Hero Power') {
    const attackAsset =
      card.type === 'Weapon'
        ? premium
          ? 'attack-weapon-premium.png'
          : 'attack-weapon.png'
        : 'ATTACK.png'
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
      stat(
        'durability',
        card.durability,
        profile.stats.weaponDefense,
        premium ? 'durability-premium.png' : 'durability.png'
      )
    )
  } else if ((card.type === 'Minion' || card.type === 'Hero') && card.health !== null) {
    children.push(stat('health', card.health, profile.stats.defense, 'HEALTH.png'))
  }

  return group('stats', { x: 0, y: 0 }, 300, children)
}

function rarity(card: CardDefinition, profile: CardProfile): CardGroupNode | null {
  if (!['Common', 'Rare', 'Epic', 'Legendary'].includes(card.rarity)) return null
  return group('rarity', { x: 0, y: 0 }, 400, [
    image('gem', `rarity-${card.rarity.toLowerCase()}.png`, profile.rarity, 400, {
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
      mask: {
        ...node.mask,
        bounds: {
          ...node.mask.bounds,
          width: override.width ?? node.mask.bounds.width,
          height: override.height ?? node.mask.bounds.height
        }
      }
    }
  }

  return visit(root, '') as CardGroupNode
}

export function buildCardRenderTree(
  card: CardDefinition,
  options: CardRenderOptions = {}
): { readonly root: CardGroupNode } {
  const premium = options.premium ?? false
  const profile = CARD_PROFILES[visualTemplateFor(card.type)]
  const children: CardRenderNode[] = [
    artwork(profile),
    image(
      'frame',
      premium ? profile.frame.premium : profile.frame.normal,
      { x: 0, y: 0 },
      100,
      { size: CARD_CANVAS }
    ),
    text(
      'name',
      card.name,
      profile.nameBox,
      premium ? PREMIUM_NAME_STYLE : NAME_STYLE_BASE,
      200
    )
  ]

  if (card.effect) {
    children.push(
      text(
        'rules',
        markHearthstoneKeywords(card.effect),
        profile.rulesBox,
        premium ? PREMIUM_RULES_STYLE : RULES_STYLE_BASE,
        220
      )
    )
  }

  children.push(stats(card, profile, premium))
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
