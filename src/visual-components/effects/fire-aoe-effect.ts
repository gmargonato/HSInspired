import { Container, RenderTexture, Sprite, Texture, type PointData } from 'pixi.js'
import type { FireAoeTuning } from '../../desktop/contracts/ipc/vfx-templates'
import { applyAnchoredPlacement, applyPlacement, type LayoutPlacement } from '../layout'
import { FIRE_AOE_LAYOUT as L, type FireAoeCoverage } from './fire-aoe-layout'
import { hexColorToRgb } from './fire-vfx-shader-common'
import {
  FireAoeComposite,
  FireAoeResources,
  FireImpactMesh,
  createFireBoardGlow
} from './fire-aoe-materials'
import {
  createFireParticles,
  createFireImpactParticles,
  fireAoeEnvelope,
  fireAoePhases,
  fireParticleAt,
  type FireParticle
} from './fire-aoe-particles'

export interface FireAoeTarget extends PointData {
  readonly kind: 'minion' | 'hero'
}

export interface FireAoeRequest {
  readonly area?: {
    readonly coverage: FireAoeCoverage
    readonly placement: LayoutPlacement
  }
  /** Snapshot of gameplay's visual targets, never inferred from coverage. */
  readonly targets: readonly FireAoeTarget[]
  readonly tuning: FireAoeTuning
  readonly intensity: number
  readonly seed?: number
}

/** One shared implementation for the match and VFX Lab; update accepts cast-local seconds. */
export class FireAoeEffect {
  readonly container = new Container()
  readonly duration: number
  private readonly area?: FireArea
  private readonly impacts: FireImpact[]
  private disposed = false

  constructor(
    resources: FireAoeResources,
    private readonly request: FireAoeRequest
  ) {
    this.container.label = 'fire-aoe.effect'
    this.container.eventMode = 'none'
    this.container.interactiveChildren = false
    if (request.area) {
      this.area = new FireArea(resources, request)
      this.container.addChild(this.area.container)
    }
    this.impacts = request.targets.flatMap((point, index) => {
      if (point.kind !== 'hero' && !request.tuning.minionImpacts) return []
      const impact = new FireImpact(
        resources,
        point,
        request.tuning,
        (request.seed ?? 1) + index * 97
      )
      this.container.addChild(impact.container)
      return [impact]
    })
    this.duration =
      Math.max(this.area?.end ?? 0, ...this.impacts.map((impact) => impact.end)) *
      request.tuning.timingScale
  }

  update(seconds: number): void {
    if (this.disposed) return
    const time = Math.max(0, seconds) / this.request.tuning.timingScale
    this.area?.update(time)
    for (const impact of this.impacts) impact.update(time)
    this.container.visible = seconds < this.duration
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.area?.dispose()
    for (const impact of this.impacts) impact.container.destroy({ children: true })
    this.container.removeFromParent()
    this.container.destroy({ children: true })
  }
}

class FireArea {
  readonly container = new Container()
  readonly end: number
  private readonly field = new Container()
  private readonly heat = RenderTexture.create({
    width: L.resolution,
    height: L.resolution,
    resolution: 1,
    scaleMode: 'linear'
  })
  private readonly composite: FireAoeComposite
  private readonly halo: FireAoeComposite
  private readonly glowFilter: ReturnType<typeof createFireBoardGlow>
  private readonly glow: Sprite
  private readonly dim: Sprite
  private readonly views: {
    readonly particle: FireParticle
    readonly sprite: Sprite | FireImpactMesh
  }[]
  private readonly worldScaleX: number
  private readonly worldScaleZ: number
  private readonly centerZ: number
  private readonly fieldEnd: number
  private readonly ramp?: RenderTexture
  private lastFieldTime = -1

