import { Sprite, type Texture } from 'pixi.js'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { TARGETING_ARROW_HEAD } from '../../../visual-components/controls/cursor'
import { completeTimeline } from '../presentation/game-presentation-animation'
import { REMOTE_TIMING } from '../presentation/game-presentation-timing'
import { AttackLine, type LinePoint } from './attack-line'

export type RemoteTargetPoint = LinePoint

interface RemoteTargetVisual {
  readonly line: AttackLine
  readonly circle: Sprite
  readonly head: Sprite
}

/** Pixi-only targeting cue for a remote spell, kept visible before its effects resolve. */
export class RemoteTargetPreview extends Actor {
  private readonly visuals: RemoteTargetVisual[] = []
  private sequence = 0

  constructor(
    private readonly bodyTexture: Texture,
    private readonly headTexture: Texture,
    private readonly circleTexture: Texture
  ) {
    super()
    this.label = 'game.remote-target-preview'
    this.eventMode = 'none'
    this.visible = false
  }

  async present(
    from: RemoteTargetPoint,
    targets: readonly RemoteTargetPoint[]
  ): Promise<void> {
    const sequence = ++this.sequence
    this.clear()
    if (this.destroyed || targets.length === 0) return

    for (const [index, target] of targets.entries()) {
      const line = new AttackLine()
      line.label = `game.remote-target-preview.line:${index}`
      line.setBodyTexture(this.bodyTexture)
      line.setEndpoints(from, this.bodyEnd(from, target))

      const head = new Sprite(this.headTexture)
      head.anchor.set(
        TARGETING_ARROW_HEAD.tipX / TARGETING_ARROW_HEAD.width,
        TARGETING_ARROW_HEAD.tipY / TARGETING_ARROW_HEAD.height
      )
      head.position.set(target.x, target.y)
      head.rotation = Math.atan2(target.y - from.y, target.x - from.x) + Math.PI / 2
      head.eventMode = 'none'
      head.label = `game.remote-target-preview.head:${index}`

      const circle = new Sprite(this.circleTexture)
      circle.anchor.set(0.5)
      circle.position.set(target.x, target.y - 10)
      circle.eventMode = 'none'
      circle.label = `game.remote-target-preview.circle:${index}`

      this.addChild(line, circle, head)
      this.visuals.push({ line, circle, head })
    }

    this.alpha = 0
    this.visible = true
    const timeline = this.timeline()
    timeline.to(this, {
      alpha: 1,
      duration: REMOTE_TIMING.targetFadeIn,
      ease: 'power2.out'
    })
    timeline.to({}, { duration: REMOTE_TIMING.targetHold })
    timeline.to(this, {
      alpha: 0,
      duration: REMOTE_TIMING.targetFadeOut,
      ease: 'power1.in'
    })
    await completeTimeline(timeline)
    if (sequence === this.sequence && !this.destroyed) this.clear()
  }

  clear(): void {
    this.killAnimations()
    for (const visual of this.visuals) {
      visual.line.clear()
      visual.line.removeFromParent()
      visual.line.destroy({ children: true })
      visual.circle.removeFromParent()
      visual.circle.destroy()
      visual.head.removeFromParent()
      visual.head.destroy()
    }
    this.visuals.length = 0
    this.alpha = 1
    this.visible = false
  }

  override dispose(): void {
    this.sequence += 1
    this.clear()
    super.dispose()
  }

  private bodyEnd(
    from: RemoteTargetPoint,
    target: RemoteTargetPoint
  ): RemoteTargetPoint {
    const dx = target.x - from.x
    const dy = target.y - from.y
    const length = Math.hypot(dx, dy)
    if (length <= TARGETING_ARROW_HEAD.bodyEndInset) return target
    const inset = TARGETING_ARROW_HEAD.bodyEndInset
    return {
      x: target.x - (dx / length) * inset,
      y: target.y - (dy / length) * inset
    }
  }
}
