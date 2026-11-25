import { outlinedTextStyle } from '../../../visual-components/text-style'
import {
  Container,
  Rectangle,
  Sprite,
  Text,
  type Renderer,
  type Texture
} from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'
import { FATIGUE_LAYOUT } from './fatigue-layout'
import {
  CardMotionVisual,
  bodyMotionCorners,
  deckMotionCorners
} from '../presentation/card-motion-visual'

export type FatiguePresentationSide = 'local' | 'remote'

const FATIGUE_TIMING = {
  fadeIn: 0.18,
  pop: 0.28,
  hold: 1.15,
  fadeOut: 0.22,
  startScaleMultiplier: 0.82
} as const

/** Formats the authoritative fatigue amount without coupling presentation to rules. */
export function formatFatigueMessage(amount: number): string {
  return `Out of Cards! Take ${amount} damage.`
}

/** Full-screen, non-interactive fatigue card presented for one failed draw. */
export class FatigueView extends Container {
  private readonly frame: Sprite
  private readonly message: Text
  private readonly animations = new AnimationScope()
  private completion: (() => void) | null = null
  private flight: CardMotionVisual | null = null
  private paused = false

  constructor(texture: Texture) {
    super()
    this.label = 'game.fatigue'
    this.eventMode = 'none'
    this.visible = false
    applyPlacement(this, FATIGUE_LAYOUT.presentation.local)

    this.frame = new Sprite(texture)
    applyAnchoredPlacement(this.frame, FATIGUE_LAYOUT.frame)
    this.frame.label = 'game.fatigue.frame'
    this.frame.eventMode = 'none'
    this.addChild(this.frame)

    this.message = new Text({
      text: '',
      style: {
        ...outlinedTextStyle('fatigue', 34),
        fill: 0x2b1b12,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: FATIGUE_LAYOUT.message.size.width,
        lineHeight: 36
      }
    })
    applyAnchoredPlacement(this.message, FATIGUE_LAYOUT.message)
    this.message.label = 'game.fatigue.message'
    this.message.eventMode = 'none'
    this.addChild(this.message)
  }

  present(
    amount: number,
    side: FatiguePresentationSide,
    motion?: { renderer: Renderer; layer: Container; deck: Sprite; back: Texture }
  ): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    this.finishPresentation()
    if (this.paused) this.animations.pause()
    this.message.text = formatFatigueMessage(amount)
    const presentation = FATIGUE_LAYOUT.presentation[side]
    applyPlacement(this, presentation)
    this.visible = true
    this.alpha = 0

    const presentationScale = presentation.scale?.x ?? 1
    this.scale.set(
      presentationScale * (motion ? 1 : FATIGUE_TIMING.startScaleMultiplier)
    )
    if (motion) {
      this.alpha = 1
      const bounds = this.getLocalBounds(),
        frame = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
      this.flight = new CardMotionVisual(
        motion.renderer,
        motion.layer,
        this,
        motion.back,
        'fatigue',
        bodyMotionCorners(motion.layer, this, frame),
        {
          start: deckMotionCorners(motion.layer, motion.deck),
          remote: side === 'remote'
        }
      )
    }

    return new Promise((resolve) => {
      this.completion = resolve
      const timeline = this.animations.timeline()
      if (this.flight) {
        const flight = this.flight,
          clock = { seconds: 0 }
        timeline.to(clock, {
          seconds: flight.playback.duration,
          duration: flight.playback.duration,
          ease: 'none',
          onUpdate: () => flight.update(clock.seconds)
        })
        timeline.call(() => {
          flight.dispose()
          if (this.flight === flight) this.flight = null
        })
      } else {
        timeline.to(this, {
          alpha: 1,
          duration: FATIGUE_TIMING.fadeIn,
          ease: 'power2.out'
        })
        timeline.to(
          this.scale,
          {
            x: presentationScale,
            y: presentationScale,
            duration: FATIGUE_TIMING.pop,
            ease: 'back.out(1.5)'
          },
          0
        )
      }
      timeline.to(this, { alpha: 1, duration: FATIGUE_TIMING.hold })
      timeline.to(this, {
        alpha: 0,
        duration: FATIGUE_TIMING.fadeOut,
        ease: 'power2.in'
      })
      timeline.eventCallback('onComplete', () => this.finishPresentation())
    })
  }

  private finishPresentation(): void {
    this.animations.kill()
    this.flight?.dispose()
    this.flight = null
    this.visible = false
    const resolve = this.completion
    this.completion = null
    resolve?.()
  }

  pauseAnimations(): void {
    this.paused = true
    this.animations.pause()
  }

  resumeAnimations(): void {
    this.paused = false
    this.animations.resume()
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.finishPresentation()
    super.destroy(options)
  }
}
