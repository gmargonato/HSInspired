import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Matrix,
  Point,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type Renderer
} from 'pixi.js'
import 'pixi.js/advanced-blend-modes'
import type { CardDefinition } from '../../../game/content/cards'
import { supportsPremiumFormat } from '../../../game/progression/premium-support'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import {
  CARD_NAME_FIT,
  CARD_RULES_COMPACT_SPACING,
  formatCardRulesText,
  buildCardLayout,
  type CardBounds,
  type CardLayout,
  type CardRenderNode,
  type CardRenderOptions,
  type CardTextLayer
} from './card-layout'
import { resolveCardTitleFit } from './card-title-fit'
import {
  classFrameAppearanceFor,
  subscribeToClassFrameConfig,
  type ClassFrameBlendMode,
  shouldRenderClassFrameColors
} from './class-frame-colors'
import type { ClassFrameLayerAppearance } from './class-frame-colors'
import {
  isCardPremium,
  isPremiumEnabled,
  subscribeToPremiumAppearance
} from '../premium-appearance'
import {
  PremiumArtworkBreath,
  isArtworkVisible
} from '../effects/premium-artwork-breath'

export interface CardViewOptions extends CardRenderOptions {
  readonly premiumSide?: 'local' | 'remote'
  readonly ignorePremiumOverride?: boolean
  readonly animatePremiumArtwork?: boolean
  readonly artwork?: Texture
  readonly snapshot?: {
    readonly currentCost?: number
    readonly attack?: number
    readonly health?: number
    readonly maxHealth?: number
    readonly durability?: number
    readonly maxDurability?: number
    readonly rulesText?: string
    readonly silenced?: boolean
  }
}

export interface CardLayerAppearance {
  readonly alpha?: number
  readonly tint?: number
  readonly blendMode?: ClassFrameBlendMode
}

export interface CardAppearanceSnapshotOptions {
  /** Let a presentation refresh once immediately before the scene renders. */
  readonly deferRefresh?: boolean
}

export interface CardPieceMotion {
  set(state: {
    x: number
    y: number
    scale: number
    rotation?: number
    visible: boolean
  }): void
  samplePoint(target: Container, u: number, v: number, out: Point): void
  restore(): void
}

export type CardCostColor = 'normal' | 'reduced' | 'increased'

const CARD_COST_COLORS: Record<CardCostColor, number> = {
  normal: 0xffffff,
  reduced: 0x6cff47,
  increased: 0xff4a4a
}

/** Read-only production diagnostics for a semantic card node. */
export interface CardNodeMetadata {
  readonly path: string
  readonly id: string
  readonly kind: CardRenderNode['kind']
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly visible: boolean
  readonly assetKey?: string
  readonly text?: string
  readonly fontSize?: number
  readonly lineHeight?: number
}

interface TreeObjectEntry {
  readonly node: CardRenderNode
  readonly object: Container | Sprite | Text
}

function drawShape(graphics: Graphics, bounds: CardBounds, color: number): void {
  graphics.rect(bounds.x, bounds.y, bounds.width, bounds.height)
  graphics.fill(color)
}

function drawShapeOutline(graphics: Graphics, bounds: CardBounds, color: number): void {
  graphics.rect(bounds.x, bounds.y, bounds.width, bounds.height)
  graphics.stroke({ color, width: 3, alpha: 0.9 })
}

function cubicBezier(
  start: number,
  control1: number,
  control2: number,
  end: number,
  t: number
): number {
  const inverse = 1 - t
  return (
    inverse * inverse * inverse * start +
    3 * inverse * inverse * t * control1 +
    3 * inverse * t * t * control2 +
    t * t * t * end
  )
}

function cubicBezierDerivative(
  start: number,
  control1: number,
  control2: number,
  end: number,
  t: number
): number {
  const inverse = 1 - t
  return (
    3 * inverse * inverse * (control1 - start) +
    6 * inverse * t * (control2 - control1) +
    3 * t * t * (end - control2)
  )
}

