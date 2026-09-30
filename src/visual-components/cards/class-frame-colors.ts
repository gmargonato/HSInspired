import rawConfig from '../../../config/card-class-colors.json'
import {
  CARD_CLASS_BLEND_MODES,
  CARD_CLASS_BUILDER_CLASSES,
  parseCardClassBuilderConfig,
  type CardClassBuilderClass,
  type CardClassBuilderConfig,
  type CardClassColorLayer,
  type CardClassMaskChannel,
  type CardClassTemplate
} from '../../desktop/contracts/ipc/card-class-builder'

export type ClassFrameClassId = CardClassBuilderClass
export type ClassFrameTemplate = CardClassTemplate
export type ClassFrameMaskChannel = CardClassMaskChannel
export type ClassFrameBlendMode = (typeof CARD_CLASS_BLEND_MODES)[number]

export interface HslColor {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
}

export interface ClassFrameLayerAppearance {
  readonly premiumOffsets: Readonly<
    Record<ClassFrameTemplate, { readonly x: number; readonly y: number }>
  >
  readonly color: number
  readonly alpha: number
  readonly blendMode: ClassFrameBlendMode
  readonly offsets: Readonly<
    Record<ClassFrameTemplate, { readonly x: number; readonly y: number }>
  >
}

export interface ClassFrameAppearance {
  readonly primary: ClassFrameLayerAppearance
  readonly secondary: ClassFrameLayerAppearance
}

export const CLASS_FRAME_BLEND_MODES = CARD_CLASS_BLEND_MODES
const CLASS_FRAME_CLASSES = new Set<string>(CARD_CLASS_BUILDER_CLASSES)
const listeners = new Set<(config: CardClassBuilderConfig) => void>()
let activeConfig = parseCardClassBuilderConfig(rawConfig)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizedHue(hue: number): number {
  return (((hue % 360) + 360) % 360) / 360
}

export function hslToHex({ hue, saturation, lightness }: HslColor): number {
  const h = normalizedHue(hue)
  const s = clamp(saturation, 0, 1)
  const l = clamp(lightness, 0, 1)
  if (s === 0) {
    const channel = Math.round(l * 255)
    return (channel << 16) | (channel << 8) | channel
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hueToRgb = (offset: number): number => {
    let value = (h + offset) % 1
    if (value < 0) value += 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }

  const red = Math.round(hueToRgb(1 / 3) * 255)
  const green = Math.round(hueToRgb(0) * 255)
  const blue = Math.round(hueToRgb(-1 / 3) * 255)
  return (red << 16) | (green << 8) | blue
}

export function formatHexColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`
}

export function isClassFrameClass(classId: string): classId is ClassFrameClassId {
  return CLASS_FRAME_CLASSES.has(classId)
}

export const CLASS_FRAME_COLORS_ENABLED = true

export function getClassFrameConfig(): CardClassBuilderConfig {
  return activeConfig
}

export function updateClassFrameConfig(config: CardClassBuilderConfig): void {
  activeConfig = parseCardClassBuilderConfig(config)
  for (const listener of listeners) listener(activeConfig)
}

export function subscribeToClassFrameConfig(
  listener: (config: CardClassBuilderConfig) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function layerAppearance(
  layer: CardClassColorLayer,
  channel: ClassFrameMaskChannel,
  config: CardClassBuilderConfig
): ClassFrameLayerAppearance {
  return {
    color: hslToHex(layer),
    alpha: layer.opacity,
    blendMode: layer.blendMode,
    premiumOffsets: {
      minion: config.offsets.premium.minion.primary,
      spell: config.offsets.premium.spell.primary
    },
    offsets: {
      minion: config.offsets.minion[channel],
      spell: config.offsets.spell.primary
    }
  }
}

export function classFrameAppearanceFor(
  classId: string,
  config: CardClassBuilderConfig = activeConfig
): ClassFrameAppearance | undefined {
  if (!isClassFrameClass(classId)) return undefined
  const entry = config.classes[classId]
  return {
    primary: layerAppearance(entry.primary, 'primary', config),
    secondary: layerAppearance(entry.secondary, 'secondary', config)
  }
}

export function shouldRenderClassFrameColors(enabledOverride?: boolean): boolean {
  return enabledOverride ?? CLASS_FRAME_COLORS_ENABLED
}
