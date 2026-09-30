import {
  AURA_CATEGORIES,
  AURA_ELEMENT_LABELS,
  auraCategory,
  type AuraBackground
} from './aura-lab-elements'
import { OUTLINE_LAB_PALETTES } from './outline-lab-palettes'
import type {
  OutlinePresetName,
  OutlinePaletteName
} from '../../visual-components/effects/outline-tuning'
import type { ShatterTuning } from '../../visual-components/effects/shatter'
import type { Renderer } from 'pixi.js'
import {
  AURA_CONTROLS,
  GHOST_TUNING_RANGES,
  GHOST_WIND_DIRECTIONS,
  type AuraTuning,
  type AuraPalette,
  type GhostAuraTuning,
  type GhostAuraPalette
} from '../../desktop/contracts/ipc/outline-tuning'
import { OUTLINE_LAB_LAYOUT as LAYOUT } from './outline-lab-layout'

type Change = (key: string, value: number | boolean, color: boolean) => void
interface Control {
  key: string
  label: string
  section: string
  type: 'range' | 'checkbox' | 'color' | 'select'
  options?: readonly { readonly value: number; readonly label: string }[]
  min?: number
  max?: number
  step?: number
}

/** Native inputs retain V5's fractional precision in a scrollable panel. */
export class OutlineLabShaderControls {
  private readonly root = document.createElement('section')
  private readonly shader = document.createElement('select')
  private readonly content = document.createElement('div')
  private readonly resize = (): void => this.updatePosition()

  constructor(
    private readonly options: {
      canvas: HTMLCanvasElement
      renderer: Renderer
      parent: HTMLElement
      onShaderChange(shader: 'aura' | 'ghost' | 'shatter'): void
    }
  ) {
    this.root.setAttribute('aria-label', 'Shader controls')
    Object.assign(this.root.style, {
      position: 'absolute',
      transformOrigin: 'top left',
      zIndex: '10',
      boxSizing: 'border-box',
      padding: '16px',
      background: '#17283d',
      color: '#fff3dc',
      font: '16px Arial',
      pointerEvents: 'auto',
      overflowY: 'auto'
    })
    for (const [value, label] of [
      ['aura', 'Aura Shader'],
      ['ghost', 'Ghost Aura Shader'],
      ['shatter', 'Shatter Shader']
    ]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      this.shader.append(option)
    }
    this.shader.setAttribute('aria-label', 'Shader')
    this.shader.style.cssText =
      'width:100%;padding:10px;font:18px Arial;margin-bottom:12px'
    this.shader.onchange = () =>
      options.onShaderChange(this.shader.value as 'aura' | 'ghost' | 'shatter')
    this.root.append(this.shader, this.content)
    for (const event of ['pointerdown', 'wheel', 'keydown'])
      this.root.addEventListener(event, (event) => event.stopPropagation())
    options.parent.append(this.root)
    options.renderer.on('resize', this.resize)
    this.updatePosition()
  }

  showAura(
    tuning: AuraTuning,
    palette: AuraPalette,
    onChange: Change,
    preview: {
      preset: OutlinePresetName
      palette: OutlinePaletteName
      background: AuraBackground
      onElement(preset: OutlinePresetName): void
      onState(palette: OutlinePaletteName): void
      onBackground(background: AuraBackground): void
    }
  ): void {
    this.shader.value = 'aura'
    this.render(AURA_CONTROLS, { ...tuning, ...palette }, onChange)
    const navigation = document.createElement('div')
    const heading = document.createElement('h3')
    heading.textContent = 'Editing: ' + AURA_ELEMENT_LABELS[preview.preset]
    navigation.append(heading)
    const select = (
      label: string,
      entries: readonly (readonly [string, string])[],
      value: string,
      change: (value: string) => void
    ): void => {
      const row = document.createElement('label')
      row.style.cssText = 'display:block;margin:10px 0'
      row.append(label + ' ')
      const input = document.createElement('select')
      input.style.cssText = 'padding:6px;max-width:100%;font:16px Arial'
      input.setAttribute('aria-label', label)
      for (const [key, title] of entries) input.add(new Option(title, key))
      input.value = value
      input.onchange = () => change(input.value)
      row.append(input)
      navigation.append(row)
    }
    select(
      'Element',
      AURA_CATEGORIES[auraCategory(preview.preset)].map(
        (key) => [key, AURA_ELEMENT_LABELS[key]] as const
      ),
      preview.preset,
      (value) => preview.onElement(value as OutlinePresetName)
    )
    select(
      'Preview state',
      OUTLINE_LAB_PALETTES[preview.preset].map(
        (state) => [state.palette, state.label] as const
      ),
      preview.palette,
      (value) => preview.onState(value as OutlinePaletteName)
    )
    select(
      'Background',
      [
        ['context', 'Scene artwork'],
        ['dark', 'Neutral dark'],
        ['light', 'Neutral light']
      ],
      preview.background,
      (value) => preview.onBackground(value as AuraBackground)
    )
    const note = document.createElement('p')
    note.textContent =
      'Tuning applies only to this element. Colors edit the shared ' +
      preview.palette +
      ' palette.'
    navigation.append(note)
    this.content.prepend(navigation)
  }

