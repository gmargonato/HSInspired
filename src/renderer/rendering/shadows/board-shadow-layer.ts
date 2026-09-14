import {
  BlurFilter,
  Container,
  Graphics,
  Matrix,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  type Renderer,
  type Texture
} from 'pixi.js'
import { MATCH_SHADOW_CONFIG as config } from './match-shadow-config'
import { shadowBodyCorners, shadowCasters, type ShadowCaster } from './shadow-caster'

const SHAPE_SIZE = 256

function destroyShadow(shadow: Sprite | PerspectiveMesh): void {
  // Mesh geometry is owned here; its baked texture is shared with other shadows.
  if (shadow instanceof PerspectiveMesh) shadow.geometry.destroy(true)
  shadow.destroy()
}

export function shadowHeight(caster: ShadowCaster, magnification: number): number {
  const rest = caster.restingHeight ?? config.restingHeight
  return Math.min(
    config.maxHeight,
    caster.maximumHeight,
    Math.max(
      caster.minimumHeight,
      rest + config.liftStrength * Math.max(0, magnification - 1)
    )
  )
}

export function smoothShadowHeight(
  current: number,
  target: number,
  deltaMS: number
): number {
  if (config.responseMs <= 0) return target
  const next =
    current +
    (target - current) * -Math.expm1(-Math.max(0, deltaMS) / config.responseMs)
  return Math.abs(next - target) < 0.01 ? target : next
}

/** Alpha relative to the ground root: shared scene fades must not be applied twice. */
function visibleAlpha(
  visual: Container,
  root: Container,
  excluded: ReadonlySet<Container>
): number {
  let alpha = 1
  for (let node: Container | null = visual; node && node !== root; node = node.parent) {
    if (node.destroyed || !node.visible || !node.renderable || excluded.has(node))
      return 0
    alpha *= node.alpha
    if (node.parent === root) return alpha
  }
  return 0
}

/** Shared soft shape textures; no live blur filters or offscreen passes during animation. */
export class BoardShadowLayer extends Container {
  private readonly shapes = new Map<ShadowCaster['shape'], Texture>()
  private readonly shapePadding = Math.ceil(Math.max(0, config.blur) * 3)
  private readonly shadows = new Map<ShadowCaster, Sprite | PerspectiveMesh>()
  private readonly excludedRoots = new Set<Container>()
  private readonly inverseGround = new Matrix()
  private readonly transform = new Matrix()
  private readonly footprint = new Matrix()

  constructor(
    private readonly ground: Container,
    private readonly renderer: Renderer
  ) {
    super()
    this.label = 'game.ground-shadows'
    this.eventMode = 'none'
  }

  /** Modal previews can reuse physical visuals without casting onto the board. */
  exclude(...roots: Container[]): void {
    for (const root of roots) this.excludedRoots.add(root)
  }

  private shapeTexture(shape: ShadowCaster['shape']): Texture {
    const existing = this.shapes.get(shape)
    if (existing) return existing
    const graphic = new Graphics()
    if (shape === 'ellipse')
      graphic.circle(SHAPE_SIZE / 2, SHAPE_SIZE / 2, SHAPE_SIZE / 2)
    else graphic.roundRect(0, 0, SHAPE_SIZE, SHAPE_SIZE, SHAPE_SIZE * 0.09)
    graphic.fill(0x000000)
    const blur =
      config.blur > 0
        ? new BlurFilter({ strength: config.blur, quality: 2, resolution: 1 })
        : null
    graphic.filters = blur ? [blur] : null
    const pad = this.shapePadding
    try {
      const texture = this.renderer.generateTexture({
        target: graphic,
        frame: new Rectangle(-pad, -pad, SHAPE_SIZE + pad * 2, SHAPE_SIZE + pad * 2),
        resolution: 1,
        antialias: true,
        clearColor: [0, 0, 0, 0]
      })
      this.shapes.set(shape, texture)
      return texture
    } finally {
      graphic.destroy()
      blur?.destroy()
    }
  }

