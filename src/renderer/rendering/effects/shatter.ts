// Ported from ShaderTest/src/shaders/shatter.js (Shatter v1).
import {
  Container,
  Mesh,
  MeshGeometry,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  Shader,
  type Renderer
} from 'pixi.js'

import { SHATTER_CONFIG } from './outline-tuning'
import type { ShatterTuning } from '../../../shared/ipc/outline-tuning'
export {
  SHATTER_DEFAULTS,
  type ShatterTuning
} from '../../../shared/ipc/outline-tuning'

function randomSequence(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

// Clip a convex polygon to the half-plane closest to its own seed.
function clip(polygon: number[][], nx: number, ny: number, offset: number) {
  const result: number[][] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const da = a[0] * nx + a[1] * ny - offset
    const db = b[0] * nx + b[1] * ny - offset
    if (da <= 0) result.push(a)
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db)
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return result
}

export function createShatterPieces(
  width: number,
  height: number,
  count: number,
  seed: number
) {
  const random = randomSequence(seed)
  const sites = Array.from({ length: count }, () => [
    random() * width,
    random() * height
  ])
  return sites
    .map((site, index) => {
      let polygon = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height]
      ]
      for (let j = 0; j < sites.length && polygon.length; j++) {
        if (j === index) continue
        const other = sites[j]
        const nx = other[0] - site[0]
        const ny = other[1] - site[1]
        polygon = clip(
          polygon,
          nx,
          ny,
          (nx * (other[0] + site[0]) + ny * (other[1] + site[1])) / 2
        )
      }
      let area = 0
      let cx = 0
      let cy = 0
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]
        const b = polygon[(i + 1) % polygon.length]
        const cross = a[0] * b[1] - b[0] * a[1]
        area += cross
        cx += (a[0] + b[0]) * cross
        cy += (a[1] + b[1]) * cross
      }
      cx = Math.abs(area) > 1e-8 ? cx / (3 * area) : site[0]
      cy = Math.abs(area) > 1e-8 ? cy / (3 * area) : site[1]
      const dx = cx - width / 2
      const dy = cy - height / 2
      const length = Math.hypot(dx, dy)
      const angle = random() * Math.PI * 2
      return {
        polygon,
        cx,
        cy,
        direction:
          length > 1e-8
            ? [dx / length, dy / length]
            : [Math.cos(angle), Math.sin(angle)],
        travel: 0.6 + random() * 0.4,
        rotation: (random() < 0.5 ? -1 : 1) * (0.25 + random() * 0.75)
      }
    })
    .filter((piece) => piece.polygon.length >= 3)
}

