import { Container, Point, Sprite, type Texture } from 'pixi.js'
import type { CardPieceMotion } from '../../../visual-components/cards/card-view'
import { CARD_ASSEMBLY as CONFIG } from './card-assembly-layout'

interface Spark {
  sprite: Sprite
  age: number
  life: number
  vx: number
  vy: number
  size: number
  stretch: number
}

/** Fixed sprite pool: no per-particle timers, tweens, filters, or allocations. */
export class CardAssemblyEffects extends Container {
  private readonly pool: Spark[] = []
  private readonly trails = new Map<
    CardPieceMotion,
    { point: Point; remainder: number }
  >()
  private readonly center = new Point()
  private readonly edge = new Point()
  private shakeAge: number = CONFIG.shakeDuration
  private shakeStrength = 0

  constructor(
    texture: Texture,
    private readonly offset: (x: number, y: number) => void
  ) {
    super()
    this.label = 'card-preview.assembly-effects'
    this.eventMode = 'none'
    for (let i = 0; i < CONFIG.particles.capacity; i++) {
      const sprite = new Sprite(texture)
      sprite.label = `card-preview.assembly-spark-${i}`
      sprite.anchor.set(0.5)
      sprite.blendMode = 'add'
      sprite.tint = CONFIG.particles.tint
      sprite.visible = false
      this.addChild(sprite)
      this.pool.push({ sprite, age: 0, life: 0, vx: 0, vy: 0, size: 0, stretch: 1 })
    }
  }

  trail(motion: CardPieceMotion): void {
    motion.samplePoint(this, 0.5, 0.5, this.center)
    const previous = this.trails.get(motion)
    if (!previous) {
      this.trails.set(motion, { point: this.center.clone(), remainder: 0 })
      return
    }
    const dx = this.center.x - previous.point.x
    const dy = this.center.y - previous.point.y
    const distance = Math.hypot(dx, dy)
    if (distance === 0) return
    let along = CONFIG.particles.spacing - previous.remainder
    let emitted = 0
    for (; along <= distance && emitted < 32; along += CONFIG.particles.spacing) {
      const side = Math.floor(Math.random() * 4)
      motion.samplePoint(
        this,
        side === 0 ? 0 : side === 1 ? 1 : Math.random(),
        side === 2 ? 0 : side === 3 ? 1 : Math.random(),
        this.edge
      )
      this.spawn(
        previous.point.x + (dx * along) / distance + this.edge.x - this.center.x,
        previous.point.y + (dy * along) / distance + this.edge.y - this.center.y,
        (-dx / distance) * 25,
        (-dy / distance) * 25,
        false
      )
      emitted++
    }
    previous.remainder = (previous.remainder + distance) % CONFIG.particles.spacing
    previous.point.copyFrom(this.center)
  }

  land(motion: CardPieceMotion): void {
    this.trails.delete(motion)
    motion.samplePoint(this, 0.5, 0.5, this.center)
    for (let i = 0; i < CONFIG.particles.burstCount; i++) {
      const angle =
        (i / CONFIG.particles.burstCount) * Math.PI * 2 + Math.random() * 0.3
      const speed = 75 + Math.random() * 90
      this.spawn(
        this.center.x,
        this.center.y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        true
      )
    }
  }

  impact(strength: number): void {
    this.shakeStrength = strength
    this.shakeAge = 0
    this.offset(strength * 0.6, strength)
  }

  update(deltaMS: number): void {
    const dt = Math.max(0, deltaMS) / 1000
    for (const spark of this.pool) {
      if (!spark.sprite.visible) continue
      spark.age += dt
      if (spark.age >= spark.life) {
        spark.sprite.visible = false
        continue
      }
      const remaining = 1 - spark.age / spark.life
      spark.sprite.x += spark.vx * dt
      spark.sprite.y += spark.vy * dt
      spark.sprite.alpha = remaining * remaining
      spark.sprite.width = spark.size * (0.35 + remaining * 0.65)
      spark.sprite.height = spark.sprite.width * spark.stretch
    }
    if (this.shakeAge < CONFIG.shakeDuration) {
      this.shakeAge = Math.min(CONFIG.shakeDuration, this.shakeAge + dt)
      const t = this.shakeAge / CONFIG.shakeDuration
      const kick = this.shakeStrength * (1 - t) ** 2 * Math.cos(t * Math.PI * 4)
      this.offset(kick * 0.6, kick)
    }
  }

  clear(): void {
    if (this.destroyed) return
    this.trails.clear()
    for (const spark of this.pool) spark.sprite.visible = false
    this.shakeAge = CONFIG.shakeDuration
    this.offset(0, 0)
  }

  override destroy(): void {
    this.clear()
    super.destroy({ children: true })
  }

  private spawn(x: number, y: number, vx: number, vy: number, burst: boolean): void {
    let spark: Spark | undefined
    for (const candidate of this.pool) {
      if (!candidate.sprite.visible) {
        spark = candidate
        break
      }
    }
    if (!spark) return
    spark.age = 0
    spark.life =
      CONFIG.particles.lifetimeMin +
      Math.random() * (CONFIG.particles.lifetimeMax - CONFIG.particles.lifetimeMin)
    spark.vx = vx + (Math.random() - 0.5) * 30
    spark.vy = vy + (Math.random() - 0.5) * 30
    spark.size = (burst ? 9 : 5) + Math.random() * 7
    spark.stretch = Math.random() < 0.3 ? 2.2 : 1
    spark.sprite.position.set(x, y)
    spark.sprite.rotation = Math.atan2(vy, vx) - Math.PI / 2
    spark.sprite.width = spark.size
    spark.sprite.height = spark.size * spark.stretch
    spark.sprite.alpha = 1
    spark.sprite.visible = true
  }
}
