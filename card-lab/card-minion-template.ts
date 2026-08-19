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
    readonly armor: CardPoint
    readonly weaponAttack: CardPoint
    readonly weaponDefense: CardPoint
  }
  readonly rarity: CardPoint
}

const SHARED_ARTWORK = {
  bounds: { x: 60, y: 20, width: 500, height: 500 }
} as const

const SHARED_NAME_BOX = { x: 74, y: 454, width: 490, height: 72 } as const
const SHARED_RULES_BOX = { x: 80, y: 600, width: 460, height: 190 } as const
const NAME_BANNER_SOURCE_SIZE = { width: 665, height: 198 } as const
const NAME_BANNER_SIZE = NAME_BANNER_SOURCE_SIZE
const NAME_BANNER_Z_INDEX = 110
const RACE_BANNER_SIZE = { width: 408, height: 69 } as const
const RACE_BANNER_POSITION = {
  x: CARD_CANVAS.width / 2,
  y: CARD_CANVAS.height - 40 - RACE_BANNER_SIZE.height / 2
} as const
const RACE_TEXT_BOX = { x: 105, y: 795, width: 410, height: 62 } as const
const RACE_BANNER_Z_INDEX = 230
const RACE_TEXT_Z_INDEX = 231
const LEGENDARY_FRAME_Z_INDEX = 105
const LEGENDARY_FRAME_OFFSET = { x: 60, y: -35 } as const
const SHARED_STATS = {
  mana: { x: 60, y: 50 },
  attack: { x: 40, y: 810 },
  defense: { x: 570, y: 810 },
  armor: { x: 570, y: 820 },
  weaponAttack: { x: 60, y: 830 },
  weaponDefense: { x: 570, y: 830 }
} as const

/**
 * Per-stat label calibration, in pixels relative to each stat group's center.
 * Edit these values when a number needs to move without moving its icon.
 */
export const CARD_STAT_LABEL_OFFSETS = {
  mana: { x: 0, y: -10 },
  attack: { x: 10, y: 10 },
  weaponAttack: { x: 0, y: -5 },
  health: { x: 0, y: 10 },
  armor: { x: 0, y: -5 },
  durability: { x: 0, y: 0 },
  name: { x: 0, y: -17 }
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
      x: profile.nameBox.x + profile.nameBox.width / 2 - 10,
      y: profile.nameBox.y + profile.nameBox.height / 2
    },
    NAME_BANNER_Z_INDEX,
    {
      size: NAME_BANNER_SIZE,
      anchor: { x: 0.5, y: 0.5 }
    }
  )
}

function raceBanner(): Extract<CardRenderNode, { kind: 'image' }> {
  return image(
    'race-banner',
    'RACE_BANNER.png',
    RACE_BANNER_POSITION,
    RACE_BANNER_Z_INDEX,
    { size: RACE_BANNER_SIZE, anchor: { x: 0.5, y: 0.5 } }
  )
}

const NAME_STYLE_BASE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 47,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x000000, width: 7 },
  wordWrap: true,
  breakWords: true
}

const RULES_STYLE_BASE: CardTextStyle = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 44,
  fill: 0x19130e,
  align: 'center',
  fontWeight: 'normal',
  letterSpacing: -0.5,
  stroke: { color: 0x19130e, width: 0.75 },
  lineHeight: 50,
  breakWords: true,
  tagStyles: { keyword: { fontWeight: 'bold' } }
}

/**
 * Display-only line-break hints for cards whose reference layout uses a
 * deliberate break that the generic greedy wrapper cannot reproduce.
 * Card data remains the canonical, unbroken rules text.
 */
const CARD_RULES_LINE_BREAKS: Readonly<Record<string, readonly string[]>> = {
  classic_deathwing: ['discard']
}

function rulesText(card: CardDefinition): string {
  if (!card.effect) return ''

  const displayText = (CARD_RULES_LINE_BREAKS[card.id] ?? []).reduce(
    (text, phrase) => text.replace(`${phrase} `, `${phrase}\n`),
    card.effect
  )

  return markHearthstoneKeywords(displayText)
}

