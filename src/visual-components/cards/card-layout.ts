import type { CardType } from '../../game-rules/content/cards'
import { resolveCardAssetDefinition } from '../assets/card-assets'
import {
  CENTER,
  TOP_CENTER,
  TOP_LEFT,
  placement,
  type LayoutPlacement
} from '../layout'
import type { CardPoint, CardTextCurve, CardTextStyle } from './card-render-tree'

/** TUNING GUIDE
 * Positions use the 620 x 900 card canvas. Positive X = right; positive Y = down.
 * Name and rarity children use coordinates relative to their assembly position.
 * Move an assembly to move all its pieces; edit a child to move only that piece.
 * Standard/premium entries are explicit. Shared settings appear once.
 * Artwork/rarity decimals preserve the approved geometry at its original precision.
 * Frame source-body edges below are asset calibration, not visual offsets.
 */
export const CARD_CANVAS = { width: 620, height: 900 } as const
export const CARD_BODY_BOUNDS = { x: 0, y: 60, width: 620, height: 840 } as const
/** Uniform rarity gem scale for every card type and finish; 1 = native size. */
export const RARITY_GEM_SCALE = 1.1
export const CARD_LAYERS = {
  root: 0,
  artwork: 0,
  frameShadow: 50,
  frame: 100,
  classMask: 102,
  legendary: 105,
  rarity: 109,
  nameBanner: 110,
  nameText: 200,
  raceBanner: 210,
  rules: 220,
  raceText: 231,
  stats: 300,
  statIcon: 300,
  statLabel: 301,
  raritySlot: 399,
  rarityGem: 400,
  overlays: 500
} as const

export type CardVisualTemplate = 'minion' | 'spell' | 'weapon' | 'hero'
export type CardFinish = 'standard' | 'premium'
type Finishes<T> = Readonly<Record<CardFinish, T>>
interface RarityLayout {
  readonly position: CardPoint
  readonly gem: LayoutPlacement
  readonly slot: LayoutPlacement
  readonly slotVisible?: boolean
}
interface RulesLayout {
  readonly placement: LayoutPlacement
  readonly style: Finishes<CardTextStyle>
}
export interface CardProfile {
  readonly template: CardVisualTemplate
  readonly frame: string
  readonly frameBody: Finishes<{ readonly top: number; readonly bottom: number }>
  readonly artwork: {
    readonly placement: LayoutPlacement
    readonly shape?: 'ellipse' | 'arch'
  }
  readonly name: {
    readonly position: CardPoint
    readonly banner: Finishes<LayoutPlacement>
    readonly text: LayoutPlacement
    readonly style: CardTextStyle
    readonly curve?: CardTextCurve
  }
  readonly rules: RulesLayout
  readonly rarity: Finishes<RarityLayout>
  readonly legendary: Finishes<LayoutPlacement> | null
}

