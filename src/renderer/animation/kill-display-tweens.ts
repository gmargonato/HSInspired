import { Container } from 'pixi.js'
import { gsap } from './animations'

function collectTransformTargets(container: Container, targets: unknown[]): void {
  for (const child of container.children) {
    targets.push(child, child.scale, child.skew, child.pivot)
    collectTransformTargets(child, targets)
  }
}

/**
 * Finishes or kills every GSAP tween that targets the container, its
 * transform channels, or any of its descendants.
 *
 * Call this while the container is still alive, right before destroying it.
 * Completing tweens keeps their awaiters resolving; killing prevents GSAP
 * from later initializing a tween against a destroyed container, whose
 * position/scale channels are nulled by Pixi and would throw on every tick.
 */
export function killDisplayTweens(container: Container): void {
  const targets: unknown[] = [container]
  if (!container.destroyed) {
    targets.push(container.scale, container.skew, container.pivot)
    collectTransformTargets(container, targets)
  }
  for (const tween of gsap.getTweensOf(targets as gsap.TweenTarget[])) {
    if (
      tween
        .targets<Container>()
        .some((target) => target instanceof Container && target.destroyed)
    ) {
      tween.kill()
      continue
    }
    tween.progress(1).kill()
  }
}
