import {
  Container,
  Filter,
  Graphics,
  Matrix,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Texture,
  type FilterSystem,
  type Renderer,
  type RenderSurface
} from 'pixi.js'
import { acquireAuraField, hasAuraField, type AuraFieldLease } from './aura-field-cache'
import {
  DISTANCE_LIMIT,
  DISTANCE_PADDING,
  REFERENCE_CARD_WIDTH
} from './aura-distance-field'
import {
  createAuraGlProgram,
  createAuraGpuProgram,
  createAuraUniforms
} from './aura-shader'
import { inverseAuraProjection } from './aura-projection'
import type { AuraPalette, AuraTuning } from '../../../shared/ipc/outline-tuning'

/** V5 material over a cached local silhouette, reprojected for the current pose. */
export class AuraFilter extends Filter {
  readonly auraUniforms = createAuraUniforms()
  private readonly mapping = new Matrix()
  private field: AuraFieldLease | null = null
  private source: Texture | null = null
  private snapshot: Texture | null = null
  private snapshotBounds = new Rectangle()
  private revision = ''
  private pending = false
  private disposed = false
  private failedRevision: string | null = null
  private silhouetteRevision = 0
  private readonly invalidateShape = (): void => {
    this.silhouetteRevision++
  }

  constructor(
    private readonly target: Container,
    private readonly silhouette?: {
      readonly texture: Texture
      readonly bounds: Rectangle
    }
  ) {
    super({
      glProgram: createAuraGlProgram(),
      gpuProgram: createAuraGpuProgram(),
      resources: {
        uDistanceField: Texture.EMPTY.source,
        uDistanceSampler: Texture.EMPTY.source.style
      },
      antialias: 'inherit',
      resolution: 'inherit'
    })
    this.resources.auraUniforms = this.auraUniforms
    this.auraUniforms.uniforms.uPadding = DISTANCE_PADDING
    this.auraUniforms.uniforms.uDistanceLimit = DISTANCE_LIMIT
    if (target instanceof Graphics) target.context.on('update', this.invalidateShape)
    this.syncPadding()
  }

