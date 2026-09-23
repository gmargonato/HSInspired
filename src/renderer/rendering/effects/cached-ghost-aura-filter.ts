import { Filter, Matrix, RenderTexture, Texture, UniformGroup } from 'pixi.js'
import type {
  FilterWithShader,
  FilterSystem,
  RenderSurface,
  Sprite,
  TextureSource
} from 'pixi.js'
import {
  createGhostAuraGlProgram,
  createGhostAuraGpuProgram
} from './ghost-aura-shader'
import { mapOutlineDistance } from './outline-distance-mapping'

export interface OutlineCacheDiagnostics {
  readonly applies: number
  readonly liveFallbacks: number
  readonly unstableFrames: number
  readonly cacheBakes: number
  readonly cacheBakeMs: number
  readonly cacheHits: number
  readonly invalidations: number
  readonly changedInputs: Readonly<Record<string, number>>
}

const INPUT_NAMES = [
  'globalAlpha',
  'texture.uid',
  'source.uid',
  'source.resourceId',
  'input.antialias',
  'padding',
  'geometry.ribbonWidth',
  'geometry.rimWidth',
  'geometry.glowWidth',
  'detail.edgeWobble',
  'organic.contourVariation'
] as const

const createDiagnostics = (): {
  applies: number
  liveFallbacks: number
  unstableFrames: number
  cacheBakes: number
  cacheBakeMs: number
  cacheHits: number
  invalidations: number
  changedInputs: Record<string, number>
} => ({
  applies: 0,
  liveFallbacks: 0,
  unstableFrames: 0,
  cacheBakes: 0,
  cacheBakeMs: 0,
  cacheHits: 0,
  invalidations: 0,
  changedInputs: {}
})

/** Reuses sprite silhouette distances while keeping the animated material live. */
export class CachedOutlineFilter extends Filter {
  private static diagnostics = createDiagnostics()

  static resetDiagnostics(): void {
    this.diagnostics = createDiagnostics()
  }

  static getDiagnostics(): OutlineCacheDiagnostics {
    return {
      ...this.diagnostics,
      changedInputs: { ...this.diagnostics.changedInputs }
    }
  }

  private readonly mapping = new Matrix()
  private readonly referenceMapping = new Matrix()
  private readonly cacheUniforms = new UniformGroup({
    uCacheX: { value: [1, 0, 0, 1], type: 'vec4<f32>' },
    uCacheY: { value: [0, 1, 0, 0], type: 'vec4<f32>' },
    uCacheSize: { value: [1, 1, 1, 1], type: 'vec4<f32>' }
  })
  private previousInputs: readonly number[] = []
  private cache: RenderTexture | null = null
  private cacheValid = false
  private bakeFilter: Filter | null = null
  private cachedFilter: Filter | null = null
  private watchedTexture: Texture | null = null
  private watchedSource: TextureSource | null = null
  private cacheRenderer: FilterSystem['renderer'] | null = null
  private readonly invalidate = (): void => {
    CachedOutlineFilter.diagnostics.invalidations += 1
    this.cacheValid = false
    this.previousInputs = []
  }

  constructor(
    private readonly target: Sprite,
    private readonly options: FilterWithShader,
    private readonly outlineUniforms: UniformGroup
  ) {
    super(options)
  }

  override apply(
    system: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clear: boolean
  ): void {
    CachedOutlineFilter.diagnostics.applies += 1
    const renderer = system.renderer
    if (renderer !== this.cacheRenderer) {
      this.cacheRenderer?.runners.contextChange?.remove(this)
      this.resetCache()
      this.cacheRenderer = renderer
      renderer.runners.contextChange?.add(this)
    }
    // Packed-float reads require WebGL 2 (or WebGPU). Keep the original
    // shader for unsupported contexts and for composed filter chains.
    if (
      ('gl' in renderer && renderer.context.webGLVersion !== 2) ||
      this.target.filters?.length !== 1 ||
      input.source.pixelWidth * input.source.pixelHeight > 4_194_304
    ) {
      CachedOutlineFilter.diagnostics.liveFallbacks += 1
      this.resetCache()
      super.apply(system, input, output, clear)
      return
    }

    this.watchTexture()
    // Keep the complete mapping, including clipping/subpixel offsets. The
    // saved mapping lets the shader find reference distances after movement.
    const mapping = system.calculateSpriteMatrix(this.mapping, this.target)
    const uniforms = this.outlineUniforms.uniforms
    const geometry = uniforms.uGeometry as number[]
    const detail = uniforms.uDetail as number[]
    const organic = uniforms.uOrganic as number[]
    const texture = this.target.texture
    const current = [
      this.target.getGlobalAlpha(),
      texture.uid,
      texture.source.uid,
      texture.source._resourceId,
      Number(input.source.antialias),
      this.padding,
      geometry[0],
      geometry[1],
      geometry[2],
      detail[3],
      organic[0]
    ]
    const sameSilhouette =
      current.length === this.previousInputs.length &&
      current.every((value, index) => value === this.previousInputs[index])
    if (!sameSilhouette) {
      CachedOutlineFilter.diagnostics.unstableFrames += 1
      for (let index = 0; index < current.length; index += 1) {
        if (current[index] === this.previousInputs[index]) continue
        const inputName = INPUT_NAMES[index] ?? `input.${index}`
        CachedOutlineFilter.diagnostics.changedInputs[inputName] =
          (CachedOutlineFilter.diagnostics.changedInputs[inputName] ?? 0) + 1
      }
    }
    this.previousInputs = current
    if (!sameSilhouette) this.cacheValid = false

    let projection =
      this.cacheValid && this.cache
        ? mapOutlineDistance(
            mapping,
            this.referenceMapping,
            input.source,
            this.cache.source
          )
        : null
    if (!projection) this.cacheValid = false

    if (!this.cacheValid) {
      this.ensureCache(input)
      const cache = this.cache!
      // RGBA8 stores all 32 bits of each distance. Dithering or blending
      // would corrupt those bytes; neither is appropriate for this data pass.
      const gl = 'gl' in renderer ? renderer.gl : null
      const dither = gl?.isEnabled(gl.DITHER) ?? false
      if (dither) gl!.disable(gl!.DITHER)
      try {
        const startedAt = performance.now()
        system.applyFilter(this.bakeFilter!, input, cache, true)
        CachedOutlineFilter.diagnostics.cacheBakeMs += performance.now() - startedAt
      } finally {
        if (dither) gl!.enable(gl!.DITHER)
      }
      CachedOutlineFilter.diagnostics.cacheBakes += 1
      this.referenceMapping.copyFrom(mapping)
      this.cacheValid = true
      const size = this.cacheUniforms.uniforms.uCacheSize as number[]
      size[0] = cache.source.pixelWidth
      size[1] = cache.source.pixelHeight
      size[2] = Math.round(input.frame.width * input.source.resolution)
      size[3] = Math.round(input.frame.height * input.source.resolution)
      projection = mapOutlineDistance(
        mapping,
        this.referenceMapping,
        input.source,
        cache.source
      )
    }
    if (!projection) {
      // Degenerate/near-zero transforms cannot safely map a distance field.
      CachedOutlineFilter.diagnostics.liveFallbacks += 1
      super.apply(system, input, output, clear)
      return
    }
    Object.assign(this.cacheUniforms.uniforms.uCacheX, projection.x)
    Object.assign(this.cacheUniforms.uniforms.uCacheY, projection.y)
    this.cacheUniforms.update()
    CachedOutlineFilter.diagnostics.cacheHits += 1
    system.applyFilter(this.cachedFilter!, input, output, clear)
  }

