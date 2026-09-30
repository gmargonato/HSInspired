import { Container, Filter, Rectangle, Sprite, type Texture } from 'pixi.js'
import type { GodRaysDustTuning } from '../../desktop/contracts/ipc/god-rays-dust-tuning'
import type { GodRaysEffect } from './god-rays-filter'
import { godRaysVertex, godRaysDustFragment } from './god-rays-shader'
import { GodRaysDustModel } from './god-rays-dust-model'
import { GAME_WIDTH, GAME_HEIGHT } from '../layout'

export class GodRaysDust extends Container {
  private readonly model: GodRaysDustModel
  private readonly sprites: Sprite[] = []
  private readonly light: Filter
  private tuning: GodRaysDustTuning
  private active = true

  constructor(
    private readonly textures: readonly [Texture, Texture],
    rays: GodRaysEffect,
    tuning: GodRaysDustTuning
  ) {
    super()
    this.label = 'god-rays.dust'
    this.eventMode = 'none'
    this.interactiveChildren = false
    // Fixed full-canvas bounds align this filter's UVs with the ray overlay.
    this.boundsArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.tuning = tuning
    this.model = new GodRaysDustModel(tuning)
    this.light = Filter.from({
      gl: {
        vertex: godRaysVertex,
        fragment: godRaysDustFragment,
        name: 'god-rays-dust',
        preferredFragmentPrecision: 'highp'
      },
      blendMode: tuning.blendMode,
      resolution: 1,
      padding: 0,
      clipToViewport: false,
      resources: {
        // Share the actual uniforms so light geometry, color, and time cannot drift.
        godRaysUniforms: rays.filter.resources.godRaysUniforms,
        dustUniforms: { uDustBrightness: { value: tuning.brightness, type: 'f32' } }
      }
    })
    this.filters = [this.light]
    this.setTuning(tuning)
  }

  setTuning(tuning: GodRaysDustTuning): void {
    this.tuning = tuning
    this.model.setTuning(tuning)
    this.setActive(this.active)
    this.light.blendMode = tuning.blendMode
    this.light.resources.dustUniforms.uniforms.uDustBrightness = tuning.brightness
    this.sync()
  }

  update(deltaMS: number): void {
    if (!this.active || !this.tuning.enabled) return
    this.model.update(deltaMS)
    this.sync()
  }

  setActive(active: boolean): void {
    this.active = active
    this.visible = active && this.tuning.enabled && this.tuning.count > 0
  }

  private sync(): void {
    while (this.sprites.length < this.model.particles.length) {
      const sprite = new Sprite({
        texture: this.textures[0],
        anchor: 0.5,
        blendMode: 'screen'
      })
      sprite.eventMode = 'none'
      sprite.label = 'god-rays.dust-particle'
      this.sprites.push(sprite)
      this.addChild(sprite)
    }
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i]
      const particle = this.model.particles[i]
      sprite.visible = !!particle
      if (!particle) continue
      sprite.texture = this.textures[particle.texture]
      sprite.position.set(particle.x, particle.y)
      sprite.width = sprite.height = particle.diameter
      sprite.alpha = particle.alpha
      sprite.rotation = particle.rotation
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return
    this.filters = null
    this.light.destroy()
    super.destroy(options)
  }
}
