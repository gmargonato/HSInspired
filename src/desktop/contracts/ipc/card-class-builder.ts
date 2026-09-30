export const CARD_CLASS_BUILDER_IPC_CHANNELS = {
  save: 'debug:card-class-builder:save'
} as const

export const CARD_CLASS_BUILDER_CLASSES = [
  'Druid',
  'Hunter',
  'Mage',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior'
] as const

export const CARD_CLASS_BLEND_MODES = [
  'normal',
  'add',
  'multiply',
  'screen',
  'color',
  'overlay',
  'soft-light'
] as const

export type CardClassBuilderClass = (typeof CARD_CLASS_BUILDER_CLASSES)[number]
export type CardClassBlendMode = (typeof CARD_CLASS_BLEND_MODES)[number]
export type CardClassMaskChannel = 'primary' | 'secondary'
export type CardClassTemplate = 'minion' | 'spell'

export interface CardClassColorLayer {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
  readonly opacity: number
  readonly blendMode: CardClassBlendMode
}

export interface CardClassOffset {
  readonly x: number
  readonly y: number
}

export interface CardClassBuilderConfig {
  readonly version: 1
  readonly classes: Readonly<
    Record<
      CardClassBuilderClass,
      {
        readonly primary: CardClassColorLayer
        readonly secondary: CardClassColorLayer
      }
    >
  >
  readonly offsets: {
    readonly minion: {
      readonly primary: CardClassOffset
      readonly secondary: CardClassOffset
    }
    readonly spell: { readonly primary: CardClassOffset }
    readonly premium: Readonly<
      Record<CardClassTemplate, { readonly primary: CardClassOffset }>
    >
  }
}

export interface CardClassBuilderApi {
  save(config: CardClassBuilderConfig): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function numberInRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  )
}

function parseLayer(value: unknown): CardClassColorLayer {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['hue', 'saturation', 'lightness', 'opacity', 'blendMode']) ||
    !numberInRange(value.hue, 0, 360) ||
    !numberInRange(value.saturation, 0, 1) ||
    !numberInRange(value.lightness, 0, 1) ||
    !numberInRange(value.opacity, 0, 1) ||
    !CARD_CLASS_BLEND_MODES.includes(value.blendMode as CardClassBlendMode)
  ) {
    throw new Error('Invalid card class color layer')
  }
  return {
    hue: value.hue,
    saturation: value.saturation,
    lightness: value.lightness,
    opacity: value.opacity,
    blendMode: value.blendMode as CardClassBlendMode
  }
}

function parseOffset(value: unknown): CardClassOffset {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['x', 'y']) ||
    !numberInRange(value.x, -200, 200) ||
    !numberInRange(value.y, -200, 200)
  ) {
    throw new Error('Invalid card class mask offset')
  }
  return { x: value.x, y: value.y }
}

export function parseCardClassBuilderConfig(value: unknown): CardClassBuilderConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['version', 'classes', 'offsets']) ||
    value.version !== 1 ||
    !isRecord(value.classes) ||
    !hasExactKeys(value.classes, CARD_CLASS_BUILDER_CLASSES) ||
    !isRecord(value.offsets) ||
    !(
      hasExactKeys(value.offsets, ['minion', 'spell']) ||
      hasExactKeys(value.offsets, ['minion', 'spell', 'premium'])
    )
  ) {
    throw new Error('Invalid card class builder configuration')
  }

  const classValues = value.classes
  const classes = Object.fromEntries(
    CARD_CLASS_BUILDER_CLASSES.map((classId) => {
      const entry = classValues[classId]
      if (!isRecord(entry) || !hasExactKeys(entry, ['primary', 'secondary'])) {
        throw new Error(`Invalid card class builder entry for ${classId}`)
      }
      return [
        classId,
        { primary: parseLayer(entry.primary), secondary: parseLayer(entry.secondary) }
      ]
    })
  ) as CardClassBuilderConfig['classes']

  const minion = value.offsets.minion
  const spell = value.offsets.spell
  if (
    !isRecord(minion) ||
    !hasExactKeys(minion, ['primary', 'secondary']) ||
    !isRecord(spell) ||
    !hasExactKeys(spell, ['primary'])
  ) {
    throw new Error('Invalid card class template offsets')
  }

  const premium =
    'premium' in value.offsets
      ? value.offsets.premium
      : { minion: { primary: { x: 0, y: 0 } }, spell: { primary: { x: 0, y: 0 } } }
  if (!isRecord(premium) || !hasExactKeys(premium, ['minion', 'spell'])) {
    throw new Error('Invalid premium card class offsets')
  }
  const parsePremiumTemplate = (
    entry: unknown
  ): { readonly primary: CardClassOffset } => {
    if (!isRecord(entry) || !hasExactKeys(entry, ['primary'])) {
      throw new Error('Invalid premium card class template offset')
    }
    return { primary: parseOffset(entry.primary) }
  }

  return {
    version: 1,
    classes,
    offsets: {
      minion: {
        primary: parseOffset(minion.primary),
        secondary: parseOffset(minion.secondary)
      },
      spell: { primary: parseOffset(spell.primary) },
      premium: {
        minion: parsePremiumTemplate(premium.minion),
        spell: parsePremiumTemplate(premium.spell)
      }
    }
  }
}
