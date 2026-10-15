import { Container, Sprite, type Texture } from 'pixi.js'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { SUMMON_GLOW_LAYOUT as GLOW } from './summon-glow-layout'

/** Adds an entrance to the caller's shared, scene-owned timeline. */
export function appendSummonGlow(
  timeline: gsap.core.Timeline,
  layer: Container,
  texture: Texture,
  view: Container,
  scale: number,
  onReveal: () => void
): () => void {
  const glow = new Sprite(texture)
  applyAnchoredPlacement(glow, GLOW.glow)
  glow.label = 'game.summon-glow'
  glow.eventMode = 'none'
  glow.blendMode = 'add'
  glow.alpha = 0
  glow.position.copyFrom(layer.toLocal(view.toGlobal(GLOW.glow.position)))
  glow.scale.set(scale)
  layer.addChild(glow)
  view.alpha = 0
  timeline.to(glow, { alpha: 1, duration: GLOW.buildup, ease: 'power1.inOut' }, 0)
  timeline.call(
    () => {
      if (!view.destroyed) onReveal()
    },
    [],
    GLOW.buildup
  )
  timeline.to(view, { alpha: 1, duration: GLOW.peak, ease: 'none' }, GLOW.buildup)
  timeline.to(
    glow,
    { alpha: 0, duration: GLOW.fade, ease: 'power1.inOut' },
    GLOW.buildup + GLOW.peak
  )
  return () => {
    if (!glow.destroyed) glow.destroy()
    if (!view.destroyed) view.alpha = 1
  }
}
