import {
  Container,
  Matrix,
  MeshPlane,
  RenderTexture,
  Rectangle,
  Shader,
  Sprite,
  type PointData,
  type Renderer
} from 'pixi.js'
import type { VfxTemplate } from '../../desktop/contracts/ipc/vfx-templates'
import { applyAnchoredPlacement } from '../layout'
import authored from './fireball-authored.json'
import { FIREBALL_LAYOUT as L } from './fireball-layout'
import {
  FIREBALL_MATERIALS,
  FireballCoreMesh,
  FireballParticleMesh,
  createFireballComposite,
  configureFireballAssets,
  type FireballAssets
} from './fireball-materials'
import {
  createFireballParticles,
  fireballParticleAt,
  fireballTravel,
  type FireballPhase,
  type FireballParticle
} from './fireball-particles'
import { hexColorToRgb } from './fire-vfx-shader-common'
import { fireballPathPoint } from './fireball-path'
import { createFireballTailFilter } from './fireball-tail-filter'

export type FireballTuning = Extract<VfxTemplate, { family: 'missile' }>['tuning']
interface Batch {
  phase: FireballPhase
  mesh: FireballParticleMesh
  particles: FireballParticle[]
  field: boolean
}

class FireballField {
  readonly content = new Container()
  readonly tailContent = new Container()
  readonly tailFilter?: ReturnType<typeof createFireballTailFilter>
  readonly display = new Container()
  readonly heat: RenderTexture
  readonly bloomCapture: RenderTexture
  readonly bloomHeat: RenderTexture
  readonly core?: FireballCoreMesh
  private readonly bloomPass: Sprite
  private readonly bloomTransform: Matrix
  private readonly planes: (Sprite | MeshPlane)[] = []
  private readonly curvedPlanes: { mesh: MeshPlane; positions: Float32Array }[] = []
  private readonly filters: ReturnType<typeof createFireballComposite>[] = []
  private readonly clearColor: [number, number, number, number]
  constructor(
    readonly phase: FireballPhase,
    assets: FireballAssets,
    private readonly renderer: Renderer,
    scale: number,
    tuning: FireballTuning
  ) {
    const layout = L[phase]
    // Zero alpha does not erase RGB from the native heat accumulation target.
    // Keep the recovered warm clear only for the original material palette.
    this.clearColor =
      tuning.useOriginalColors === false
        ? [
            ...(Array.from(hexColorToRgb(tuning.flameColor)).map(
              (channel) => channel * 0.45490196
            ) as [number, number, number]),
            0
          ]
        : [0.45490196, 0.25128558, 0.08384467, 0]
    this.content.label = 'fireball.' + phase + '.offscreen'
    this.display.label = 'fireball.' + phase + '.composite'
    // Unity RenderTextureFormat.Default (7) resolves to the clamped color target.
    // HDR accumulation changes both the fire color and the exponent-based opacity.
    this.heat = RenderTexture.create({
      ...layout.resolution,
      resolution: 1,
      format: 'rgba8unorm',
      antialias: false
    })
    const bloomSize = {
      width: Math.floor(layout.resolution.width * layout.bloom.resolutionRatio),
      height: Math.floor(layout.resolution.height * layout.bloom.resolutionRatio)
    }
    this.bloomCapture = RenderTexture.create({ ...bloomSize, resolution: 1 })
    this.bloomHeat = RenderTexture.create({ ...bloomSize, resolution: 1 })
    this.bloomTransform = new Matrix().scale(
      bloomSize.width / layout.resolution.width,
      bloomSize.height / layout.resolution.height
    )
    if (phase !== 'impact') {
      this.core = new FireballCoreMesh(
        assets,
        layout.resolution.width,
        layout.resolution.height,
        layout.cameraZ
      )
      this.core.shader!.resources.core.uniforms.uWorldSize = [
        layout.plane.size.width,
        layout.plane.size.height
      ]
      if (tuning.useOriginalColors === false) {
        this.core.shader!.resources.core.uniforms.uRecolor = 1
        this.core.shader!.resources.core.uniforms.uTint = hexColorToRgb(
          tuning.headSurfaceColor ?? tuning.edgeColor ?? tuning.flameColor
        )
        this.core.shader!.resources.core.uniforms.uFoldTint = hexColorToRgb(
          tuning.foldColor ?? tuning.edgeColor ?? tuning.flameColor
        )
      }
      this.content.addChild(this.core)
    }
    if (phase === 'missile') {
      this.tailContent.label = 'fireball.missile.tail'
      this.tailContent.boundsArea = new Rectangle(
        0,
        0,
        layout.resolution.width,
        layout.resolution.height
      )
      if ((tuning.tailMotion ?? 1) < 1) {
        this.tailFilter = createFireballTailFilter(tuning)
        this.tailContent.filters = [this.tailFilter]
      }
      this.content.addChild(this.tailContent)
    }
    const main = createFireballComposite('main', layout)
    main.resources.fireballComposite.uniforms.uIntensity =
      layout.intensity * tuning.intensity
    const bloom = [
      createFireballComposite('extract', layout),
      createFireballComposite('horizontal', layout),
      createFireballComposite('vertical', layout)
    ]
    bloom[0].resources.fireballComposite.uniforms.uBloom =
      (layout.bloom.intensity / (1 - layout.bloom.threshold)) *
      (tuning.missileGlow ?? 1)
    this.bloomPass = new Sprite(this.bloomCapture)
    this.bloomPass.label = 'fireball.' + phase + '.bloom-passes'
    this.bloomPass.filters = bloom
    this.bloomPass.blendMode = 'none'
    const bloomDisplay = createFireballComposite('bloom-display', layout)
    // Pixi's final filter owns the blend state; setting only Sprite.blendMode
    // would composite this glow normally and cover the brighter color plane.
    bloomDisplay.blendMode = 'add'
    this.filters.push(main, ...bloom, bloomDisplay)
    for (const [i, filters] of [[main], [bloomDisplay]].entries()) {
      const texture = i ? this.bloomHeat : this.heat
      const curved = phase === 'missile' && (tuning.pathCurvature ?? 0) !== 0
      const sprite = curved
        ? new MeshPlane({ texture, verticesX: 5, verticesY: 65 })
        : new Sprite(texture)
      sprite.label = 'fireball.' + phase + (i ? '.bloom' : '.color')
      if (sprite instanceof MeshPlane) {
        // Own the texture binding: Pixi's shared default mesh shader can retain
        // bindings to render textures after an effect has been disposed.
        sprite.shader = Object.assign(
          Shader.from({
            gl: {
              name: 'fireball-curved-plane',
              vertex: `in vec2 aPosition; in vec2 aUV; out vec2 vUV;
              uniform mat3 uProjectionMatrix,uWorldTransformMatrix,uTransformMatrix;
              void main(){vUV=aUV;gl_Position=vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0)).xy,0.0,1.0);}`,
              fragment: `in vec2 vUV; out vec4 finalColor; uniform sampler2D uArtwork;
              void main(){finalColor=texture(uArtwork,vUV);}`
            },
            resources: { uArtwork: texture.source }
          }),
          { texture }
        )
        const positions = sprite.geometry.positions
        for (let j = 0; j < positions.length; j += 2) {
          positions[j] =
            (positions[j] / texture.width - 0.5) * layout.plane.size.width * scale
          positions[j + 1] =
            (positions[j + 1] / texture.height - 0.5) *
              layout.plane.size.height *
              scale +
            layout.plane.position.y * scale
        }
        this.curvedPlanes.push({ mesh: sprite, positions: positions.slice() })
      } else {
        applyAnchoredPlacement(sprite, layout.plane)
        sprite.position.set(
          layout.plane.position.x * scale,
          layout.plane.position.y * scale
        )
        sprite.width = layout.plane.size.width * scale
        sprite.height = layout.plane.size.height * scale
      }
      sprite.filters = filters
      if (i) sprite.blendMode = 'add'
      this.planes.push(sprite)
      this.display.addChild(sprite)
    }
  }
  bend(head: number, distance: number, curvature: number): void {
    for (const { mesh, positions } of this.curvedPlanes) {
      const output = mesh.geometry.positions
      for (let i = 0; i < positions.length; i += 2) {
        const point = fireballPathPoint(
          positions[i],
          head - positions[i + 1],
          distance,
          curvature
        )
        output[i] = point.x
        output[i + 1] = point.y + head
      }
      mesh.geometry.getBuffer('aPosition').update()
    }
  }
  render(): void {
    this.renderer.render({
      container: this.content,
      target: this.heat,
      clear: true,
      clearColor: this.clearColor
    })
    this.renderer.render({
      container: this.content,
      target: this.bloomCapture,
      transform: this.bloomTransform,
      clear: true,
      clearColor: this.clearColor
    })
    this.renderer.render({
      container: this.bloomPass,
      target: this.bloomHeat,
      clear: true,
      clearColor: [0, 0, 0, 0]
    })
  }
  dispose(): void {
    this.tailContent.filters = null
    this.tailFilter?.destroy()
    this.tailContent.destroy({ children: true })
    for (const sprite of this.planes) sprite.filters = null
    for (const { mesh } of this.curvedPlanes) {
      const geometry = mesh.geometry
      const shader = mesh.shader
      mesh.removeFromParent()
      mesh.destroy()
      geometry.destroy(true)
      shader?.destroy()
    }
    this.curvedPlanes.length = 0
    for (const filter of this.filters) filter.destroy()
    this.bloomPass.filters = null
    this.bloomPass.destroy()
    this.content.destroy({ children: true })
    this.display.destroy({ children: true })
    this.heat.destroy(true)
    this.bloomCapture.destroy(true)
    this.bloomHeat.destroy(true)
  }
}

