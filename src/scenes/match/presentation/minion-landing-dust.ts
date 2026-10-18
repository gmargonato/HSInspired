import { Container, Sprite, type Texture } from 'pixi.js'
import type { OpeningMatchEvent } from '../../../game-rules/match'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { MINION_LANDING_DUST_LAYOUT as DUST } from './minion-landing-dust-layout'

export function hasMinionLandingDust(event: OpeningMatchEvent): boolean {
  return (
    event.type === 'minion-played' ||
    (event.type === 'minion-summoned' && event.sourceZone === 'hand')
  )
}

/** Independent, board-anchored bursts; never hold up the presentation queue. */
export class MinionLandingDust extends Actor {
  constructor(private readonly textures: readonly Texture[]) {
    super()
    this.label = 'game.minion-landing-dust'
    this.eventMode = 'none'
  }

  play(x: number, y: number, scale: number, scaleY = scale): Container {
    const burst = new Container()
    burst.label = 'game.minion-landing-dust-burst'
    burst.position.set(x, y)
    burst.eventMode = 'none'
    this.addChild(burst)
    // Scale only the ellipse geometry; textures retain their native 1x size.
    const ring = new Container()
    ring.label = 'game.minion-landing-dust-ring'
    ring.y = DUST.centerY * scaleY
    burst.addChild(ring)
    burst.alpha = 0
    const phase = Math.random() * Math.PI * 2
    const puffs: { sprite: Sprite; angle: number }[] = []
    for (let index = 0; index < DUST.count; index++) {
      const sprite = new Sprite(
        this.textures[Math.floor(Math.random() * this.textures.length)]
      )
      sprite.label = 'game.minion-landing-dust-puff:' + index
      sprite.anchor.set(0.5)
      sprite.rotation = Math.random() * Math.PI * 2
      ring.addChild(sprite)
      puffs.push({
        sprite,
        angle: phase + (index * Math.PI * 2) / DUST.count
      })
    }
    const motion = { progress: 0 }
    const updateRing = (): void => {
      const expansion = 1 + (DUST.expansion - 1) * motion.progress
      for (const { sprite, angle } of puffs) {
        const vertical = Math.sin(angle)
        const radiusY = vertical > 0 ? DUST.bottomRadiusY : DUST.radiusY
        sprite.position.set(
          Math.cos(angle) * DUST.radiusX * expansion * scale,
          vertical * radiusY * expansion * scaleY
        )
      }
    }
    updateRing()
    const timeline = this.timeline({
      onComplete: () => burst.destroy({ children: true })
    })
    // All puffs share one expansion and opacity envelope, including cancellation.
    burst.once('destroyed', () => this.animationScope.cancel(timeline))
    timeline.to(
      motion,
      {
        progress: 1,
        duration: DUST.duration,
        ease: 'power2.out',
        onUpdate: updateRing
      },
      0
    )
    timeline.to(
      burst,
      {
        alpha: DUST.alpha,
        duration: DUST.appearDuration,
        ease: 'power1.out'
      },
      0
    )
    timeline.to(
      burst,
      {
        alpha: 0,
        duration: DUST.duration - DUST.appearDuration - DUST.holdDuration,
        ease: 'power1.inOut'
      },
      DUST.appearDuration + DUST.holdDuration
    )
    return burst
  }
}
