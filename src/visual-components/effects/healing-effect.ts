import {
  Buffer,
  BufferUsage,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Shader,
  Texture,
  type PointData
} from 'pixi.js'
import type { HealingAssets } from '../assets/healing-assets'
import type { HealingTuning } from '../../desktop/contracts/ipc/vfx-templates'
import raw from './healing-authored.json'
import { HEALING_LAYOUT as L } from './healing-layout'

interface Curve {
  mode: number
  min: number
  max: number
  lower: number[][]
  upper: number[][]
}
interface Gradient {
  rgb: number[][]
  alpha: number[][]
}
interface Color {
  mode: number
  min: number[]
  max: number[]
  lower: Gradient
  upper: Gradient
}
interface Profile {
  duration: number
  delay: Curve
  life: Curve
  size: Curve
  speed: Curve
  color: Color
  colorOverLife: Color | null
  sizeOverLife: Curve | null
  rate: Curve | null
  bursts: number[][]
  radius: number
  rotation: Curve
  spin: Curve | null
  actionRate?: number[][]
}
interface Node {
  name: string
  position: number[]
  scale: number[]
  mesh?: string
  spinY?: number
  materials?: string[]
  particle?: Profile
  trail?: { life: number; width: number; widthCurve?: number[][]; color: Gradient }
}
interface Material {
  shader: string
  floats: Record<string, number>
  colors: Record<string, number[]>
  textures: Record<string, { key: string; scale: number[]; offset: number[] }>
}
const authored = raw as unknown as {
  effects: Record<'mass' | 'target' | 'bloom', { nodes: Node[] }>
  materials: Record<string, Material>
  meshes: Record<string, { vertices: number[][]; indices: number[] }>
}
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const random = (seed: number) => {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return n - Math.floor(n)
}
function curveKeys(keys: number[][], t: number): number {
  if (!keys.length) return 1
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i]
    if (t > b[0]) continue
    const dt = b[0] - a[0],
      u = (t - a[0]) / dt
    return (
      (2 * u ** 3 - 3 * u * u + 1) * a[1] +
      (u ** 3 - 2 * u * u + u) * dt * a[3] +
      (-2 * u ** 3 + 3 * u * u) * b[1] +
      (u ** 3 - u * u) * dt * b[2]
    )
  }
  return keys[keys.length - 1][1]
}
function value(c: Curve, t: number, r: number): number {
  if (c.mode === 0) return c.max
  if (c.mode === 3) return c.min + (c.max - c.min) * r
  const high = c.max * curveKeys(c.upper, t)
  return c.mode === 2 ? c.max * curveKeys(c.lower, t) * (1 - r) + high * r : high
}
function gradient(g: Gradient, t: number): number[] {
  const sample = (keys: number[][], component: number) => {
    if (!keys.length) return 1
    for (let i = 1; i < keys.length; i++)
      if (t <= keys[i][0]) {
        const a = keys[i - 1],
          b = keys[i],
          u = clamp((t - a[0]) / (b[0] - a[0] || 1))
        return a[component] + (b[component] - a[component]) * u
      }
    return keys[keys.length - 1][component]
  }
  return [sample(g.rgb, 1), sample(g.rgb, 2), sample(g.rgb, 3), sample(g.alpha, 1)]
}
function color(c: Color, t: number, r: number): number[] {
  if (c.mode === 0) return c.max
  if (c.mode === 2) return c.max.map((v, i) => c.min[i] + (v - c.min[i]) * r)
  const high = gradient(c.upper, t)
  return c.mode === 3
    ? high.map((v, i) => gradient(c.lower, t)[i] * (1 - r) + v * r)
    : high
}

