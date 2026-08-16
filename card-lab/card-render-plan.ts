import type { CardDefinition, CardRarity, CardType } from './card-catalog'

export type CardTemplate = 'minion' | 'spell' | 'weapon' | 'hero' | 'hero-power'
export type CardLayerKind = 'texture' | 'text' | 'placeholder'
export type CardShape = 'ellipse' | 'circle' | 'rounded-rectangle'

export interface CardPoint {
  readonly x: number
  readonly y: number
}

export interface CardBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CardTextStyle {
  readonly fontFamily: string
  readonly fontSize: number
  readonly fill: number
  readonly align: 'left' | 'center'
  readonly stroke?: { readonly color: number; readonly width: number }
  readonly wordWrap?: boolean
  readonly wordWrapWidth?: number
  readonly lineHeight?: number
  readonly breakWords?: boolean
}

export interface CardTextureLayer {
  readonly kind: 'texture'
  readonly id: string
  readonly assetName: string
  readonly position: CardPoint
  readonly anchor?: CardPoint
  readonly scale?: CardPoint
  readonly zIndex: number
}

export interface CardTextLayer {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  readonly position: CardPoint
  readonly anchor?: CardPoint
  readonly style: CardTextStyle
  readonly zIndex: number
}

export interface CardPlaceholderLayer {
  readonly kind: 'placeholder'
  readonly id: string
  readonly bounds: CardBounds
  readonly shape: CardShape
  readonly color: number
  readonly zIndex: number
}

export type CardLayer = CardTextureLayer | CardTextLayer | CardPlaceholderLayer

export interface CardLayoutProfile {
  readonly template: CardTemplate
  readonly width: number
  readonly height: number
  readonly art: { readonly bounds: CardBounds; readonly shape: CardShape }
  readonly namePosition: CardPoint
  readonly nameWidth: number
  readonly nameY: number
  readonly effect: CardBounds
  readonly costPosition: CardPoint
  readonly attackPosition?: CardPoint
  readonly healthPosition?: CardPoint
  readonly racePosition?: CardPoint
  readonly rarityPosition?: CardPoint
}

export interface CardRenderOptions {
  readonly premium?: boolean
  readonly opponent?: boolean
  readonly debug?: boolean
  readonly elite?: boolean
  readonly silenced?: boolean
}

export interface CardRenderPlan {
  readonly cardId: string
  readonly cardType: CardType
  readonly template: CardTemplate
  readonly width: number
  readonly height: number
  readonly layers: readonly CardLayer[]
  readonly diagnostics: readonly string[]
}

const COMMON_NAME_STYLE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 32,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x17120f, width: 5 },
  wordWrap: true,
  wordWrapWidth: 380,
  breakWords: true
}

const EFFECT_STYLE: CardTextStyle = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 27,
  fill: 0x19130e,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 360,
  lineHeight: 29,
  breakWords: true
}

const STAT_STYLE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 48,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x17120f, width: 6 }
}

const HERO_POWER_STYLE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 30,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x17120f, width: 5 },
  wordWrap: true,
  wordWrapWidth: 390,
  breakWords: true
}

export const CARD_LAYOUTS: Readonly<Record<CardTemplate, CardLayoutProfile>> = {
  minion: {
    template: 'minion',
    width: 527,
    height: 793,
    art: { bounds: { x: 92, y: 40, width: 344, height: 450 }, shape: 'ellipse' },
    namePosition: { x: 263.5, y: 520 },
    nameWidth: 400,
    nameY: 520,
    effect: { x: 84, y: 580, width: 359, height: 130 },
    costPosition: { x: 55, y: 60 },
    attackPosition: { x: 60, y: 735 },
    healthPosition: { x: 467, y: 735 },
    racePosition: { x: 263.5, y: 600 },
    rarityPosition: { x: 263.5, y: 560 }
  },
  spell: {
    template: 'spell',
    width: 527,
    height: 746,
    art: {
      bounds: { x: 57, y: 45, width: 413, height: 330 },
      shape: 'rounded-rectangle'
    },
    namePosition: { x: 263.5, y: 432 },
    nameWidth: 400,
    nameY: 432,
    effect: { x: 90, y: 500, width: 347, height: 145 },
    costPosition: { x: 55, y: 60 },
    rarityPosition: { x: 263.5, y: 475 }
  },
  weapon: {
    template: 'weapon',
    width: 527,
    height: 775,
    art: { bounds: { x: 77, y: 40, width: 373, height: 373 }, shape: 'circle' },
    namePosition: { x: 263.5, y: 475 },
    nameWidth: 410,
    nameY: 475,
    effect: { x: 74, y: 545, width: 379, height: 130 },
    costPosition: { x: 55, y: 60 },
    attackPosition: { x: 66, y: 720 },
    healthPosition: { x: 461, y: 720 },
    rarityPosition: { x: 263.5, y: 515 }
  },
  hero: {
    template: 'hero',
    width: 527,
    height: 795,
    art: { bounds: { x: 92, y: 40, width: 344, height: 450 }, shape: 'ellipse' },
    namePosition: { x: 263.5, y: 520 },
    nameWidth: 400,
    nameY: 520,
    effect: { x: 84, y: 565, width: 359, height: 145 },
    costPosition: { x: 55, y: 60 },
    healthPosition: { x: 467, y: 735 },
    rarityPosition: { x: 263.5, y: 560 }
  },
  'hero-power': {
    template: 'hero-power',
    width: 564,
    height: 841,
    art: { bounds: { x: 162, y: 88, width: 240, height: 240 }, shape: 'circle' },
    namePosition: { x: 282, y: 400 },
    nameWidth: 400,
    nameY: 400,
    effect: { x: 84, y: 540, width: 396, height: 170 },
    costPosition: { x: 282, y: 79 },
    rarityPosition: { x: 282, y: 404 }
  }
}

