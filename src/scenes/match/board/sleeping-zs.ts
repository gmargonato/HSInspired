import { Container, Text } from 'pixi.js'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { MINION_LAYOUT } from './minion-layout'

const SLEEPING_Z_COLOR = 0x3cff3c
const SLEEPING_Z_STROKE = 0x0f2a0f

/** Bright-green Zzz that spawns at the minion's top-right and drifts right while growing. */
export class SleepingZs extends Actor {
  private readonly container = new Container()
  private intervalId: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor() {
    super()
    this.container.label = 'minion.sleeping-zs'
    this.container.eventMode = 'none'
    this.addChild(this.container)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.spawnOne()
    this.intervalId = setInterval(
      () => this.spawnOne(),
      MINION_LAYOUT.sleepingZ.spawnIntervalMs
    )
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const child of [...this.container.children]) {
      this.killTweensOf(child)
      child.destroy()
    }
    this.container.removeChildren()
  }

  override dispose(): void {
    this.stop()
    super.dispose()
  }

  private spawnOne(): void {
    const { origin, baseFontSize, driftX, driftY, duration, startScale, endScale } =
      MINION_LAYOUT.sleepingZ
    const text = new Text({
      text: 'Z',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontWeight: 'bold',
        fontSize: baseFontSize,
        fill: SLEEPING_Z_COLOR,
        stroke: { color: SLEEPING_Z_STROKE, width: 6 },
        align: 'center'
      }
    })
    text.anchor.set(0.5)
    text.position.set(origin.x, origin.y)
    text.scale.set(startScale)
    text.alpha = 1
    text.eventMode = 'none'
    text.label = 'minion.sleeping-z'
    this.container.addChild(text)

    const targetX = origin.x + driftX
    const targetY = origin.y + driftY
    this.tweenTo(text, {
      x: targetX,
      duration,
      ease: 'power1.out'
    })
    this.tweenTo(text, {
      y: targetY,
      duration,
      ease: 'power1.out'
    })
    this.tweenTo(text.scale, {
      x: endScale,
      y: endScale,
      duration,
      ease: 'power1.out'
    })
    this.tweenTo(text, {
      alpha: 0,
      duration,
      ease: 'power1.in',
      onComplete: () => {
        if (!text.destroyed) text.destroy()
      }
    })
  }
}