  update(deltaMS: number): void {
    this.visible = config.enabled && config.depth > 0
    for (const [caster, shadow] of this.shadows) {
      if (
        caster.owner.destroyed ||
        visibleAlpha(caster.visual, this.ground, this.excludedRoots) <= 0
      ) {
        destroyShadow(shadow)
        this.shadows.delete(caster)
      } else {
        shadow.visible = false
      }
    }
    if (!this.visible) return
    this.ground.getGlobalTransform(this.inverseGround)
    const ground = this.inverseGround
    // A zero-size viewport must not poison smoothed height with NaN.
    if (Math.abs(ground.a * ground.d - ground.b * ground.c) < 1e-10) return
    ground.invert()
    for (const caster of shadowCasters()) {
      const alpha = visibleAlpha(caster.visual, this.ground, this.excludedRoots)
      if (alpha <= 0) continue

      // Refresh live transforms; GSAP can move objects before Pixi's render update.
      caster.owner.getGlobalTransform(this.transform)
      this.transform.prepend(this.inverseGround)
      const magnification =
        caster.magnification ??
        Math.max(
          Math.hypot(this.transform.a, this.transform.b),
          Math.hypot(this.transform.c, this.transform.d)
        ) / Math.max(0.0001, caster.restingScale)
      const target = shadowHeight(caster, magnification) * caster.depthMultiplier
      caster.height = smoothShadowHeight(caster.height ?? target, target, deltaMS)
      const height = caster.height * config.depth
      if (height <= 0) continue

      let shadow = this.shadows.get(caster)
      const corners = caster.corners
      if (shadow && shadow instanceof PerspectiveMesh !== !!corners) {
        destroyShadow(shadow)
        this.shadows.delete(caster)
        shadow = undefined
      }
      if (!shadow) {
        const texture = this.shapeTexture(caster.shape)
        shadow = corners
          ? new PerspectiveMesh({ texture, verticesX: 10, verticesY: 10 })
          : new Sprite(texture)
        // Mesh corners include padding explicitly; sprites offset their anchor instead.
        if (shadow instanceof Sprite)
          shadow.anchor.set(this.shapePadding / (SHAPE_SIZE + this.shapePadding * 2))
        shadow.label = `${caster.owner.label || 'game.piece'}.ground-shadow`
        shadow.eventMode = 'none'
        this.shadows.set(caster, shadow)
        this.addChild(shadow)
      }
      caster.visual.getGlobalTransform(this.transform)
      this.transform.prepend(this.inverseGround)
      const { x, y, width, height: bodyHeight } = caster.bounds
      if (corners && shadow instanceof PerspectiveMesh) {
        const pad = this.shapePadding
        const [a, b, c, d] = shadowBodyCorners(
          corners,
          { x: 0, y: 0, width: SHAPE_SIZE, height: SHAPE_SIZE },
          {
            x: -pad,
            y: -pad,
            width: SHAPE_SIZE + 2 * pad,
            height: SHAPE_SIZE + 2 * pad
          }
        )
        // Collapsed/edge-on quads cannot define a perspective transform.
        const area = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)
        if (
          ![a, b, c, d].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
          Math.abs(area) < 1e-6
        ) {
          shadow.visible = false
          continue
        }
        shadow.setCorners(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
        this.footprint.copyFrom(this.transform)
      } else {
        this.footprint.set(width / SHAPE_SIZE, 0, 0, bodyHeight / SHAPE_SIZE, x, y)
        this.footprint.prepend(this.transform)
      }
      this.footprint.tx += height * config.lightOffset.x
      this.footprint.ty += height * config.lightOffset.y
      shadow.setFromMatrix(this.footprint)
      const proximity =
        1 -
        Math.min(
          1,
          Math.max(
            0,
            (caster.height - config.restingHeight) /
              Math.max(1, config.heldCardHeight - config.restingHeight)
          )
        )
      shadow.alpha =
        (config.opacity + config.groundOpacityBoost * proximity) *
        Math.min(1, height / config.restingHeight) *
        alpha
      shadow.visible = true
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    for (const shadow of this.shadows.values()) destroyShadow(shadow)
    this.shadows.clear()
    this.excludedRoots.clear()
    for (const shape of this.shapes.values()) shape.destroy(true)
    this.shapes.clear()
    super.destroy(options)
  }
}
