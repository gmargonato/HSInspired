import {
  CARD_CLASS_BUILDER_CLASSES,
  type CardClassBuilderConfig,
  type CardClassColorLayer
} from '../../../../shared/ipc/card-class-builder'
import {
  getClassFrameConfig,
  updateClassFrameConfig,
  type ClassFrameBlendMode,
  type ClassFrameClassId,
  type ClassFrameMaskChannel,
  type ClassFrameTemplate
} from '../../../rendering/cards/class-frame-colors'
import { CARD_CATALOG, type CardDefinition } from '../../../../game/content/cards'

export const CARD_LAB_TEMPLATES = ['minion', 'spell', 'weapon', 'hero'] as const
export type CardLabTemplate = (typeof CARD_LAB_TEMPLATES)[number]

export type NumericControlKey =
  'hue' | 'saturation' | 'lightness' | 'opacity' | 'offsetX' | 'offsetY'

export interface NumericControlSpec {
  readonly key: NumericControlKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly displayScale: number
  readonly suffix: string
}

export const NUMERIC_CONTROL_SPECS = [
  {
    key: 'hue',
    label: 'Hue',
    min: 0,
    max: 360,
    step: 1,
    displayScale: 1,
    suffix: '°'
  },
  {
    key: 'saturation',
    label: 'Saturation',
    min: 0,
    max: 1,
    step: 0.01,
    displayScale: 100,
    suffix: '%'
  },
  {
    key: 'lightness',
    label: 'Lightness',
    min: 0,
    max: 1,
    step: 0.01,
    displayScale: 100,
    suffix: '%'
  },
  {
    key: 'opacity',
    label: 'Opacity',
    min: 0,
    max: 1,
    step: 0.01,
    displayScale: 100,
    suffix: '%'
  },
  {
    key: 'offsetX',
    label: 'Offset X',
    min: -200,
    max: 200,
    step: 1,
    displayScale: 1,
    suffix: 'px'
  },
  {
    key: 'offsetY',
    label: 'Offset Y',
    min: -200,
    max: 200,
    step: 1,
    displayScale: 1,
    suffix: 'px'
  }
] as const satisfies readonly NumericControlSpec[]

const SPEC_BY_KEY = new Map(NUMERIC_CONTROL_SPECS.map((spec) => [spec.key, spec]))

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizedHue(value: number): number {
  const wrapped = ((value % 360) + 360) % 360
  return wrapped === 0 && value > 0 ? 360 : wrapped
}

function rounded(value: number): number {
  return Number(value.toFixed(4))
}

function replaceClassLayer(
  config: CardClassBuilderConfig,
  classId: ClassFrameClassId,
  channel: ClassFrameMaskChannel,
  layer: CardClassColorLayer
): CardClassBuilderConfig {
  return {
    ...config,
    classes: {
      ...config.classes,
      [classId]: { ...config.classes[classId], [channel]: layer }
    }
  }
}

export class CardInspectorModel {
  readonly classes = CARD_CLASS_BUILDER_CLASSES
  selectedClass: ClassFrameClassId = CARD_CLASS_BUILDER_CLASSES[0]
  private template: CardLabTemplate = 'minion'
  private premium = false

  get config(): CardClassBuilderConfig {
    return getClassFrameConfig()
  }

  get selectedTemplate(): CardLabTemplate {
    return this.template
  }

  set selectedTemplate(template: CardLabTemplate) {
    this.template = template
    if (!this.hasCardForClass(this.selectedClass)) {
      const availableClass = this.classes.find((classId) =>
        this.hasCardForClass(classId)
      )
      if (availableClass) this.selectedClass = availableClass
    }
  }

  get selectedPremium(): boolean {
    return this.premium
  }

  set selectedPremium(premium: boolean) {
    this.premium = premium
  }

  get hasSecondaryMask(): boolean {
    return !this.premium && this.template === 'minion'
  }

  get maskTemplate(): ClassFrameTemplate | undefined {
    return this.template === 'minion' || this.template === 'spell'
      ? this.template
      : undefined
  }

  hasCardForClass(classId: ClassFrameClassId): boolean {
    return CARD_CATALOG.all.some(
      (card) => card.cardClass === classId && card.type.toLowerCase() === this.template
    )
  }

  get selectedCard(): CardDefinition | undefined {
    return CARD_CATALOG.all.find(
      (card) =>
        card.cardClass === this.selectedClass &&
        card.type.toLowerCase() === this.template
    )
  }

  getLayer(channel: ClassFrameMaskChannel): CardClassColorLayer {
    return this.config.classes[this.selectedClass][channel]
  }

  getNumeric(channel: ClassFrameMaskChannel, key: NumericControlKey): number {
    const template = this.maskTemplate
    if (!template) return 0
    if (key === 'offsetX' || key === 'offsetY') {
      const offset = this.selectedPremium
        ? this.config.offsets.premium[template].primary
        : this.selectedTemplate === 'spell'
          ? this.config.offsets.spell.primary
          : this.config.offsets.minion[channel]
      return key === 'offsetX' ? offset.x : offset.y
    }
    return this.getLayer(channel)[key]
  }

  setNumeric(
    channel: ClassFrameMaskChannel,
    key: NumericControlKey,
    value: number
  ): void {
    const next = this.normalize(key, value)
    this.setNumericDirect(channel, key, next)
  }

  setBlendMode(channel: ClassFrameMaskChannel, blendMode: ClassFrameBlendMode): void {
    if (!this.maskTemplate) return
    const config = this.config
    updateClassFrameConfig(
      replaceClassLayer(config, this.selectedClass, channel, {
        ...config.classes[this.selectedClass][channel],
        blendMode
      })
    )
  }

  private normalize(key: NumericControlKey, value: number): number {
    const spec = SPEC_BY_KEY.get(key)!
    const normalized =
      key === 'hue' ? normalizedHue(value) : clamp(value, spec.min, spec.max)
    return rounded(Math.round(normalized / spec.step) * spec.step)
  }

  private setNumericDirect(
    channel: ClassFrameMaskChannel,
    key: NumericControlKey,
    value: number
  ): void {
    const template = this.maskTemplate
    if (!template) return
    const normalized = this.normalize(key, value)
    const config = this.config
    if (key === 'offsetX' || key === 'offsetY') {
      const current = this.selectedPremium
        ? config.offsets.premium[template].primary
        : this.selectedTemplate === 'spell'
          ? config.offsets.spell.primary
          : config.offsets.minion[channel]
      const next =
        key === 'offsetX'
          ? { ...current, x: normalized }
          : { ...current, y: normalized }
      updateClassFrameConfig({
        ...config,
        offsets: this.selectedPremium
          ? {
              ...config.offsets,
              premium: {
                ...config.offsets.premium,
                [this.selectedTemplate]: { primary: next }
              }
            }
          : this.selectedTemplate === 'spell'
            ? { ...config.offsets, spell: { primary: next } }
            : {
                ...config.offsets,
                minion: { ...config.offsets.minion, [channel]: next }
              }
      })
      return
    }

    updateClassFrameConfig(
      replaceClassLayer(config, this.selectedClass, channel, {
        ...config.classes[this.selectedClass][channel],
        [key]: normalized
      })
    )
  }
}
