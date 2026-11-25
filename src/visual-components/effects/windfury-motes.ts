import { Container, type Texture } from 'pixi.js'
import { GhostMaterialMesh } from './ghost-materials'
import { WINDFURY_PROJECTION as projection } from './windfury-layout'
import { Matrix3, Matrix4, Vector3 } from 'three'
import authored from './windfury-authored.json'
import { windTransform, windValue, type WindNode } from './windfury-material'

type Curve = {
  scalar: number
  minScalar: number
  minMaxState: number
  maxCurve: {
    m_Curve: { time: number; value: number; inSlope: number; outSlope: number }[]
  }
  minCurve: Curve['maxCurve']
}
type Modules = {
  InitialModule: {
    startLifetime: Curve
    startSize: Curve
    startRotation: Curve
    startColor: {
      minColor: { r: number; a: number }
      maxColor: { r: number; a: number }
    }
    gravityModifier: Curve
  }
  ShapeModule: { radius: { value: number } }
  VelocityModule: { x: Curve; y: Curve; z: Curve; inWorldSpace: number }
  ForceModule: { x: Curve; y: Curve; z: Curve }
  RotationModule: { curve: Curve }
  SizeModule: { curve: Curve }
}
type Particle = {
  shade: number
  life: number
  size: number
  rotation: number
  spin: number
  alpha: number
  path: Vector3[]
}
function evaluate(c: Curve, t: number, r: number): number {
  const keys = (x: Curve['maxCurve']) =>
    x.m_Curve.map((k) => [k.time, k.value, k.inSlope, k.outSlope])
  if (c.minMaxState === 0) return c.scalar
  if (c.minMaxState === 3) return c.minScalar + (c.scalar - c.minScalar) * r
  const upper = windValue(keys(c.maxCurve), t, 1) * c.scalar
  return c.minMaxState === 1
    ? upper
    : windValue(keys(c.minCurve), t, 1) * c.scalar * (1 - r) + upper * r
}
/** Authored burst modules sampled at 60 Hz. Seeded forces make captures repeatable;
 * Unity's random stream and scene gravity remain renderer adaptations. */
export class WindMotes {
  readonly layer = new Container()
  private readonly particles: Particle[] = []
  private readonly modules: Modules
  private readonly material: GhostMaterialMesh
  private opacity = 1
  constructor(
    texture: Texture,
    private readonly width: number,
    private readonly height: number,
    hero: boolean
  ) {
    this.layer.label = 'windfury.motes'
    this.layer.eventMode = 'none'
    texture.source.alphaMode = 'no-premultiply-alpha'
    texture.source.update()
    const tint = authored.materials.FX_Leaf1.colors._TintColor
    this.material = new GhostMaterialMesh(texture, texture, 50, 2, [
      tint.r,
      tint.g,
      tint.b,
      tint.a
    ])
    this.material.label = 'windfury.motes.material'
    this.layer.addChild(this.material)
    this.layer.onRender = () => {
      let alpha = this.opacity
      for (let node: Container | null = this.layer; node; node = node.parent)
        alpha *= node.alpha
      this.material.shader!.resources.ghostUniforms.uniforms.uOpacity = alpha
    }
    const prefab = hero
      ? authored.prefabs.Card_Play_Hero_WindFury_Burst
      : authored.prefabs.Card_Play_Ally_WindFury_Burst
    let transform = new Matrix4(),
      modules: Modules | undefined
    const visit = (node: WindNode & { particles?: Modules }, parent: Matrix4) => {
      const matrix = windTransform(node, parent)
      if (node.particles) {
        transform = matrix
        modules = node.particles
      }
      for (const child of node.children) visit(child, matrix)
    }
    visit(prefab as unknown as WindNode & { particles?: Modules }, new Matrix4())
    this.modules = modules!
    const emitterRotation = new Matrix3().setFromMatrix4(
      new Matrix4().extractRotation(transform)
    )
    let seed = 0x51f15e
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const init = this.modules.InitialModule
    for (let i = 0; i < 50; i++) {
      const life = evaluate(init.startLifetime, 0, random()),
        size = evaluate(init.startSize, 0, random())
      const r = random(),
        shade =
          init.startColor.minColor.r +
          (init.startColor.maxColor.r - init.startColor.minColor.r) * r
      const angle = random() * Math.PI * 2,
        radius = Math.sqrt(random()) * this.modules.ShapeModule.radius.value
      const p = new Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0
      ).applyMatrix4(transform)
      const velocity = new Vector3(),
        path = [p.clone()],
        distribution = [random(), random(), random()]
      for (let step = 1; step <= Math.ceil(life * 60); step++) {
        const t = step / 60,
          age = t / life
        const force = this.modules.ForceModule
        velocity.addScaledVector(
          new Vector3(
            evaluate(force.x, age, random()),
            evaluate(force.y, age, random()) -
              9.81 * evaluate(init.gravityModifier, age, 0),
            evaluate(force.z, age, random())
          ),
          1 / 60
        )
        const v = this.modules.VelocityModule
        const curveVelocity = new Vector3(
          evaluate(v.x, age, distribution[0]),
          evaluate(v.y, age, distribution[1]),
          evaluate(v.z, age, distribution[2])
        )
        if (!v.inWorldSpace) curveVelocity.applyMatrix3(emitterRotation)
        p.addScaledVector(velocity, 1 / 60).addScaledVector(curveVelocity, 1 / 60)
        path.push(p.clone())
      }
      this.particles.push({
        shade,
        life,
        size,
        rotation: evaluate(init.startRotation, 0, random()),
        spin: evaluate(this.modules.RotationModule.curve, 0, random()),
        alpha:
          init.startColor.minColor.a +
          (init.startColor.maxColor.a - init.startColor.minColor.a) * r,
        path
      })
    }
  }
  update(time: number, scale: number, fade: number): void {
    this.opacity = fade
    this.layer.visible = time >= 0 && this.particles.some((p) => time < p.life)
    if (!this.layer.visible) return
    for (const [i, p] of this.particles.entries()) {
      if (time >= p.life) {
        this.material.quad(i, 0, 0, 0, 0, 0, [0, 0, 0, 0])
        continue
      }
      const frame = time * 60,
        index = Math.floor(frame),
        a = p.path[Math.min(index, p.path.length - 1)],
        b = p.path[Math.min(index + 1, p.path.length - 1)]
      const x =
        (((a.x + (b.x - a.x) * (frame - index)) * this.width) /
          projection.diameterUnits) *
        scale
      const y =
        (((a.z + (b.z - a.z) * (frame - index)) * this.height) /
          projection.diameterUnits) *
        scale
      const size =
        ((p.size *
          evaluate(this.modules.SizeModule.curve, time / p.life, 0) *
          this.width) /
          projection.diameterUnits) *
        scale
      const alpha = p.alpha * Math.min(1, (1 - time / p.life) / 0.45)
      this.material.quad(i, x, y, size, size, p.rotation + p.spin * time, [
        p.shade,
        p.shade,
        p.shade,
        alpha
      ])
    }
    this.material.upload()
  }
  destroy(): void {
    this.layer.destroy({ children: true })
  }
}
