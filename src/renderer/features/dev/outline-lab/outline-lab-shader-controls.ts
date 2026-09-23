import type { Renderer } from 'pixi.js'
import {
  AURA_CONTROLS,
  GHOST_TUNING_RANGES,
  type AuraTuning,
  type AuraPalette,
  type GhostAuraTuning,
  type GhostAuraPalette
} from '../../../../shared/ipc/outline-tuning'
import { OUTLINE_LAB_LAYOUT as LAYOUT } from './outline-lab-layout'

type Change = (key: string, value: number | boolean, color: boolean) => void
interface Control {
  key: string
  label: string
  section: string
  type: 'range' | 'checkbox' | 'color'
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
      onShaderChange(ghost: boolean): void
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
      ['ghost', 'Ghost Aura Shader']
    ]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      this.shader.append(option)
    }
    this.shader.setAttribute('aria-label', 'Shader')
    this.shader.style.cssText =
      'width:100%;padding:10px;font:18px Arial;margin-bottom:12px'
    this.shader.onchange = () => options.onShaderChange(this.shader.value === 'ghost')
    this.root.append(this.shader, this.content)
    for (const event of ['pointerdown', 'wheel', 'keydown'])
      this.root.addEventListener(event, (event) => event.stopPropagation())
    options.parent.append(this.root)
    options.renderer.on('resize', this.resize)
    this.updatePosition()
  }

  showAura(tuning: AuraTuning, palette: AuraPalette, onChange: Change): void {
    this.shader.value = 'aura'
    this.render(AURA_CONTROLS, { ...tuning, ...palette }, onChange)
  }

  showGhost(
    tuning: GhostAuraTuning,
    palette: GhostAuraPalette,
    onChange: Change
  ): void {
    this.shader.value = 'ghost'
    const controls: Control[] = Object.entries(GHOST_TUNING_RANGES).map(
      ([key, [min, max]]) => ({
        key,
        label: this.label(key),
        section: 'Ghost tuning',
        type: 'range',
        min,
        max,
        step: key === 'saturation' ? 0.05 : 1
      })
    )
    for (const key of Object.keys(palette))
      controls.push({
        key,
        label: this.label(key),
        section: 'Ghost colors',
        type: 'color'
      })
    this.render(controls, { ...tuning, ...palette }, onChange)
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

  private label(key: string): string {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
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