  constructor(
    private readonly resources: FireAoeResources,
    private readonly request: FireAoeRequest
  ) {
    const area = request.area!
    const preset = L.presets[area.coverage]
    this.container.label = 'fire-aoe.area'
    applyPlacement(this.container, area.placement)
    this.worldScaleX = area.placement.size.width / preset.width
    this.worldScaleZ = area.placement.size.height / preset.depth
    this.centerZ = preset.centerZ
    this.field.label = 'fire-aoe.offscreen'
    const mask = resources.masks[area.coverage]
    this.dim = new Sprite({ texture: mask, anchor: 0.5 })
    this.dim.label = 'fire-aoe.board-light'
    this.dim.tint = 0
    this.dim.alpha = 0
    this.glow = new Sprite({ texture: mask, anchor: 0.5 })
    this.glow.label = 'fire-aoe.board-glow'
    const maskPlacement = L.boardMasks[area.coverage]
    for (const sprite of [this.dim, this.glow]) {
      applyAnchoredPlacement(sprite, maskPlacement)
      sprite.width = area.placement.size.width * maskPlacement.size.width
      sprite.height = area.placement.size.height * maskPlacement.size.height
    }
    const appearance = request.tuning.appearance
    this.glowFilter = createFireBoardGlow(appearance)
    const glowExtension =
      area.placement.size.height * (L.boardGlowDepthScale[area.coverage] - 1)
    this.glow.y += glowExtension / 2
    this.glow.height += glowExtension * maskPlacement.size.height
    // Keep the original mask's center and scale while reserving transparent
    // bounds for its feather. Otherwise the expanded glow clips at its old quad.
    const glowWidth = this.glow.width,
      glowHeight = this.glow.height
    this.glow.position.x += (0.5 - this.glow.anchor.x) * glowWidth
    this.glow.position.y += (0.5 - this.glow.anchor.y) * glowHeight
    this.glow.anchor.set(0.5)
    this.glow.width = glowWidth * L.boardGlowOverlap.far[0]
    this.glow.height = glowHeight * L.boardGlowOverlap.far[1]
    this.glowFilter.resources.glow.uniforms.uCoverageScale = [...L.boardGlowOverlap.far]
    this.glow.filters = [this.glowFilter]
    this.glow.alpha = 1
    this.container.addChild(this.dim, this.glow)

    this.ramp = appearance?.palette
      ? resources.createRamp(appearance.palette)
      : undefined
    const ramp = this.ramp ?? resources.assets.fireAoeColorRamp
    this.composite = new FireAoeComposite(this.heat, ramp, false, appearance)
    this.halo = new FireAoeComposite(this.heat, ramp, true, appearance)
    for (const [index, material] of [this.composite, this.halo].entries()) {
      const plane = new Sprite(Texture.WHITE)
      plane.label = index === 0 ? 'fire-aoe.fire-plane' : 'fire-aoe.screen-glow'
      applyAnchoredPlacement(plane, L.plane)
      // The original RT covers a square in world space, including on half-board casts.
      plane.width = L.worldSpan * this.worldScaleX
      plane.height = L.worldSpan * this.worldScaleZ
      plane.y = this.centerZ * this.worldScaleZ
      plane.filters = [material.filter]
      if (index === 1) plane.blendMode = 'add'
      this.container.addChild(plane)
    }
    const layers = {
      fire: new Container(),
      dark: new Container(),
      fieldSmoke: new Container()
    }
    for (const [kind, layer] of Object.entries(layers)) {
      layer.label = 'fire-aoe.field-' + kind
      this.field.addChild(layer)
    }
    const particles = createFireParticles(area.coverage, request.tuning, request.seed)
    this.end = Math.max(
      fireAoePhases(area.coverage).end,
      ...particles.map((p) => p.birth + p.life)
    )
    this.fieldEnd = Math.max(
      ...particles.filter(isFieldParticle).map((p) => p.birth + p.life)
    )
    this.views = particles.map((particle, index) => {
      const sprite = particleSprite(resources, particle, index, request.tuning)
      if (isFieldParticle(particle))
        layers[particle.kind as keyof typeof layers].addChild(sprite)
      else this.container.addChild(sprite)
      return { particle, sprite }
    })
  }

  update(time: number): void {
    const envelope = fireAoeEnvelope(time, this.request.area!.coverage)
    const tuning = this.request.tuning
    this.container.visible = time < this.end
    this.composite.update(
      envelope.alpha,
      this.request.intensity * envelope.intensity,
      tuning.rampIntensity,
      tuning.glow
    )
    this.halo.update(
      envelope.alpha * envelope.intensity,
      this.request.intensity,
      tuning.rampIntensity,
      tuning.glow
    )
    this.glowFilter.resources.glow.uniforms.uLevel =
      envelope.glow * Math.min(1, tuning.glow / 0.75)
    // Scene lighting and the final world-to-screen projection remain 2D adaptations.
    this.dim.alpha = envelope.dim * 0.16
    for (const { particle: p, sprite } of this.views) {
      sprite.visible = time >= p.birth && time < p.birth + p.life
      if (!sprite.visible) continue
      const state = fireParticleAt(p, time, tuning.motion)
      if (isFieldParticle(p)) {
        const scale = L.resolution / L.worldSpan
        sprite.position.set(
          L.resolution / 2 + state.x * scale,
          L.resolution / 2 - state.z * scale
        )
        sprite.width = sprite.height = state.size * scale
      } else {
        sprite.position.set(
          state.x * this.worldScaleX,
          (this.centerZ - state.z) * this.worldScaleZ -
            state.y * this.worldScaleX * L.billboardRise
        )
        // View-facing smoke/embers keep square proportions and rotate in screen space.
        sprite.width = sprite.height = state.size * this.worldScaleX
      }
      sprite.rotation = state.rotation
      applyParticleColor(sprite, p, state, tuning)
    }
    // Clear after the actual last field particle, not when the FSM changes state.
    if (this.lastFieldTime < this.fieldEnd || time < this.fieldEnd) {
      this.resources.renderer.render({
        container: this.field,
        target: this.heat,
        clear: true,
        clearColor: [0, 0, 0, 1]
      })
    }
    this.lastFieldTime = time
  }

