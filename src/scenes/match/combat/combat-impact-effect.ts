import { Container, Sprite } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import type { GameAssets } from '../../../visual-components/assets'
import {
  applyAnchoredPlacement,
  type LayoutPoint
} from '../../../visual-components/layout'
import { COMBAT_IMPACT_LAYOUT as LAYOUT } from './combat-impact-layout'
import type { DamageIndicatorView } from './damage-indicator-view'

type ImpactAnimations = Pick<AnimationScope, 'timeline' | 'cancel'>

/** Board-space particles keep their momentum when either combatant moves away. */
export function playCombatImpact(
  layer: Container,
  assets: GameAssets,
  animations: ImpactAnimations,
  contact: LayoutPoint,
  direction: LayoutPoint
): void {
  const effect = new Container()
  effect.label = 'game.combat-impact'
  effect.eventMode = 'none'
  effect.position.copyFrom(contact)
  effect.zIndex = 1050
  layer.addChild(effect)
  const timeline = animations.timeline()
  const finish = (): void => {
    if (!effect.destroyed) effect.destroy({ children: true })
  }
  effect.once('destroyed', () => animations.cancel(timeline))
  timeline.eventCallback('onComplete', finish)
  timeline.eventCallback('onInterrupt', finish)

  for (let i = 0; i < LAYOUT.flashCopies; i++) {
    const flash = new Sprite(assets.playSpotlight4)
    flash.label = `game.combat-impact.flash-${i}`
    applyAnchoredPlacement(flash, LAYOUT.flash)
    flash.rotation = LAYOUT.flashRotation
    flash.blendMode = 'add'
    effect.addChild(flash)
    timeline.to(
      flash,
      { alpha: 0, duration: LAYOUT.flashDuration, ease: 'power2.in' },
      0
    )
    timeline.to(
      flash.scale,
      {
        x: flash.scale.x * LAYOUT.flashExpansion,
        y: flash.scale.y * LAYOUT.flashExpansion,
        duration: LAYOUT.flashDuration,
        ease: 'power2.out'
      },
      0
    )
  }

  const tuning = LAYOUT.embers
  const angle = Math.atan2(direction.y, direction.x)
  const between = (min: number, max: number): number =>
    min + Math.random() * (max - min)
  for (let i = 0; i < tuning.count; i++) {
    const spark = new Sprite(assets.ghostSpotlight)
    spark.label = `game.combat-impact.ember-${i}`
    spark.anchor.copyFrom(tuning.anchor)
    spark.blendMode = 'add'
    spark.tint = tuning.tint
    spark.width = between(tuning.widthMin, tuning.widthMax)
    spark.height = between(tuning.lengthMin, tuning.lengthMax)
    const heading = angle + between(-tuning.coneHalfAngle, tuning.coneHalfAngle)
    // The triangle's tip points upward in the source texture.
    spark.rotation = heading + Math.PI / 2
    spark.position.set(
      between(-tuning.spawnRadius, tuning.spawnRadius),
      between(-tuning.spawnRadius, tuning.spawnRadius)
    )
    effect.addChild(spark)
    const distance = between(tuning.distanceMin, tuning.distanceMax)
    const duration = between(tuning.durationMin, tuning.durationMax)
    timeline.to(
      spark,
      {
        x: spark.x + Math.cos(heading) * distance,
        y: spark.y + Math.sin(heading) * distance,
        duration,
        ease: 'power1.out'
      },
      0
    )
    timeline.to(
      spark,
      {
        alpha: 0,
        duration: duration * 0.65,
        ease: 'power1.in'
      },
      duration * 0.35
    )
    timeline.to(
      spark.scale,
      {
        x: spark.scale.x * 0.35,
        y: spark.scale.y * 0.2,
        duration,
        ease: 'power1.in'
      },
      0
    )
  }
}

/** Attached behind the indicator so its glow follows the same return movement. */
export function addCombatDamageGlow(
  indicator: DamageIndicatorView,
  assets: GameAssets,
  animations: ImpactAnimations
): void {
  const glow = new Sprite(assets.heroPowerAura2)
  glow.label = 'game.damage-indicator.impact-glow'
  glow.eventMode = 'none'
  applyAnchoredPlacement(glow, LAYOUT.glow)
  glow.tint = LAYOUT.glowTint
  glow.blendMode = 'add'
  indicator.addChildAt(glow, 0)
  const timeline = animations.timeline()
  const finish = (): void => {
    if (!glow.destroyed) glow.destroy()
  }
  glow.once('destroyed', () => animations.cancel(timeline))
  timeline.to(glow, { alpha: 0, duration: LAYOUT.glowDuration, ease: 'power1.in' })
  timeline.eventCallback('onComplete', finish)
  timeline.eventCallback('onInterrupt', finish)
}