const vertex = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}`

const fragment = `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uArtwork;
uniform float uOpacity;
void main() {
    finalColor = texture(uArtwork, vUV) * uOpacity;
}`

/** Owns one snapshot and its shards; the caller owns animation timing. */
export function createShatter(
  renderer: Renderer,
  target: Container,
  tuning: ShatterTuning = { ...SHATTER_CONFIG }
) {
  const parent = target.parent
  if (!parent) throw new Error('Shatter requires an attached view')
  const bounds = target.getLocalBounds()
  const frame = new Rectangle(bounds.minX, bounds.minY, bounds.width, bounds.height)
  if (frame.width <= 0 || frame.height <= 0) throw new Error('Empty shatter snapshot')
  const width = frame.width
  const height = frame.height
  const pieces = createShatterPieces(width, height, tuning.shardCount, tuning.seed)
  const texture = renderer.generateTexture({ target, frame, antialias: true })
  const geometry = new MeshGeometry({})
  let shader: Shader
  try {
    shader = Shader.from({
      gl: { vertex, fragment, name: 'shatter-v1', preferredFragmentPrecision: 'highp' },
      resources: {
        uArtwork: texture.source,
        shatterUniforms: { uOpacity: { value: 1, type: 'f32' } }
      }
    })
  } catch (error) {
    geometry.destroy()
    texture.destroy(true)
    throw error
  }
  const mesh = new Mesh({ geometry, shader, texture })
  const container = new Container()
  container.label = target.label + '.shatter'
  container.eventMode = 'none'
  container.position.copyFrom(target.position)
  container.scale.copyFrom(target.scale)
  container.pivot.copyFrom(target.pivot)
  container.skew.copyFrom(target.skew)
  container.rotation = target.rotation
  container.alpha = target.alpha
  container.zIndex = target.zIndex
  mesh.position.set(frame.x + width / 2, frame.y + height / 2)
  container.addChild(mesh)
  let disposed = false
  const wasVisible = target.visible
  const dispose = () => {
    if (disposed) return
    disposed = true
    container.removeFromParent()
    container.destroy({ children: true })
    geometry.destroy()
    shader.destroy()
    texture.destroy(true)
    if (!target.destroyed) target.visible = wasVisible
  }
  try {
    rebuild()
    parent.addChildAt(container, parent.getChildIndex(target) + 1)
    target.visible = false
  } catch (error) {
    dispose()
    throw error
  }
  return {
    setProgress(progress: number) {
      if (!disposed) applyProgress(Math.max(0, Math.min(1, progress)))
    },
    dispose
  }
  function applyProgress(progress: number) {
    const travel = progress * (2 - progress)
    const fade = Math.max(0, Math.min(1, (progress - 0.55) / 0.45))
    shader.resources.shatterUniforms.uniforms.uOpacity =
      1 - fade * fade * (3 - 2 * fade)
    mesh.visible = progress < 1
    const positions = geometry.positions
    let cursor = 0
    for (const piece of pieces) {
      const angle = ((piece.rotation * tuning.spin * Math.PI) / 180) * progress
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const distance = tuning.spread * Math.max(width, height) * piece.travel * travel
      const x = piece.cx - width / 2 + piece.direction[0] * distance
      const y = piece.cy - height / 2 + piece.direction[1] * distance
      for (const point of piece.polygon) {
        const dx = point[0] - piece.cx
        const dy = point[1] - piece.cy
        positions[cursor++] = x + dx * cos - dy * sin
        positions[cursor++] = y + dx * sin + dy * cos
      }
    }
    geometry.getBuffer('aPosition').update()
  }

  function rebuild() {
    const uvs: number[] = []
    const indices: number[] = []
    let vertexIndex = 0
    const uv = texture.uvs
    for (const piece of pieces) {
      for (const [x, y] of piece.polygon) {
        const s = x / width
        const t = y / height
        uvs.push(
          uv.x0 + (uv.x1 - uv.x0) * s + (uv.x3 - uv.x0) * t,
          uv.y0 + (uv.y1 - uv.y0) * s + (uv.y3 - uv.y0) * t
        )
      }
      for (let i = 1; i < piece.polygon.length - 1; i++) {
        indices.push(vertexIndex, vertexIndex + i, vertexIndex + i + 1)
      }
      vertexIndex += piece.polygon.length
    }
    geometry.uvs = new Float32Array(uvs)
    geometry.positions = new Float32Array(uvs.length)
    geometry.indices = new Uint32Array(indices)
    applyProgress(0)
  }
}

/** Render the production mesh once during loading to populate Pixi's GPU program cache. */
export function prewarmShatter(renderer: Renderer): void {
  const stage = new Container()
  stage.label = 'shatter.warmup'
  const sample = new Sprite(Texture.WHITE)
  sample.label = 'shatter.warmup.sample'
  sample.anchor.set(0.5)
  sample.position.set(32, 32)
  sample.scale.set(16)
  stage.addChild(sample)
  let output: RenderTexture | undefined
  let effect: ReturnType<typeof createShatter> | undefined
  try {
    output = RenderTexture.create({ width: 64, height: 64, resolution: 1 })
    effect = createShatter(renderer, sample)
    effect.setProgress(0.6)
    // Creating Shader alone does not compile it. A visible mesh must be drawn;
    // rendering into a texture keeps this preparation off the match screen.
    renderer.render({ container: stage, target: output, clear: true })
  } finally {
    // Shader.destroy() leaves the shared GlProgram (and compiled GPU program) cached.
    effect?.dispose()
    output?.destroy(true)
    stage.destroy({ children: true })
  }
}