  dispose(): void {
    for (const child of this.container.children) child.filters = null
    this.composite.destroy()
    this.halo.destroy()
    this.glowFilter.destroy()
    this.ramp?.destroy(true)
    this.field.destroy({ children: true })
    this.heat.destroy(true)
    this.container.destroy({ children: true })
  }
}

function isFieldParticle(p: FireParticle): boolean {
  return p.kind === 'fire' || p.kind === 'dark' || p.kind === 'fieldSmoke'
}
function particleSprite(
  resources: FireAoeResources,
  particle: FireParticle,
  index: number,
  tuning: FireAoeTuning
): Sprite | FireImpactMesh {
  const kind = particle.kind
  const texture =
    kind === 'fire'
      ? resources.wisps[particle.row]
      : kind === 'dark'
        ? resources.assets.fireAoeDarkWisp
        : kind === 'embers'
          ? resources.assets.fireAoeEmbers
          : kind === 'burst'
            ? resources.burst
            : kind === 'sparks'
              ? resources.spark
              : kind === 'smoke' && tuning.appearance?.smokeColor
                ? resources.smokeMask
                : resources.smoke
  const sprite =
    kind === 'burst' || kind === 'sparks'
      ? new FireImpactMesh(
          texture,
          kind === 'burst',
          tuning.appearance?.impactColor ?? tuning.appearance?.palette?.flame
        )
      : new Sprite({ texture, anchor: 0.5 })
  sprite.label = 'fire-aoe.' + kind + '-' + index
  sprite.blendMode =
    kind === 'fire' || kind === 'embers'
      ? 'add'
      : kind === 'dark'
        ? 'multiply'
        : 'normal'
  sprite.visible = false
  return sprite
}

class FireImpact {
  readonly container = new Container()
  readonly end: number
  private readonly views: { particle: FireParticle; sprite: Sprite | FireImpactMesh }[]
  constructor(
    resources: FireAoeResources,
    point: PointData,
    private readonly tuning: FireAoeTuning,
    seed: number
  ) {
    this.container.label = 'fire-aoe.target-impact'
    this.container.position.copyFrom(point)
    this.views = createFireImpactParticles(tuning, seed).map((particle, index) => {
      const sprite = particleSprite(resources, particle, index, tuning)
      this.container.addChild(sprite)
      return { particle, sprite }
    })
    this.end = Math.max(0, ...this.views.map(({ particle: p }) => p.birth + p.life))
    this.update(0)
  }
  update(time: number): void {
    for (const { particle: p, sprite } of this.views) {
      sprite.visible = time >= p.birth && time < p.birth + p.life
      if (!sprite.visible) continue
      const state = fireParticleAt(p, time, this.tuning.motion)
      const scale = L.impact.worldPixels
      const billboard = p.profile.renderMode !== 2
      sprite.position.set(
        state.x * scale,
        -state.z * scale - (billboard ? state.y * scale * L.billboardRise : 0)
      )
      sprite.width = sprite.height = state.size * scale
      sprite.rotation =
        p.profile.renderMode === 1
          ? Math.atan2(
              -p.direction[2] - p.direction[1] * L.billboardRise,
              p.direction[0]
            )
          : state.rotation
      applyParticleColor(sprite, p, state, this.tuning)
    }
  }
}

function applyParticleColor(
  sprite: Sprite | FireImpactMesh,
  particle: FireParticle,
  state: ReturnType<typeof fireParticleAt>,
  tuning: FireAoeTuning
): void {
  const appearance = tuning.appearance
  if (sprite instanceof FireImpactMesh) {
    sprite.setParticleColor(state.color)
  } else if (particle.kind === 'fire' || particle.kind === 'embers') {
    // Hero/Additive vertex output is 2 * _TintColor * particle color.
    const tint =
      particle.kind === 'fire'
        ? [0.29850745, 0.29850745, 0.29850745, 1]
        : [0.29850745, 0.16908465, 0, 0.50196081]
    sprite.tint = state.color.slice(0, 3).map((v, i) => Math.min(1, v * tint[i] * 2))
    const emberColor = appearance?.emberColor ?? appearance?.palette?.flame
    if (particle.kind === 'embers' && emberColor) {
      const brightness = Math.max(...state.color.slice(0, 3)) * 0.5970149
      sprite.tint = Array.from(hexColorToRgb(emberColor), (value) =>
        Math.min(1, value * brightness)
      )
    }
    sprite.alpha = Math.min(1, state.alpha * tint[3] * 2)
  } else {
    sprite.tint = state.tint
    sprite.alpha = state.alpha
    if (particle.kind === 'smoke') {
      if (appearance?.smokeColor) {
        const brightness = Math.max(...state.color.slice(0, 3))
        sprite.tint = Array.from(
          hexColorToRgb(appearance.smokeColor),
          (value) => value * brightness
        )
      }
      sprite.alpha *= appearance?.smokeOpacity ?? 1
    }
  }
}