// Shared typography and display sizes.
const NAME_STYLE_BASE: CardTextStyle = {
  fontFamily: 'Belwe',
  fontSize: 47,
  fill: 0xffffff,
  align: 'center',
  stroke: { color: 0x000000, width: 7 },
  wordWrap: false,
  breakWords: false
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

export const CARD_RULES_COMPACT_SPACING = {
  minimumLines: 5,
  lineHeight: 40
} as const

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
const STAT_LABEL_SIZE = { width: 110, height: 110 } as const

export const CARD_NAME_FIT = { minFontSize: 30, horizontalPadding: 16 } as const
export const CARD_RULES_LINE_BREAKS: Readonly<Record<string, readonly string[]>> = {
  classic_deathwing: ['discard']
}
const RULES_PLACEMENT = placement(
  { x: 310, y: 712.5 },
  { width: 460, height: 165 },
  { anchor: CENTER }
)
const SHARED_RULES: RulesLayout = {
  placement: RULES_PLACEMENT,
  style: {
    standard: RULES_STYLE_BASE,
    premium: {
      ...RULES_STYLE_BASE,
      fill: 0xffffff,
      stroke: { color: 0xffffff, width: 0.75 }
    }
  }
}
const WEAPON_RULES: RulesLayout = {
  placement: RULES_PLACEMENT,
  style: { standard: WEAPON_RULES_STYLE, premium: WEAPON_RULES_STYLE }
}
export const CARD_RACE_LAYOUT = {
  banner: placement(
    { x: 310, y: 825.5 },
    { width: 408, height: 69 },
    { anchor: CENTER }
  ),
  text: placement({ x: 310, y: 826 }, { width: 410, height: 62 }, { anchor: CENTER }),
  style: RACE_STYLE
} as const
export const CARD_SILENCE_LAYOUT = assetPlacement('card.overlay.silence', {
  x: 310,
  y: 695
})

export const CARD_TRADEABLE_LAYOUT = placement(
  { x: 60, y: 40 },
  { width: 128, height: 274 },
  {
    anchor: TOP_CENTER,
    scale: 1,
    note: 'Native-size Tradeable ribbon behind the mana crystal.'
  }
)

/** Match the frame aura's pixel scale without stretching the banner silhouette. */
export const CARD_TRADEABLE_AURA_LAYOUT = placement(
  {
    x: CARD_TRADEABLE_LAYOUT.position.x - CARD_TRADEABLE_LAYOUT.size.width / 2,
    y: 0
  },
  { width: CARD_BODY_BOUNDS.width, height: CARD_CANVAS.height },
  { anchor: TOP_LEFT, note: 'Transparent card-width canvas for the banner aura.' }
)

/** Stat label positions are local to their icon's center. */
export const CARD_STATS = {
  mana: statLayout('card.stat.mana', { x: 60, y: 100 }, { x: 0, y: -10 }, STAT_STYLE),
  attack: statLayout('card.stat.attack', { x: 40, y: 810 }, { x: 15, y: 10 }),
  weaponAttack: statLayout(
    'card.stat.weapon-attack',
    { x: 60, y: 830 },
    { x: 0, y: -5 }
  ),
  health: statLayout('card.stat.health', { x: 570, y: 810 }, { x: 0, y: 10 }),
  armor: statLayout('card.stat.armor', { x: 570, y: 820 }, { x: 0, y: -5 }),
  durability: statLayout(
    'card.stat.weapon-durability',
    { x: 570, y: 830 },
    { x: 0, y: 0 }
  )
} as const

/** All type-specific tuning. The gem stays centered unless its own X is changed. */
export const CARD_PROFILES: Readonly<Record<CardVisualTemplate, CardProfile>> = {
  minion: {
    template: 'minion',
    frame: 'card.frame.minion',
    frameBody: {
      standard: { top: 65, bottom: 981 },
      premium: { top: 65, bottom: 982 }
    },
    artwork: {
      placement: placement(
        { x: 105, y: 15.386462882096072 },
        { width: 415, height: 524.7707423580786 }
      ),
      shape: 'ellipse'
    },
    name: {
      position: { x: 310, y: 506 },
      banner: {
        standard: assetPlacement('card.name.minion', { x: 0, y: 0 }),
        premium: assetPlacement('card.name.minion.premium', { x: 0, y: 0 })
      },
      text: placement({ x: 0, y: -18 }, { width: 570, height: 72 }, { anchor: CENTER }),
      style: { ...NAME_STYLE_BASE, fontSize: 50 },
      curve: { startY: 24, control1Y: 50, control2Y: -60, endY: 18, rotationScale: 1 }
    },
    rules: SHARED_RULES,
    rarity: {
      standard: {
        position: { x: 310, y: 567.1301310043667 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: 8 }),
        slot: assetPlacement('card.rarity-frame.minion', { x: 11, y: 0 })
      },
      premium: {
        position: { x: 310, y: 567.1301310043667 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: 0 }),
        slot: assetPlacement('card.rarity-frame.minion.premium', { x: -1, y: -10 })
      }
    },
    legendary: {
      standard: assetPlacement('card.frame.legendary', { x: 370, y: -35 }, TOP_CENTER),
      premium: assetPlacement(
        'card.frame.legendary.premium',
        { x: 370, y: -35 },
        TOP_CENTER
      )
    }
  },
  spell: {
    template: 'spell',
    frame: 'card.frame.spell',
    frameBody: {
      standard: { top: 2, bottom: 927 },
      premium: { top: 12, bottom: 931 }
    },
    artwork: {
      placement: placement(
        { x: 65, y: 100.27459459459459 },
        { width: 490, height: 383.49405405405406 }
      ),
      shape: undefined
    },
    name: {
      position: { x: 310, y: 517 },
      banner: {
        standard: assetPlacement('card.name.spell', { x: 0, y: 0 }),
        premium: assetPlacement('card.name.spell.premium', { x: 0, y: 0 })
      },
      text: placement({ x: 0, y: -44 }, { width: 530, height: 72 }, { anchor: CENTER }),
      style: NAME_STYLE_BASE,
      curve: {
        startY: 34,
        control1Y: -11,
        control2Y: -11,
        endY: 34,
        rotationScale: 0.85
      }
    },
    rules: SHARED_RULES,
    rarity: {
      standard: {
        position: { x: 310, y: 551.0451891891892 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: 17 }),
        slot: assetPlacement('card.rarity-frame.spell', { x: 0, y: 5 })
      },
      premium: {
        position: { x: 310, y: 551.0451891891892 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: 17 }),
        slot: assetPlacement('card.rarity-frame.spell.premium', { x: 0, y: 10 })
      }
    },
    legendary: {
      standard: assetPlacement(
        'card.frame.legendary.spell',
        { x: 370, y: 10 },
        TOP_CENTER
      ),
      premium: assetPlacement(
        'card.frame.legendary.spell.premium',
        { x: 370, y: 10 },
        TOP_CENTER
      )
    }
  },
  weapon: {
    template: 'weapon',
    frame: 'card.frame.weapon',
    frameBody: {
      standard: { top: 39, bottom: 957 },
      premium: { top: 39, bottom: 957 }
    },
    artwork: {
      placement: placement(
        { x: 65, y: 63.23311546840958 },
        { width: 490, height: 452.437908496732 }
      ),
      shape: 'ellipse'
    },
    name: {
      position: { x: 310, y: 503 },
      banner: {
        // Keep the approved display size independent of the updated source PNG.
        standard: placement(
          { x: 0, y: 0 },
          { width: 603, height: 126 },
          { anchor: CENTER }
        ),
        premium: assetPlacement('card.name.weapon.premium', { x: 0, y: 0 })
      },
      text: placement({ x: 9, y: -20 }, { width: 490, height: 72 }, { anchor: CENTER }),
      style: NAME_STYLE_BASE,
      curve: undefined
    },
    rules: WEAPON_RULES,
    rarity: {
      standard: {
        position: { x: 310, y: 544.2126361655774 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: 28 }),
        slot: assetPlacement('card.rarity-frame.weapon', { x: 2, y: 0 })
      },
      premium: {
        position: { x: 310, y: 544.2126361655774 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: 21 }),
        slot: assetPlacement('card.rarity-frame.weapon.premium', { x: 2, y: 0 })
      }
    },
    legendary: null
  },
  hero: {
    template: 'hero',
    frame: 'card.frame.hero',
    frameBody: {
      standard: { top: 66, bottom: 985 },
      premium: { top: 66, bottom: 980 }
    },
    artwork: {
      placement: placement(
        { x: 105, y: 29.684439608269862 },
        { width: 405, height: 460.1668480232137 }
      ),
      shape: 'arch'
    },
    name: {
      position: { x: 310, y: 501 },
      banner: {
        standard: assetPlacement('card.name.hero', { x: 0, y: 0 }),
        premium: assetPlacement('card.name.hero.premium', { x: 0, y: 0 })
      },
      text: placement({ x: 0, y: -23 }, { width: 530, height: 72 }, { anchor: CENTER }),
      style: NAME_STYLE_BASE,
      curve: {
        startY: 44,
        control1Y: -14,
        control2Y: -14,
        endY: 44,
        rotationScale: 0.85
      }
    },
    rules: SHARED_RULES,
    rarity: {
      standard: {
        position: { x: 310, y: 572.8759521218717 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: -5 }),
        slot: assetPlacement('card.rarity-frame.hero', { x: -9, y: -10 })
      },
      premium: {
        position: { x: 310, y: 557.8759521218717 },
        gem: assetPlacement('card.rarity.common', { x: 0, y: -5 }),
        slot: assetPlacement('card.rarity-frame.hero', { x: -4, y: -10 }),
        slotVisible: false
      }
    },
    legendary: {
      standard: assetPlacement('card.frame.legendary', { x: 370, y: -35 }, TOP_CENTER),
      premium: assetPlacement(
        'card.frame.legendary.premium',
        { x: 370, y: -35 },
        TOP_CENTER
      )
    }
  }
}

