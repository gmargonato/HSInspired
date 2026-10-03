import type { Container } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'

const HEALTH_PULSE = {
  scale: 2,
  grow: 0.09,
  shrink: 0.15
} as const

/** Pulses a badge and its label together without accumulating scale on repeat hits. */
export function createHealthPulse(
  group: Container,
  animations: AnimationScope
): () => void {
  const baseScale = group.scale.clone()
  let active: ReturnType<AnimationScope['timeline']> | null = null
  const restore = (): void => {
    if (!group.destroyed) group.scale.copyFrom(baseScale)
    active = null
  }

  return () => {
    if (group.destroyed) return
    if (active) animations.cancel(active)
    restore()
    active = animations.timeline({ onComplete: restore, onInterrupt: restore })
    active.to(group.scale, {
      x: baseScale.x * HEALTH_PULSE.scale,
      y: baseScale.y * HEALTH_PULSE.scale,
      duration: HEALTH_PULSE.grow,
      ease: 'power2.out'
    })
    active.to(group.scale, {
      x: baseScale.x,
      y: baseScale.y,
      duration: HEALTH_PULSE.shrink,
      ease: 'power2.inOut'
    })
  }
}
