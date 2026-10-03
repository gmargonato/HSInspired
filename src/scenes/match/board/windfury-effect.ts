import { WINDFURY_CONFIG } from '../../../visual-components/effects/outline-tuning'
import {
  parseWindfuryTuning,
  type WindfuryTuning
} from '../../../desktop/contracts/ipc/windfury-tuning'
import { Graphics } from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { applyPlacement, type LayoutPlacement } from '../../../visual-components/layout'

const WIND = {
  duration: 2.1,
  samples: 40,
  feather: [
    { width: 2.4, alpha: 0.035 },
    { width: 1.6, alpha: 0.075 },
    { width: 1, alpha: 0.23 }
  ]
} as const

/** Two halves of one orbit, mounted behind and in front of the host portrait. */
export class WindfuryEffect {
  readonly rear = new Graphics()
  readonly front = new Graphics()
  private readonly animations = new AnimationScope()
  private readonly clock = { phase: 0 }
  private tuning: WindfuryTuning = { ...WINDFURY_CONFIG }
  private loop: ReturnType<AnimationScope['to']> | null = null
  private enabled = false
  private destroyed = false

  constructor(
    private readonly placement: LayoutPlacement,
    label: string
  ) {
    for (const [layer, suffix] of [
      [this.rear, 'rear'],
      [this.front, 'front']
    ] as const) {
      layer.label = `${label}.${suffix}`
      layer.eventMode = 'none'
      layer.visible = false
      applyPlacement(layer, placement)
      // Geometry is drawn about the authored anchor, never measured from live bounds.
      layer.pivot.set(0, 0)
    }
  }

  setTuning(tuning: WindfuryTuning): void {
    this.tuning = parseWindfuryTuning(tuning)
    if (this.destroyed) return
    this.loop?.timeScale(this.tuning.speed)
    if (this.enabled) this.draw()
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed || enabled === this.enabled) return
    this.enabled = enabled
    this.rear.visible = this.front.visible = enabled
    this.animations.kill()
    this.loop = null
    if (!enabled) return
    this.clock.phase = 0
    this.draw()
    this.loop = this.animations.to(this.clock, {
      phase: 1,
      duration: WIND.duration,
      repeat: -1,
      ease: 'none',
      onUpdate: () => this.draw()
    })
    this.loop.timeScale(this.tuning.speed)
  }

  private draw(): void {
    this.rear.clear()
    this.front.clear()
    const { width, height } = this.placement.size
    const tuning = this.tuning
    const trailRadians = Math.PI * tuning.trailLength
    const radiusX = width * 0.5 * tuning.width
    const radiusY = height * tuning.orbitDepth
    for (let ribbon = 0; ribbon < tuning.ribbons; ribbon++) {
      const head = (this.clock.phase + ribbon / tuning.ribbons) * Math.PI * 2
      const start = head - trailRadians
      // Split exactly at the silhouette's left/right edges so depth never pops.
      const cuts = [start]
      for (let edge = Math.floor(start / Math.PI) + 1; edge * Math.PI < head; edge++) {
        cuts.push(edge * Math.PI)
      }
      cuts.push(head)
      for (let run = 1; run < cuts.length; run++) {
        const from = cuts[run - 1]
        const to = cuts[run]
        const layer = Math.sin((from + to) / 2) >= 0 ? this.front : this.rear
        const steps = Math.max(
          2,
          Math.ceil(((to - from) / trailRadians) * WIND.samples)
        )
        for (const feather of WIND.feather) {
          const upper: number[] = []
          const lower: number[] = []
          for (let sample = 0; sample <= steps; sample++) {
            const angle = from + ((to - from) * sample) / steps
            const along = (angle - start) / trailRadians
            const taper = Math.pow(Math.max(0, Math.sin(Math.PI * along)), 1.3)
            const x = Math.cos(angle) * radiusX
            const y =
              Math.sin(angle) * radiusY +
              (ribbon - (tuning.ribbons - 1) / 2) * height * tuning.spacing
            const halfWidth =
              height *
              0.016 *
              tuning.thickness *
              taper *
              (1 + (feather.width - 1) * tuning.softness)
            upper.push(x, y - halfWidth)
            lower.unshift(x, y + halfWidth)
          }
          layer.poly([...upper, ...lower]).fill({
            color: tuning.color,
            alpha:
              tuning.opacity * feather.alpha * (0.88 + 0.12 * Math.sin(head + ribbon))
          })
        }
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.animations.kill()
    this.rear.destroy()
    this.front.destroy()
  }
}
