import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import 'pixi.js/advanced-blend-modes'
import type { CardDefinition } from '../../../game/content/cards'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import {
  CARD_NAME_FIT,
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

export interface CardViewOptions extends CardRenderOptions {
  readonly artwork?: Texture
}

export interface CardLayerAppearance {
  readonly alpha?: number
  readonly tint?: number
  readonly blendMode?: ClassFrameBlendMode
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
  readonly plan: CardLayout
  readonly renderedHeight: number

  private readonly layerObjects = new Map<string, Array<Container | Sprite | Text>>()
  private readonly treeObjects = new Map<string, TreeObjectEntry>()
  private readonly basePositions = new Map<string, { x: number; y: number }>()
  private readonly semanticOffsets = new Map<string, { x: number; y: number }>()
  private unsubscribeClassFrameConfig: (() => void) | null = null
  private readonly content: Container

  private constructor(plan: CardLayout) {
    super()
    this.plan = plan
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
    const view = new CardView(buildCardLayout(card, options))
    try {
      await view.build(resolver, options.artwork)
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
    if (this.isCachedAsTexture) return
    this.cacheAsTexture({ antialias: true, resolution: 1 })
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
    this.setSemanticLayerOffset(path, appearance.offsets[template])
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
        lineHeight: node.style.lineHeight
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