  /** Release GPU storage when the outline is hidden, without owning its artwork. */
  resetCache(): void {
    this.invalidate()
    this.releaseCacheTexture()
  }

  /** A restored graphics context has lost the cached GPU contents. */
  contextChange(): void {
    this.resetCache()
  }

  override destroy(destroyPrograms = false): void {
    this.cacheRenderer?.runners.contextChange?.remove(this)
    this.cacheRenderer = null
    this.resetCache()
    this.unwatchTexture()
    this.bakeFilter?.destroy(destroyPrograms)
    this.cachedFilter?.destroy(destroyPrograms)
    this.bakeFilter = null
    this.cachedFilter = null
    super.destroy(destroyPrograms)
  }

  private ensureCache(input: Texture): void {
    const source = input.source
    if (
      this.cache &&
      (this.cache.source.pixelWidth !== source.pixelWidth ||
        this.cache.source.pixelHeight !== source.pixelHeight ||
        this.cache.source.resolution !== source.resolution)
    ) {
      this.releaseCacheTexture()
    }
    if (!this.cache) {
      this.cache = RenderTexture.create({
        width: source.width,
        height: source.height,
        resolution: source.resolution,
        format: 'rgba8unorm',
        antialias: false,
        scaleMode: 'nearest',
        autoGenerateMipmaps: false,
        autoGarbageCollect: false,
        label: 'outline-distance-cache'
      })
      this.cache.source.on('unload', this.invalidate)
    }
    this.cache.frame.copyFrom(input.frame)
    this.cache.updateUvs()
    this.bakeFilter ??= new Filter({
      ...this.options,
      glProgram: createGhostAuraGlProgram('distance'),
      gpuProgram: createGhostAuraGpuProgram('distance'),
      antialias: false,
      blendMode: 'none'
    })
    this.cachedFilter ??= new Filter({
      ...this.options,
      glProgram: createGhostAuraGlProgram('cached'),
      gpuProgram: createGhostAuraGpuProgram('cached'),
      resources: {
        ...this.options.resources,
        cacheUniforms: this.cacheUniforms,
        uDistanceCache: this.cache.source
      }
    })
    this.cachedFilter.resources.uDistanceCache = this.cache.source
  }

  private releaseCacheTexture(): void {
    // Pixi destroys a BindGroup when a resource still bound to it is
    // destroyed. Detach first on every release path, including hover resize,
    // so the cached shader's resource setter remains usable for its replacement.
    if (this.cachedFilter)
      this.cachedFilter.resources.uDistanceCache = Texture.EMPTY.source
    this.cache?.source.off('unload', this.invalidate)
    this.cache?.destroy(true)
    this.cache = null
    this.cacheValid = false
  }

  private watchTexture(): void {
    const texture = this.target.texture
    if (texture === this.watchedTexture && texture.source === this.watchedSource) return
    this.unwatchTexture()
    this.watchedTexture = texture
    this.watchedSource = texture.source
    texture.on('update', this.invalidate)
    texture.source.on('update', this.invalidate)
    texture.source.on('styleChange', this.invalidate)
    this.invalidate()
  }

  private unwatchTexture(): void {
    this.watchedTexture?.off('update', this.invalidate)
    this.watchedSource?.off('update', this.invalidate)
    this.watchedSource?.off('styleChange', this.invalidate)
    this.watchedTexture = null
    this.watchedSource = null
  }
}