function templateFor(type: CardType): CardTemplate {
  if (type === 'Hero Power') return 'hero-power'
  return type.toLowerCase() as Exclude<CardTemplate, 'hero-power'>
}

function rarityAssetName(
  template: CardTemplate,
  rarity: CardRarity,
  premium: boolean
): string | null {
  if (!['Common', 'Rare', 'Epic', 'Legendary'].includes(rarity)) return null

  const rarityKey = rarity.toLowerCase()
  if (template === 'hero') return `rarity-${rarityKey}.png`

  const premiumSuffix = premium && template !== 'weapon' ? '-premium' : ''
  return `rarity-${template}${premiumSuffix}-${rarityKey}.png`
}

function addTexture(
  layers: CardLayer[],
  id: string,
  assetName: string,
  position: CardPoint,
  zIndex: number,
  options: { anchor?: CardPoint; scale?: CardPoint } = {}
): void {
  layers.push({
    kind: 'texture',
    id,
    assetName,
    position,
    zIndex,
    ...options
  })
}

function addText(
  layers: CardLayer[],
  id: string,
  text: string,
  position: CardPoint,
  style: CardTextStyle,
  zIndex: number,
  anchor: CardPoint = { x: 0.5, y: 0.5 }
): void {
  layers.push({ kind: 'text', id, text, position, anchor, style, zIndex })
}

function addPlaceholder(layers: CardLayer[], layout: CardLayoutProfile): void {
  layers.push({
    kind: 'placeholder',
    id: 'art-placeholder',
    bounds: layout.art.bounds,
    shape: layout.art.shape,
    color: 0x535b65,
    zIndex: 0
  })
}

function addStats(
  layers: CardLayer[],
  card: CardDefinition,
  layout: CardLayoutProfile
): void {
  const iconScale = { x: 0.5, y: 0.5 }
  addTexture(layers, 'cost-icon', 'cost-mana.png', layout.costPosition, 30, {
    anchor: { x: 0.5, y: 0.5 },
    scale: iconScale
  })
  addText(layers, 'cost-value', String(card.cost), layout.costPosition, STAT_STYLE, 31)

  if (card.type === 'Minion' && card.attack !== null && layout.attackPosition) {
    addTexture(layers, 'attack-icon', 'attack-minion.png', layout.attackPosition, 30, {
      anchor: { x: 0.5, y: 0.5 },
      scale: iconScale
    })
    addText(
      layers,
      'attack-value',
      String(card.attack),
      layout.attackPosition,
      STAT_STYLE,
      31
    )
  }

  if (card.type === 'Weapon' && card.attack !== null && layout.attackPosition) {
    addTexture(layers, 'attack-icon', 'attack-weapon.png', layout.attackPosition, 30, {
      anchor: { x: 0.5, y: 0.5 },
      scale: iconScale
    })
    addText(
      layers,
      'attack-value',
      String(card.attack),
      layout.attackPosition,
      STAT_STYLE,
      31
    )
  }

  if (card.type === 'Minion' && card.health !== null && layout.healthPosition) {
    addTexture(layers, 'health-icon', 'health.png', layout.healthPosition, 30, {
      anchor: { x: 0.5, y: 0.5 },
      scale: iconScale
    })
    addText(
      layers,
      'health-value',
      String(card.health),
      layout.healthPosition,
      STAT_STYLE,
      31
    )
  }

  if (card.type === 'Weapon' && card.durability !== null && layout.healthPosition) {
    addTexture(layers, 'durability-icon', 'durability.png', layout.healthPosition, 30, {
      anchor: { x: 0.5, y: 0.5 },
      scale: iconScale
    })
    addText(
      layers,
      'durability-value',
      String(card.durability),
      layout.healthPosition,
      STAT_STYLE,
      31
    )
  }
}