// Aperture top centers in source-frame pixels, paired with the top shadow ridge
// in each cropped export. Align the visible ridge, not the export's bounding box.
// Only the frame reference point is scaled; shadow images stay at native size.
const FRAME_SHADOW_ALIGNMENT = {
  minion: {
    standard: { aperture: { x: 327, y: 28 }, ridge: { x: 230.5, y: 21 } },
    premium: { aperture: { x: 328, y: 58 }, ridge: { x: 226.5, y: 25 } }
  },
  spell: {
    standard: { aperture: { x: 323, y: 49 }, ridge: { x: 281, y: 26 } },
    premium: { aperture: { x: 329, y: 72 }, ridge: { x: 281, y: 26 } }
  },
  weapon: {
    standard: { aperture: { x: 326, y: 57 }, ridge: { x: 251, y: 25 } },
    premium: { aperture: { x: 326, y: 57 }, ridge: { x: 251, y: 25 } }
  },
  hero: {
    standard: { aperture: { x: 327, y: 64 }, ridge: { x: 214.5, y: 26 } },
    premium: { aperture: { x: 327, y: 64 }, ridge: { x: 214.5, y: 26 } }
  }
} as const

// Final placement adjustment in card-canvas pixels; keep native shadow sizes.
const FRAME_SHADOW_OFFSET = { x: -2, y: -5 } as const

