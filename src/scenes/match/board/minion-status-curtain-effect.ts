import { Container, Graphics, GraphicsContext, Sprite, type Texture } from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { applyPlacement } from '../../../visual-components/layout'
import { MINION_LAYOUT } from './minion-layout'

export const MINION_CURTAIN_TUNING = {
  count: 18,
  duration: 4,
  minSize: 24,
  maxSize: 42,
  opacity: 1,
  drift: 2,
  spellDamage: 0x48aaff,
  buffed: 0xffb638,
  debuffed: 0xff3636
} as const

// Stable visual variation without consuming the match RNG.
function variation(index: number): number {
  const value = Math.sin(index * 127.1) * 43758.5453
  return value - Math.floor(value)
}

export interface MinionCurtainState {
  readonly spellDamage: boolean
  readonly buffed: boolean
  readonly debuffed: boolean
}

// Shared immutable geometry: scene warmup uploads the same context live minions use.
const curtainMaskContext = new GraphicsContext()
  .ellipse(
    0,
    0,
    MINION_LAYOUT.statusCurtain.size.width / 2,
    MINION_LAYOUT.statusCurtain.size.height / 2
  )
  .fill(0xffffff)

/** Fixed sprite pools, driven by one clock per enabled curtain. */
export class MinionStatusCurtainEffect {
  readonly layer = new Container()
  private readonly bands: {
    kind: keyof MinionCurtainState
    layer: Container
    particles: Sprite[]
    clock: { phase: number }
    animations: AnimationScope
  }[] = []
  private destroyed = false

  constructor(spark: Texture, mote: Texture) {
    const layout = MINION_LAYOUT.statusCurtain
    this.layer.label = 'minion.status-curtains'
    this.layer.eventMode = 'none'
    this.layer.visible = false
    applyPlacement(this.layer, layout)
    this.layer.pivot.set(0, 0)
    const mask = new Graphics(curtainMaskContext)
    mask.label = 'minion.status-curtains.mask'
    mask.eventMode = 'none'
    this.layer.addChild(mask)
    this.layer.mask = mask
    for (const kind of ['spellDamage', 'buffed', 'debuffed'] as const) {
      const layer = new Container()
      layer.label = `minion.curtain.${kind}`
      layer.eventMode = 'none'
      layer.visible = false
      this.layer.addChild(layer)
      const particles = Array.from({ length: MINION_CURTAIN_TUNING.count }, (_, i) => {
        const sprite = new Sprite(kind === 'spellDamage' ? spark : mote)
        sprite.label = `minion.curtain.${kind}.${i}`
        sprite.eventMode = 'none'
        sprite.anchor.set(0.5)
        sprite.tint = MINION_CURTAIN_TUNING[kind]
        sprite.blendMode = 'add'
        const fraction = variation(i + 1)
        sprite.width = sprite.height =
          MINION_CURTAIN_TUNING.minSize +
          fraction * (MINION_CURTAIN_TUNING.maxSize - MINION_CURTAIN_TUNING.minSize)
        layer.addChild(sprite)
        return sprite
      })
      this.bands.push({
        kind,
        layer,
        particles,
        clock: { phase: 0 },
        animations: new AnimationScope()
      })
    }
  }

  setState(state: MinionCurtainState): void {
    if (this.destroyed) return
    const active =
      Number(state.spellDamage) + Number(state.buffed) + Number(state.debuffed)
    this.layer.visible = active > 0
    for (const band of this.bands) {
      band.layer.alpha = active > 1 ? 1 / Math.sqrt(active) : 1
      if (band.layer.visible === state[band.kind]) continue
      band.layer.visible = state[band.kind]
      band.animations.kill()
      if (!band.layer.visible) continue
      const bandIndex = this.bands.indexOf(band)
      const draw = (elapsed: number): void => {
        const { width, height } = MINION_LAYOUT.statusCurtain.size
        for (let i = 0; i < band.particles.length; i++) {
          const sprite = band.particles[i]
          const speed = 0.75 + variation(i + 31 + bandIndex) * 0.5
          const phase = (elapsed * speed + variation(i * (bandIndex + 1))) % 1
          const side = i % 2 === 0 ? -1 : 1
          const y = (phase - 0.5) * height
          // Follow the oval sides, keeping the portrait center clear.
          const edgeX =
            (width / 2) * Math.sqrt(Math.max(0, 1 - (y / (height / 2)) ** 2))
          const lane = 0.68 + variation(i + 17 + bandIndex) * 0.18
          sprite.position.set(
            side * edgeX * lane +
              Math.sin(phase * Math.PI * 2 + i) * MINION_CURTAIN_TUNING.drift,
            band.kind === 'debuffed' ? y : -y
          )
          sprite.alpha =
            MINION_CURTAIN_TUNING.opacity *
            Math.min(1, phase / 0.15, (1 - phase) / 0.15)
        }
      }
      band.clock.phase = 0
      draw(0)
      const loop = band.animations.to(band.clock, {
        phase: 1,
        duration: MINION_CURTAIN_TUNING.duration,
        repeat: -1,
        ease: 'none',
        // Total time keeps individual speeds continuous across clock repeats.
        onUpdate: () => draw(loop.totalTime() / MINION_CURTAIN_TUNING.duration)
      })
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const band of this.bands) band.animations.kill()
    this.layer.destroy({
      children: true,
      context: false,
      texture: false,
      textureSource: false
    })
  }
}