  showGhost(
    tuning: GhostAuraTuning,
    palette: GhostAuraPalette,
    onChange: Change,
    actions: { label: string; run(): void }[]
  ): void {
    this.shader.value = 'ghost'
    const labels: Record<string, string> = {
      windDirection: 'Direction',
      mistIntensity: 'Intensity',
      mistWidth: 'Width (px)',
      mistSoftness: 'Softness',
      mistTextureScale: 'Texture scale',
      mistAnimationSpeed: 'Animation speed',
      particleIntensity: 'Intensity',
      particleWindStrength: 'Wind strength',
      particleCount: 'Count',
      particleSize: 'Average size (px)',
      particleTravelDistance: 'Maximum travel distance (px)',
      mistPrimaryColor: 'Primary color',
      mistHighlightColor: 'Highlight color',
      particleColor: 'Color'
    }
    const section = (key: string): string =>
      key === 'windDirection' ? 'Shared' : key.startsWith('mist') ? 'Mist' : 'Particles'
    const controls: Control[] = [
      { key: 'mistEnabled', label: 'Enabled', section: 'Mist', type: 'checkbox' },
      {
        key: 'particlesEnabled',
        label: 'Enabled',
        section: 'Particles',
        type: 'checkbox'
      },
      ...Object.entries(GHOST_TUNING_RANGES).map(([key, [min, max]]): Control => ({
        key,
        label: labels[key],
        section: section(key),
        type: key === 'windDirection' ? 'select' : 'range',
        options: key === 'windDirection' ? GHOST_WIND_DIRECTIONS : undefined,
        min,
        max,
        step: ['particleCount', 'particleTravelDistance', 'mistWidth'].includes(key)
          ? 1
          : 0.01
      })),
      ...Object.keys(palette).map((key): Control => ({
        key,
        label: labels[key],
        section: section(key),
        type: 'color'
      }))
    ]
    this.render(controls, { ...tuning, ...palette }, onChange)
    const buttons = document.createElement('div')
    for (const action of actions) {
      const button = document.createElement('button')
      button.textContent = action.label
      button.onclick = action.run
      buttons.append(button)
    }
    const shared = Array.from(this.content.children).find(
      (group) => group.querySelector('legend')?.textContent === 'Shared'
    )
    shared?.append(buttons)
  }

  showShatter(
    tuning: ShatterTuning,
    progress: number,
    onChange: Change,
    actions: { label: string; run(): void }[]
  ): void {
    this.shader.value = 'shatter'
    this.render(
      [
        {
          key: 'progress',
          label: 'Progress',
          section: 'Shatter',
          type: 'range',
          min: 0,
          max: 1,
          step: 0.001
        },
        {
          key: 'shardCount',
          label: 'Shard count',
          section: 'Shatter',
          type: 'range',
          min: 8,
          max: 120,
          step: 1
        },
        {
          key: 'spread',
          label: 'Spread',
          section: 'Shatter',
          type: 'range',
          min: 0,
          max: 2,
          step: 0.01
        },
        {
          key: 'spin',
          label: 'Spin (degrees)',
          section: 'Shatter',
          type: 'range',
          min: 0,
          max: 720,
          step: 1
        },
        {
          key: 'duration',
          label: 'Duration (seconds)',
          section: 'Shatter',
          type: 'range',
          min: 0.3,
          max: 5,
          step: 0.1
        },
        {
          key: 'seed',
          label: 'Seed',
          section: 'Shatter',
          type: 'range',
          min: 1,
          max: 9999,
          step: 1
        }
      ],
      { ...tuning, progress },
      onChange
    )
    for (const action of actions) {
      const button = document.createElement('button')
      button.textContent = action.label
      button.onclick = action.run
      this.content.append(button)
    }
    const note = document.createElement('p')
    note.textContent =
      'Save applies these settings to matches and future sessions. Match minions shatter after their death wiggle; heroes are preview-only.'
    this.content.append(note)
  }

