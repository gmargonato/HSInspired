import { Container, Sprite, type Renderer, type Texture } from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { createShatter } from '../../../visual-components/effects/shatter'
import { SHATTER_CONFIG } from '../../../visual-components/effects/outline-tuning'
import type { GameAssets } from '../../../visual-components/assets'
import { HeroView } from '../board/hero-view'
import { runScreenShake } from '../combat/screen-shake'
import { completeTimeline } from '../presentation/game-presentation-animation'
import { HERO_DESTRUCTION_LAYOUT as LAYOUT } from './hero-destruction-layout'

/** One coordinated burst, including both portraits for a draw. */
export class HeroDestruction {
  private readonly animations = new AnimationScope()
  private readonly effects: ReturnType<typeof createShatter>[] = []
  private readonly temporary: Container[] = []

  async play(
    renderer: Renderer,
    board: Container,
    heroes: readonly { view: HeroView; local: boolean }[],
    assets: GameAssets
  ): Promise<void> {
    const timeline = this.animations.timeline()
    const progress = { value: 0 }
    const frames: readonly Texture[] = [
      assets.heroPortraitCrack1,
      assets.heroPortraitCrack2,
      assets.heroPortraitCrack3,
      assets.heroPortraitCrack4,
      assets.heroPortraitCrack5,
      assets.heroPortraitCrack6
    ]
    const breakAt =
      (frames.length - 1) * LAYOUT.crackFrameDuration +
      LAYOUT.crackFadeDuration +
      LAYOUT.crackPeakHold
    let shake: Promise<void> | undefined
    try {
      for (const { view, local } of heroes) {
        const parent = view.parent
        if (!parent) continue
        const crater = new Sprite(
          local ? assets.destroyedLocal : assets.destroyedRemote
        )
        crater.label = 'game.hero-destruction.crater'
        crater.eventMode = 'none'
        applyAnchoredPlacement(crater, local ? LAYOUT.local : LAYOUT.remote)
        crater.position.copyFrom(view.position)
        crater.visible = false
        parent.addChild(crater)

        const portrait = view.createPortrait()
        portrait.position.copyFrom(view.position)
        portrait.scale.copyFrom(view.scale)
        portrait.rotation = view.rotation
        parent.addChild(portrait)
        this.temporary.push(portrait)
        view.visible = false
        const cracks: Sprite[] = []
        for (const [index, texture] of frames.entries()) {
          const crack = new Sprite(texture)
          crack.label = `game.hero-destruction.crack-${index + 1}`
          crack.eventMode = 'none'
          crack.blendMode = 'add'
          crack.alpha = 0
          applyAnchoredPlacement(crack, LAYOUT.crack)
          portrait.addChild(crack)
          cracks.push(crack)
          timeline.to(
            crack,
            { alpha: 1, duration: LAYOUT.crackFadeDuration, ease: 'sine.inOut' },
            index * LAYOUT.crackFrameDuration
          )
        }
        timeline.call(
          () => {
            for (const crack of cracks) crack.destroy()
            crater.visible = true
            try {
              this.effects.push(
                createShatter(
                  renderer,
                  portrait,
                  { ...SHATTER_CONFIG },
                  {
                    travelDistance:
                      LAYOUT.travelDistance / Math.max(Math.abs(view.scale.x), 0.01),
                    fadeStart: LAYOUT.fadeStart
                  }
                )
              )
            } catch (error) {
              console.warn('[HeroDestruction] snapshot failed; fading portrait', error)
              this.animations.to(portrait, { alpha: 0, duration: LAYOUT.burstFade })
            }
          },
          [],
          breakAt
        )

        const burst = new Sprite(assets.playSpotlight4)
        burst.label = 'game.hero-destruction.burst'
        burst.eventMode = 'none'
        applyAnchoredPlacement(burst, LAYOUT.burst)
        burst.position.copyFrom(view.position)
        burst.blendMode = 'add'
        burst.alpha = 0
        parent.addChild(burst)
        this.temporary.push(burst)
        timeline.to(burst, { alpha: 1, duration: LAYOUT.burstRise }, breakAt)
        timeline.to(
          burst,
          { alpha: 0, duration: LAYOUT.burstFade },
          breakAt + LAYOUT.burstRise
        )
        timeline.to(
          burst.scale,
          {
            x: LAYOUT.burstPeakScale,
            y: LAYOUT.burstPeakScale,
            duration: LAYOUT.burstFade,
            ease: 'power2.out'
          },
          breakAt
        )
      }
      timeline.call(
        () => {
          shake = runScreenShake(board, this.animations, LAYOUT.shake)
        },
        [],
        breakAt
      )
      const updateShards = (): void => {
        for (const effect of this.effects) effect.setProgress(progress.value)
      }
      // Open the fractures first so the silhouette reads before the outward burst.
      timeline.to(
        progress,
        {
          value: LAYOUT.fractureProgress,
          duration: LAYOUT.fractureDuration,
          ease: 'sine.in',
          onUpdate: updateShards
        },
        breakAt
      )
      timeline.to(
        progress,
        {
          value: 1,
          duration: LAYOUT.duration - LAYOUT.fractureDuration,
          ease: 'sine.out',
          onUpdate: updateShards
        },
        breakAt + LAYOUT.fractureDuration
      )
      await completeTimeline(timeline)
      await shake
    } finally {
      this.dispose()
    }
  }

  dispose(): void {
    this.animations.kill()
    for (const effect of this.effects.splice(0)) effect.dispose()
    for (const view of this.temporary.splice(0)) {
      if (!view.destroyed) view.destroy({ children: true })
    }
  }
}
