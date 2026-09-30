import { Sprite, Texture, type Renderer } from 'pixi.js'
import { createAuraDistanceField } from './aura-distance-field'

type Field = ReturnType<typeof createAuraDistanceField>
export interface AuraFieldLease {
  readonly field: Field
  readonly valid: boolean
  release(): void
}
interface Entry {
  signature: string
  field: Field
  references: number
  valid: boolean
  detach(): void
}
const caches = new WeakMap<Renderer, Map<Texture, Entry>>()

function signature(source: Texture): string {
  const frame = source.frame
  return `${source.source.uid}:${frame.x}:${frame.y}:${frame.width}:${frame.height}:${source.source.resolution}`
}

export function hasAuraField(renderer: Renderer, source: Texture): boolean {
  const entry = caches.get(renderer)?.get(source)
  return !!entry?.valid && entry.signature === signature(source)
}

/** Shared by equal source silhouettes, never keyed by animation, palette or pose. */
export function acquireAuraField(renderer: Renderer, source: Texture): AuraFieldLease {
  let cache = caches.get(renderer)
  if (!cache) {
    cache = new Map()
    caches.set(renderer, cache)
  }
  let entry = cache.get(source)
  if (!entry?.valid || entry.signature !== signature(source)) {
    const sprite = new Sprite(source)
    let canvas
    try {
      canvas = renderer.extract.canvas(sprite)
    } finally {
      sprite.destroy({ texture: false })
    }
    const field = createAuraDistanceField(
      canvas as CanvasImageSource,
      canvas.width,
      canvas.height
    )
    const invalidate = (): void => {
      created.valid = false
    }
    const textureSource = source.source
    const created: Entry = {
      signature: signature(source),
      field,
      references: 0,
      valid: true,
      detach: () => {
        source.off('update', invalidate)
        textureSource.off('update', invalidate)
        textureSource.off('unload', invalidate)
        textureSource.off('destroy', invalidate)
      }
    }
    source.on('update', invalidate)
    textureSource.on('update', invalidate)
    textureSource.on('unload', invalidate)
    textureSource.on('destroy', invalidate)
    cache.set(source, created)
    entry = created
  }
  const acquired = entry
  acquired.references++
  let released = false
  return {
    field: acquired.field,
    get valid() {
      return acquired.valid
    },
    release() {
      if (released) return
      released = true
      if (--acquired.references !== 0) return
      if (cache.get(source) === acquired) cache.delete(source)
      acquired.detach()
      acquired.field.texture.destroy(true)
    }
  }
}