function raceLabel(card: CardDefinition): string | null {
  if (card.type === 'Minion') return card.subtype
  if (card.type === 'Spell') return card.spellSchool ?? card.subtype
  return null
}

const WEAPON_RULES_STYLE: CardTextStyle = {
  ...RULES_STYLE_BASE,
  fill: 0xffffff
}

const RACE_STYLE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 30,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x000000, width: 4 },
  wordWrap: true,
  breakWords: true
}

const STAT_STYLE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 150,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x17120f, width: 8 }
}
const TIGHT_STAT_STYLE: CardTextStyle = {
  ...STAT_STYLE,
  letterSpacing: -4
}

const STAT_VALUE_BOX: CardBounds = {
  x: -55,
  y: -55,
  width: 110,
  height: 110
}

type CardStatId = Exclude<keyof typeof CARD_STAT_LABEL_OFFSETS, 'name' | 'weaponAttack'>
type CardStatLabelId = Exclude<keyof typeof CARD_STAT_LABEL_OFFSETS, 'name'>

function stat(
  id: CardStatId,
  value: number,
  position: CardPoint,
  assetName: string,
  labelId: CardStatLabelId = id
): CardGroupNode {
  const labelOffset = CARD_STAT_LABEL_OFFSETS[labelId]
  const labelBox: CardBounds = {
    ...STAT_VALUE_BOX,
    x: STAT_VALUE_BOX.x + labelOffset.x,
    y: STAT_VALUE_BOX.y + labelOffset.y
  }
  const labelStyle = id === 'mana' ? STAT_STYLE : TIGHT_STAT_STYLE

  return group(id, position, 300, [
    image('icon', assetName, { x: 0, y: 0 }, 300, {
      anchor: { x: 0.5, y: 0.5 }
    }),
    text('label', String(value), labelBox, labelStyle, 301)
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
        attackAsset,
        card.type === 'Weapon' ? 'weaponAttack' : 'attack'
      )
    )
  }

  if (card.type === 'Weapon' && card.durability !== null) {
    children.push(
      stat(
        'durability',
        card.durability,
        profile.stats.weaponDefense,
        'WEAPON_DURABILITY.png'
      )
    )
  } else if (card.type === 'Minion' && card.health !== null) {
    children.push(stat('health', card.health, profile.stats.defense, 'HEALTH.png'))
  } else if (card.type === 'Hero' && card.armor !== null) {
    children.push(stat('armor', card.armor, profile.stats.armor, 'ARMOR.png'))
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

function legendaryFrame(
  card: CardDefinition
): Extract<CardRenderNode, { kind: 'image' }> | null {
  if (card.type !== 'Minion' || card.rarity !== 'Legendary') return null

  return image(
    'legendary-frame',
    'LEGENDARY.png',
    {
      x: CARD_CANVAS.width / 2 + LEGENDARY_FRAME_OFFSET.x,
      y: LEGENDARY_FRAME_OFFSET.y
    },
    LEGENDARY_FRAME_Z_INDEX,
    { anchor: { x: 0.5, y: 0 } }
  )
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
  const legendaryFrameNode = legendaryFrame(card)
  const children: CardRenderNode[] = [
    artwork(profile),
    image('frame', profile.frame, { x: 0, y: 0 }, 100, { size: CARD_CANVAS }),
    ...(legendaryFrameNode ? [legendaryFrameNode] : []),
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
        rulesText(card),
        profile.rulesBox,
        card.type === 'Weapon' ? WEAPON_RULES_STYLE : RULES_STYLE_BASE,
        220
      )
    )
  }

  const label = raceLabel(card)
  if (label) {
    children.push(
      raceBanner(),
      text('race', label, RACE_TEXT_BOX, RACE_STYLE, RACE_TEXT_Z_INDEX)
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