export function cardFrameShadowKey(
  template: CardVisualTemplate,
  premium: boolean
): string {
  return (
    'card.frame-shadow.' +
    template +
    (template === 'minion' ? (premium ? '.premium' : '.standard') : '')
  )
}

export function cardFrameShadowPlacement(
  template: CardVisualTemplate,
  premium: boolean
): LayoutPlacement {
  const transform = cardFrameTransform(template, premium)
  const { aperture, ridge } =
    FRAME_SHADOW_ALIGNMENT[template][premium ? 'premium' : 'standard']
  return placement(
    {
      x:
        transform.position.x +
        aperture.x * transform.scale.x -
        ridge.x +
        FRAME_SHADOW_OFFSET.x,
      y:
        transform.position.y +
        aperture.y * transform.scale.y -
        ridge.y +
        FRAME_SHADOW_OFFSET.y
    },
    assetSize(cardFrameShadowKey(template, premium)),
    { anchor: TOP_LEFT }
  )
}

// Geometry helpers: no additional visual tuning below this line.
function assetSize(key: string) {
  const asset = resolveCardAssetDefinition(key)
  return { width: asset.authoredWidth, height: asset.authoredHeight }
}
function assetPlacement(
  key: string,
  position: CardPoint,
  anchor = CENTER
): LayoutPlacement {
  return placement(position, assetSize(key), { anchor })
}
function statLayout(
  assetKey: string,
  position: CardPoint,
  labelPosition: CardPoint,
  style = TIGHT_STAT_STYLE
) {
  return {
    assetKey,
    position,
    icon: assetPlacement(assetKey, { x: 0, y: 0 }),
    label: placement(labelPosition, STAT_LABEL_SIZE, { anchor: CENTER }),
    style
  }
}
export function visualTemplateFor(type: CardType): CardVisualTemplate {
  if (type === 'Spell') return 'spell'
  if (type === 'Weapon') return 'weapon'
  if (type === 'Hero') return 'hero'
  return 'minion'
}
export function cardFrameTransform(template: CardVisualTemplate, premium = false) {
  const profile = CARD_PROFILES[template]
  const source = assetSize(profile.frame + (premium ? '.premium' : ''))
  const body = profile.frameBody[premium ? 'premium' : 'standard']
  const scale = {
    x: CARD_BODY_BOUNDS.width / source.width,
    y: CARD_BODY_BOUNDS.height / (body.bottom - body.top)
  }
  return {
    position: { x: CARD_BODY_BOUNDS.x, y: CARD_BODY_BOUNDS.y - body.top * scale.y },
    scale
  }
}
/** Source-image geometry is confined here; ordinary placements use card pixels. */
export function cardFramePlacement(
  template: CardVisualTemplate,
  premium: boolean
): LayoutPlacement {
  const key = CARD_PROFILES[template].frame + (premium ? '.premium' : '')
  const transform = cardFrameTransform(template, premium)
  return placement(transform.position, assetSize(key), {
    anchor: TOP_LEFT,
    scale: transform.scale
  })
}
export function cardClassMaskPlacement(template: CardVisualTemplate): LayoutPlacement {
  const source = assetSize(CARD_PROFILES[template].frame + '.premium')
  const mask = assetSize('card.frame.' + template + '.premium.class-mask')
  const transform = cardFrameTransform(template, true)
  return placement(
    {
      x: ((source.width - mask.width) / 2) * transform.scale.x,
      y: transform.position.y + (source.height - mask.height) * transform.scale.y
    },
    mask,
    { anchor: TOP_LEFT, scale: transform.scale }
  )
}
export function cardNameBannerPlacement(
  template: CardVisualTemplate,
  premium: boolean
): LayoutPlacement {
  const name = CARD_PROFILES[template].name
  const banner = name.banner[premium ? 'premium' : 'standard']
  const { scale } = cardFrameTransform(template, premium)
  return placement(
    {
      x: name.position.x + banner.position.x,
      y: name.position.y + banner.position.y
    },
    {
      width: banner.size.width * scale.x,
      height: banner.size.height * scale.y
    },
    { anchor: banner.anchor }
  )
}
