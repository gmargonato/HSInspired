import { PLAYABLE_CLASSES, type KnownClassId } from '../../../game/content/cards'

/** Playable classes are eligible for the shared minion mask treatment. */
export type ClassFrameClassId = Exclude<KnownClassId, 'Neutral'>

export type ClassFrameBlendMode = 'normal' | 'add' | 'multiply' | 'screen'

/** Absolute HSL values; hue is degrees and saturation/lightness are 0..1. */
export interface ClassFrameLayerControls {
  readonly hue?: number
  readonly saturation?: number
  readonly lightness?: number
  readonly blendMode?: ClassFrameBlendMode
}

/** Shared controls can be overridden independently for each mask layer. */
export interface ClassFrameAppearanceControls extends ClassFrameLayerControls {
  readonly primary?: ClassFrameLayerControls
  readonly accent?: ClassFrameLayerControls
}

export interface ClassFrameAppearance {
  readonly primary: number
  readonly accent: number
  readonly primaryAlpha: number
  readonly accentAlpha: number
  readonly primaryBlendMode: ClassFrameBlendMode
  readonly accentBlendMode: ClassFrameBlendMode
}

/** Development inspector reset values; production colors are class-specific below. */
export const CLASS_FRAME_DEFAULT_CONTROLS = {
  primary: { hue: 210, saturation: 0.72, lightness: 0.44 },
  accent: { hue: 198, saturation: 0.86, lightness: 0.72 }
} as const

/**
 * Final, direct frame colors for each playable class. These are exact RGB
 * values, not offsets from a shared base palette.
 */
export const CLASS_FRAME_CLASS_APPEARANCES: Readonly<
  Record<ClassFrameClassId, Pick<ClassFrameAppearance, 'primary' | 'accent'>>
> = {
  Druid: { primary: 0xa16400, accent: 0xfabc00 },
  Hunter: { primary: 0x00a10a, accent: 0xfabc00 },
  Mage: { primary: 0x1f6cff, accent: 0xffe38b },
  Paladin: { primary: 0xffdd19, accent: 0xffcb0c },
  Priest: { primary: 0xb2edff, accent: 0xffc514 },
  Rogue: { primary: 0x003748, accent: 0xffc514 },
  Shaman: { primary: 0x0036db, accent: 0xffc514 },
  Warlock: { primary: 0x3700ff, accent: 0xf9f638 },
  Warrior: { primary: 0xff0303, accent: 0xffaf17 }
}

const CLASS_FRAME_CLASSES = new Set<string>(PLAYABLE_CLASSES)

/** Neutral and unknown classes intentionally have no class-mask layers. */
export function isClassFrameClass(classId: string): boolean {
  return CLASS_FRAME_CLASSES.has(classId)
}

/** Global kill switch for the experiment. */
export const CLASS_FRAME_COLORS_ENABLED = true

export const CLASS_FRAME_MASK_APPEARANCE = {
  primaryAlpha: 0.56,
  primaryBlendMode: 'multiply',
  accentAlpha: 0.38,
  accentBlendMode: 'add'
} as const

interface HslColor {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hslToRgb({ hue, saturation, lightness }: HslColor): number {
  if (saturation === 0) {
    const channel = Math.round(lightness * 255)
    return (channel << 16) | (channel << 8) | channel
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const hueToRgb = (offset: number): number => {
    let normalizedHue = (hue + offset) % 1
    if (normalizedHue < 0) normalizedHue += 1
    if (normalizedHue < 1 / 6) return p + (q - p) * 6 * normalizedHue
    if (normalizedHue < 1 / 2) return q
    if (normalizedHue < 2 / 3) return p + (q - p) * (2 / 3 - normalizedHue) * 6
    return p
  }

  const red = Math.round(hueToRgb(1 / 3) * 255)
  const green = Math.round(hueToRgb(0) * 255)
  const blue = Math.round(hueToRgb(-1 / 3) * 255)
  return (red << 16) | (green << 8) | blue
}

function colorForControls(
  controls: ClassFrameLayerControls | undefined,
  shared: ClassFrameLayerControls,
  fallback: number,
  inspectorDefaults: {
    readonly hue: number
    readonly saturation: number
    readonly lightness: number
  }
): number {
  const hue = controls?.hue ?? shared.hue
  const saturation = controls?.saturation ?? shared.saturation
  const lightness = controls?.lightness ?? shared.lightness
  if (hue === undefined && saturation === undefined && lightness === undefined) {
    return fallback
  }
  return hslToRgb({
    hue: ((((hue ?? inspectorDefaults.hue) % 360) + 360) % 360) / 360,
    saturation: clamp(saturation ?? inspectorDefaults.saturation, 0, 1),
    lightness: clamp(lightness ?? inspectorDefaults.lightness, 0, 1)
  })
}

export function classFrameAppearanceFor(
  classId: string,
  controls: ClassFrameAppearanceControls = {}
): ClassFrameAppearance | undefined {
  if (!isClassFrameClass(classId)) return undefined

  const primaryControls = controls.primary
  const accentControls = controls.accent
  const defaults = CLASS_FRAME_CLASS_APPEARANCES[classId as ClassFrameClassId]
  return {
    primary: colorForControls(
      primaryControls,
      controls,
      defaults.primary,
      CLASS_FRAME_DEFAULT_CONTROLS.primary
    ),
    accent: colorForControls(
      accentControls,
      controls,
      defaults.accent,
      CLASS_FRAME_DEFAULT_CONTROLS.accent
    ),
    primaryAlpha: CLASS_FRAME_MASK_APPEARANCE.primaryAlpha,
    accentAlpha: CLASS_FRAME_MASK_APPEARANCE.accentAlpha,
    primaryBlendMode:
      primaryControls?.blendMode ??
      controls.blendMode ??
      CLASS_FRAME_MASK_APPEARANCE.primaryBlendMode,
    accentBlendMode:
      accentControls?.blendMode ??
      controls.blendMode ??
      CLASS_FRAME_MASK_APPEARANCE.accentBlendMode
  }
}

export function shouldRenderClassFrameColors(enabledOverride?: boolean): boolean {
  return enabledOverride ?? CLASS_FRAME_COLORS_ENABLED
}
