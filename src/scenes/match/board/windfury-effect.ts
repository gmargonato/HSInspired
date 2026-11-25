import { Container, Texture } from 'pixi.js'
import { Matrix4 } from 'three'
import { WINDFURY_CONFIG } from '../../../visual-components/effects/outline-tuning'
import {
  parseWindfuryTuning,
  type WindfuryTuning
} from '../../../desktop/contracts/ipc/windfury-tuning'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { applyPlacement, type LayoutPlacement } from '../../../visual-components/layout'
import authored from '../../../visual-components/effects/windfury-authored.json'
import {
  WindMaterial,
  windTransform,
  windValue,
  windProjectionFit,
  type WindfuryTextures,
  type WindNode,
  type WindTrack
} from '../../../visual-components/effects/windfury-material'
import { WindMotes } from '../../../visual-components/effects/windfury-motes'

type Curl = {
  mesh: WindMaterial
  node: WindNode
  burst: boolean
  tracks: WindTrack[]
  delay: number
  duration: number
}
/** Scene-owned mounting and playback; native geometry/materials live in visual-components. */
export class WindfuryEffect {
  readonly rear = new Container()
  readonly front = new Container()
  private readonly animations = new AnimationScope()
  private readonly clock = { phase: 0 }
  private tuning: WindfuryTuning = { ...WINDFURY_CONFIG }
  private loop: ReturnType<AnimationScope['to']> | null = null
  private enabled = false
  private destroyed = false
  private curls: Curl[] = []
  private exit: ReturnType<AnimationScope['timeline']> | null = null
  private reminder: ReturnType<AnimationScope['timeline']> | null = null
  private burstStart = 0
  private motes?: WindMotes
  constructor(
    private readonly placement: LayoutPlacement,
    private readonly label: string,
    private readonly textures?: WindfuryTextures
  ) {
    for (const [layer, suffix] of [
      [this.rear, 'rear'],
      [this.front, 'front']
    ] as const) {
      layer.label = label + '.' + suffix
      layer.eventMode = 'none'
      layer.visible = false
      applyPlacement(layer, placement)
      layer.pivot.set(0)
    }
  }
  private initialize(): void {
    if (this.curls.length) return
    const { placement, label } = this
    const texture = this.textures?.windfuryWind ?? Texture.EMPTY
    const hero = label.includes('hero') || placement.size.width > 300
    const kind = hero ? 'Hero' : 'Ally'
    const idle = authored.prefabs[`Card_Play_${kind}_WindFury_Idle`] as WindNode
    const activation = authored.prefabs[`Card_Play_${kind}_WindFury_Burst`] as WindNode
    const fit = windProjectionFit(idle, activation)
    for (const burst of [false, true]) {
      const root = authored.prefabs[
        ('Card_Play_' +
          kind +
          '_WindFury_' +
          (burst ? 'Burst' : 'Idle')) as keyof typeof authored.prefabs
      ] as WindNode
      const visit = (node: WindNode, parent: Matrix4) => {
        const transform = windTransform(node, parent)
        if (node.mesh) {
          const clip = burst
            ? 'FX_WindFuryCurlsBurst'
            : node.name.endsWith('b')
              ? 'FX_WindFuryCurlsIdle2'
              : 'FX_WindFuryCurlsIdle'
          const tracks = authored.clips[clip].filter((t) => t.path === node.name)
          for (const [layer, side] of [
            [this.rear, -1],
            [this.front, 1]
          ] as const) {
            const mesh = new WindMaterial(
              texture,
              node,
              transform,
              placement.size.width,
              placement.size.height,
              side,
              burst && !hero,
              fit.portraitDepth,
              burst ? fit.burstScale : 1
            )
            layer.addChild(mesh)
            this.curls.push({
              mesh,
              node,
              burst,
              tracks,
              delay: !burst && node.name.endsWith('b') ? 0.2 : 0,
              duration: clip.endsWith('2') ? 3 : 2.6
            })
          }
        }
        for (const child of node.children) visit(child, transform)
      }
      visit(root, new Matrix4())
    }
    this.motes = new WindMotes(
      this.textures?.windfuryMote ?? Texture.EMPTY,
      placement.size.width,
      placement.size.height,
      hero
    )
    this.front.addChild(this.motes.layer)
  }
  setTuning(tuning: WindfuryTuning): void {
    if (this.destroyed) return
    this.tuning = parseWindfuryTuning(tuning)
    this.loop?.timeScale(tuning.speed)
    this.draw()
  }
  setEnabled(enabled: boolean): void {
    if (this.destroyed || enabled === this.enabled) return
    this.enabled = enabled
    this.reminder?.kill()
    this.reminder = null
    this.exit?.kill()
    this.exit = null
    if (!enabled) {
      this.loop?.pause()
      const state = { fade: 1 }
      this.exit = this.animations.timeline()
      this.exit.to(state, {
        fade: 0,
        duration: 0.5,
        onUpdate: () => this.draw(state.fade)
      })
      this.exit.call(
        () => {
          this.loop?.kill()
          this.loop = null
          this.rear.visible = this.front.visible = false
        },
        [],
        1
      )
      return
    }
    this.initialize()
    this.animations.kill()
    this.loop = null
    this.clock.phase = 0
    this.burstStart = 0
    this.rear.visible = this.front.visible = true
    this.draw()
    this.loop = this.animations.to(this.clock, {
      phase: 39,
      duration: 39,
      repeat: -1,
      ease: 'none',
      onUpdate: () => this.draw()
    })
    this.loop.timeScale(this.tuning.speed)
  }
  /** Deterministic sampling for warm-up and the developer preview. */
  advancePreview(seconds: number): void {
    this.loop?.totalTime(seconds, false)
  }
  playBurst(): void {
    if (this.destroyed || !this.enabled) return
    this.burstStart = this.loop?.totalTime() ?? this.clock.phase
    this.draw()
  }
  scheduleReminder(eligible: () => boolean): void {
    if (this.destroyed || !this.enabled) return
    this.reminder?.kill()
    this.reminder = this.animations.timeline()
    this.reminder.call(
      () => {
        if (!this.destroyed && this.enabled && eligible()) this.playBurst()
      },
      [],
      1.2
    )
  }
  private draw(fade = 1): void {
    const time = this.loop?.totalTime() ?? this.clock.phase
    for (const curl of this.curls) {
      const age = curl.burst ? time - this.burstStart : time - curl.delay
      curl.mesh.visible = age >= 0 && (!curl.burst || age < 1.5)
      if (!curl.mesh.visible) continue
      curl.mesh.tune(this.tuning)
      const u = curl.mesh.shader!.resources.windUniforms.uniforms
      u.uOpacity = 1
      u.uMaterialColor.set([1, 1, 1, 1])
      u.uScroll.set([0.4, 0])
      u.uST.set([1, 1, 0, 0])
      for (const track of curl.tracks) {
        const v = windValue(track.keys, curl.burst ? age : age % curl.duration, NaN)
        if (!Number.isFinite(v)) continue
        const a = track.attribute
        if (a === '_UScroll') u.uScroll[0] = v
        if (a.startsWith('_Color.')) u.uMaterialColor['rgba'.indexOf(a.at(-1)!)] = v
        if (a.startsWith('_MainTex_ST.')) u.uST['rgba'.indexOf(a.at(-1)!)] = v
        if (a.startsWith('_MainTex.scale.')) u.uST[a.endsWith('x') ? 0 : 1] = v
        if (a.startsWith('_MainTex.offset.')) u.uST[a.endsWith('x') ? 2 : 3] = v
      }
      for (let i = 0; i < 3; i++) u.uMaterialColor[i] *= fade
    }
    this.motes?.update(time - this.burstStart, this.tuning.scale, fade)
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.animations.kill()
    this.motes?.destroy()
    for (const c of this.curls) c.mesh.destroy()
    this.curls = []
    this.rear.destroy()
    this.front.destroy()
  }
}