/** Batched textured quads preserve HDR RGB independently of texture alpha. */
class HealingMesh extends Mesh<MeshGeometry, Shader> {
  readonly positions: Float32Array
  readonly colors: Float32Array
  constructor(
    assets: HealingAssets,
    material: Material,
    count: number,
    tuning: HealingTuning,
    meshIndices?: number[],
    strokePixels = 0
  ) {
    const positions = new Float32Array(count * 8),
      colors = new Float32Array(count * 16),
      uvs = new Float32Array(count * 8),
      indices = new Uint32Array(count * 6)
    for (let i = 0; i < count; i++) {
      uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8)
      indices.set(
        [0, 1, 2, 0, 2, 3].map((v) => v + i * 4),
        i * 6
      )
    }
    const geometry = new MeshGeometry({
      positions,
      uvs,
      indices: meshIndices ? new Uint32Array(meshIndices) : indices
    })
    geometry.batchMode = 'no-batch'
    geometry.addAttribute('aColor', {
      buffer: new Buffer({
        data: colors,
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
      }),
      format: 'float32x4',
      stride: 16,
      offset: 0
    })
    const texture = assets[material.textures._MainTex?.key] ?? Texture.WHITE,
      fx = assets[material.textures._FxTex?.key] ?? texture
    const tint = Number.parseInt(tuning.tint.slice(1), 16)
    const shader = Shader.from({
      gl: {
        name: 'healing-material',
        vertex: `in vec2 aPosition,aUV;in vec4 aColor;out vec2 vUV;out vec4 vColor;
      uniform mat3 uProjectionMatrix,uWorldTransformMatrix,uTransformMatrix;
      void main(){vUV=aUV;vColor=aColor;gl_Position=vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.)).xy,0.,1.);}`,
        fragment: `in vec2 vUV;in vec4 vColor;out vec4 finalColor;uniform sampler2D uMain,uFx;
      uniform vec4 uColor,uScroll;uniform vec3 uTint;uniform vec2 uStroke;uniform float uTime,uIntensity,uHasFx,uFxIntensity,uRecolor,uAddMultiply;
      void main(){vec4 tex=texture(uMain,vUV);
      if(uStroke.x>0.){
        tex=max(tex,texture(uMain,vUV+vec2(uStroke.x,0.)));
        tex=max(tex,texture(uMain,vUV-vec2(uStroke.x,0.)));
        tex=max(tex,texture(uMain,vUV+vec2(0.,uStroke.y)));
        tex=max(tex,texture(uMain,vUV-vec2(0.,uStroke.y)));
      }
      vec3 rgb=tex.rgb/max(tex.a,.00001)*uColor.rgb*vColor.rgb*uIntensity;
      float opacity=vColor.a;
      if(uHasFx>.5)rgb*=texture(uFx,fract(vUV*uScroll.xy+uScroll.zw*uTime/20.)).rgb*uFxIntensity;
      if(uAddMultiply<.5)rgb*=tex.a*uColor.a;else rgb*=2.;
      if(uRecolor>.5)rgb=uTint*max(max(rgb.r,rgb.g),rgb.b);
      finalColor=vec4(clamp(rgb*opacity,0.,1.),0.);}`
      },
      resources: {
        uMain: texture.source,
        uFx: fx.source,
        healing: {
          uStroke: {
            value: [strokePixels / texture.width, strokePixels / texture.height],
            type: 'vec2<f32>'
          },
          uColor: {
            value: material.colors._TintColor ?? material.colors._Color ?? [1, 1, 1, 1],
            type: 'vec4<f32>'
          },
          uScroll: {
            value: [
              material.floats._ScaleX ?? 1,
              material.floats._ScaleY ?? 1,
              material.floats._ScrollX ?? 0,
              material.floats._ScrollY ?? 0
            ],
            type: 'vec4<f32>'
          },
          uTint: {
            value: [
              ((tint >> 16) & 255) / 255,
              ((tint >> 8) & 255) / 255,
              (tint & 255) / 255
            ],
            type: 'vec3<f32>'
          },
          uTime: { value: 0, type: 'f32' },
          uIntensity: {
            value: (material.floats._Intensity ?? 1) * tuning.intensity * L.exposure,
            type: 'f32'
          },
          uHasFx: { value: material.textures._FxTex ? 1 : 0, type: 'f32' },
          uFxIntensity: { value: material.floats._FxIntensity ?? 1, type: 'f32' },
          uRecolor: { value: tuning.originalColors ? 0 : 1, type: 'f32' },
          uAddMultiply: {
            value: material.shader.includes('AddMultiply') ? 1 : 0,
            type: 'f32'
          }
        }
      }
    })
    super({ geometry, shader, texture })
    this.positions = positions
    this.colors = colors
    this.blendMode = 'normal'
    this.label = 'healing.particles'
    this.eventMode = 'none'
  }
  quad(
    i: number,
    x: number,
    y: number,
    w: number,
    h: number,
    rotation: number,
    rgba: number[],
    projectedRotation = false
  ): void {
    const c = Math.cos(rotation),
      s = Math.sin(rotation)
    for (let j = 0; j < 4; j++) {
      const dx = ([-1, 1, 1, -1][j] * w) / 2,
        dy = ([-1, -1, 1, 1][j] * h) / 2
      this.positions[i * 8 + j * 2] =
        x + dx * c - dy * s * (projectedRotation && h ? w / h : 1)
      this.positions[i * 8 + j * 2 + 1] =
        y + dx * s * (projectedRotation && w ? h / w : 1) + dy * c
      this.colors.set(rgba, i * 16 + j * 4)
    }
  }
  upload(t: number): void {
    this.shader!.resources.healing.uniforms.uTime = t
    this.geometry.getBuffer('aPosition').update()
    this.geometry.getBuffer('aColor').update()
  }
  dispose(): void {
    this.geometry.destroy(true)
    this.shader!.destroy()
    this.destroy()
  }
}

