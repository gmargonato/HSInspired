import type { Renderer } from 'pixi.js'
import {
  HERO_POWER_ASSET_SOURCES,
  type HeroPowerAssetKey
} from '../../../ui/asset-registry/hero-power-assets'
import { hasHeroPowerEffect } from '../../game/hero-power-effects/hero-power-effects-presenter'
import { PREVIEW_POWERS } from './hero-power-anim-model'
import { HERO_POWER_ANIM_LAYOUT as LAYOUT } from './hero-power-anim-layout'

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}

interface ControlActions {
  select(id: string): void
  play(): void
  loop(enabled: boolean): void
}

/** Isolated DOM sidebar, aligned to the Pixi design canvas like the other dev labs. */
export class HeroPowerAnimControls {
  private readonly host = element('section')
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private readonly play = element('button', 'Play / Replay')
  private readonly loop = element('input')
  private readonly status = element('p')
  private readonly target = element('p')
  private readonly name = element('h2')
  private readonly rules = element('p')
  private readonly resize = (): void => this.updatePosition()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    private readonly parent: HTMLElement,
    actions: ControlActions
  ) {
    this.host.dataset.devControl = 'hero-power-anim.controls'
    Object.assign(this.host.style, {
      position: 'absolute',
      transformOrigin: 'top left',
      zIndex: '10'
    })
    const shadow = this.host.attachShadow({ mode: 'open' })
    const style = element('style')
    style.textContent = `
      :host { color: #f4eee0; font: 18px/1.4 'Segoe UI', sans-serif; cursor: default; }
      * { box-sizing: border-box; }
      .panel { height:100%; display:flex; flex-direction:column; padding:22px;
        background:rgba(18,22,29,.96); border:1px solid #5c5140; border-radius:12px; }
      h1 { font-size:26px; margin:0 0 6px; } h2 { font-size:21px; margin:16px 0 5px; }
      p { margin:5px 0; } .muted { color:#c0bdba; font-size:16px; }
      button { font:inherit; color:inherit; background:#303945; border:1px solid #637082;
        border-radius:6px; padding:10px; cursor:pointer; }
      button:hover:not(:disabled) { background:#414f60; }
      button:focus-visible { outline:2px solid #f1cb78; outline-offset:2px; }
      button:disabled { opacity:.45; cursor:default; }
      .toolbar { display:flex; gap:14px; align-items:center; margin:14px 0 8px; }
      label { display:flex; gap:6px; align-items:center; cursor:pointer; }
      input { accent-color:#e5be68; width:18px; height:18px; }
      .list { overflow-y:auto; flex:1; min-height:0; margin-top:14px; padding:0 5px 6px 0; }
      h3 { color:#ddc490; font-size:16px; margin:18px 0 8px; text-transform:uppercase; }
      .power { display:flex; gap:12px; align-items:center; width:100%; text-align:left;
        margin:0 0 7px; padding:8px; background:#252b34; }
      .power[aria-pressed=true] { border-color:#f1cb78; background:#443d2c; }
      img { width:46px; height:46px; border-radius:50%; object-fit:cover; }
      small { display:block; font-size:13px; color:#aaa; }
      .ready { color:#a9dc9e; }
    `
    const panel = element('div')
    panel.className = 'panel'
    const subtitle = element('p', 'Select a power, then replay its animation.')
    subtitle.className = 'muted'
    this.rules.className = 'muted'
    this.status.setAttribute('aria-live', 'polite')
    this.target.className = 'muted'
    const toolbar = element('div')
    toolbar.className = 'toolbar'
    this.play.type = 'button'
    this.play.onclick = () => actions.play()
    this.loop.type = 'checkbox'
    this.loop.onchange = () => actions.loop(this.loop.checked)
    const loopLabel = element('label')
    loopLabel.append(this.loop, document.createTextNode('Loop'))
    toolbar.append(this.play, loopLabel)
    const list = element('div')
    list.className = 'list'
    list.setAttribute('aria-label', 'Hero powers')
    let previousClass = ''
    for (const power of PREVIEW_POWERS) {
      if (power.classId !== previousClass) {
        list.append(element('h3', power.classId))
        previousClass = power.classId
      }
      const button = element('button')
      button.className = 'power'
      button.type = 'button'
      const image = element('img')
      image.src =
        HERO_POWER_ASSET_SOURCES[power.presentationAssetKey as HeroPowerAssetKey]
      image.alt = ''
      const title = element('span', power.displayName)
      const available = hasHeroPowerEffect(power.id)
      const badge = element('small', available ? 'Ready' : 'Not implemented yet')
      if (available) badge.className = 'ready'
      title.append(badge)
      button.append(image, title)
      button.onclick = () => actions.select(power.id)
      list.append(button)
      this.buttons.set(power.id, button)
    }
    panel.append(
      element('h1', 'Hero Power Anim'),
      subtitle,
      this.name,
      this.rules,
      toolbar,
      this.status,
      this.target,
      list
    )
    shadow.append(style, panel)
    parent.append(this.host)
    renderer.on('resize', this.resize)
    window.addEventListener('resize', this.resize)
    this.updatePosition()
  }

  refresh(
    id: string,
    busy: boolean,
    looping: boolean,
    target: string,
    error?: string
  ): void {
    const power = PREVIEW_POWERS.find((entry) => entry.id === id)!
    const available = hasHeroPowerEffect(id)
    this.name.textContent = power.displayName
    this.rules.textContent = power.rulesText.replace(/<[^>]*>/g, '')
    this.play.disabled = busy || !available
    this.loop.disabled = !available
    this.loop.checked = looping
    this.status.textContent =
      error ?? (busy ? 'Playing…' : available ? 'Ready to play' : 'Not implemented yet')
    this.target.textContent = target
    for (const [key, button] of this.buttons)
      button.setAttribute('aria-pressed', String(key === id))
  }

  setVisible(visible: boolean): void {
    this.host.hidden = !visible
  }

  dispose(): void {
    this.renderer.off('resize', this.resize)
    window.removeEventListener('resize', this.resize)
    this.host.remove()
  }

  private updatePosition(): void {
    const canvas = this.canvas.getBoundingClientRect(),
      parent = this.parent.getBoundingClientRect()
    const scale = Math.min(
      canvas.width / LAYOUT.canvas.width,
      canvas.height / LAYOUT.canvas.height
    )
    const x = (canvas.width - LAYOUT.canvas.width * scale) / 2
    const y = (canvas.height - LAYOUT.canvas.height * scale) / 2
    Object.assign(this.host.style, {
      left: `${canvas.left - parent.left + x + LAYOUT.controls.position.x * scale}px`,
      top: `${canvas.top - parent.top + y + LAYOUT.controls.position.y * scale}px`,
      width: `${LAYOUT.controls.size.width}px`,
      height: `${LAYOUT.controls.size.height}px`,
      transform: `scale(${scale})`
    })
  }
}
