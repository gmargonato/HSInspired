import {
  BlurFilter,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  type Renderer,
  type Texture
} from 'pixi.js'

// Match-style softness, baked once rather than filtered on every card/frame.
const BODY_SIZE = 256
const BLUR = 1.5
const PADDING = Math.ceil(BLUR * 3)

export interface CardShadowTextureLease {
  readonly texture: Texture
  readonly bodySize: number
  readonly padding: number
  release(): void
}

interface Entry {
  texture: Texture
  references: number
}

const textures = new WeakMap<Renderer, Entry>()

function bakeTexture(renderer: Renderer): Texture {
  const body = new Graphics()
    .roundRect(0, 0, BODY_SIZE, BODY_SIZE, BODY_SIZE * 0.09)
    .fill(0x000000)
  body.label = 'card-shadow.bake'
  const blur = new BlurFilter({
    strength: BLUR,
    quality: 2,
    resolution: 1,
    legacy: true
  })
  body.filters = [blur]
  try {
    const texture = renderer.generateTexture({
      target: body,
      frame: new Rectangle(
        -PADDING,
        -PADDING,
        BODY_SIZE + PADDING * 2,
        BODY_SIZE + PADDING * 2
      ),
      resolution: 1,
      antialias: true,
      clearColor: [0, 0, 0, 0]
    })
    // Retained leases own GPU residency, including between collection visits.
    texture.source.autoGarbageCollect = false
    try {
      warmSprite(renderer, texture)
      return texture
    } catch (error) {
      texture.destroy(true)
      throw error
    }
  } finally {
    body.destroy()
    blur.destroy()
  }
}

function warmSprite(renderer: Renderer, texture: Texture): void {
  const sprite = new Sprite(texture)
  sprite.label = 'card-shadow.warmup'
  sprite.width = sprite.height = 32
  const target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
  try {
    renderer.render({ container: sprite, target, clear: true })
  } finally {
    sprite.destroy()
    target.destroy(true)
  }
}

/** Startup and collection views share one resident texture per renderer. */
export function acquireCardShadowTexture(renderer: Renderer): CardShadowTextureLease {
  let entry = textures.get(renderer)
  if (!entry) {
    entry = { texture: bakeTexture(renderer), references: 0 }
    textures.set(renderer, entry)
  }
  const acquired = entry
  acquired.references++
  let released = false
  return {
    texture: acquired.texture,
    bodySize: BODY_SIZE,
    padding: PADDING,
    release() {
      if (released) return
      released = true
      if (--acquired.references !== 0) return
      textures.delete(renderer)
      acquired.texture.destroy(true)
    }
  }
}
