import { Container, Sprite, type Texture } from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { applyPlacement } from '../../../visual-components/layout'
import { MINION_LAYOUT } from './minion-layout'

// Card_Play_Ally_Aura / FX_AuraGlow. See docs/minion-aura-reference.md.
export const MINION_AURA_PERIOD = 4
const LIFETIME = 2.5
const ALPHA_HOLD = 23928 / 65535
const EXPANSION_TANGENT = 2.10730242729187

/** Unity's two-key Hermite size curve and linear alpha gradient. */
export function minionAuraSample(seconds: number): { size: number; alpha: number } {
  const age = Math.max(0, seconds) % MINION_AURA_PERIOD
  if (age >= LIFETIME) return { size: 0, alpha: 0 }
  const t = age / LIFETIME
  return {
    size: (-2 * t + 3) * t * t + EXPANSION_TANGENT * t * (t - 1) ** 2,
    alpha: t <= ALPHA_HOLD ? 1 : (1 - t) / (1 - ALPHA_HOLD)
  }
}

/** One stationary additive particle per cycle, owned by its minion. */
export class MinionAuraEffect {
  readonly layer = new Container()
  private readonly glow: Sprite
  private readonly animations = new AnimationScope()
  private readonly clock = { seconds: 0 }
  private destroyed = false

  constructor(texture: Texture) {
    this.layer.label = 'minion.aura'
    this.layer.eventMode = 'none'
    this.layer.visible = false
    applyPlacement(this.layer, MINION_LAYOUT.aura)
    this.glow = new Sprite(texture)
    this.glow.label = 'minion.aura.glow'
    this.glow.eventMode = 'none'
    this.glow.anchor.set(0.5)
    this.glow.blendMode = 'add'
    // Hero/Additive/Additive: texture * vertexColor * 2 * _TintColor.
    // All RGB gains are below one, so Pixi tint + premultiplied add is equivalent.
    const brightness = 2 * (217 / 255)
    this.glow.tint = [
      brightness * 0.45490196347236633,
      brightness * 0.33707815408706665,
      brightness * 0.13201075792312622
    ]
    this.layer.addChild(this.glow)
    this.draw()
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed || enabled === this.layer.visible) return
    this.animations.kill()
    this.layer.visible = enabled
    this.clock.seconds = 0
    this.draw()
    if (!enabled) return
    this.animations.to(this.clock, {
      seconds: MINION_AURA_PERIOD,
      duration: MINION_AURA_PERIOD,
      repeat: -1,
      ease: 'none',
      onUpdate: () => this.draw()
    })
  }

  private draw(): void {
    const { size, alpha } = minionAuraSample(this.clock.seconds)
    this.glow.scale.set(
      (MINION_LAYOUT.aura.size.width * size) / this.glow.texture.width,
      (MINION_LAYOUT.aura.size.height * size) / this.glow.texture.height
    )
    // The source vertex shader doubles RGBA. SrcAlpha clamps to one when
    // blending to the board; the recovered texture's alpha is uniformly one.
    this.glow.alpha = Math.min(1, 2 * alpha)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.animations.kill()
    this.layer.destroy({ children: true })
  }
}