function createCurvedText(layer: CardTextLayer): Container {
  const textLayer = new Container()
  const curve = layer.curve
  if (!curve) return textLayer

  const characters = Array.from(layer.text)
  const measurementStyle = { ...layer.style, stroke: undefined }
  const glyphs = characters.map(
    (character) =>
      new Text({
        text: character,
        style: layer.style,
        anchor: { x: 0.5, y: 0.5 }
      })
  )
  const glyphWidths = characters.map((character) => {
    if (character === ' ') return layer.style.fontSize * 0.28
    return new Text({
      text: character,
      style: measurementStyle,
      anchor: { x: 0.5, y: 0.5 }
    }).width
  })
  const totalWidth = glyphWidths.reduce((width, glyphWidth) => width + glyphWidth, 0)
  let cursor = -totalWidth / 2

  for (const [index, glyph] of glyphs.entries()) {
    const glyphWidth = glyphWidths[index]
    const glyphCenter = cursor + glyphWidth / 2
    const t = totalWidth === 0 ? 0.5 : (glyphCenter + totalWidth / 2) / totalWidth
    const y = cubicBezier(curve.startY, curve.control1Y, curve.control2Y, curve.endY, t)
    const slope = cubicBezierDerivative(
      curve.startY,
      curve.control1Y,
      curve.control2Y,
      curve.endY,
      t
    )

    glyph.position.set(glyphCenter, y)
    glyph.rotation = Math.atan2(slope, totalWidth)
    textLayer.addChild(glyph)
    cursor += glyphWidth
  }

  textLayer.position.set(layer.position.x, layer.position.y)
  return textLayer
}

function cardTextLayer(node: Extract<CardRenderNode, { kind: 'text' }>): CardTextLayer {
  const anchor = node.anchor ?? { x: 0, y: 0 }
  return {
    kind: 'text',
    id: node.id,
    text: node.text,
    position: {
      x: node.box.x + node.box.width * anchor.x,
      y: node.box.y + node.box.height * anchor.y
    },
    anchor,
    fit: node.fit,
    style: {
      ...node.style,
      wordWrap: node.style.wordWrap ?? true,
      wordWrapWidth: node.style.wordWrapWidth ?? node.box.width
    },
    curve: node.curve,
    zIndex: node.zIndex
  }
}

function updateRulesLineHeight(text: Text, defaultLineHeight: number): void {
  const { lines } = CanvasTextMetrics.measureText(text.text, text.style)
  text.style.lineHeight =
    lines.length >= CARD_RULES_COMPACT_SPACING.minimumLines
      ? CARD_RULES_COMPACT_SPACING.lineHeight
      : defaultLineHeight
}

function fitTitleToWidth(text: Text, boxWidth: number): void {
  const maxWidth = Math.max(1, boxWidth - CARD_NAME_FIT.horizontalPadding * 2)
  const fit = resolveCardTitleFit({
    maxFontSize: text.style.fontSize,
    minFontSize: CARD_NAME_FIT.minFontSize,
    maxWidth,
    measureWidth: (fontSize) => {
      text.scale.set(1)
      text.style.fontSize = fontSize
      return text.width
    }
  })

  text.style.fontSize = fit.fontSize
  text.scale.set(fit.scale)
}

function drawNodeDebug(
  node: CardRenderNode,
  overlay: Container,
  parentPosition: { readonly x: number; readonly y: number }
): void {
  if (node.kind === 'group') {
    const position = {
      x: parentPosition.x + node.position.x,
      y: parentPosition.y + node.position.y
    }
    for (const child of node.children) drawNodeDebug(child, overlay, position)
    return
  }

  if (node.kind === 'artwork') {
    const bounds = {
      ...node.bounds,
      x: parentPosition.x + node.position.x + node.bounds.x,
      y: parentPosition.y + node.position.y + node.bounds.y
    }
    const shape = new Graphics()
    drawShapeOutline(shape, bounds, 0xffe066)
    overlay.addChild(shape)
    return
  }

  const bounds =
    node.kind === 'text'
      ? {
          ...node.box,
          x: parentPosition.x + node.box.x,
          y: parentPosition.y + node.box.y
        }
      : node.transform.size
        ? {
            x:
              parentPosition.x +
              node.transform.position.x -
              node.transform.size.width * (node.transform.anchor?.x ?? 0),
            y:
              parentPosition.y +
              node.transform.position.y -
              node.transform.size.height * (node.transform.anchor?.y ?? 0),
            width: node.transform.size.width,
            height: node.transform.size.height
          }
        : null

  if (!bounds) return
  const outline = new Graphics()
  outline.rect(bounds.x, bounds.y, bounds.width, bounds.height)
  outline.stroke({
    color: node.kind === 'text' ? 0x55e6ff : 0x8dff8d,
    width: 2,
    alpha: 0.85
  })
  overlay.addChild(outline)
}

export class CardView extends Container {
  private activePlan: CardLayout
  get plan(): CardLayout {
    return this.activePlan
  }
  readonly renderedHeight: number