export function buildCardRenderPlan(
  card: CardDefinition,
  options: CardRenderOptions = {}
): CardRenderPlan {
  const premium = options.premium ?? false
  const template = templateFor(card.type)
  const layout = CARD_LAYOUTS[template]
  const layers: CardLayer[] = []
  const diagnostics: string[] = []
  const effectBounds =
    card.subtype && template === 'minion'
      ? { ...layout.effect, y: 640, height: 85 }
      : layout.effect

  addPlaceholder(layers, layout)

  if (template === 'hero-power') {
    addTexture(
      layers,
      'hero-power-frame',
      `hero-power-${premium ? 'premium-' : ''}${options.opponent ? 'opponent' : 'player'}.png`,
      { x: 0, y: 0 },
      10
    )
    addText(
      layers,
      'hero-power-name',
      card.name,
      layout.namePosition,
      HERO_POWER_STYLE,
      20
    )
    addText(
      layers,
      'hero-power-cost',
      String(card.cost),
      layout.costPosition,
      STAT_STYLE,
      21
    )
    if (card.effect) {
      addText(layers, 'effect-text', card.effect, layout.effect, EFFECT_STYLE, 20, {
        x: 0,
        y: 0
      })
    }
    diagnostics.push(
      'Hero Power uses its dedicated template and ignores creature stats.'
    )
  } else {
    if (premium) {
      addTexture(
        layers,
        'premium-base',
        `base-${template}-premium.png`,
        { x: 0, y: 0 },
        10
      )
      addTexture(
        layers,
        'premium-frame',
        `frame-${template}-premium-${card.cardClass.toLowerCase()}.png`,
        { x: 0, y: 0 },
        11
      )
    } else {
      addTexture(
        layers,
        'card-frame',
        `frame-${template}-${card.cardClass.toLowerCase()}.png`,
        { x: 0, y: 0 },
        10
      )
    }

    addTexture(
      layers,
      'name-banner',
      `name-banner-${template}${premium ? '-premium' : ''}.png`,
      layout.namePosition,
      20,
      { anchor: { x: 0.5, y: 0.5 } }
    )
    addText(layers, 'name-text', card.name, layout.namePosition, COMMON_NAME_STYLE, 21)

    if (card.subtype && template === 'minion' && layout.racePosition) {
      addTexture(
        layers,
        'race-banner',
        `race-banner${premium ? '-premium' : ''}.png`,
        layout.racePosition,
        18,
        { anchor: { x: 0.5, y: 0.5 } }
      )
      addText(
        layers,
        'race-text',
        card.subtype,
        layout.racePosition,
        { ...EFFECT_STYLE, fontSize: 22, lineHeight: 23 },
        19
      )
    }

    if (card.effect) {
      addText(layers, 'effect-text', card.effect, effectBounds, EFFECT_STYLE, 20, {
        x: 0,
        y: 0
      })
    }

    addStats(layers, card, layout)

    const rarityAsset = rarityAssetName(template, card.rarity, premium)
    if (rarityAsset && layout.rarityPosition) {
      addTexture(layers, 'rarity-gem', rarityAsset, layout.rarityPosition, 22, {
        anchor: { x: 0.5, y: 0.5 },
        scale: { x: 0.72, y: 0.72 }
      })
    }
  }

  if (options.elite && template !== 'hero-power') {
    addTexture(
      layers,
      'elite-overlay',
      `elite-${template}${premium ? '-premium' : ''}.png`,
      { x: layout.width / 2, y: 18 },
      25,
      { anchor: { x: 0.5, y: 0 } }
    )
    diagnostics.push(
      'Elite decoration is explicitly enabled; rarity does not imply elite.'
    )
  }

  if (options.silenced && template !== 'hero-power') {
    addTexture(
      layers,
      'silence-overlay',
      'silence-x.png',
      { x: layout.width / 2, y: 470 },
      40,
      {
        anchor: { x: 0.5, y: 0.5 },
        scale: { x: 0.8, y: 0.8 }
      }
    )
  }

  if (card.type === 'Hero') {
    diagnostics.push(
      'Hero layout is available for future card data but is not present in the current catalog.'
    )
  }

  if (card.rarity === 'Free' || card.rarity === 'None') {
    diagnostics.push(`Rarity ${card.rarity} intentionally has no rarity gem.`)
  }

  return {
    cardId: card.id,
    cardType: card.type,
    template,
    width: layout.width,
    height: layout.height,
    layers,
    diagnostics
  }
}