export interface HealingArea extends PointData {
  width: number
  height: number
}
export interface HealingEffectOptions {
  family: 'heal-aoe' | 'heal-target'
  tuning: HealingTuning
  areas?: readonly HealingArea[]
  recipients?: readonly (PointData & { kind?: 'hero' | 'minion' })[]
  source?: PointData
  target?: PointData
}
interface Stream {
  kind: 'mass' | 'target' | 'bloom'
  maximumSize: number
  mesh: HealingMesh
  node: Node
  births: number[]
  center: PointData
  sx: number
  sy: number
  offset: number
  moving: boolean
}

/** Two healing families with a shared independently playable recipient bloom. */
export class HealingEffect {
  readonly container = new Container()
  readonly duration: number
  readonly impactSeconds: number
  private readonly streams: Stream[] = []
  private readonly trails: { mesh: HealingMesh; node: Node }[] = []
  private readonly spirals: {
    mesh: HealingMesh
    vertices: number[][]
    area: HealingArea
  }[] = []
  private dead = false
  private readonly travel: number
  constructor(
    assets: HealingAssets,
    private readonly options: HealingEffectOptions
  ) {
    this.container.label = 'healing.effect'
    this.container.eventMode = 'none'
    const { tuning, source, target } = options
    this.travel =
      options.family === 'heal-target' &&
      !tuning.bloomOnly &&
      source &&
      target &&
      Math.hypot(target.x - source.x, target.y - source.y) > 1
        ? L.travelSeconds
        : 0
    this.impactSeconds =
      (options.family === 'heal-aoe'
        ? L.impactSeconds
        : this.travel + L.impactSeconds) * tuning.timingScale
    this.duration =
      (options.family === 'heal-aoe' ? L.bloomSeconds : this.travel + L.bloomSeconds) *
      tuning.timingScale
    const add = (
      kind: 'mass' | 'target' | 'bloom',
      center: PointData,
      sx: number,
      sy: number,
      offset: number,
      parent: Container
    ) => {
      for (const node of authored.effects[kind].nodes) {
        // One fixed source glow, never repeated along the missile's flight path.
        const sourceGlow = kind === 'target' && node.name === 'fx_glow'
        const p = node.particle,
          material = node.materials?.[0] && authored.materials[node.materials[0]]
        if (!p || !material || !material.textures._MainTex) continue
        const decorative =
          /mote|star/i.test(node.name) && !/large|fx_star$/.test(node.name)
        const head = kind === 'target' && node.name === 'fx_star'
        const density = decorative
          ? tuning.density *
            (kind === 'target' ? L.missileSparkDensity * tuning.trailDensity : 1)
          : 1
        const births: number[] = []
        for (const [time, count] of p.bursts)
          for (let i = 0; i < Math.min(96, Math.round(count * density)); i++)
            births.push(time)
        const rate = p.rate ? Math.max(0, value(p.rate, 0, 0.5)) * density : 0
        const emission = Math.min(p.duration, kind === 'target' ? this.travel : 0.6)
        if (p.actionRate) {
          let emitted = 0
          for (let time = 0; time < emission; time += 1 / 120) {
            emitted += (Math.max(0, curveKeys(p.actionRate, time)) * density) / 120
            while (births.length < Math.min(96, Math.floor(emitted))) births.push(time)
          }
        } else
          for (let i = 0; i < Math.min(96, Math.ceil(emission * rate)); i++)
            births.push(i / rate)
        if (head || sourceGlow) births.splice(0, births.length, 0)
        if (!births.length) continue
        const life = Math.max(0.01, value(p.life, 0, 0.5))
        const overlap = decorative
          ? 1
          : Math.max(
              1,
              ...births.map(
                (birth) => births.filter((b) => b <= birth && b > birth - life).length
              )
            )
        const ground = /Shockwave|afterGlow|wave|runeCircle|rings/.test(node.name)
        const gain =
          kind === 'mass'
            ? node.name === 'Shockwave'
              ? L.massWaveGain
              : ground
                ? L.massGroundGain
                : L.massRaysGain
            : kind === 'bloom' && /rays_core|afterGlow|beam/.test(node.name)
              ? L.bloomCoreGain
              : 1
        // Unity's expanding shockwave reaches ~20 units, while its glow reaches 6.
        // Fit each surface layer at its authored maximum, not its initial size.
        const maximumSize =
          p.size.max *
          (p.sizeOverLife
            ? p.sizeOverLife.max * Math.max(1, ...p.sizeOverLife.upper.map((k) => k[1]))
            : 1)
        const surfaceScale =
          kind === 'mass' && ground ? L.waveDiameter / Math.max(1, maximumSize) : 1
        const mesh = new HealingMesh(
          assets,
          material,
          births.length,
          kind === 'target'
            ? {
                ...tuning,
                intensity:
                  (tuning.intensity *
                    (sourceGlow
                      ? L.sourceGlowGain
                      : decorative
                        ? L.missileSparkGain
                        : 1)) /
                  L.exposure
              }
            : {
                ...tuning,
                intensity:
                  (tuning.intensity *
                    gain *
                    (kind === 'bloom'
                      ? tuning.bloomStrength *
                        (options.family === 'heal-target' ? L.targetBloomGain : 1)
                      : 1)) /
                  Math.sqrt(overlap)
              },
          undefined,
          kind === 'bloom' && ground && options.family === 'heal-target'
            ? L.targetRingStroke
            : 0
        )
        parent.addChild(mesh)
        this.streams.push({
          kind,
          maximumSize,
          mesh,
          node,
          births,
          center,
          sx: sx * surfaceScale,
          sy: sy * surfaceScale,
          offset,
          moving: kind === 'target' && !sourceGlow
        })
      }
    }
    if (options.family === 'heal-aoe') {
      for (const footprint of options.areas ?? []) {
        // Healing spreads beyond the minion row; recipient blooms stay at their targets.
        const area = {
          ...footprint,
          width: footprint.width * L.massCoverageWidth,
          height: footprint.height * L.massCoverageDepth
        }
        const group = new Container(),
          mask = new Graphics()
            .rect(
              area.x - area.width / 2,
              area.y - area.height / 2,
              area.width,
              area.height
            )
            .fill(0xffffff)
        group.label = 'healing.wave'
        mask.label = 'healing.coverage-mask'
        this.container.addChild(group, mask)
        group.mask = mask
        for (const node of authored.effects.mass.nodes) {
          if (!node.mesh || !node.materials) continue
          const shape = authored.meshes[node.mesh]
          const mesh = new HealingMesh(
            assets,
            authored.materials[node.materials[0]],
            Math.ceil(shape.vertices.length / 4),
            tuning,
            shape.indices
          )
          mesh.label = 'healing.spiral'
          group.addChild(mesh)
          this.spirals.push({ mesh, vertices: shape.vertices, area })
        }
        add(
          'mass',
          area,
          (area.width / L.waveDiameter) * tuning.waveScale,
          (area.height / L.waveDiameter) * tuning.waveScale,
          0,
          group
        )
      }
      for (const recipient of options.recipients ?? [])
        add(
          'bloom',
          recipient,
          L.massBloomUnit *
            tuning.bloomScale *
            (recipient.kind === 'hero' ? L.heroBloomScale : 1),
          L.massBloomUnit *
            tuning.bloomScale *
            (recipient.kind === 'hero' ? L.heroBloomScale : 1),
          0,
          this.container
        )
    } else if (target) {
      if (this.travel) {
        add('target', source!, L.missileUnit, L.missileUnit, 0, this.container)
        for (const node of authored.effects.target.nodes)
          if (node.trail && node.materials) {
            const mesh = new HealingMesh(
              assets,
              authored.materials[node.materials[0]],
              L.ribbonSegments,
              { ...tuning, intensity: tuning.intensity / L.exposure }
            )
            for (let i = 0; i < L.ribbonSegments; i++) {
              const a = i / L.ribbonSegments,
                b = (i + 1) / L.ribbonSegments
              mesh.geometry.uvs.set([b, 0, a, 0, a, 1, b, 1], i * 8)
            }
            mesh.geometry.getBuffer('aUV').update()
            this.container.addChild(mesh)
            this.trails.push({ mesh, node })
          }
      }
      add(
        'bloom',
        target,
        L.bloomUnit * tuning.bloomScale,
        L.bloomUnit * tuning.bloomScale,
        this.travel,
        this.container
      )
    }
    this.update(0)
  }
  private path(t: number): PointData {
    const a = this.options.source!,
      b = this.options.target!,
      u = clamp(t / this.travel),
      dx = b.x - a.x,
      dy = b.y - a.y,
      bend = this.options.tuning.pathCurvature * 2 * u * (1 - u)
    return { x: a.x + dx * u - dy * bend, y: a.y + dy * u + dx * bend }
  }
  update(seconds: number): void {
    if (this.dead) return
    const t = Math.max(0, seconds) / this.options.tuning.timingScale
    for (const { mesh, vertices, area } of this.spirals) {
      const spin =
        authored.effects.mass.nodes.find((n) => n.spinY !== undefined)?.spinY ?? 0
      const angle = ((spin * Math.PI) / 180) * t,
        c = Math.cos(angle),
        s = Math.sin(angle)
      const opacity =
        clamp(t / L.spiralFadeIn) *
        (1 - clamp((t - L.spiralFadeOut) / (L.spiralEnd - L.spiralFadeOut)))
      const scale = this.options.tuning.waveScale
      for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i],
          x = v[0] * c - v[2] * s,
          y = v[0] * s + v[2] * c
        mesh.positions.set(
          [
            area.x + ((x * area.width) / L.waveDiameter) * scale,
            area.y - ((y * area.height) / L.waveDiameter) * scale
          ],
          i * 2
        )
        mesh.colors.set([v[6], v[7], v[8], v[9] * opacity], i * 4)
      }
      mesh.upload(t)
    }
    for (const stream of this.streams) {
      const { mesh, node, births, sx, sy, offset, kind } = stream,
        p = node.particle!
      for (let i = 0; i < births.length; i++) {
        const r = random(i + node.name.length * 31),
          birth = births[i] + value(p.delay, 0, r),
          age = t - offset - birth,
          life = Math.max(0.01, value(p.life, 0, r)),
          u = clamp(age / life)
        const active =
          age >= 0 && age < life && (!stream.moving || t < this.travel + 0.6)
        const head = stream.moving && node.name === 'fx_star'
        const sourceGlow = kind === 'target' && node.name === 'fx_glow'
        const emissionPhase = births[i] / Math.max(0.01, p.duration)
        const initial = color(p.color, emissionPhase, r),
          over = p.colorOverLife ? color(p.colorOverLife, u, r) : [1, 1, 1, 1]
        const rgba = initial.map((v, j) => v * over[j])
        rgba[3] *= active ? Math.min(1, (1 - u) * 5) : 0
        if (head) rgba[3] = t >= 0 && t < this.travel ? 1 : 0
        if (sourceGlow) {
          rgba.splice(0, 3, ...initial.slice(0, 3))
          rgba[3] =
            clamp(t / L.sourceGlowRise) * clamp((this.travel - t) / L.sourceGlowFade)
        }
        let size =
          value(p.size, emissionPhase, r) *
          (p.sizeOverLife ? value(p.sizeOverLife, u, r) : 1)
        if (sourceGlow) size = L.sourceGlowDiameter / sx
        if (stream.moving)
          size *= head
            ? L.missileHeadScale
            : L.missileSparkScale * this.options.tuning.trailSize
        const center = stream.moving ? this.path(head ? t : birth) : stream.center,
          angle = r * Math.PI * 2
        const radius =
          head || sourceGlow
            ? 0
            : p.radius * Math.sqrt(random(i + 17)) +
              Math.max(0, age) * value(p.speed, 0, r)
        const ground = /Shockwave|afterGlow|wave|runeCircle|rings/.test(node.name)
        if (kind === 'mass' && ground)
          size = Math.min(stream.maximumSize, size * L.massGroundExpansion)
        const beam = /beam/i.test(node.name)
        const unit =
          kind === 'mass' ? L.massBillboardUnit * this.options.tuning.waveScale : sx
        const x = center.x + Math.cos(angle) * radius * sx
        const y = center.y + Math.sin(angle) * radius * sy
        const rotation =
          value(p.rotation, 0, r) +
          (p.spin ? value(p.spin, u, r) * Math.max(0, age) : 0)
        // Only floor-facing rings inherit the board footprint. Billboard rays,
        // motes and beams retain their proportions instead of becoming a stripe.
        const width = size * (ground ? sx : unit)
        const height =
          size *
          (ground ? (kind === 'mass' ? sy : sy * L.groundDepth) : unit) *
          (beam ? L.beamHeight : 1)
        mesh.quad(
          i,
          x,
          beam ? y - height * 0.3 : y,
          width,
          height,
          rotation,
          rgba,
          true
        )
      }
      mesh.upload(t)
    }
    for (const { mesh, node } of this.trails) {
      const trail = node.trail!,
        life = Math.min(0.6, trail.life)
      for (let i = 0; i < L.ribbonSegments; i++) {
        const lag = (i / L.ribbonSegments) * life,
          at = t - lag,
          a = this.path(at),
          b = this.path(at - life / L.ribbonSegments)
        const rgba = gradient(trail.color, i / L.ribbonSegments)
        rgba[3] *= at >= 0 && at <= this.travel ? 1 : 0
        mesh.quad(
          i,
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
          Math.hypot(a.x - b.x, a.y - b.y) + 3,
          (trail.widthCurve
            ? curveKeys(trail.widthCurve, Math.min(t, this.travel))
            : trail.width) *
            L.ribbonUnit *
            this.options.tuning.ribbonWidth,
          Math.atan2(a.y - b.y, a.x - b.x),
          rgba
        )
      }
      mesh.upload(t)
    }
    this.container.visible = seconds < this.duration
  }
  dispose(): void {
    if (this.dead) return
    this.dead = true
    for (const s of this.streams) s.mesh.dispose()
    for (const t of this.trails) t.mesh.dispose()
    for (const s of this.spirals) s.mesh.dispose()
    this.container.destroy({ children: true })
  }
}
