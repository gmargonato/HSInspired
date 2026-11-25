import { WINDFURY_PROJECTION as projection } from './windfury-layout'
import { Buffer, BufferUsage, Mesh, MeshGeometry, Shader, type Texture } from 'pixi.js'
import { Matrix4, Quaternion, Vector3 } from 'three'
import authored from './windfury-authored.json'
import type { WindfuryTuning } from '../../desktop/contracts/ipc/windfury-tuning'

/** Textures supplied by the owning scene's acquired game bundle. */
export interface WindfuryTextures {
  readonly windfuryWind: Texture
  readonly windfuryMote: Texture
}

export type WindNode = {
  name: string
  position: number[]
  rotation: number[]
  scale: number[]
  mesh?: string
  children: WindNode[]
}
export type WindTrack = { path: string; attribute: string; keys: number[][] }

/** Unity's unweighted cubic Hermite curves, including constant endpoint holds. */
export function windValue(keys: number[][], time: number, fallback = 0): number {
  if (!keys.length) return fallback
  if (time <= keys[0][0]) return keys[0][1]
  const b = keys.findIndex((k) => k[0] > time)
  if (b < 0) return keys[keys.length - 1][1]
  const a = keys[b - 1],
    next = keys[b],
    dt = next[0] - a[0],
    t = (time - a[0]) / dt
  return (
    (2 * t ** 3 - 3 * t * t + 1) * a[1] +
    (t ** 3 - 2 * t * t + t) * dt * a[3] +
    (-2 * t ** 3 + 3 * t * t) * next[1] +
    (t ** 3 - t * t) * dt * next[2]
  )
}

export const windVertex = `#version 300 es
in vec2 aPosition, aUV, aWind;
in vec3 aColor;
out vec2 vUV;
out vec3 vBarycentric;
flat out vec3 vBoundary;
in vec3 aBarycentric,aBoundary;
out vec3 vColor;
out float vFresnel, vDepth;
uniform mat3 uProjectionMatrix, uWorldTransformMatrix, uTransformMatrix;
uniform vec2 uScroll;
uniform vec4 uST;
uniform float uWidth, uScale;
void main(){
  gl_Position=vec4((uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition*uScale,1.)).xy,0.,1.);
  vUV=(aUV+uScroll)*uST.xy+uST.zw;
  vBarycentric=aBarycentric;vBoundary=aBoundary;
  vColor=aColor;
  vFresnel=.5*smoothstep(1.-uWidth,1.,clamp(aWind.x,0.,1.));
  vDepth=aWind.y;
}`

export const windFragment = `#version 300 es
in vec2 vUV;
in vec3 vBarycentric;
flat in vec3 vBoundary;
in vec3 vColor;
in float vFresnel, vDepth;
out vec4 finalColor;
uniform sampler2D uWind;
uniform vec3 uTint;
uniform float uIntensity,uFresnelIntensity,uFresnelAlpha,uOpacity,uSide;
uniform vec4 uMaterialColor, uColor;
uniform float uEdgeFeather;
void main(){
  // Complementary coverage keeps the two passes continuous at the portrait
  // surface, including fragments that straddle it. Outside the portrait they
  // still sum to one, so this cannot double the additive brightness.
  float depthWidth=max(fwidth(vDepth),0.00001);
  float front=smoothstep(-depthWidth,depthWidth,vDepth);
  float coverage=uSide<0.?1.-front:front;
  vec3 edge=vBarycentric/max(fwidth(vBarycentric),vec3(0.00001));
  edge=mix(vec3(10000.),edge,vBoundary);
  coverage*=smoothstep(0.,uEdgeFeather,min(edge.x,min(edge.y,edge.z)));
  vec3 tex=texture(uWind,vec2(vUV.x,1.-vUV.y)).rgb;
  float a=vFresnel*uFresnelAlpha;
  vec3 rgb=tex*vColor*uTint*uMaterialColor.rgb*uIntensity*vFresnel*uFresnelIntensity*a;
  // The original outputs a*a and then uses SrcAlpha One. Bake SrcAlpha once
  // for Pixi's ONE/ONE additive blend. Texture alpha and tint alpha are unused.
  finalColor=vec4(rgb*a*a,0.)*uOpacity*uColor.a*coverage;
}`

/** A native curl projected into its owner's design space. Two depth passes
 * let the existing portrait, shield and badge stack occlude it without a new GL context. */
const geometries = new Map<string, { geometry: MeshGeometry; references: number }>()