  setShatterProgress(progress: number): void {
    if (this.shader.value !== 'shatter') return
    for (const input of this.content.querySelectorAll<HTMLInputElement>(
      'input[aria-label^="Shatter: Progress"]'
    )) {
      input.value = String(Number(progress.toFixed(3)))
    }
  }

  private render(
    controls: readonly Control[],
    values: Record<string, number | boolean>,
    onChange: Change
  ): void {
    this.content.replaceChildren()
    const groups = new Map<string, HTMLElement>()
    for (const spec of controls) {
      let group = groups.get(spec.section)
      if (!group) {
        group = document.createElement('fieldset')
        group.style.cssText = 'border:1px solid #6682a5;margin:0 0 14px;padding:12px'
        const legend = document.createElement('legend')
        legend.textContent = spec.section
        group.append(legend)
        this.content.append(group)
        groups.set(spec.section, group)
      }
      const row = document.createElement('label')
      row.style.cssText =
        'display:grid;grid-template-columns:180px 1fr 78px;align-items:center;gap:10px;margin:9px 0'
      const caption = document.createElement('span')
      caption.textContent = spec.label
      if (spec.type === 'select') {
        const select = document.createElement('select')
        select.setAttribute('aria-label', spec.section + ': ' + spec.label)
        for (const option of spec.options ?? []) {
          const element = document.createElement('option')
          element.value = String(option.value)
          element.textContent = option.label
          select.append(element)
        }
        select.value = String(values[spec.key])
        select.onchange = () => onChange(spec.key, Number(select.value), false)
        row.append(caption, select)
        group.append(row)
        continue
      }
      const input = document.createElement('input')
      input.setAttribute('aria-label', `${spec.section}: ${spec.label}`)
      const output = document.createElement('input')
      output.setAttribute('aria-label', `${spec.section}: ${spec.label} value`)
      output.style.width = '72px'
      input.type = spec.type
      if (spec.type === 'checkbox') {
        input.checked = Boolean(values[spec.key])
        input.onchange = () => onChange(spec.key, input.checked, false)
        row.append(caption, input)
      } else if (spec.type === 'color') {
        input.value = `#${Number(values[spec.key]).toString(16).padStart(6, '0')}`
        output.value = input.value
        output.maxLength = 7
        input.oninput = () => {
          output.value = input.value
          onChange(spec.key, parseInt(input.value.slice(1), 16), true)
        }
        output.onchange = () => {
          if (!/^#[0-9a-f]{6}$/i.test(output.value)) {
            output.value = input.value
            return
          }
          input.value = output.value
          onChange(spec.key, parseInt(input.value.slice(1), 16), true)
        }
        row.append(caption, input, output)
      } else {
        output.type = 'number'
        for (const field of [input, output]) {
          field.min = String(spec.min)
          field.max = String(spec.max)
          field.step = String(spec.step)
          field.value = String(values[spec.key])
        }
        const update = (raw: string): void => {
          if (!raw.trim() || !Number.isFinite(Number(raw))) {
            output.value = input.value
            return
          }
          const step = spec.step!
          const value = Number(
            (
              Math.round(Math.min(spec.max!, Math.max(spec.min!, Number(raw))) / step) *
              step
            ).toFixed(4)
          )
          input.value = output.value = String(value)
          onChange(spec.key, value, false)
        }
        input.oninput = () => update(input.value)
        output.onchange = () => update(output.value)
        row.append(caption, input, output)
      }
      group.append(row)
    }
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
  }
  dispose(): void {
    this.options.renderer.off('resize', this.resize)
    this.root.remove()
  }
  private updatePosition(): void {
    const canvas = this.options.canvas.getBoundingClientRect()
    const parent = this.options.parent.getBoundingClientRect()
    const scale = Math.min(canvas.width / 1920, canvas.height / 1080)
    this.root.style.left = `${canvas.left - parent.left + (canvas.width - 1920 * scale) / 2 + LAYOUT.controls.x * scale}px`
    this.root.style.top = `${canvas.top - parent.top + (canvas.height - 1080 * scale) / 2 + LAYOUT.tuningHeadingY * scale}px`
    this.root.style.width = `${LAYOUT.controls.width}px`
    this.root.style.height = `${LAYOUT.controls.height - (LAYOUT.tuningHeadingY - LAYOUT.controls.y)}px`
    this.root.style.transform = `scale(${scale})`
  }
}