  private readonly layerObjects = new Map<string, Array<Container | Sprite | Text>>()
  private readonly treeObjects = new Map<string, TreeObjectEntry>()
  private readonly basePositions = new Map<string, { x: number; y: number }>()
  private readonly semanticOffsets = new Map<string, { x: number; y: number }>()
  private unsubscribeClassFrameConfig: (() => void) | null = null
  private unsubscribePremium: (() => void) | null = null
  private premiumAppearancePaused = false
  private pendingPremiumRefresh: (() => void) | null = null
  private premium = false
  private premiumPresentation: boolean | null = null
  private refreshPremiumPresentation: (() => void) | null = null
  private readonly alphaMasks = new Map<string, Sprite>()
  private readonly appearanceSnapshots = new Set<() => void>()
  private readonly deferredSnapshots = new Map<
    Texture,
    { dirty: boolean; refresh: () => void }
  >()
  private snapshotRevision = 0
  private readonly content: Container
  private staticLayers: Container | null = null
  private artworkBreath: PremiumArtworkBreath | null = null
  private readonly animatedSnapshots = new Map<
    Texture,
    { refresh: () => void; isVisible: () => boolean }
  >()

  private constructor(plan: CardLayout) {
    super()
    this.activePlan = plan
    this.sortableChildren = true
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, plan.width, plan.height * plan.renderScaleY)
    this.label = `card:${plan.cardId}`

