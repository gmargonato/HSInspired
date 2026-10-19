import type { CardDefinition, CardId, CardType } from '../../game-rules/content/cards'
import { supportsPremiumFormat } from '../../game-rules/progression/premium-support'
import type { LayoutPlacement } from '../layout'
import {
  CARD_CANVAS,
  CARD_LAYERS,
  CARD_PROFILES,
  CARD_STATS,
  CARD_RACE_LAYOUT,
  CARD_SILENCE_LAYOUT,
  CARD_TRADEABLE_LAYOUT,
  CARD_RULES_LINE_BREAKS,
  RARITY_GEM_SCALE,
  cardFramePlacement,
  cardFrameShadowKey,
  cardFrameShadowPlacement,
  cardClassMaskPlacement,
  cardNameBannerPlacement,
  visualTemplateFor,
  type CardVisualTemplate,
  type CardProfile
} from './card-layout'
import type {
  CardBounds,
  CardGroupNode,
  CardPoint,
  CardRenderNode,
  CardRenderTree,
  CardTextCurve,
  CardTextFit,
  CardTextStyle
} from './card-render-tree'
import { markHearthstoneKeywords } from './card-text-markup'
import { isClassFrameClass, shouldRenderClassFrameColors } from './class-frame-colors'

export function cardFrameAssetKey(
  card: Pick<CardDefinition, 'type' | 'cardClass'>,
  premium = false
): string {
  const base = 'card.frame.' + visualTemplateFor(card.type)
  if (premium) return base + '.premium'
  return isClassFrameClass(card.cardClass)
    ? base + '.' + card.cardClass.toLowerCase()
    : base
}

export function formatCardRulesText(
  card: Pick<CardDefinition, 'id' | 'rulesText'>
): string {
  if (!card.rulesText) return ''

  const displayText = (CARD_RULES_LINE_BREAKS[card.id] ?? []).reduce(
    (text, phrase) => text.replace(`${phrase} `, `${phrase}\n`),
    card.rulesText
  )

  return markHearthstoneKeywords(displayText)
}

function raceLabel(card: CardDefinition): string | null {
  if (card.type === 'Minion') {
    const tribes = [
      ...new Set(
        [...(card.tribes ?? []), card.subtype].filter((tribe): tribe is string =>
          Boolean(tribe)
        )
      )
    ]
    return tribes.length > 0 ? tribes.join(' / ') : null
  }
  if (card.type === 'Spell') return card.spellSchool ?? card.subtype
  return null
}

