import type { Renderer } from 'pixi.js'
import type { VfxTemplate } from '../../desktop/contracts/ipc/vfx-templates'
import {
  AOE_ZONES,
  type VfxEffectId,
  type VfxLabSettingKey,
  type VfxLabSettingValue,
  type VfxLabSettings
} from './vfx-lab-model'
import { VFX_LAB_LAYOUT as LAYOUT } from './vfx-lab-layout'

interface ControlSpec {
  readonly key: VfxLabSettingKey
  readonly label: string
  readonly type: 'range' | 'color' | 'select' | 'checkbox'
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly options?: readonly { readonly value: string; readonly label: string }[]
}

interface ControlActions {
  select(effect: VfxEffectId): void
  selectTemplate(id: string): void
  createTemplate(): void
  deleteTemplate(): void
  renameTemplate(name: string): void
  saveTemplates(): void
  change(key: VfxLabSettingKey, value: VfxLabSettingValue): void
  play(): void
  loop(enabled: boolean): void
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}

const COMMON_CONTROLS: readonly ControlSpec[] = [
  { key: 'flameColor', label: 'Flame color', type: 'color' },
  { key: 'coreColor', label: 'Core color', type: 'color' },
  {
    key: 'intensity',
    label: 'Intensity',
    type: 'range',
    min: 0.25,
    max: 2.5,
    step: 0.01
  },
  {
    key: 'noiseScale',
    label: 'Noise scale',
    type: 'range',
    min: 1,
    max: 10,
    step: 0.1
  },
  {
    key: 'flowSpeed',
    label: 'Texture speed',
    type: 'range',
    min: 0,
    max: 3.5,
    step: 0.05
  },
  {
    key: 'turbulence',
    label: 'Turbulence',
    type: 'range',
    min: 0,
    max: 1.2,
    step: 0.01
  },
  { key: 'durationMs', label: 'Duration', type: 'range', min: 400, max: 2200, step: 50 }
]

const EFFECT_CONTROLS: Record<VfxEffectId, readonly ControlSpec[]> = {
  missile: [
    {
      key: 'missileLength',
      label: 'Wake length',
      type: 'range',
      min: 150,
      max: 750,
      step: 5
    },
    {
      key: 'missileWidth',
      label: 'Fireball size',
      type: 'range',
      min: 0.12,
      max: 0.48,
      step: 0.005
    },
    { key: 'showTargetGuides', label: 'Show hero endpoints', type: 'checkbox' }
  ],
  aoe: [
    {
      key: 'aoeRadius',
      label: 'Blast radius',
      type: 'range',
      min: 0.35,
      max: 1.15,
      step: 0.01
    },
    {
      key: 'aoeEdgeSoftness',
      label: 'Edge softness',
      type: 'range',
      min: 0.01,
      max: 0.2,
      step: 0.005
    },
    {
      key: 'aoeShape',
      label: 'Coverage shape',
      type: 'select',
      options: [
        { value: 'radial', label: 'Radial burst' },
        { value: 'wide', label: 'Wide burst' }
      ]
    }
  ]
}

