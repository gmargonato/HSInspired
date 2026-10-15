import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import type { GameAssets } from '../../../visual-components/assets'
import {
  applyAnchoredPlacement,
  type LayoutPoint
} from '../../../visual-components/layout'
import {
  COMBAT_IMPACT_LAYOUT as LAYOUT,
  COMBAT_DAMAGE_REVEAL_DELAY
} from './combat-impact-layout'
import type { DamageIndicatorView } from './damage-indicator-view'

type ImpactAnimations = Pick<AnimationScope, 'timeline' | 'cancel'>

let previousFlashRotation: number | undefined

/** Shared by playback and loading so every flipbook frame is warmed. */
export function combatHitSparkFrames(assets: GameAssets): readonly Texture[] {
  return [
    assets.combatHitSpark1,
    assets.combatHitSpark2,
    assets.combatHitSpark3,
    assets.combatHitSpark4,
    assets.combatHitSpark5,
    assets.combatHitSpark6,
    assets.combatHitSpark7
  ]
}

/** A full-size sibling of the popping number, following the same character. */
export function addCombatDamageFlipbook(
  indicator: DamageIndicatorView,
  assets: GameAssets,
  animations: ImpactAnimations
): void {
  const frames = combatHitSparkFrames(assets)
  const flipbook = new Sprite(frames[0])
  flipbook.label = 'game.damage-indicator.hit-flipbook'
  flipbook.eventMode = 'none'
  flipbook.visible = false
  applyAnchoredPlacement(flipbook, LAYOUT.flipbook.placement)
  indicator.addChildAt(flipbook, 0)

  const timeline = animations.timeline()
  const finish = (): void => {
    if (!flipbook.destroyed) flipbook.destroy()
  }
  flipbook.once('destroyed', () => animations.cancel(timeline))
  for (const [index, texture] of frames.entries()) {
    timeline.call(
      () => {
        flipbook.texture = texture
        flipbook.visible = true
      },
      [],
      LAYOUT.flipbook.delay + index * LAYOUT.flipbook.frameDuration
    )
  }
  // Hold the final, nearly transparent frame for one complete frame interval.
  timeline.set(
    flipbook,
    { visible: false },
    LAYOUT.flipbook.delay + frames.length * LAYOUT.flipbook.frameDuration
  )
  timeline.eventCallback('onComplete', finish)
  timeline.eventCallback('onInterrupt', finish)
}

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

  const fullTurn = Math.PI * 2
  // Exclude nearby angles so consecutive hits always have a visible rotation change.
  const rotation =
    previousFlashRotation === undefined
      ? Math.random() * fullTurn
      : (previousFlashRotation +
          LAYOUT.flashMinRotationChange +
          Math.random() * (fullTurn - 2 * LAYOUT.flashMinRotationChange)) %
        fullTurn
  previousFlashRotation = rotation

  for (let i = 0; i < LAYOUT.flashCopies; i++) {
    const flash = new Sprite(assets.combatHitSpark)
    flash.label = `game.combat-impact.flash-${i}`
    applyAnchoredPlacement(flash, LAYOUT.flash)
    flash.rotation = rotation
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
    spark.visible = false
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
    timeline.set(spark, { visible: true }, COMBAT_DAMAGE_REVEAL_DELAY)
    timeline.to(
      spark,
      {
        x: spark.x + Math.cos(heading) * distance,
        y: spark.y + Math.sin(heading) * distance,
        duration,
        ease: 'power1.out'
      },
      COMBAT_DAMAGE_REVEAL_DELAY
    )
    timeline.to(
      spark,
      {
        alpha: 0,
        duration: duration * 0.65,
        ease: 'power1.in'
      },
      COMBAT_DAMAGE_REVEAL_DELAY + duration * 0.35
    )
    timeline.to(
      spark.scale,
      {
        x: spark.scale.x * 0.35,
        y: spark.scale.y * 0.2,
        duration,
        ease: 'power1.in'
      },
      COMBAT_DAMAGE_REVEAL_DELAY
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
  indicator.content.addChildAt(glow, 0)
  const timeline = animations.timeline()
  const finish = (): void => {
    if (!glow.destroyed) glow.destroy()
  }
  glow.once('destroyed', () => animations.cancel(timeline))
  timeline.to(
    glow,
    { alpha: 0, duration: LAYOUT.glowDuration, ease: 'power1.in' },
    COMBAT_DAMAGE_REVEAL_DELAY
  )
  timeline.eventCallback('onComplete', finish)
  timeline.eventCallback('onInterrupt', finish)
}
