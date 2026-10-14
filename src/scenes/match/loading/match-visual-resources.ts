import type { Renderer, Texture, TextureSource } from 'pixi.js'
import { configureCardTexture } from '../../../visual-components/assets/card-asset-resolver'

// Two match scenes may overlap during a transition. The final owner restores
// the original setting, including textures already pinned by menu startup.
const residency = new WeakMap<TextureSource, { count: number; automatic: boolean }>()

/** Board variants are fixed for the match; do not pin nine unused full-screen images. */
export function matchVisualTextures(
  assets: Readonly<Record<string, Texture>>,
  board: Texture
): readonly Texture[] {
  return [
    board,
    ...Object.entries(assets)
      .filter(([key]) => key !== 'boardBase' && !/^board\d+$/.test(key))
      .map(([, texture]) => texture)
  ]
}

/** Upload decoded match bundles before play and retain their GPU residency. */
export class MatchVisualResources {
  private readonly sources = new Set<TextureSource>()
  private disposed = false

  async prepare(
    renderer: Renderer,
    cardTextures: readonly Texture[],
    matchTextures: readonly Texture[],
    onProgress?: (progress: number) => Promise<void>
  ): Promise<void> {
    if (this.disposed) return
    // This can unload a shared source. Configure every card texture before the
    // upload queue or any outline/shader warm-up touches game/hero aliases.
    cardTextures.forEach(configureCardTexture)
    const textures: Texture[] = []
    for (const texture of [...cardTextures, ...matchTextures]) {
      const source = texture.source
      if (this.sources.has(source)) continue
      const lease = residency.get(source) ?? {
        count: 0,
        automatic: source.autoGarbageCollect
      }
      lease.count++
      residency.set(source, lease)
      source.autoGarbageCollect = false
      this.sources.add(source)
      textures.push(texture)
    }
    try {
      // Use the same synchronous upload operation as Pixi's prepare system, in
      // bounded batches. Its async queue does not reject upload exceptions and
      // can leave its promise pending forever; catch failures in our own scope.
      for (let offset = 0; offset < textures.length && !this.disposed; offset += 4) {
        const batch = textures.slice(offset, offset + 4)
        for (const texture of batch) renderer.texture.initSource(texture.source)
        if (onProgress) await onProgress((offset + batch.length) / textures.length)
        else await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  dispose(): void {
    this.disposed = true
    for (const source of this.sources) {
      const lease = residency.get(source)!
      if (--lease.count === 0) {
        source.autoGarbageCollect = lease.automatic
        residency.delete(source)
      }
    }
    this.sources.clear()
  }
}