function multiplyQuaternion(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ]
}

/** Shared cast-local timeline: flight releases gameplay, while original particle tails finish. */
export class FireballEffect {
  readonly container = new Container()
  readonly duration: number
  readonly impactSeconds: number
  readonly launchSeconds: number
  private readonly flightRoot = new Container()
  private readonly impactRoot = new Container()
  private readonly missile: FireballField
  private readonly birth: FireballField
  private readonly impact: FireballField
  private readonly batches: Batch[] = []
  private readonly flash: FireballParticleMesh
  private readonly glow: FireballParticleMesh
  private readonly birthGlow: FireballParticleMesh
  private readonly scale: number
  private readonly distance: number
  private disposed = false
  private readonly fieldEnd: number
  private readonly impactEnd: number
  private readonly birthEnd: number

  constructor(
    renderer: Renderer,
    assets: FireballAssets,
    private readonly request: {
      source: PointData
      target: PointData
      tuning: FireballTuning
      seed?: number
      /** A caller that already presented the native Idle prefab can skip birth. */
      prewarmed?: boolean
    }
  ) {
    configureFireballAssets(assets)
    this.container.label = 'fireball.effect'
    this.container.eventMode = 'none'
    this.container.interactiveChildren = false
    this.container.sortableChildren = true
    this.impactRoot.sortableChildren = true
    this.container.position.copyFrom(request.source)
    const dx = request.target.x - request.source.x,
      dy = request.target.y - request.source.y
    this.container.rotation =
      Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) + Math.PI / 2 : 0
    this.scale = L.worldPixels * (request.tuning.missileWidth / 0.32)
    this.distance = Math.hypot(dx, dy) / this.scale
    this.launchSeconds = request.prewarmed
      ? 0
      : (request.tuning.launchDelayMs ?? L.birth.waitSeconds * 1000) / 1000
    const flight = request.tuning.durationMs / 1000
    this.impactSeconds = this.launchSeconds + flight
    this.birth = new FireballField(
      'birth',
      assets,
      renderer,
      this.scale,
      request.tuning
    )
    this.missile = new FireballField(
      'missile',
      assets,
      renderer,
      this.scale,
      request.tuning
    )
    this.impact = new FireballField(
      'impact',
      assets,
      renderer,
      this.scale,
      request.tuning
    )
    this.flightRoot.label = 'fireball.flight'
    this.impactRoot.label = 'fireball.impact'
    // RenderToTexture sets queue 200 + offset 3000, above ordinary particles (3000).
    this.flightRoot.zIndex = 200
    this.impactRoot.zIndex = 200
    this.impact.display.zIndex = 200
    this.flightRoot.addChild(this.missile.display)
    this.impactRoot.addChild(this.impact.display)
    this.impactRoot.y = -this.distance * this.scale
    this.container.addChild(this.flightRoot, this.impactRoot)
    this.birth.display.zIndex = 200
    this.container.addChild(this.birth.display)
    const birth = createFireballParticles('birth', this.launchSeconds, request.seed)
      // The native Birth prefab includes bursts at 3 and 4 seconds. Short casts
      // release this emitter at launch instead of leaving delayed source sparks.
      .filter(
        (particle) =>
          request.tuning.launchDelayMs === undefined ||
          this.launchSeconds >= L.birth.waitSeconds ||
          particle.birth < this.launchSeconds
      )
    const missile = createFireballParticles('missile', flight, request.seed)
    const impact = createFireballParticles('impact', flight, (request.seed ?? 1) + 1237)
    for (const [phase, particles] of [
      ['birth', birth],
      ['missile', missile],
      ['impact', impact]
    ] as const) {
      const groups = new Map<string, FireballParticle[]>()
      for (const particle of particles) {
        const list = groups.get(particle.name) ?? []
        list.push(particle)
        groups.set(particle.name, list)
      }
      for (const [name, particles] of groups) {
        const field = name.startsWith('FireParticle') || name === 'FireImpactRing'
        const mesh = new FireballParticleMesh(
          assets,
          particles[0].profile.material,
          particles.length
        )
        mesh.shader!.resources.fireball.uniforms.uNoiseScale =
          Number(FIREBALL_MATERIALS[particles[0].profile.material].values._Scale ?? 1) *
          request.tuning.noiseScale
        if (phase === 'missile' && field)
          mesh.shader!.resources.fireball.uniforms.uIrregularity = Math.max(
            1,
            request.tuning.tailMotion ?? 1
          )
        if (request.tuning.useOriginalColors === false) {
          mesh.shader!.resources.fireball.uniforms.uRecolor = 1
          mesh.shader!.resources.fireball.uniforms.uTint = hexColorToRgb(
            name === 'Smoke01' || name === 'BlastMark'
              ? (request.tuning.sootColor ?? '#1f130b')
              : name === 'Sparks01'
                ? request.tuning.coreColor
                : name === 'FireParticleLeft' || name === 'FireParticleRight'
                  ? (request.tuning.edgeColor ?? request.tuning.flameColor)
                  : request.tuning.flameColor
          )
        }
        if (field)
          (phase === 'missile'
            ? this.missile.tailContent
            : this[phase].content
          ).addChild(mesh)
        else if (phase !== 'impact') this.container.addChild(mesh)
        else this.impactRoot.addChild(mesh)
        this.batches.push({ phase, mesh, particles, field })
      }
    }
    this.flash = new FireballParticleMesh(assets, 'flash', 1)
    this.impact.content.addChild(this.flash)
    this.glow = new FireballParticleMesh(assets, 'glow', 1)
    this.missile.content.addChild(this.glow)
    this.birthGlow = new FireballParticleMesh(assets, 'glow', 1)
    this.birth.content.addChild(this.birthGlow)
    if (request.tuning.useOriginalColors === false) {
      for (const [mesh, color] of [
        [this.glow, request.tuning.glowColor ?? request.tuning.flameColor],
        [this.birthGlow, request.tuning.glowColor ?? request.tuning.flameColor],
        [this.flash, request.tuning.coreColor]
      ] as const) {
        mesh.shader!.resources.fireball.uniforms.uRecolor = 1
        mesh.shader!.resources.fireball.uniforms.uTint = hexColorToRgb(color)
      }
    }
    // Native sortingOrder places dark cutouts before the additive core, after particles.
    this.missile.content.addChild(this.missile.core!)
    this.birth.content.addChild(this.birth.core!)
    this.birthEnd =
      this.launchSeconds === 0
        ? 0
        : Math.min(
            this.launchSeconds + 1,
            Math.max(
              this.launchSeconds,
              ...birth
                .filter((p) => p.name === 'FireParticle')
                .map((p) => p.birth + p.life)
            )
          )
    this.fieldEnd =
      this.launchSeconds +
      Math.min(
        flight + 0.85,
        Math.max(
          flight + L.coreHideAfterImpact,
          ...missile
            .filter((p) => p.name.startsWith('FireParticle'))
            .map((p) => p.birth + p.life)
        )
      )
    this.impactEnd =
      this.launchSeconds +
      Math.max(
        flight + L.flash.fadeSeconds,
        ...impact
          .filter((p) => p.name === 'FireImpactRing')
          .map((p) => p.birth + p.life)
      )
    this.duration = Math.max(
      this.fieldEnd,
      this.impactEnd,
      this.birthEnd,
      ...birth.filter((p) => p.name !== 'FireParticle').map((p) => p.birth + p.life),
      ...missile.map((p) => this.launchSeconds + p.birth + p.life),
      ...impact.map((p) => this.launchSeconds + p.birth + p.life)
    )
    this.update(0)
  }

  update(seconds: number): void {
    if (this.disposed) return
    const elapsed = Math.max(0, seconds),
      t = elapsed - this.launchSeconds,
      flight = this.request.tuning.durationMs / 1000,
      head = this.distance * fireballTravel(t / flight),
      birthGrowth = Math.max(0.001, Math.min(L.birth.growthSeconds, this.launchSeconds))
    this.container.visible = elapsed < this.duration
    this.flightRoot.y = -head * this.scale
    this.missile.bend(
      head * this.scale,
      this.distance * this.scale,
      this.request.tuning.pathCurvature ?? 0
    )
    this.missile.display.visible = t >= 0 && elapsed < this.fieldEnd
    this.impact.display.visible = t >= flight && elapsed < this.impactEnd
    this.birth.display.visible = elapsed < this.birthEnd
    const core = this.missile.core!
    core.visible = t >= 0 && t < flight + L.coreHideAfterImpact
    const nativeHead = L.coreDiameter * L.worldPixels
    const growth = this.request.tuning.headGrowthMs ?? 0
    const diameter =
      growth > 0
        ? (this.request.tuning.headStartSize ?? nativeHead) +
          ((this.request.tuning.headEndSize ?? nativeHead) -
            (this.request.tuning.headStartSize ?? nativeHead)) *
            Math.max(0, Math.min(1, (t * 1000) / growth))
        : (this.request.tuning.headEndSize ?? nativeHead)
    core.shader!.resources.core.uniforms.uRadius = (0.3 * diameter) / nativeHead
    const irregularity = this.request.tuning.tailMotion ?? 1
    if (this.missile.tailFilter) {
      const uniforms = this.missile.tailFilter.resources.tail.uniforms
      uniforms.uIrregularity = irregularity
      uniforms.uLength = Math.min(head, this.request.tuning.missileLength / this.scale)
      uniforms.uRadius = Math.max(0.04, (diameter / L.worldPixels) * 0.3)
      uniforms.uLife =
        t >= 0 && head > 0.001 ? Math.max(0, 1 - Math.max(0, t - flight) / 0.35) : 0
    }
    for (const phase of ['birth', 'missile'] as const) {
      const phaseCore = this[phase].core!
      const phaseTime = phase === 'birth' ? elapsed : Math.max(0, t)
      if (phase === 'birth') {
        phaseCore.visible = elapsed > 0 && elapsed < this.launchSeconds
        phaseCore.shader!.resources.core.uniforms.uRadius =
          ((0.3 * diameter) / nativeHead) * Math.min(1, elapsed / birthGrowth)
      }
      for (const [i, node] of authored[phase].cores
        .filter((n) => n.name.startsWith('Core'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .entries()) {
        const speed = node.rotationSpeed!
        const axis = speed.findIndex((v) => v !== 0),
          q = [0, 0, 0, 1]
        const angle =
          ((speed[axis] * Math.PI) / 180) *
          phaseTime *
          this.request.tuning.flowSpeed *
          0.5
        q[axis] = Math.sin(angle)
        q[3] = Math.cos(angle)
        phaseCore.shader!.resources.core.uniforms['uQ' + i] = multiplyQuaternion(
          node.quaternion,
          q
        )
      }
    }
    for (const batch of this.batches) {
      const phase = batch.phase
      // A clean energy ribbon has no loose flame scraps, smoke or sparks.
      // Fade those supporting streams back in toward the original fire preset.
      batch.mesh.visible = phase !== 'missile' || batch.field || irregularity > 0
      const particleTime = phase === 'birth' ? elapsed : t
      const layout = L[phase],
        res = layout.resolution
      for (const [i, p] of batch.particles.entries()) {
        if (particleTime < p.birth || particleTime >= p.birth + p.life) {
          this.writeQuad(batch.mesh, i, 0, 0, 0, 0, 0, [0, 0, 0, 0])
          continue
        }
        const state = fireballParticleAt(p, particleTime, flight, this.distance)
        if (phase === 'missile' && !batch.field)
          state.color[3] *= Math.min(1, irregularity)
        state.position[0] +=
          this.request.tuning.turbulence *
          0.1 *
          Math.sin((particleTime - p.birth) * 5 + p.random * 6.28)
        let x = state.position[0],
          z = state.position[2]
        let size = state.size,
          rotation = state.rotation
        if (phase === 'missile' && batch.field && irregularity > 1) {
          const excess = irregularity - 1
          const behind = head - z
          // Coherent folds run along the plume; this changes its silhouette,
          // rather than only spinning textures inside nearly identical bounds.
          x +=
            excess *
            0.24 *
            Math.sin(behind * 4 - t * 9) *
            Math.min(1, Math.max(0, behind) / 0.6)
          size *=
            1 + excess * (0.2 + 0.25 * Math.sin(behind * 6 + t * 7 + p.random * 2))
        }
        if (batch.field) {
          if (phase === 'missile') z -= head
          x = (x / layout.plane.size.width + 0.5) * res.width
          z = (0.5 - (z - layout.cameraZ) / layout.plane.size.height) * res.height
          size *= res.width / layout.plane.size.width
        } else {
          x *= this.scale
          z = -z * this.scale
          size *= this.scale
        }
        if (p.profile.renderMode === 1) {
          rotation = Math.atan2(-state.velocity[2], state.velocity[0])
          this.writeQuad(
            batch.mesh,
            i,
            x,
            z,
            size,
            size * p.profile.lengthScale,
            rotation,
            state.visible ? state.color : [0, 0, 0, 0]
          )
        } else
          this.writeQuad(
            batch.mesh,
            i,
            x,
            z,
            size,
            size,
            rotation,
            state.visible ? state.color : [0, 0, 0, 0]
          )
      }
      if (phase === 'missile' && !batch.field && this.request.tuning.pathCurvature) {
        for (let i = 0; i < batch.mesh.positions.length; i += 2) {
          const point = fireballPathPoint(
            batch.mesh.positions[i],
            -batch.mesh.positions[i + 1],
            this.distance * this.scale,
            this.request.tuning.pathCurvature
          )
          batch.mesh.positions[i] = point.x
          batch.mesh.positions[i + 1] = point.y
        }
      }
      batch.mesh.upload()
    }
    const post = Math.max(0, t - flight),
      life = Math.min(1, post / L.flash.fadeSeconds)
    const fade = 1 - life * life * (3 - 2 * life)
    const scale =
      L.flash.startScale +
      (L.flash.endScale - L.flash.startScale) *
        (1 - (1 - Math.min(1, post / L.flash.scaleSeconds)) ** 2)
    const flashPixels = (scale * L.impact.resolution.width) / L.impact.plane.size.width
    this.writeQuad(this.flash, 0, 90, 90, flashPixels, flashPixels, 0, [
      1,
      1,
      1,
      t >= flight ? fade : 0
    ])
    this.flash.upload()
    const glowPixels = (2 * L.missile.resolution.width) / L.missile.plane.size.width
    this.writeQuad(
      this.glow,
      0,
      L.missile.resolution.width / 2,
      (0.5 + L.missile.cameraZ / L.missile.plane.size.height) *
        L.missile.resolution.height,
      glowPixels,
      glowPixels,
      0,
      [1, 1, 1, core.visible ? 1 : 0]
    )
    this.glow.upload()
    const birthGlowPixels =
      (L.birth.glowScale *
        Math.min(1, elapsed / birthGrowth) *
        L.birth.resolution.width) /
      L.birth.plane.size.width
    this.writeQuad(this.birthGlow, 0, 85, 85, birthGlowPixels, birthGlowPixels, 0, [
      1,
      1,
      1,
      elapsed < this.launchSeconds ? 1 : 0
    ])
    this.birthGlow.upload()
    if (this.birth.display.visible) this.birth.render()
    if (this.missile.display.visible) this.missile.render()
    if (this.impact.display.visible) this.impact.render()
  }
  private writeQuad(
    mesh: FireballParticleMesh,
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    color: readonly number[]
  ): void {
    const cos = Math.cos(rotation),
      sin = Math.sin(rotation)
    for (let corner = 0; corner < 4; corner++) {
      const sx = (corner === 0 || corner === 3 ? -0.5 : 0.5) * width,
        sy = (corner < 2 ? -0.5 : 0.5) * height
      mesh.positions[index * 8 + corner * 2] = x + cos * sx - sin * sy
      mesh.positions[index * 8 + corner * 2 + 1] = y + sin * sx + cos * sy
      mesh.colors.set(color, index * 16 + corner * 4)
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.container.removeFromParent()
    this.missile.display.removeFromParent()
    this.impact.display.removeFromParent()
    this.birth.display.removeFromParent()
    this.birth.dispose()
    this.missile.dispose()
    this.impact.dispose()
    this.container.destroy({ children: true })
  }
}
