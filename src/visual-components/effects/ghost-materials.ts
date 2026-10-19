import { Buffer, BufferUsage, Mesh, MeshGeometry, Shader, type Texture } from 'pixi.js'
import { ghostMeshVertex, ghostMeshFragment } from './ghost-aura-shader'

export interface GhostTextures {
  readonly ghostClouds: Texture
  readonly ghostBannerAtlas: Texture
  readonly ghostButtonAtlas: Texture
  readonly ghostSmokeAdd: Texture
  readonly ghostSmoke: Texture
  readonly ghostMote: Texture
  readonly ghostEvaporate: Texture
}

export function configureGhostTextures(textures: GhostTextures): void {
  for (const texture of [
    textures.ghostClouds,
    textures.ghostBannerAtlas,
    textures.ghostButtonAtlas,
    textures.ghostSmokeAdd,
    textures.ghostSmoke,
    textures.ghostMote,
    textures.ghostEvaporate
  ]) {
    if (texture.source.alphaMode !== 'no-premultiply-alpha') {
      texture.source.alphaMode = 'no-premultiply-alpha'
      texture.source.update()
    }
  }
  textures.ghostClouds.source.style.addressMode = 'repeat'
}

/** One draw per material, with independent particle colors and native atlas UVs. */
export class GhostMaterialMesh extends Mesh<MeshGeometry, Shader> {
  readonly positions: Float32Array
  readonly colors: Float32Array
  constructor(
    texture: Texture,
    clouds: Texture,
    count: number,
    kind: number,
    tint: number[],
    uv?: readonly number[]
  ) {
    const positions = new Float32Array(count * 8),
      colors = new Float32Array(count * 16)
    const uvs = new Float32Array(count * 8),
      indices = new Uint32Array(count * 6)
    for (let i = 0; i < count; i++) {
      uvs.set(uv ?? [0, 0, 1, 0, 1, 1, 0, 1], i * 8)
      indices.set(
        [0, 1, 2, 0, 2, 3].map((n) => n + i * 4),
        i * 6
      )
    }
    const geometry = new MeshGeometry({ positions, uvs, indices })
    geometry.batchMode = 'no-batch'
    geometry.addAttribute('aParticleColor', {
      buffer: new Buffer({
        data: colors,
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
      }),
      format: 'float32x4',
      stride: 16,
      offset: 0
    })
    const shader = Shader.from({
      gl: {
        vertex: ghostMeshVertex,
        fragment: ghostMeshFragment,
        name: 'ghost-material-' + kind
      },
      resources: {
        uArtwork: texture.source,
        uClouds: clouds.source,
        ghostUniforms: {
          uKind: { value: kind, type: 'f32' },
          uTint: { value: new Float32Array(tint), type: 'vec4<f32>' },
          uScroll: { value: new Float32Array(2), type: 'vec2<f32>' },
          uIntensity: { value: 1, type: 'f32' },
          uTextureScale: { value: 1, type: 'f32' },
          uSoftness: { value: 1, type: 'f32' },
          uOpacity: { value: 1, type: 'f32' }
        }
      }
    })
    super({ geometry, shader })
    this.positions = positions
    this.colors = colors
    this.blendMode = kind === 0 || kind === 3 ? 'normal' : 'add'
    this.eventMode = 'none'
    this.label = 'ghost-mist.material'
  }
  quad(
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    color: readonly number[]
  ): void {
    const c = Math.cos(rotation),
      s = Math.sin(rotation)
    for (let v = 0; v < 4; v++) {
      const dx = (v === 0 || v === 3 ? -0.5 : 0.5) * width
      const dy = (v < 2 ? -0.5 : 0.5) * height
      this.positions[(index * 4 + v) * 2] = x + c * dx - s * dy
      this.positions[(index * 4 + v) * 2 + 1] = y + s * dx + c * dy
      this.colors.set(color, (index * 4 + v) * 4)
    }
  }
  upload(): void {
    this.geometry.getBuffer('aPosition').update()
    this.geometry.getBuffer('aParticleColor').update()
  }
  override destroy(): void {
    const { geometry, shader } = this
    super.destroy()
    geometry.destroy()
    shader?.destroy()
  }
}
