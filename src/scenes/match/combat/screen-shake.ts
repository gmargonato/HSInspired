import type { Container } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import type { CombatImpactProfile } from './combat-impact'
import { completeTimeline } from '../presentation/game-presentation-animation'

const SHAKE_DIRECTIONS = [
  { x: 1, y: -0.25 },
  { x: -0.75, y: 0.55 },
  { x: 0.55, y: -0.75 },
  { x: -0.35, y: 0.3 },
  { x: 0.2, y: -0.15 }
] as const

/** Shared board shake; preserves the combat motion and restores on interruption. */
export async function runScreenShake(
  target: Container,
  animations: Pick<AnimationScope, 'timeline'>,
  profile: Pick<CombatImpactProfile, 'amplitude' | 'pulses' | 'duration'>
): Promise<void> {
  const baseX = target.x
  const baseY = target.y
  const stepDuration = profile.duration / (profile.pulses * 2)
  const timeline = animations.timeline()

  for (let index = 0; index < profile.pulses; index += 1) {
    const direction = SHAKE_DIRECTIONS[index % SHAKE_DIRECTIONS.length]
    timeline.to(target, {
      x: baseX + direction.x * profile.amplitude,
      y: baseY + direction.y * profile.amplitude,
      duration: stepDuration,
      ease: 'power1.out'
    })
    timeline.to(target, {
      x: baseX,
      y: baseY,
      duration: stepDuration,
      ease: 'power1.in'
    })
  }

  try {
    await completeTimeline(timeline)
  } finally {
    if (!target.destroyed) target.position.set(baseX, baseY)
  }
}
