import type { GodRaysDustTuning } from '../../desktop/contracts/ipc/god-rays-dust-tuning'
import { GAME_WIDTH, GAME_HEIGHT } from '../layout'

const STEP = 1 / 60
const FADE_IN = 0.7
const FADE_OUT = 1.5

export interface DustParticle {
  x: number
  y: number
  diameter: number
  alpha: number
  rotation: number
  texture: number
  depth: number
  originX: number
  travel: number
  age: number
  phase: number
  spin: number
  decayAt: number
  fadeAge: number | null
}

/** Fixed simulation steps keep birth/decay timing independent of render FPS. */
export class GodRaysDustModel {
  readonly particles: DustParticle[] = []
  private remainder = 0

  constructor(
    private tuning: GodRaysDustTuning,
    private readonly random = Math.random
  ) {
    this.resize(true)
  }

  setTuning(tuning: GodRaysDustTuning): void {
    this.tuning = tuning
    this.resize(false)
    for (const particle of this.particles) this.place(particle)
  }

  private resize(prewarm: boolean): void {
    this.particles.length = Math.min(this.particles.length, this.tuning.count)
    while (this.particles.length < this.tuning.count)
      this.particles.push(this.birth(prewarm))
  }

  private birth(prewarm: boolean): DustParticle {
    const depth = this.random()
    const originX = this.random() * GAME_WIDTH
    const velocity = 30 * (1.25 - 0.5 * depth) * Math.SQRT1_2
    const diameter = (6 + 12 * depth) * this.tuning.size
    const exitTime = Math.min(
      (originX + diameter / 2) / velocity,
      (GAME_HEIGHT + diameter) / velocity
    )
    const decayAt =
      this.random() < this.tuning.decayChance
        ? exitTime * (0.2 + this.random() * 0.6)
        : Infinity
    const speed = this.tuning.speed || 1
    const travel = prewarm
      ? this.random() * Math.min(exitTime, decayAt + FADE_OUT * speed)
      : 0
    const particle: DustParticle = {
      x: originX,
      y: 0,
      diameter,
      depth,
      originX,
      travel,
      age: travel / speed,
      alpha: 0,
      rotation: 0,
      texture: this.random() < 0.5 ? 0 : 1,
      phase: this.random() * Math.PI * 2,
      spin: (this.random() < 0.5 ? -1 : 1) * (0.08 + this.random() * 0.12),
      decayAt,
      fadeAge: travel >= decayAt ? (travel - decayAt) / speed : null
    }
    this.place(particle)
    return particle
  }

  private place(particle: DustParticle): void {
    const velocity = 30 * (1.25 - 0.5 * particle.depth) * Math.SQRT1_2
    particle.diameter = (6 + 12 * particle.depth) * this.tuning.size
    const flutter =
      3 * (Math.sin(particle.travel * 0.6 + particle.phase) - Math.sin(particle.phase))
    particle.x = particle.originX - velocity * particle.travel + flutter
    particle.y = -particle.diameter / 2 + velocity * particle.travel
    particle.rotation = particle.phase + particle.spin * particle.travel
    const fadeIn = Math.min(1, particle.age / FADE_IN)
    const fadeOut =
      particle.fadeAge === null ? 1 : Math.max(0, 1 - particle.fadeAge / FADE_OUT)
    particle.alpha = fadeIn * fadeOut
  }

  update(deltaMS: number): void {
    if (!this.tuning.enabled || !Number.isFinite(deltaMS) || deltaMS <= 0) return
    this.remainder += deltaMS / 1000
    while (this.remainder + 1e-10 >= STEP) {
      this.remainder -= STEP
      for (let i = 0; i < this.particles.length; i++) {
        const particle = this.particles[i]
        particle.age += STEP
        particle.travel += STEP * this.tuning.speed
        if (particle.fadeAge !== null) particle.fadeAge += STEP
        else if (particle.travel >= particle.decayAt) particle.fadeAge = 0
        this.place(particle)
        if (
          particle.x + particle.diameter / 2 < 0 ||
          particle.y - particle.diameter / 2 > GAME_HEIGHT ||
          (particle.fadeAge !== null && particle.fadeAge >= FADE_OUT)
        )
          this.particles[i] = this.birth(false)
      }
    }
  }
}