function group(
  id: string,
  position: CardPoint,
  zIndex: number,
  children: readonly CardRenderNode[]
): CardGroupNode {
  return { kind: 'group', id, position, zIndex, children }
}
/** Native images retain their texture size, including live texture replacements. */
function image(
  id: string,
  assetKey: string,
  at: LayoutPlacement,
  zIndex: number,
  displaySize = false
): Extract<CardRenderNode, { kind: 'image' }> {
  return {
    kind: 'image',
    id,
    assetKey,
    zIndex,
    transform: {
      position: at.position,
      anchor: at.anchor,
      scale: at.scale,
      ...(displaySize ? { size: at.size } : {})
    }
  }
}
function textBounds(at: LayoutPlacement, parent: CardPoint): CardBounds {
  return {
    x: parent.x + at.position.x - at.size.width * at.anchor.x,
    y: parent.y + at.position.y - at.size.height * at.anchor.y,
    ...at.size
  }
}
function text(
  id: string,
  value: string,
  at: LayoutPlacement,
  style: CardTextStyle,
  zIndex: number,
  options: {
    readonly parent?: CardPoint
    readonly fit?: CardTextFit
    readonly curve?: CardTextCurve
  } = {}
): Extract<CardRenderNode, { kind: 'text' }> {
  return {
    kind: 'text',
    id,
    text: value,
    box: textBounds(at, options.parent ?? { x: 0, y: 0 }),
    style,
    fit: options.fit,
    curve: options.curve,
    anchor: at.anchor,
    zIndex
  }
}
function classFrameMasks(
  card: CardDefinition,
  options: CardRenderOptions
): readonly CardRenderNode[] {
  if (
    !shouldRenderClassFrameColors(options.classFrameColors) ||
    !isClassFrameClass(card.cardClass)
  )
    return []
  const template = visualTemplateFor(card.type)
  // Keep the premium sprite mounted while hidden for live appearance switching.
  return [
    {
      ...image(
        'class-frame-mask-1',
        'card.frame.' + template + '.premium.class-mask',
        cardClassMaskPlacement(template),
        CARD_LAYERS.classMask
      ),
      visible: options.premium === true
    }
  ]
}
function artwork(profile: CardProfile): Extract<CardRenderNode, { kind: 'artwork' }> {
  const at = profile.artwork.placement
  return {
    kind: 'artwork',
    id: 'artwork',
    shape: profile.artwork.shape,
    position: { x: 0, y: 0 },
    bounds: textBounds(at, { x: 0, y: 0 }),
    zIndex: CARD_LAYERS.artwork
  }
}
function stat(
  id: string,
  value: number,
  layout: (typeof CARD_STATS)[keyof typeof CARD_STATS]
): CardGroupNode {
  return group(id, layout.position, CARD_LAYERS.stats, [
    image('icon', layout.assetKey, layout.icon, CARD_LAYERS.statIcon),
    text('label', String(value), layout.label, layout.style, CARD_LAYERS.statLabel)
  ])
}
function stats(card: CardDefinition): CardGroupNode {
  const children: CardRenderNode[] = [stat('mana', card.cost, CARD_STATS.mana)]
  if ((card.type === 'Minion' || card.type === 'Weapon') && card.attack !== null) {
    children.push(
      stat(
        'attack',
        card.attack,
        card.type === 'Weapon' ? CARD_STATS.weaponAttack : CARD_STATS.attack
      )
    )
  }
  if (card.type === 'Weapon' && card.durability !== null) {
    children.push(stat('durability', card.durability, CARD_STATS.durability))
  } else if (card.type === 'Minion' && card.health !== null) {
    children.push(stat('health', card.health, CARD_STATS.health))
  } else if (card.type === 'Hero' && card.armor !== null) {
    children.push(stat('armor', card.armor, CARD_STATS.armor))
  }
  return group('stats', { x: 0, y: 0 }, CARD_LAYERS.stats, children)
}
function rarity(
  card: CardDefinition,
  profile: CardProfile,
  premium: boolean
): CardGroupNode | null {
  if (!['Common', 'Rare', 'Epic', 'Legendary'].includes(card.rarity)) return null
  const layout = profile.rarity[premium ? 'premium' : 'standard']
  return group('rarity', layout.position, CARD_LAYERS.rarity, [
    {
      ...image(
        'frame',
        'card.rarity-frame.' +
          profile.template +
          (premium && card.type !== 'Hero' ? '.premium' : ''),
        layout.slot,
        CARD_LAYERS.raritySlot
      ),
      visible: layout.slotVisible !== false
    },
    image(
      'gem',
      'card.rarity.' + card.rarity.toLowerCase(),
      { ...layout.gem, scale: { x: RARITY_GEM_SCALE, y: RARITY_GEM_SCALE } },
      CARD_LAYERS.rarityGem
    )
  ])
}
function legendaryFrame(
  card: CardDefinition,
  profile: CardProfile,
  premium: boolean
): Extract<CardRenderNode, { kind: 'image' }> | null {
  if (card.rarity !== 'Legendary' || !profile.legendary) return null
  const key =
    'card.frame.legendary' +
    (card.type === 'Spell' ? '.spell' : '') +
    (premium ? '.premium' : '')
  return image(
    'legendary-frame',
    key,
    profile.legendary[premium ? 'premium' : 'standard'],
    CARD_LAYERS.legendary
  )
}
function overlays(options: CardRenderOptions): CardGroupNode | null {
  if (!options.silenced) return null
  return group('overlays', { x: 0, y: 0 }, CARD_LAYERS.overlays, [
    image('silence', 'card.overlay.silence', CARD_SILENCE_LAYOUT, CARD_LAYERS.overlays)
  ])
}
export function buildCardRenderTree(
  card: CardDefinition,
  options: CardRenderOptions = {}
): CardRenderTree {
  const profile = CARD_PROFILES[visualTemplateFor(card.type)]
  const premium = supportsPremiumFormat(card.type) && options.premium === true
  const legendary = legendaryFrame(card, profile, premium)
  const children: CardRenderNode[] = [
    artwork(profile),
    image(
      'frame-shadow',
      cardFrameShadowKey(profile.template, premium),
      cardFrameShadowPlacement(profile.template, premium),
      CARD_LAYERS.frameShadow
    ),
    image(
      'frame',
      cardFrameAssetKey(card, premium),
      cardFramePlacement(profile.template, premium),
      CARD_LAYERS.frame
    ),
    ...classFrameMasks(card, options),
    ...(legendary ? [legendary] : []),
    image(
      'name-banner',
      'card.name.' + profile.template + (premium ? '.premium' : ''),
      cardNameBannerPlacement(profile.template, premium),
      CARD_LAYERS.nameBanner,
      true
    ),
    text(
      'name',
      card.name,
      profile.name.text,
      profile.name.style,
      CARD_LAYERS.nameText,
      {
        parent: profile.name.position,
        fit: 'width',
        curve: profile.name.curve
      }
    )
  ]
  if (card.rulesText) {
    children.push(
      text(
        'rules',
        formatCardRulesText(card),
        profile.rules.placement,
        profile.rules.style[premium ? 'premium' : 'standard'],
        CARD_LAYERS.rules
      )
    )
  }
  const label = raceLabel(card)
  if (label) {
    children.push(
      image(
        'race-banner',
        premium ? 'card.race-banner.premium' : 'card.race-banner',
        CARD_RACE_LAYOUT.banner,
        CARD_LAYERS.raceBanner,
        true
      ),
      text(
        'race',
        label,
        CARD_RACE_LAYOUT.text,
        CARD_RACE_LAYOUT.style,
        CARD_LAYERS.raceText
      )
    )
  }
  if (card.keywords.includes('tradeable'))
    children.push(
      image(
        'tradeable',
        'card.keyword.tradeable',
        CARD_TRADEABLE_LAYOUT,
        CARD_LAYERS.stats - 1
      )
    )
  children.push(stats(card))
  const rarityNode = rarity(card, profile, premium)
  if (rarityNode) children.push(rarityNode)
  const overlayNode = overlays(options)
  if (overlayNode) children.push(overlayNode)
  return { root: group('card', { x: 0, y: 0 }, CARD_LAYERS.root, children) }
}

export interface CardRenderOptions {
  /** Presentation-only variant for supported collectible card formats. */
  readonly premium?: boolean
  readonly opponent?: boolean
  readonly debug?: boolean
  readonly elite?: boolean
  readonly silenced?: boolean
  /** Optional per-view override for premium class masks. */
  readonly classFrameColors?: boolean
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
    'Standard frames have baked-in class colors; premium frames use a class mask and Neutral remains uncolored.'
  ]

  if (card.type === 'Hero')
    diagnostics.push('Hero uses the dedicated hero frame with a premium variant.')
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