export class WindMaterial extends Mesh<MeshGeometry, Shader> {
  private readonly geometryKey: string
  readonly uniforms: ReturnType<typeof windUniforms>
  constructor(
    texture: Texture,
    node: WindNode,
    transform: Matrix4,
    width: number,
    height: number,
    side: number,
    burst: boolean,
    portraitDepth: number,
    modelScale = 1
  ) {
    texture.source.style.addressMode = 'clamp-to-edge'
    texture.source.style.scaleMode = 'linear'
    transform = new Matrix4()
      .makeScale(modelScale, modelScale, modelScale)
      .multiply(transform)
    const geometryKey = [
      node.mesh,
      width,
      height,
      portraitDepth,
      ...transform.elements
    ].join(',')
    let shared = geometries.get(geometryKey)
    if (!shared) {
      shared = {
        references: 0,
        geometry: (() => {
          const source = authored.meshes[node.mesh! as keyof typeof authored.meshes]
          const positions: number[] = [],
            wind: number[] = [],
            colors: number[] = []
          const inverse = transform.clone().invert()
          const camera = new Vector3(0, projection.cameraY, 0).applyMatrix4(inverse)
          for (let i = 0; i < source.positions.length; i += 3) {
            const local = new Vector3().fromArray(source.positions, i)
            const view = camera.clone().sub(local).normalize()
            const normal = new Vector3().fromArray(source.normals, i)
            const p = local.applyMatrix4(transform)
            positions.push(
              (p.x * width) / projection.diameterUnits,
              (p.z * height) / projection.diameterUnits
            )
            wind.push(normal.dot(view), portraitDepth - p.y)
            colors.push(...source.colors.slice((i / 3) * 4, (i / 3) * 4 + 3))
          }
          const visible = source.indices.filter((_, i, ids) => {
            const a = ids[Math.floor(i / 3) * 3] * 2,
              b = ids[Math.floor(i / 3) * 3 + 1] * 2,
              c = ids[Math.floor(i / 3) * 3 + 2] * 2
            return (
              (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) -
                (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]) >
              0
            )
          })
          // FBX vertices can be split at normals/UV seams. Weld their source
          // positions when finding silhouettes so interior diagonals never fade.
          const keys = source.positions.reduce<string[]>((out, _, i) => {
            if (i % 3 === 0)
              out.push(
                source.positions
                  .slice(i, i + 3)
                  .map((x) => Math.round(x * 100000))
                  .join(',')
              )
            return out
          }, [])
          const edgeKey = (a: number, b: number) => [keys[a], keys[b]].sort().join('|')
          const edgeCounts = new Map<string, number>()
          for (let i = 0; i < visible.length; i += 3)
            for (let j = 0; j < 3; j++) {
              const key = edgeKey(visible[i + j], visible[i + ((j + 1) % 3)])
              edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
            }
          const expanded = {
            positions: [] as number[],
            uvs: [] as number[],
            wind: [] as number[],
            colors: [] as number[],
            barycentric: [] as number[],
            boundary: [] as number[]
          }
          for (let i = 0; i < visible.length; i += 3) {
            const ids = visible.slice(i, i + 3),
              boundary = ids.map((_, j) =>
                edgeCounts.get(edgeKey(ids[(j + 1) % 3], ids[(j + 2) % 3])) === 1
                  ? 1
                  : 0
              )
            for (let j = 0; j < 3; j++) {
              const id = ids[j]
              expanded.positions.push(...positions.slice(id * 2, id * 2 + 2))
              expanded.uvs.push(...source.uvs.slice(id * 2, id * 2 + 2))
              expanded.wind.push(...wind.slice(id * 2, id * 2 + 2))
              expanded.colors.push(...colors.slice(id * 3, id * 3 + 3))
              expanded.barycentric.push(...[0, 1, 2].map((k) => Number(k === j)))
              expanded.boundary.push(...boundary)
            }
          }
          const geometry = new MeshGeometry({
            positions: new Float32Array(expanded.positions),
            uvs: new Float32Array(expanded.uvs),
            indices: Uint32Array.from(visible.map((_, i) => i))
          })
          geometry.batchMode = 'no-batch'
          for (const [name, data, format] of [
            ['aWind', expanded.wind, 'float32x2'],
            ['aColor', expanded.colors, 'float32x3'],
            ['aBarycentric', expanded.barycentric, 'float32x3'],
            ['aBoundary', expanded.boundary, 'float32x3']
          ] as const)
            geometry.addAttribute(name, {
              buffer: new Buffer({
                data: new Float32Array(data),
                usage: BufferUsage.VERTEX
              }),
              format
            })
          return geometry
        })()
      }
      geometries.set(geometryKey, shared)
    }
    shared.references++
    const geometry = shared.geometry
    const uniforms = windUniforms(side, burst)
    const shader = Shader.from({
      gl: { vertex: windVertex, fragment: windFragment, name: 'windfury-native' },
      resources: { uWind: texture.source, windUniforms: uniforms }
    })
    super({ geometry, shader })
    this.geometryKey = geometryKey
    this.uniforms = uniforms
    this.blendMode = 'add'
    this.eventMode = 'none'
    this.label = 'windfury.curl.' + node.name
  }
  tune(tuning: WindfuryTuning): void {
    const u = this.shader!.resources.windUniforms.uniforms
    u.uScale = tuning.scale
    u.uIntensity = 2 * tuning.intensity
    u.uWidth = Math.min(1, this.uniforms.uWidth.value * tuning.fresnelWidth)
    u.uFresnelIntensity =
      this.uniforms.uFresnelIntensity.value * tuning.fresnelIntensity
    u.uFresnelAlpha = this.uniforms.uFresnelAlpha.value * tuning.fresnelAlpha
    u.uTint.set([
      ((tuning.color >> 16) & 255) / 255,
      ((tuning.color >> 8) & 255) / 255,
      (tuning.color & 255) / 255
    ])
  }
  override destroy(): void {
    const { geometry, shader } = this
    super.destroy()
    const shared = geometries.get(this.geometryKey)!
    if (--shared.references === 0) {
      geometry.destroy()
      geometries.delete(this.geometryKey)
    }
    shader?.destroy()
  }
}

