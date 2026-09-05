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
    step: 0.1,
    displayScale: 1,
    suffix: '°'
  },
  {
    key: 'saturation',
    label: 'Saturation',
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: '%'
  },
  {
    key: 'lightness',
    label: 'Lightness',
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: '%'
  },
  {
    key: 'opacity',
    label: 'Opacity',
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: '%'
  },
  {
    key: 'offsetX',
    label: 'Offset X',
    min: -200,
    max: 200,
    step: 0.1,
    displayScale: 1,
    suffix: 'px'
  },
  {
    key: 'offsetY',
    label: 'Offset Y',
    min: -200,
    max: 200,
    step: 0.1,
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
  private template: ClassFrameTemplate = 'minion'
  activeChannel: ClassFrameMaskChannel = 'primary'
  linked = false

  get config(): CardClassBuilderConfig {
    return getClassFrameConfig()
  }

  get selectedTemplate(): ClassFrameTemplate {
    return this.template
  }

  set selectedTemplate(template: ClassFrameTemplate) {
    this.template = template
    if (template === 'spell') {
      this.activeChannel = 'primary'
      this.linked = false
    }
  }

  getLayer(channel: ClassFrameMaskChannel): CardClassColorLayer {
    return this.config.classes[this.selectedClass][channel]
  }

  getNumeric(channel: ClassFrameMaskChannel, key: NumericControlKey): number {
    if (key === 'offsetX' || key === 'offsetY') {
      const offset =
        this.selectedTemplate === 'spell'
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
    const previous = this.getNumeric(channel, key)
    const next = this.normalize(key, value)
    this.setNumericDirect(channel, key, next)
    if (!this.linked || this.selectedTemplate === 'spell') return

    const other = channel === 'primary' ? 'secondary' : 'primary'
    const delta =
      key === 'hue' ? ((next - previous + 540) % 360) - 180 : next - previous
    this.setNumericDirect(other, key, this.getNumeric(other, key) + delta)
  }

  setBlendMode(channel: ClassFrameMaskChannel, blendMode: ClassFrameBlendMode): void {
    const config = this.config
    updateClassFrameConfig(
      replaceClassLayer(config, this.selectedClass, channel, {
        ...config.classes[this.selectedClass][channel],
        blendMode
      })
    )
  }

  moveActiveMask(deltaX: number, deltaY: number): void {
    this.setNumeric(
      this.activeChannel,
      'offsetX',
      this.getNumeric(this.activeChannel, 'offsetX') + deltaX
    )
    this.setNumeric(
      this.activeChannel,
      'offsetY',
      this.getNumeric(this.activeChannel, 'offsetY') + deltaY
    )
  }

  private normalize(key: NumericControlKey, value: number): number {
    const spec = SPEC_BY_KEY.get(key)!
    if (key === 'hue') return rounded(normalizedHue(value))
    return rounded(clamp(value, spec.min, spec.max))
  }

  private setNumericDirect(
    channel: ClassFrameMaskChannel,
    key: NumericControlKey,
    value: number
  ): void {
    const normalized = this.normalize(key, value)
    const config = this.config
    if (key === 'offsetX' || key === 'offsetY') {
      const current =
        this.selectedTemplate === 'spell'
          ? config.offsets.spell.primary
          : config.offsets.minion[channel]
      const next =
        key === 'offsetX'
          ? { ...current, x: normalized }
          : { ...current, y: normalized }
      updateClassFrameConfig({
        ...config,
        offsets:
          this.selectedTemplate === 'spell'
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