    this.renderedHeight = plan.height * plan.renderScaleY
    this.content = new Container()
    this.content.sortableChildren = true
    this.content.scale.y = plan.renderScaleY
    this.addChild(this.content)
  }

  static async create(
    card: CardDefinition,
    resolver: CardAssetResolver,
    options: CardViewOptions = {}
  ): Promise<CardView> {
    // Start with both standard class-mask sprites mounted so switching is synchronous.
    const view = new CardView(buildCardLayout(card, { ...options, premium: false }))
    const supportsPremium = supportsPremiumFormat(card.type)
    try {
      await view.build(resolver, options.artwork)
      if (supportsPremium && options.animatePremiumArtwork && options.artwork) {
        view.prepareArtworkBreathing()
      }
      if (supportsPremium) await view.preparePremiumAppearance(card, resolver, options)
      if (options.snapshot) view.applySnapshot(card, options.snapshot)
      if (
        shouldRenderClassFrameColors(options.classFrameColors) &&
        (card.type === 'Minion' || card.type === 'Spell')
      ) {
        view.setClassFrameAppearance(card.cardClass)
        view.unsubscribeClassFrameConfig = subscribeToClassFrameConfig(() => {
          view.setClassFrameAppearance(card.cardClass)
        })
      }
    } catch (error) {
      view.destroy({ children: true })
      throw error
    }
    return view
  }

  /** Collapse a completed card tree to one GPU surface until semantic content changes. */
  enableTextureCache(): void {
    if (this.staticLayers) {
      this.staticLayers.cacheAsTexture({ antialias: true, resolution: 1 })
      return
    }
    if (this.isCachedAsTexture) return
    this.cacheAsTexture({ antialias: true, resolution: 1 })
  }

  /** Keep frozen backdrops unchanged; apply the latest appearance when resumed. */
  setPremiumAppearancePaused(paused: boolean): void {
    this.premiumAppearancePaused = paused
    if (paused || this.destroyed) return
    const refresh = this.pendingPremiumRefresh
    this.pendingPremiumRefresh = null
    refresh?.()
  }

  /** Avoid nested cache rendering when an ancestor composites live card layers. */
  disableTextureCache(): void {
    this.cacheAsTexture(false)
    this.staticLayers?.cacheAsTexture(false)
  }

  override updateCacheTexture = (): void => {
    Container.prototype.updateCacheTexture.call(this)
    this.staticLayers?.updateCacheTexture()
    this.snapshotRevision += 1
    for (const snapshot of this.deferredSnapshots.values()) snapshot.dirty = true
  }

  /** Lets prepared presentations validate their bounds only after semantic changes. */
  get appearanceRevision(): number {
    return this.snapshotRevision
  }

  private prepareArtworkBreathing(): void {
    const artwork = this.treeObjects.get('card.artwork')?.object
    const root = this.treeObjects.get('card')?.object
    if (!artwork || !root) return
    const staticLayers = new Container()
    staticLayers.label = `${this.plan.cardId}:card.static-layers`
    staticLayers.sortableChildren = true
    staticLayers.zIndex = 1
    // Artwork is the bottom layer; everything above it can remain cached.
    for (const child of [...root.children]) {
      if (child !== artwork) staticLayers.addChild(child)
    }
    root.addChild(staticLayers)
    this.staticLayers = staticLayers
    staticLayers.cacheAsTexture({ antialias: true, resolution: 1 })
    this.artworkBreath = new PremiumArtworkBreath(
      artwork,
      () =>
        (isArtworkVisible(this) && isArtworkVisible(artwork)) ||
        [...this.animatedSnapshots.values()].some((snapshot) => snapshot.isVisible()),
      () => {
        for (const snapshot of this.animatedSnapshots.values()) {
          if (snapshot.isVisible()) snapshot.refresh()
        }
      }
    )
  }

  /** Keeps temporary card-flight snapshots in sync with the session appearance. */
  createAppearanceSnapshot(
    renderer: Renderer,
    frame?: Rectangle,
    isVisible?: () => boolean,
    options: CardAppearanceSnapshotOptions = {}
  ): ReturnType<Renderer['generateTexture']> {
    const region = frame?.clone() ?? this.getLocalBounds().rectangle.clone()
    const texture = renderer.generateTexture({
      target: this,
      frame: region,
      antialias: true
    })
    const transform = new Matrix().translate(-region.x, -region.y)
    const refresh = (): void => {
      if (this.destroyed || texture.destroyed) return
      const visible = this.visible
      this.visible = true
      try {
        renderer.render({
          container: this,
          target: texture,
          transform,
          clear: true
        })
        texture.source.updateMipmaps()
      } finally {
        this.visible = visible
      }
    }
    const deferred = { dirty: false, refresh }
    const requestRefresh = options.deferRefresh
      ? (): void => {
          deferred.dirty = true
        }
      : refresh
    if (options.deferRefresh) this.deferredSnapshots.set(texture, deferred)
    this.appearanceSnapshots.add(requestRefresh)
    if (isVisible)
      this.animatedSnapshots.set(texture, { refresh: requestRefresh, isVisible })
    const source = texture.source
    if (options.deferRefresh) source.on('unload', requestRefresh)
    texture.once('destroy', () => {
      source.off('unload', requestRefresh)
      this.appearanceSnapshots.delete(requestRefresh)
      this.animatedSnapshots.delete(texture)
      this.deferredSnapshots.delete(texture)
    })
    return texture
  }

  /** Flush an opted-in snapshot after animation/input changes and before rendering. */
  flushAppearanceSnapshot(texture: Texture, force = false): void {
    const snapshot = this.deferredSnapshots.get(texture)
    if (!snapshot || (!force && !snapshot.dirty)) return
    snapshot.dirty = false
    try {
      snapshot.refresh()
    } catch (error) {
      snapshot.dirty = true
      throw error
    }
  }

  setClassFrameAppearance(classId: string): void {
    const appearance = classFrameAppearanceFor(classId)
    if (!appearance || !this.hasLayer('card.class-frame-mask-1')) return
    if (this.plan.template !== 'minion' && this.plan.template !== 'spell') return

    this.applyClassFrameLayer(
      'card.class-frame-mask-1',
      appearance.primary,
      this.plan.template
    )
    if (this.hasLayer('card.class-frame-mask-2')) {
      this.applyClassFrameLayer(
        'card.class-frame-mask-2',
        appearance.secondary,
        this.plan.template
      )
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.artworkBreath?.destroy()
    this.animatedSnapshots.clear()
    this.appearanceSnapshots.clear()
    this.deferredSnapshots.clear()
    this.unsubscribePremium?.()
    this.unsubscribePremium = null
    this.pendingPremiumRefresh = null
    this.unsubscribeClassFrameConfig?.()
    this.unsubscribeClassFrameConfig = null
    super.destroy(options)
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    const objects = this.layerObjects.get(layerId)
    if (!objects) throw new Error(`Unknown card layer: ${layerId}`)
    for (const object of objects) object.visible = visible
    this.updateCacheTexture()
  }

  get isPremium(): boolean {
    return this.premium
  }

  /** Pin a presentation during a transition; null resumes subscribed appearance. */
  setPremiumPresentation(premium: boolean | null): void {
    this.premiumPresentation = premium
    this.refreshPremiumPresentation?.()
  }

  /** Animate sibling semantic nodes as one piece without reparenting their layers. */
  createPieceMotion(paths: readonly string[]): CardPieceMotion {
    const objects = paths.map((path) => {
      const entry = this.treeObjects.get(path)
      if (!entry) throw new Error(`Unknown card node: ${path}`)
      return entry.object
    })
    if (
      !objects.length ||
      objects.some((object) => object.parent !== objects[0].parent)
    )
      throw new Error('Card piece nodes must be nonempty siblings.')
    const masks = paths.flatMap((path) => {
      const mask = this.alphaMasks.get(path)
      return mask ? [mask] : []
    })
    const bases = [...objects, ...masks].map((object) => ({
      object,
      x: object.x,
      y: object.y,
      scaleX: object.scale.x,
      scaleY: object.scale.y,
      rotation: object.rotation,
      visible: object.visible
    }))
    const bounds = objects.map((object) => {
      const local = object.getLocalBounds()
      return {
        left: object.x + (local.x - object.pivot.x) * object.scale.x,
        top: object.y + (local.y - object.pivot.y) * object.scale.y,
        right: object.x + (local.x + local.width - object.pivot.x) * object.scale.x,
        bottom: object.y + (local.y + local.height - object.pivot.y) * object.scale.y
      }
    })
    const centerX =
      (Math.min(...bounds.map((b) => b.left)) +
        Math.max(...bounds.map((b) => b.right))) /
      2
    const centerY =
      (Math.min(...bounds.map((b) => b.top)) +
        Math.max(...bounds.map((b) => b.bottom))) /
      2
    const width =
      Math.max(...bounds.map((b) => b.right)) - Math.min(...bounds.map((b) => b.left))
    const height =
      Math.max(...bounds.map((b) => b.bottom)) - Math.min(...bounds.map((b) => b.top))
    const sample = new Point()
    let current = { x: 0, y: 0, scale: 1, rotation: 0 }
    return {
      samplePoint: (target, u, v, out) => {
        const x = (u - 0.5) * width * current.scale
        const y = (v - 0.5) * height * current.scale
        const cos = Math.cos(current.rotation)
        const sin = Math.sin(current.rotation)
        sample.set(
          centerX + current.x + x * cos - y * sin,
          centerY + current.y + x * sin + y * cos
        )
        target.toLocal(sample, objects[0].parent!, out)
      },
      set: ({ x, y, scale, rotation = 0, visible }) => {
        if (this.destroyed) return
        current.x = x
        current.y = y
        current.scale = scale
        current.rotation = rotation
        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)
        for (const base of bases) {
          const dx = (base.x - centerX) * scale
          const dy = (base.y - centerY) * scale
          base.object.position.set(
            centerX + dx * cos - dy * sin + x,
            centerY + dx * sin + dy * cos + y
          )
          base.object.rotation = base.rotation + rotation
          base.object.scale.set(base.scaleX * scale, base.scaleY * scale)
          base.object.visible = base.visible && visible
        }
        this.updateCacheTexture()
      },
      restore: () => {
        if (this.destroyed) return
        current = { x: 0, y: 0, scale: 1, rotation: 0 }
        for (const base of bases) {
          base.object.position.set(base.x, base.y)
          base.object.scale.set(base.scaleX, base.scaleY)
          base.object.rotation = base.rotation
          base.object.visible = base.visible
        }
        this.updateCacheTexture()
      }
    }
  }

  isLayerVisible(layerId: string): boolean {
    const objects = this.layerObjects.get(layerId)
    if (!objects) throw new Error(`Unknown card layer: ${layerId}`)
    return objects.every((object) => object.visible)
  }

  hasLayer(layerId: string): boolean {
    return this.layerObjects.has(layerId)
  }

  /** Applies temporary visual treatment to one semantic card layer. */
  setLayerAppearance(layerId: string, appearance: CardLayerAppearance): void {
    const objects = this.layerObjects.get(layerId)
    if (!objects) throw new Error(`Unknown card layer: ${layerId}`)
    for (const object of objects) {
      if (appearance.alpha !== undefined) object.alpha = appearance.alpha
      if (appearance.tint !== undefined) object.tint = appearance.tint
      if (appearance.blendMode !== undefined) object.blendMode = appearance.blendMode
    }
    this.updateCacheTexture()
  }

  private applyClassFrameLayer(
    path: string,
    appearance: ClassFrameLayerAppearance,
    template: 'minion' | 'spell'
  ): void {
    this.setLayerAppearance(path, {
      alpha: appearance.alpha,
      tint: appearance.color,
      blendMode: appearance.blendMode
    })
    this.setSemanticLayerOffset(
      path,
      this.premium ? appearance.premiumOffsets[template] : appearance.offsets[template]
    )
  }

  /** Preload the small set of alternate textures; keep all live switching synchronous. */
  private async preparePremiumAppearance(
    card: CardDefinition,
    resolver: CardAssetResolver,
    options: CardViewOptions
  ): Promise<void> {
    const standard = this.plan
    const premium = buildCardLayout(card, { ...options, premium: true })
    const standardImages = standard.tree.root.children.filter(
      (node) => node.kind === 'image'
    )
    const premiumImages = premium.tree.root.children.filter(
      (node) => node.kind === 'image'
    )
    const changedIds = new Set(
      standardImages
        .filter((node) => {
          const alternate = premiumImages.find((candidate) => candidate.id === node.id)
          return (
            !alternate ||
            alternate.assetKey !== node.assetKey ||
            alternate.alphaMask?.assetKey !== node.alphaMask?.assetKey
          )
        })
        .map((node) => node.id)
    )
    const keys = new Set(
      [...standardImages, ...premiumImages]
        .filter((node) => changedIds.has(node.id))
        .flatMap((node) => [
          node.assetKey,
          ...(node.alphaMask ? [node.alphaMask.assetKey] : [])
        ])
    )
    const textures = new Map(
      await Promise.all(
        [...keys].map(async (key) => [key, await resolver.load(key)] as const)
      )
    )
    const apply = (enabled: boolean): void => {
      if (this.destroyed) return
      enabled &&= supportsPremiumFormat(card.type)
      this.premium = enabled
      this.artworkBreath?.setEnabled(enabled)
      this.activePlan = enabled ? premium : standard
      const images = enabled ? premiumImages : standardImages
      for (const id of changedIds) {
        const path = `card.${id}`
        const entry = this.treeObjects.get(path)
        if (!entry || !(entry.object instanceof Sprite)) continue
        const node = images.find((candidate) => candidate.id === id)
        if (!node) {
          entry.object.visible = false
          continue
        }
        const sprite = entry.object
        const transform = node.transform
        sprite.texture = textures.get(node.assetKey)!
        sprite.scale.set(transform.scale?.x ?? 1, transform.scale?.y ?? 1)
        if (transform.size) {
          sprite.width = transform.size.width
          sprite.height = transform.size.height
        }
        sprite.visible = node.visible ?? true
        this.basePositions.set(path, { ...transform.position })
        const offset = this.semanticOffsets.get(path) ?? { x: 0, y: 0 }
        sprite.position.set(
          transform.position.x + offset.x,
          transform.position.y + offset.y
        )
        this.treeObjects.set(path, { node, object: sprite })
        const mask = this.alphaMasks.get(path)
        if (mask && node.alphaMask) {
          mask.texture = textures.get(node.alphaMask.assetKey)!
          const size = node.alphaMask.transform.size
          if (size) {
            mask.width = size.width
            mask.height = size.height
          }
        }
      }
      const rulesNode = this.activePlan.tree.root.children.find(
        (node) => node.id === 'rules'
      )
      const rulesEntry = this.treeObjects.get('card.rules')
      if (rulesNode?.kind === 'text' && rulesEntry?.object instanceof Text) {
        rulesEntry.object.style.fill = rulesNode.style.fill
        if (rulesNode.style.stroke)
          rulesEntry.object.style.stroke = rulesNode.style.stroke
        this.treeObjects.set('card.rules', {
          node: rulesNode,
          object: rulesEntry.object
        })
      }
      this.setClassFrameAppearance(card.cardClass)
      this.updateCacheTexture()
      for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.isCachedAsTexture) ancestor.updateCacheTexture()
      }
      for (const refresh of this.appearanceSnapshots) refresh()
    }
    const refresh = (): void => {
      if (
        this.premiumPresentation !== null &&
        this.premiumPresentation === this.premium
      )
        return
      apply(
        this.premiumPresentation ??
          (options.ignorePremiumOverride
            ? options.premium === true
            : options.premium === undefined
              ? isCardPremium(card.id, options.premiumSide)
              : options.premium || isPremiumEnabled(options.premiumSide))
      )
    }
    this.refreshPremiumPresentation = refresh
    refresh()
    this.unsubscribePremium = subscribeToPremiumAppearance(() => {
      if (this.premiumAppearancePaused) {
        this.pendingPremiumRefresh = refresh
        return
      }
      refresh()
    })
  }

  /** Updates match-specific text while preserving authored wrapping and keyword styles. */
  setRulesText(rulesText: string): void {
    const entry = this.treeObjects.get('card.rules')
    if (!entry || !(entry.object instanceof Text)) return
    const text = formatCardRulesText({ id: this.plan.cardId, rulesText })
    if (entry.object.text === text) return
    entry.object.text = text
    if (entry.node.kind === 'text') {
      updateRulesLineHeight(
        entry.object,
        entry.node.style.lineHeight ?? entry.node.style.fontSize
      )
    }
    this.updateCacheTexture()
  }

  /** Refreshes the visible mana value without rebuilding the card tree. */
  setManaCost(cost: number): void {
    const entry = this.treeObjects.get('card.stats.mana.label')
    if (!entry || !(entry.object instanceof Text)) return
    entry.object.text = String(Math.max(0, Math.floor(cost)))
    this.updateCacheTexture()
  }

  /** Tints the mana value according to its derived cost relative to printed cost. */
  setManaCostColor(color: CardCostColor): void {
    const entry = this.treeObjects.get('card.stats.mana.label')
    if (!entry || !(entry.object instanceof Text)) return
    entry.object.style.fill = CARD_COST_COLORS[color]
    this.updateCacheTexture()
  }

  applySnapshot(
    card: CardDefinition,
    snapshot: NonNullable<CardViewOptions['snapshot']>
  ): void {
    const write = (
      name: string,
      value: number | undefined,
      base: number | null,
      damaged = false
    ): void => {
      if (value === undefined) return
      const node = this.treeObjects.get(`card.stats.${name}.label`)
      if (!node || !(node.object instanceof Text)) return
      node.object.text = String(Math.max(0, value))
      node.object.style.fill = damaged
        ? 0xff4a4a
        : base !== null && value > base
          ? 0x6cff47
          : 0xffffff
    }
    if (snapshot.currentCost !== undefined) {
      this.setManaCost(snapshot.currentCost)
      this.setManaCostColor(
        snapshot.currentCost < card.cost
          ? 'reduced'
          : snapshot.currentCost > card.cost
            ? 'increased'
            : 'normal'
      )
    }
    write(
      'attack',
      snapshot.attack,
      card.type === 'Minion' || card.type === 'Weapon' ? card.attack : null
    )
    write(
      'health',
      snapshot.health,
      card.type === 'Minion' ? card.health : null,
      snapshot.health !== undefined &&
        snapshot.health <
          (snapshot.maxHealth ?? (card.type === 'Minion' ? card.health : 0))
    )
    write(
      'durability',
      snapshot.durability,
      card.type === 'Weapon' ? card.durability : null,
      snapshot.durability !== undefined &&
        snapshot.durability < (snapshot.maxDurability ?? 0)
    )
    if (snapshot.rulesText !== undefined) this.setRulesText(snapshot.rulesText)
    if (snapshot.silenced) this.setLayerAppearance('card.rules', { alpha: 0.3 })
    this.updateCacheTexture()
  }

  /** Returns the authored semantic nodes for diagnostics and dev tooling. */
  getNodeMetadata(): readonly CardNodeMetadata[] {
    return [...this.treeObjects.entries()].map(([path, entry]) =>
      this.getNodeMetadataFor(path, entry)
    )
  }

  getNodeMetadataForPath(path: string): CardNodeMetadata {
    const entry = this.treeObjects.get(path)
    if (!entry) throw new Error(`Unknown card node: ${path}`)
    return this.getNodeMetadataFor(path, entry)
  }

  /** Applies transient presentation motion without changing authored layout. */
  setSemanticLayerOffset(
    path: string,
    offset: { readonly x: number; readonly y: number }
  ): void {
    const entry = this.treeObjects.get(path)
    const base = this.basePositions.get(path)
    if (!entry || !base) throw new Error(`Unknown card node: ${path}`)
    this.semanticOffsets.set(path, { x: offset.x, y: offset.y })
    entry.object.position.set(base.x + offset.x, base.y + offset.y)
    this.updateCacheTexture()
  }

  private getNodeMetadataFor(path: string, entry: TreeObjectEntry): CardNodeMetadata {
    const { node, object } = entry
    const metadata: CardNodeMetadata = {
      path,
      id: node.id,
      kind: node.kind,
      x: object.position.x,
      y: object.position.y,
      visible: object.visible
    }

    if (node.kind === 'image') {
      return {
        ...metadata,
        assetKey: node.assetKey,
        width: object.width,
        height: object.height
      }
    }
    if (node.kind === 'text') {
      return {
        ...metadata,
        x: node.box.x,
        y: node.box.y,
        width: node.box.width,
        height: node.box.height,
        text: node.text,
        fontSize: object instanceof Text ? object.style.fontSize : node.style.fontSize,
        lineHeight:
          object instanceof Text ? object.style.lineHeight : node.style.lineHeight
      }
    }
    if (node.kind === 'artwork') {
      return {
        ...metadata,
        x: node.position.x,
        y: node.position.y,
        width: node.bounds.width,
        height: node.bounds.height
      }
    }
    return metadata
  }

  private registerLayerObject(
    layerId: string,
    object: Container | Sprite | Text
  ): void {
    const objects = this.layerObjects.get(layerId) ?? []
    objects.push(object)
    this.layerObjects.set(layerId, objects)
  }

  private registerTreeObject(
    path: string,
    node: CardRenderNode,
    object: Container | Sprite | Text
  ): void {
    this.registerLayerObject(path, object)
    if (!this.layerObjects.has(node.id)) this.registerLayerObject(node.id, object)
    this.treeObjects.set(path, { node, object })
    this.basePositions.set(path, { x: object.position.x, y: object.position.y })
    object.eventMode = 'none'
  }

  private async buildTreeNode(
    node: CardRenderNode,
    parent: Container,
    resolver: CardAssetResolver,
    artwork: Texture | undefined,
    parentPath: string
  ): Promise<void> {
    const path = parentPath ? `${parentPath}.${node.id}` : node.id

    if (node.kind === 'group') {
      const group = new Container()
      group.position.set(node.position.x, node.position.y)
      group.zIndex = node.zIndex
      group.visible = node.visible ?? true
      group.sortableChildren = true
      group.label = `${this.plan.cardId}:${path}`
      parent.addChild(group)
      this.registerTreeObject(path, node, group)
      for (const child of node.children) {
        await this.buildTreeNode(child, group, resolver, artwork, path)
      }
      return
    }

    if (node.kind === 'artwork') {
      const artworkLayer = new Container()
      artworkLayer.position.set(node.position.x, node.position.y)
      const mask = new Graphics()
      drawShape(mask, node.bounds, 0xffffff)

      if (artwork) {
        const image = new Sprite(artwork)
        image.anchor.set(0)
        image.position.set(node.bounds.x, node.bounds.y)
        artworkLayer.addChild(image)
      } else {
        const placeholder = new Graphics()
        drawShape(placeholder, node.bounds, 0x535b65)
        artworkLayer.addChild(placeholder)
      }

      artworkLayer.mask = mask
      artworkLayer.addChild(mask)
      artworkLayer.zIndex = node.zIndex
      artworkLayer.visible = node.visible ?? true
      artworkLayer.label = `${this.plan.cardId}:${path}`
      parent.addChild(artworkLayer)
      this.registerTreeObject(path, node, artworkLayer)
      return
    }

    if (node.kind === 'image') {
      const texture = await resolver.load(node.assetKey)
      const sprite = new Sprite(texture)
      const transform = node.transform
      sprite.anchor.set(transform.anchor?.x ?? 0, transform.anchor?.y ?? 0)
      sprite.position.set(transform.position.x, transform.position.y)
      if (transform.size) sprite.width = transform.size.width
      if (transform.size) sprite.height = transform.size.height
      else if (transform.scale) sprite.scale.set(transform.scale.x, transform.scale.y)
      if (transform.rotation !== undefined) sprite.rotation = transform.rotation
      sprite.zIndex = node.zIndex
      sprite.visible = node.visible ?? true
      sprite.label = `${this.plan.cardId}:${path}`
      parent.addChild(sprite)
      if (node.alphaMask) {
        const mask = new Sprite(await resolver.load(node.alphaMask.assetKey))
        const maskTransform = node.alphaMask.transform
        mask.anchor.set(maskTransform.anchor?.x ?? 0, maskTransform.anchor?.y ?? 0)
        mask.position.set(maskTransform.position.x, maskTransform.position.y)
        if (maskTransform.size) mask.width = maskTransform.size.width
        if (maskTransform.size) mask.height = maskTransform.size.height
        else if (maskTransform.scale) {
          mask.scale.set(maskTransform.scale.x, maskTransform.scale.y)
        }
        if (maskTransform.rotation !== undefined) {
          mask.rotation = maskTransform.rotation
        }
        mask.eventMode = 'none'
        sprite.mask = mask
        this.alphaMasks.set(path, mask)
        parent.addChild(mask)
      }
      this.registerTreeObject(path, node, sprite)
      return
    }

    const layer = cardTextLayer(node)
    const text = node.curve
      ? createCurvedText(layer)
      : new Text({ text: layer.text, style: layer.style, anchor: layer.anchor })
    if (layer.fit === 'width' && !node.curve && text instanceof Text) {
      fitTitleToWidth(text, node.box.width)
    }
    if (node.id === 'rules' && text instanceof Text) {
      updateRulesLineHeight(text, node.style.lineHeight ?? node.style.fontSize)
    }
    if (!node.curve) text.position.set(layer.position.x, layer.position.y)
    text.zIndex = node.zIndex
    text.visible = node.visible ?? true
    text.label = `${this.plan.cardId}:${path}`
    parent.addChild(text)
    this.registerTreeObject(path, node, text)
  }

  private async build(resolver: CardAssetResolver, artwork?: Texture): Promise<void> {
    await this.buildTreeNode(this.plan.tree.root, this.content, resolver, artwork, '')
  }

  addDebugOverlay(): void {
    const overlay = new Container()
    overlay.label = `${this.plan.cardId}:debug`
    overlay.zIndex = 1000

    const cardBounds = new Graphics()
    cardBounds.rect(0, 0, this.plan.width, this.plan.height)
    cardBounds.stroke({ color: 0x55e6ff, width: 3, alpha: 0.8 })
    overlay.addChild(cardBounds)
    drawNodeDebug(this.plan.tree.root, overlay, { x: 0, y: 0 })

    const center = new Graphics()
    center.moveTo(this.plan.width / 2 - 12, this.plan.height / 2)
    center.lineTo(this.plan.width / 2 + 12, this.plan.height / 2)
    center.moveTo(this.plan.width / 2, this.plan.height / 2 - 12)
    center.lineTo(this.plan.width / 2, this.plan.height / 2 + 12)
    center.stroke({ color: 0xff5e5e, width: 2, alpha: 0.9 })
    overlay.addChild(center)
    this.content.addChild(overlay)
  }
}
