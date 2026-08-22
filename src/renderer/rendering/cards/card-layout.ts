import type { CardDefinition, CardId, CardType } from '../../../game/content/cards'
import type {
  CardBounds,
  CardGroupNode,
  CardImageAlphaMask,
  CardPoint,
  CardRenderNode,
  CardRenderTree,
  CardSize,
  CardTextFit,
  CardTextStyle
} from './card-render-tree'
import { markHearthstoneKeywords } from './card-text-markup'

export { markHearthstoneKeywords } from './card-text-markup'

export type {
  CardBounds,
  CardGroupNode,
  CardPoint,
  CardRenderNode,
  CardRenderTree,
  CardSize,
  CardTextLayer,
  CardTextCurve,
  CardTextFit,
  CardTextStyle
} from './card-render-tree'

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
const MANA_SHADOW_Z_INDEX = 290
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
    frame: 'card.frame.minion',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  },
  spell: {
    template: 'spell',
    frame: 'card.frame.spell',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  },
  weapon: {
    template: 'weapon',
    frame: 'card.frame.weapon',
    artwork: SHARED_ARTWORK,
    nameBox: SHARED_NAME_BOX,
    rulesBox: SHARED_RULES_BOX,
    stats: SHARED_STATS,
    rarity: SHARED_RARITY
  },
  hero: {
    template: 'hero',
    frame: 'card.frame.hero',
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
  assetKey: string,
  position: CardPoint,
  zIndex: number,
  options: {
    readonly size?: CardSize
    readonly anchor?: CardPoint
    readonly scale?: CardPoint
    readonly alphaMask?: CardImageAlphaMask
  } = {}
): Extract<CardRenderNode, { kind: 'image' }> {
  const { alphaMask, ...transform } = options
  return {
    kind: 'image',
    id,
    assetKey,
    transform: { position, ...transform },
    alphaMask,
    zIndex
  }
}

function text(
  id: string,
  value: string,
  box: CardBounds,
  style: CardTextStyle,
  zIndex: number,
  options: { readonly fit?: CardTextFit } = {}
): Extract<CardRenderNode, { kind: 'text' }> {
  return {
    kind: 'text',
    id,
    text: value,
    box,
    style,
    fit: options.fit,
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
    card.type === 'Weapon' ? 'card.name.weapon' : 'card.name',
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
    'card.race-banner',
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
  wordWrap: false,
  breakWords: false
}

export const CARD_NAME_FIT = {
  minFontSize: 30,
  horizontalPadding: 16
} as const

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
  if (!card.rulesText) return ''

  const displayText = (CARD_RULES_LINE_BREAKS[card.id] ?? []).reduce(
    (text, phrase) => text.replace(`${phrase} `, `${phrase}\n`),
    card.rulesText
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
  assetKey: string,
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
    image('icon', assetKey, { x: 0, y: 0 }, 300, {
      anchor: { x: 0.5, y: 0.5 }
    }),
    text('label', String(value), labelBox, labelStyle, 301)
  ])
}

function stats(card: CardDefinition, profile: CardProfile): CardGroupNode {
  const children: CardRenderNode[] = [
    stat('mana', card.cost, profile.stats.mana, 'card.stat.mana')
  ]

  if ((card.type === 'Minion' || card.type === 'Weapon') && card.attack !== null) {
    const attackAsset =
      card.type === 'Weapon' ? 'card.stat.weapon-attack' : 'card.stat.attack'
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
        'card.stat.weapon-durability'
      )
    )
  } else if (card.type === 'Minion' && card.health !== null) {
    children.push(
      stat('health', card.health, profile.stats.defense, 'card.stat.health')
    )
  } else if (card.type === 'Hero' && card.armor !== null) {
    children.push(stat('armor', card.armor, profile.stats.armor, 'card.stat.armor'))
  }

  return group('stats', { x: 0, y: 0 }, 300, children)
}

function rarity(card: CardDefinition, profile: CardProfile): CardGroupNode | null {
  if (!['Common', 'Rare', 'Epic', 'Legendary'].includes(card.rarity)) return null
  return group('rarity', { x: 0, y: 0 }, 400, [
    image('gem', `card.rarity.${card.rarity.toLowerCase()}`, profile.rarity, 400, {
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
    'card.frame.legendary',
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
    image('silence', 'card.overlay.silence', { x: 310, y: 475 }, 500, {
      anchor: { x: 0.5, y: 0.5 }
    })
  ])
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
    image('mana-shadow', 'card.shadow.mana', { x: 0, y: 0 }, MANA_SHADOW_Z_INDEX, {
      alphaMask: {
        assetKey: profile.frame,
        transform: { position: { x: 0, y: 0 }, size: CARD_CANVAS }
      }
    }),
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
      200,
      { fit: 'width' }
    )
  ]

  if (card.rulesText) {
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
    root: group('card', { x: 0, y: 0 }, 0, children)
  }
}

export interface CardRenderOptions {
  readonly opponent?: boolean
  readonly debug?: boolean
  readonly elite?: boolean
  readonly silenced?: boolean
}

export interface CardLayout {
  readonly cardId: CardId
  readonly cardType: CardType
  readonly template: CardVisualTemplate
  readonly width: number
  readonly height: number
  readonly renderScaleY: number
  readonly tree: CardRenderTree
  readonly diagnostics: readonly string[]
}

export function buildCardLayout(
  card: CardDefinition,
  options: CardRenderOptions = {}
): CardLayout {
  const template = visualTemplateFor(card.type)
  const tree = buildCardRenderTree(card, options)
  const diagnostics = [
    `Uses the ${template} profile on the canonical ${CARD_CANVAS.width} × ${CARD_CANVAS.height} canvas.`,
    'Frame, name, rules, stats, and rarity are rendered as semantic nodes.',
    'Card class does not affect visual asset selection.'
  ]

  if (card.type === 'Hero')
    diagnostics.push('Hero uses the dedicated standard hero frame.')
  if (options.elite) {
    diagnostics.push('Elite overlay request ignored by the simplified card design.')
  }
  if (card.rarity === 'Free' || card.rarity === 'None') {
    diagnostics.push(`Rarity ${card.rarity} intentionally has no rarity gem.`)
  }

  return {
    cardId: card.id,
    cardType: card.type,
    template,
    width: CARD_CANVAS.width,
    height: CARD_CANVAS.height,
    renderScaleY: 1,
    tree,
    diagnostics
  }
}

/** Backwards-compatible name for callers that still refer to the minion builder. */
export const buildMinionRenderTree = buildCardRenderTree

export type { CardVisualTemplate }
