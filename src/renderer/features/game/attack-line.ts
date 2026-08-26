import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { gsap } from '../../animation/animations'

export interface LinePoint {
  readonly x: number
  readonly y: number
}

const SEGMENT_SCALE = 1
const SEGMENT_GAP = 22
const START_OFFSET = 32
const FLOW_SPEED_PX_PER_SEC = 145

/** Repeating textured arrow body from a selected minion to the cursor, flowing toward the head. */
export class AttackLine extends Container {
  private bodyTexture: Texture | null = null
  private readonly bodyLayer = new Container()
  private readonly bodyMask = new Graphics()
  private readonly segmentPool: Sprite[] = []
  private from: LinePoint | null = null
  private to: LinePoint | null = null
  private phase = 0
  private ticking = false

  private readonly onTick = (_time: number, deltaMS: number): void => {
    if (!this.visible || !this.from || !this.to) return
    const deltaSec = deltaMS / 1000
    this.phase = (this.phase + FLOW_SPEED_PX_PER_SEC * deltaSec) % this.stepSize
    this.layoutWithPhase()
  }

  private get stepSize(): number {
    if (!this.bodyTexture) return SEGMENT_GAP + 124
    return this.bodyTexture.height * SEGMENT_SCALE + SEGMENT_GAP
  }

  constructor() {
    super()
    this.label = 'game.attack-line'
    this.eventMode = 'none'
    this.visible = false

    this.bodyLayer.label = 'game.attack-line-body'
    this.bodyLayer.eventMode = 'none'
    this.bodyMask.label = 'game.attack-line-body-mask'
    this.bodyMask.eventMode = 'none'
    this.bodyLayer.mask = this.bodyMask
    this.addChild(this.bodyMask, this.bodyLayer)
  }

  setBodyTexture(texture: Texture): void {
    this.bodyTexture = texture
    this.phase = 0
    if (this.from && this.to) this.setEndpoints(this.from, this.to)
  }

  setEndpoints(from: LinePoint, to: LinePoint): void {
    this.from = from
    this.to = to
    if (!this.bodyTexture) {
      this.clearMask()
      this.visible = false
      return
    }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length < START_OFFSET + 12) {
      this.setActiveSegments(0)
      this.clearMask()
      this.visible = false
      this.stopTick()
      return
    }
    this.visible = true
    const usableLength = length - START_OFFSET
    const step = this.stepSize
    const count = Math.max(0, Math.floor(usableLength / step) + 1)
    this.setActiveSegments(count)
    if (count === 0) {
      this.stopTick()
      return
    }
    this.updateMask(from, dx / length, dy / length, length)
    this.startTick()
    this.layoutWithPhase()
  }

  clear(): void {
    this.from = null
    this.to = null
    this.phase = 0
    this.setActiveSegments(0)
    this.clearMask()
    this.visible = false
    this.stopTick()
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopTick()
    super.destroy(options)
  }

  private layoutWithPhase(): void {
    if (!this.from || !this.to || !this.bodyTexture) return
    const from = this.from
    const to = this.to
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length < 1) return
    const angle = Math.atan2(dy, dx)
    const usableLength = length - START_OFFSET
    const step = this.stepSize
    const segmentHeight = this.bodyTexture.height * SEGMENT_SCALE
    const nx = dx / length
    const ny = dy / length

    // Flow from source toward the head (destination): phase increases toward the head.
    const count = this.segmentPool.filter((s) => s.visible).length
    if (count === 0) return
    const totalSpan = count * step
    // Keep phase within one step to loop seamlessly.
    const offset = this.phase % step

    for (let index = 0; index < count; index += 1) {
      const sprite = this.segmentPool[index]
      if (!sprite || !sprite.visible) continue
      // Distribute with phase offset toward the destination, wrapping within the usable span.
      let centerT = START_OFFSET + index * step + offset + segmentHeight / 2
      // Wrap values that fall before the start.
      centerT =
        ((((centerT - START_OFFSET) % totalSpan) + totalSpan) % totalSpan) +
        START_OFFSET
      // Skip if outside usable (with a small grace to allow seamless wrap)
      if (
        centerT < START_OFFSET - segmentHeight ||
        centerT > START_OFFSET + usableLength + segmentHeight
      ) {
        sprite.visible = false
        continue
      }
      sprite.visible = true
      const cx = from.x + nx * centerT
      const cy = from.y + ny * centerT
      sprite.position.set(cx, cy)
      // Body image points up (-Y) at 0 rotation, so add 90° to align with vector.
      sprite.rotation = angle + Math.PI / 2
      sprite.scale.set(SEGMENT_SCALE)
      sprite.anchor.set(0.5, 0.5)

      // Opacity gradient: fade in near source, full in middle, fade out near head.
      // Normalize to 0-1 across usable
      const tn = (centerT - START_OFFSET) / Math.max(1, usableLength)
      let alpha: number
      if (tn < 0.18) alpha = tn / 0.18
      else if (tn > 0.78) alpha = (1 - tn) / 0.22
      else alpha = 1
      // Slight distance-based feather plus phase-driven shimmer.
      alpha = Math.max(0, Math.min(1, alpha))
      // Attenuate segments that are wrapping (near the seam) to hide pop.
      const distToSeam = Math.min(
        centerT - START_OFFSET,
        START_OFFSET + usableLength - centerT
      )
      if (distToSeam < 8) alpha *= distToSeam / 8
      sprite.alpha = alpha * 0.96 + 0.04
    }
  }

  private setActiveSegments(count: number): void {
    while (this.segmentPool.length < count) {
      if (!this.bodyTexture) break
      const sprite = new Sprite(this.bodyTexture)
      sprite.anchor.set(0.5)
      sprite.eventMode = 'none'
      sprite.label = `game.attack-segment:${this.segmentPool.length}`
      sprite.scale.set(SEGMENT_SCALE)
      this.segmentPool.push(sprite)
      this.bodyLayer.addChild(sprite)
    }
    for (let index = 0; index < this.segmentPool.length; index += 1) {
      const sprite = this.segmentPool[index]
      if (!sprite) continue
      sprite.visible = index < count
      if (index < count) sprite.alpha = 1
    }
  }

  private startTick(): void {
    if (this.ticking) return
    this.ticking = true
    gsap.ticker.add(this.onTick)
  }

  private stopTick(): void {
    if (!this.ticking) return
    this.ticking = false
    gsap.ticker.remove(this.onTick)
  }

  /** Clips animated tiles at the caller-provided body endpoint. */
  private updateMask(from: LinePoint, nx: number, ny: number, endT: number): void {
    if (!this.bodyTexture) return
    const halfWidth = (this.bodyTexture.width * SEGMENT_SCALE) / 2 + 2
    const px = -ny * halfWidth
    const py = nx * halfWidth
    const startX = from.x + nx * START_OFFSET
    const startY = from.y + ny * START_OFFSET
    const endX = from.x + nx * endT
    const endY = from.y + ny * endT

    this.bodyMask.clear()
    this.bodyMask
      .poly([
        startX + px,
        startY + py,
        endX + px,
        endY + py,
        endX - px,
        endY - py,
        startX - px,
        startY - py
      ])
      .fill({ color: 0xffffff })
  }

  private clearMask(): void {
    this.bodyMask.clear()
  }
}
