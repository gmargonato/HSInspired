import { Container, Sprite, type Texture } from 'pixi.js'
import type { OpeningMatchEvent } from '../../../game-rules/match'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { hasMinionLandingDust } from './minion-landing-dust'
import { MINION_LANDING_CRACKS_LAYOUT as CRACKS } from './minion-landing-cracks-layout'

export function hasMinionLandingCracks(event: OpeningMatchEvent): boolean {
  return (
    hasMinionLandingDust(event) &&
    'minion' in event &&
    event.minion.attack >= CRACKS.minimumAttack
  )
}

/** Independent board marks that never hold up the presentation queue. */
export class MinionLandingCracks extends Actor {
  constructor(private readonly texture: Texture) {
    super()
    this.label = 'game.minion-landing-cracks'
    this.eventMode = 'none'
  }

  play(x: number, y: number, scale: number): Container {
    const mark = new Container()
    mark.label = 'game.minion-landing-cracks-mark'
    mark.eventMode = 'none'
    mark.position.set(x, y)
    mark.scale.set(scale)
    const sprite = new Sprite(this.texture)
    sprite.label = 'game.minion-landing-cracks-image'
    sprite.blendMode = 'add'
    applyAnchoredPlacement(sprite, CRACKS.cracks)
    mark.addChild(sprite)
    mark.alpha = 0
    this.addChild(mark)
    const timeline = this.timeline({
      onComplete: () => mark.destroy({ children: true })
    })
    mark.once('destroyed', () => this.animationScope.cancel(timeline))
    timeline.to(
      mark,
      { alpha: 1, duration: CRACKS.appearDuration, ease: 'power1.out' },
      0
    )
    timeline.to(
      mark,
      { alpha: 0, duration: CRACKS.fadeDuration, ease: 'power1.inOut' },
      CRACKS.fadeStart
    )
    return mark
  }
}