function windUniforms(side: number, burst: boolean) {
  const source = authored.materials[burst ? 'FX_WindBurst' : 'FX_Wind1'].floats
  return {
    uScroll: { value: new Float32Array([0.4, 0]), type: 'vec2<f32>' },
    uST: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
    uMaterialColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
    uTint: { value: new Float32Array(projection.lighting), type: 'vec3<f32>' },
    uWidth: { value: source._FresnelWidth, type: 'f32' },
    uScale: { value: 1, type: 'f32' },
    uIntensity: { value: 2, type: 'f32' },
    uFresnelIntensity: { value: source._FresnelIntensity, type: 'f32' },
    uFresnelAlpha: { value: source._FresnelAlpha, type: 'f32' },
    uOpacity: { value: 1, type: 'f32' },
    uSide: { value: side, type: 'f32' },
    uEdgeFeather: { value: projection.edgeFeatherPixels, type: 'f32' }
  } as const
}

/** The native hero idle prefab has a raised container and different curl
 * transforms. A single depth constant leaves almost all of it behind the art.
 * Fit the 2D portrait surface to that host's complete idle height envelope. */
export function windProjectionFit(
  idle: WindNode,
  burst: WindNode
): { portraitDepth: number; burstScale: number } {
  const envelope = (root: WindNode) => {
    let low = Infinity,
      high = -Infinity,
      radius = 0
    const visit = (node: WindNode, parent: Matrix4) => {
      const transform = windTransform(node, parent)
      if (node.mesh) {
        const source = authored.meshes[node.mesh as keyof typeof authored.meshes]
        for (let i = 0; i < source.positions.length; i += 3) {
          const p = new Vector3().fromArray(source.positions, i).applyMatrix4(transform)
          low = Math.min(low, p.y)
          high = Math.max(high, p.y)
          radius = Math.max(radius, Math.hypot(p.x, p.z))
        }
      }
      for (const child of node.children) visit(child, transform)
    }
    visit(root, new Matrix4())
    return { low, high, radius }
  }
  const rest = envelope(idle),
    activation = envelope(burst)
  return {
    portraitDepth: (rest.low + rest.high) / 2,
    burstScale: Math.min(
      1,
      (rest.radius * projection.burstRadiusFactor) / activation.radius
    )
  }
}

export function windTransform(node: WindNode, parent: Matrix4): Matrix4 {
  return parent
    .clone()
    .multiply(
      new Matrix4().compose(
        new Vector3().fromArray(node.position),
        new Quaternion().fromArray(node.rotation),
        new Vector3().fromArray(node.scale)
      )
    )
}