  setTuning(tuning: AuraTuning): void {
    for (const [key, value] of Object.entries(tuning)) {
      this.auraUniforms.uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`] =
        Number(value)
    }
  }

  setPalette(palette: AuraPalette): void {
    for (const [key, value] of Object.entries(palette)) {
      const color = this.auraUniforms.uniforms[
        `u${key[0].toUpperCase()}${key.slice(1)}`
      ] as Float32Array
      color.set([
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255
      ])
    }
  }

  /** Must run before Pixi allocates the filter input, including after hover scaling. */
  syncPadding(): void {
    const bounds = this.target.getLocalBounds()
    const world = this.target.getGlobalTransform()
    const scale = Math.max(Math.hypot(world.a, world.b), Math.hypot(world.c, world.d))
    this.padding =
      Math.ceil(
        ((DISTANCE_PADDING * Math.max(bounds.width, 1)) / REFERENCE_CARD_WIDTH) * scale
      ) + 2
  }

  override apply(
    system: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clear: boolean
  ): void {
    const target = this.target
    const texture =
      this.silhouette?.texture ??
      (target instanceof Sprite || target instanceof PerspectiveMesh
        ? target.texture
        : null)
    const bounds = target.getLocalBounds()
    const revision = texture
      ? `${texture.uid}:${texture.source.uid}:${texture.frame.x}:${texture.frame.y}:${texture.frame.width}:${texture.frame.height}`
      : `${bounds.minX}:${bounds.minY}:${bounds.width}:${bounds.height}:${this.silhouetteRevision}`
    if (
      revision !== this.revision ||
      !this.field?.valid ||
      (texture !== this.source && texture !== null)
    ) {
      this.auraUniforms.uniforms.uReady = 0
      if (texture && hasAuraField(system.renderer, texture)) {
        this.prepare(system.renderer, texture, revision)
      } else if (!this.pending && this.failedRevision !== revision) {
        this.pending = true
        // Snapshotting a composition must happen outside an active filter pass.
        queueMicrotask(() => {
          this.pending = false
          if (this.disposed || target.destroyed) return
          try {
            this.prepare(system.renderer, texture, revision)
          } catch (error) {
            this.failedRevision = revision
            console.error('[Aura] Unable to prepare silhouette', error)
          }
        })
      }
    }
    // calculateSpriteMatrix also accounts for render-group cache transforms.
    const unitTarget = {
      worldTransform: target.worldTransform,
      renderGroup: target.renderGroup,
      parentRenderGroup: target.parentRenderGroup,
      texture: { orig: { width: 1, height: 1 } },
      anchor: { x: 0, y: 0 }
    } as Sprite
    const m = system.calculateSpriteMatrix(this.mapping, unitTarget)
    this.auraUniforms.uniforms.uMapX.set([m.a, m.c, m.tx, 0])
    this.auraUniforms.uniforms.uMapY.set([m.b, m.d, m.ty, 0])
    let corners: readonly number[]
    if (target instanceof PerspectiveMesh) corners = target.geometry.corners
    else {
      const rect =
        target instanceof Sprite
          ? {
              x:
                -target.anchor.x * target.texture.orig.width +
                (target.texture.trim?.x ?? 0),
              y:
                -target.anchor.y * target.texture.orig.height +
                (target.texture.trim?.y ?? 0),
              width: target.texture.frame.width,
              height: target.texture.frame.height
            }
          : this.snapshotBounds
      corners = [
        rect.x,
        rect.y,
        rect.x + rect.width,
        rect.y,
        rect.x + rect.width,
        rect.y + rect.height,
        rect.x,
        rect.y + rect.height
      ]
    }
    const projection = inverseAuraProjection(corners)
    if (this.silhouette && target instanceof PerspectiveMesh) {
      // The held-card mesh includes snapshot margins. Measure V5's widths and
      // taper from the original card, exactly as the resting sprite does.
      const { bounds } = this.silhouette
      const x = bounds.x / target.geometry.width
      const y = bounds.y / target.geometry.height
      const width = bounds.width / target.geometry.width
      const height = bounds.height / target.geometry.height
      for (let index = 0; index < 3; index++) {
        projection[index] = (projection[index] - x * projection[index + 6]) / width
        projection[index + 3] =
          (projection[index + 3] - y * projection[index + 6]) / height
      }
    }
    this.auraUniforms.uniforms.uProjection0.set([...projection.slice(0, 3), 0])
    this.auraUniforms.uniforms.uProjection1.set([...projection.slice(3, 6), 0])
    this.auraUniforms.uniforms.uProjection2.set([...projection.slice(6, 9), 0])
    this.auraUniforms.uniforms.uAlpha = target.getGlobalAlpha()
    super.apply(system, input, output, clear)
  }

  private prepare(renderer: Renderer, texture: Texture | null, revision: string): void {
    this.releaseField()
    this.snapshot?.destroy(true)
    this.snapshot = null
    if (!texture) {
      const target = this.target
      const bounds = target.getLocalBounds()
      this.snapshotBounds = new Rectangle(
        bounds.minX,
        bounds.minY,
        Math.max(1, bounds.width),
        Math.max(1, bounds.height)
      )
      const filters = target.filters
      const { visible, renderable, alpha } = target
      target.filters = []
      target.visible = true
      target.renderable = true
      target.alpha = 1
      try {
        this.snapshot = renderer.generateTexture({
          target,
          frame: this.snapshotBounds,
          resolution: 1,
          antialias: true
        })
        texture = this.snapshot
      } finally {
        target.filters = filters ? [...filters] : []
        target.visible = visible
        target.renderable = renderable
        target.alpha = alpha
      }
    }
    this.field = acquireAuraField(renderer, texture)
    this.source = texture
    this.revision = revision
    const { field } = this.field
    this.resources.uDistanceField = field.texture.source
    this.resources.uDistanceSampler = field.texture.source.style
    this.auraUniforms.uniforms.uCardSize.set([field.cardWidth, field.cardHeight])
    this.auraUniforms.uniforms.uFieldSize.set([
      field.texture.width,
      field.texture.height
    ])
    this.auraUniforms.uniforms.uReady = 1
  }

  private releaseField(): void {
    this.resources.uDistanceField = Texture.EMPTY.source
    this.resources.uDistanceSampler = Texture.EMPTY.source.style
    this.field?.release()
    this.field = null
  }

  override destroy(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.target instanceof Graphics)
      this.target.context?.off('update', this.invalidateShape)
    this.releaseField()
    this.snapshot?.destroy(true)
    this.snapshot = null
    super.destroy()
  }
}