/** DOM controls are overlaid on the Pixi preview like the other development labs. */
export class VfxLabControls {
  private readonly host = element('section')
  private readonly shadow: ShadowRoot
  private readonly effectSelect = element('select')
  private readonly templateList = element('div')
  private readonly nameInput = element('input')
  private readonly keyLabel = element('p')
  private readonly createButton = element('button', 'Create copy')
  private readonly deleteButton = element('button', 'Delete')
  private readonly saveButton = element('button', 'Save effects')
  private readonly saveStatus = element('p')
  private readonly parameterList = element('div')
  private readonly playButton = element('button', 'Play / Replay')
  private readonly loopInput = element('input')
  private readonly status = element('p')
  private readonly inputs = new Map<
    VfxLabSettingKey,
    HTMLInputElement | HTMLSelectElement
  >()
  private readonly outputs = new Map<VfxLabSettingKey, HTMLOutputElement>()
  private readonly resize = (): void => this.updatePosition()
  private currentEffect: VfxEffectId | null = null
  private templateListKey = ''

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    parent: HTMLElement,
    private readonly actions: ControlActions
  ) {
    this.host.dataset.devControl = 'vfx-lab.controls'
    this.host.setAttribute('aria-label', 'VFX Lab controls')
    Object.assign(this.host.style, {
      position: 'absolute',
      transformOrigin: 'top left',
      zIndex: '10'
    })
    this.shadow = this.host.attachShadow({ mode: 'open' })

    const style = element('style')
    style.textContent = [
      ':host { color:#f4eee0; font:16px/1.4 Segoe UI, sans-serif; }',
      '* { box-sizing:border-box; }',
      '.panel { height:100%; display:flex; flex-direction:column; padding:20px;',
      '  background:rgba(18,22,29,.97); border:1px solid #685648; border-radius:12px; }',
      'h1 { font-size:27px; margin:0 0 5px; color:#f3d089; }',
      '.muted { color:#c0bdba; margin:0 0 14px; }',
      'label { display:block; margin:0 0 10px; }',
      '.field-label { display:flex; justify-content:space-between; gap:10px; margin-bottom:4px; }',
      '.toggle { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 8px; }',
      '.toggle .field-label { margin:0; }',
      '.toggle input { width:18px; height:18px; accent-color:#e5be68; }',
      'output { color:#e9d3a6; font-variant-numeric:tabular-nums; }',
      'input, select, button { color:inherit; font:inherit; }',
      'input[type=range], select { width:100%; accent-color:#e5be68; }',
      'input[type=color] { width:50px; height:30px; padding:2px; border:1px solid #637082;',
      '  background:#303945; border-radius:4px; }',
      'select { padding:9px; background:#303945; border:1px solid #637082; border-radius:6px; }',
      'fieldset { min-width:0; border:1px solid #4b5665; border-radius:7px;',
      '  margin:0 0 12px; padding:10px 12px 4px; }',
      'legend { color:#ddc490; padding:0 6px; }',
      '.scroll { overflow-y:auto; flex:1; min-height:0; padding-right:4px; }',
      '.templates { max-height:150px; overflow-y:auto; display:flex; flex-direction:column;',
      '  gap:4px; margin:0 0 10px; }',
      '.templates button { text-align:left; padding:5px 8px; }',
      '.templates button.selected { border-color:#e5be68; background:#504636; }',
      '.template-actions { display:flex; gap:7px; margin:0 0 10px; }',
      '.template-actions button { flex:1; padding:7px; }',
      '.name-input { width:100%; padding:7px; margin-bottom:8px;',
      '  background:#303945; border:1px solid #637082; border-radius:6px; }',
      '.toolbar { display:flex; gap:12px; align-items:center; margin:4px 0 8px; }',
      'button { background:#303945; border:1px solid #637082; border-radius:6px;',
      '  padding:10px 14px; cursor:pointer; }',
      'button:hover { background:#414f60; }',
      'button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid #f1cb78; outline-offset:2px; }',
      '.loop { display:flex; align-items:center; gap:7px; margin:0; cursor:pointer; }',
      '.loop input { accent-color:#e5be68; width:18px; height:18px; }',
      '.status { min-height:22px; color:#b7d99f; margin:5px 0 0; }',
      '.save-status { min-height:18px; margin:2px 0 0; color:#e9d3a6; font-size:13px; }',
      '.note { font-size:13px; color:#b5b1aa; margin:4px 0 0; }'
    ].join('\n')

    this.effectSelect.setAttribute('aria-label', 'VFX effect')
    for (const [value, label] of [
      ['missile', 'Missile VFX'],
      ['aoe', 'AoE VFX']
    ] as const) {
      const option = element('option', label)
      option.value = value
      this.effectSelect.append(option)
    }
    this.effectSelect.onchange = () =>
      actions.select(this.effectSelect.value as VfxEffectId)
    this.templateList.className = 'templates'
    this.templateList.setAttribute('aria-label', 'Saved effects')
    this.nameInput.className = 'name-input'
    this.nameInput.setAttribute('aria-label', 'Effect name')
    this.nameInput.maxLength = 80
    this.nameInput.onchange = () => actions.renameTemplate(this.nameInput.value)
    this.keyLabel.className = 'note'
    this.createButton.type = 'button'
    this.createButton.onclick = () => actions.createTemplate()
    this.deleteButton.type = 'button'
    this.deleteButton.onclick = () => actions.deleteTemplate()
    this.saveButton.type = 'button'
    this.saveButton.onclick = () => actions.saveTemplates()
    this.saveStatus.className = 'save-status'
    this.saveStatus.setAttribute('aria-live', 'polite')
    this.playButton.type = 'button'
    this.playButton.onclick = () => actions.play()
    this.loopInput.type = 'checkbox'
    this.loopInput.onchange = () => actions.loop(this.loopInput.checked)
    this.status.className = 'status'
    this.status.setAttribute('aria-live', 'polite')

    const panel = element('div')
    panel.className = 'panel'
    const subtitle = element('p', 'Select an effect, tune it, then save your changes.')
    subtitle.className = 'muted'
    const effectLabel = element('label')
    const effectTitle = element('span', 'Effect')
    effectTitle.className = 'field-label'
    effectLabel.append(effectTitle, this.effectSelect)
    const templateLabel = element('div', 'Effects')
    templateLabel.className = 'field-label'
    const templateActions = element('div')
    templateActions.className = 'template-actions'
    templateActions.append(this.createButton, this.deleteButton)

    const toolbar = element('div')
    toolbar.className = 'toolbar'
    const loopLabel = element('label')
    loopLabel.className = 'loop'
    loopLabel.append(this.loopInput, document.createTextNode('Loop'))
    toolbar.append(this.playButton, loopLabel)

    const note = element('p', 'Effects use stable keys for future card bindings.')
    note.className = 'note'
    const scroll = element('div')
    scroll.className = 'scroll'
    scroll.append(this.parameterList)
    panel.append(
      element('h1', 'VFX Lab'),
      subtitle,
      effectLabel,
      templateLabel,
      this.templateList,
      this.nameInput,
      this.keyLabel,
      templateActions,
      scroll,
      toolbar,
      this.status,
      this.saveButton,
      this.saveStatus,
      note
    )
    this.shadow.append(style, panel)
    parent.append(this.host)
    renderer.on('resize', this.resize)
    window.addEventListener('resize', this.resize)
    this.updatePosition()
  }

  refresh(
    effect: VfxEffectId,
    settings: VfxLabSettings,
    playing: boolean,
    looping: boolean,
    templates: readonly VfxTemplate[],
    selectedId: string | null,
    dirty: boolean,
    saving: boolean,
    saveMessage: string
  ): void {
    this.effectSelect.value = effect
    const listKey =
      JSON.stringify(
        templates
          .filter((item) => item.family === effect)
          .map((item) => [item.id, item.name])
      ) + selectedId
    if (listKey !== this.templateListKey) {
      this.templateListKey = listKey
      this.templateList.replaceChildren()
      for (const template of templates.filter((item) => item.family === effect)) {
        const button = element('button', template.name)
        button.type = 'button'
        button.title = template.id
        button.classList.toggle('selected', template.id === selectedId)
        button.onclick = () => this.actions.selectTemplate(template.id)
        this.templateList.append(button)
      }
      if (!this.templateList.childElementCount)
        this.templateList.append(
          element('p', 'No effects in this family. Create one to begin.')
        )
    }
    const selected = templates.find((item) => item.id === selectedId)
    if (this.shadow.activeElement !== this.nameInput)
      this.nameInput.value = selected?.name ?? ''
    this.keyLabel.textContent = selected ? `Effect key: ${selected.id}` : ''
    this.createButton.textContent = selected ? 'Create copy' : 'Create effect'
    this.nameInput.disabled = !selected
    this.deleteButton.disabled = !selected
    this.playButton.disabled = !selected
    this.saveButton.disabled = !dirty || saving
    this.saveStatus.textContent = saveMessage || (dirty ? 'Unsaved changes' : 'Saved')
    if (this.currentEffect !== effect) this.renderParameters(effect, settings)
    this.parameterList.hidden = !selected
    for (const [key, input] of this.inputs) {
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = Boolean(settings[key])
        continue
      }
      if (this.shadow.activeElement === input) continue
      const value = settings[key]
      input.value = String(value)
      const output = this.outputs.get(key)
      if (output) output.value = this.formatValue(key, Number(value))
    }
    this.loopInput.checked = looping
    const noTargets =
      effect === 'aoe' && selected && !AOE_ZONES.some(({ key }) => settings[key])
    this.status.textContent = !selected
      ? 'Create an effect to preview'
      : noTargets
        ? 'Select a target zone to preview'
        : playing
          ? 'Playing…'
          : 'Ready to play'
  }

  setVisible(visible: boolean): void {
    this.host.hidden = !visible
  }

  dispose(): void {
    this.renderer.off('resize', this.resize)
    window.removeEventListener('resize', this.resize)
    this.host.remove()
  }

  private renderParameters(effect: VfxEffectId, settings: VfxLabSettings): void {
    this.currentEffect = effect
    this.inputs.clear()
    this.outputs.clear()
    this.parameterList.replaceChildren()
    if (effect === 'aoe') {
      this.addGroup(
        'Target zones',
        [
          ...AOE_ZONES.map(({ key, label }) => ({
            key,
            label,
            type: 'checkbox' as const
          })),
          { key: 'showTargetGuides', label: 'Show target guides', type: 'checkbox' }
        ],
        settings
      )
    }
    this.addGroup('Flame color and intensity', COMMON_CONTROLS, settings)
    this.addGroup(
      effect === 'missile' ? 'Missile shape' : 'Area shape',
      EFFECT_CONTROLS[effect],
      settings
    )
  }

  private addGroup(
    title: string,
    specs: readonly ControlSpec[],
    settings: VfxLabSettings
  ): void {
    const group = element('fieldset')
    group.append(element('legend', title))
    for (const spec of specs) {
      const label = element('label')
      if (spec.type === 'checkbox') label.className = 'toggle'
      const header = element('div')
      header.className = 'field-label'
      header.append(element('span', spec.label))
      let input: HTMLInputElement | HTMLSelectElement
      if (spec.type === 'select') {
        input = element('select')
        for (const optionSpec of spec.options ?? []) {
          const option = element('option', optionSpec.label)
          option.value = optionSpec.value
          input.append(option)
        }
      } else {
        input = element('input')
        input.type = spec.type
        if (spec.min !== undefined) input.min = String(spec.min)
        if (spec.max !== undefined) input.max = String(spec.max)
        if (spec.step !== undefined) input.step = String(spec.step)
      }
      input.setAttribute('aria-label', spec.label)
      input.value = String(settings[spec.key])
      if (input instanceof HTMLInputElement && spec.type === 'checkbox') {
        input.checked = Boolean(settings[spec.key])
      }
      const valueOutput = element('output')
      if (spec.type === 'range') {
        valueOutput.value = this.formatValue(spec.key, Number(settings[spec.key]))
        header.append(valueOutput)
        this.outputs.set(spec.key, valueOutput)
      }
      input.oninput = () => {
        const value =
          spec.type === 'checkbox'
            ? (input as HTMLInputElement).checked
            : spec.type === 'range'
              ? Number.parseFloat(input.value)
              : input.value
        if (spec.type === 'range') {
          const output = this.outputs.get(spec.key)
          if (output) output.value = this.formatValue(spec.key, Number(value))
        }
        this.actions.change(spec.key, value)
      }
      this.inputs.set(spec.key, input)
      label.append(header, input)
      group.append(label)
    }
    this.parameterList.append(group)
  }

  private formatValue(key: VfxLabSettingKey, value: number): string {
    if (key === 'durationMs') return Math.round(value) + ' ms'
    if (key === 'missileLength') return Math.round(value) + ' px'
    return value.toFixed(2)
  }

  private updatePosition(): void {
    const canvas = this.canvas.getBoundingClientRect()
    const parent = this.host.parentElement?.getBoundingClientRect()
    if (!parent) return
    const scale = Math.min(
      canvas.width / LAYOUT.canvas.width,
      canvas.height / LAYOUT.canvas.height
    )
    const x = (canvas.width - LAYOUT.canvas.width * scale) / 2
    const y = (canvas.height - LAYOUT.canvas.height * scale) / 2
    Object.assign(this.host.style, {
      left: canvas.left - parent.left + x + LAYOUT.controls.position.x * scale + 'px',
      top: canvas.top - parent.top + y + LAYOUT.controls.position.y * scale + 'px',
      width: LAYOUT.controls.size.width + 'px',
      height: LAYOUT.controls.size.height + 'px',
      transform: 'scale(' + scale + ')'
    })
  }
}
