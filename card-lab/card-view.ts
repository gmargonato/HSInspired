import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type {
  CardBounds,
  CardNodeOverride,
  CardNodeOverrides,
  CardPoint,
  CardRenderOptions,
  CardRenderPlan,
  CardShape,
  CardTextLayer
} from './card-render-plan'
import { buildCardRenderPlan } from './card-render-plan'
import type { CardDefinition } from './card-catalog'
import { CardAssetResolver } from './card-asset-manifest'
import type { CardRenderNode, CardTextNode } from './card-render-tree'

export interface CardViewOptions extends CardRenderOptions {
  readonly artwork?: Texture
  readonly onNodeSelected?: (path: string) => void
  readonly onNodePointerDown?: (path: string, event: FederatedPointerEvent) => void
}

export interface CardNodeInspector {
  readonly path: string
  readonly id: string
  readonly kind: CardRenderNode['kind']
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly visible: boolean
  readonly assetName?: string
  readonly text?: string
  readonly fontSize?: number
  readonly lineHeight?: number
}

export interface CardNodeGeometryPatch {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

interface TreeObjectEntry {
  readonly node: CardRenderNode
  readonly object: Container | Sprite | Text
}

interface NodeEditorState {
  x: number
  y: number
  width?: number
  height?: number
  visible: boolean
  fontSize?: number
  lineHeight?: number
}

interface ArtworkObjectEntry {
  readonly container: Container
  readonly mask: Graphics
  readonly image?: Sprite
  readonly placeholder?: Graphics
  readonly node: Extract<CardRenderNode, { kind: 'artwork' }>
}

function drawShape(
  graphics: Graphics,
  bounds: CardBounds,
  shape: CardShape,
  color: number
): void {
  if (shape === 'ellipse') {
    graphics.ellipse(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      bounds.width / 2,
      bounds.height / 2
    )
  } else if (shape === 'circle') {
    const radius = Math.min(bounds.width, bounds.height) / 2
    graphics.circle(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, radius)
  } else if (shape === 'arch') {
    const radius = Math.min(bounds.width / 2, bounds.height * 0.72)
    const centerX = bounds.x + bounds.width / 2
    const springY = bounds.y + radius
    graphics
      .moveTo(bounds.x, bounds.y + bounds.height)
      .lineTo(bounds.x, springY)
      .arc(centerX, springY, radius, Math.PI, 0)
      .lineTo(bounds.x + bounds.width, bounds.y + bounds.height)
      .closePath()
  } else {
    graphics.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 28)
  }
  graphics.fill(color)
}

function drawShapeOutline(
  graphics: Graphics,
  bounds: CardBounds,
  shape: CardShape,
  color: number
): void {
  if (shape === 'ellipse') {
    graphics.ellipse(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      bounds.width / 2,
      bounds.height / 2
    )
  } else if (shape === 'circle') {
    const radius = Math.min(bounds.width, bounds.height) / 2
    graphics.circle(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, radius)
  } else if (shape === 'arch') {
    const radius = Math.min(bounds.width / 2, bounds.height * 0.72)
    const centerX = bounds.x + bounds.width / 2
    const springY = bounds.y + radius
    graphics
      .moveTo(bounds.x, bounds.y + bounds.height)
      .lineTo(bounds.x, springY)
      .arc(centerX, springY, radius, Math.PI, 0)
      .lineTo(bounds.x + bounds.width, bounds.y + bounds.height)
      .closePath()
  } else {
    graphics.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 28)
  }
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

function cardTextLayer(node: CardTextNode): CardTextLayer {
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
    style: {
      ...node.style,
      wordWrap: true,
      wordWrapWidth: node.box.width
    },
    curve: node.curve,
    zIndex: node.zIndex
  }
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
      ...node.mask.bounds,
      x: parentPosition.x + node.position.x + node.mask.bounds.x,
      y: parentPosition.y + node.position.y + node.mask.bounds.y
    }
    const shape = new Graphics()
    drawShapeOutline(shape, bounds, node.mask.shape, 0xffe066)
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
  readonly plan: CardRenderPlan

  private readonly layerObjects = new Map<string, Array<{ visible: boolean }>>()
  private readonly treeObjects = new Map<string, TreeObjectEntry>()
  private readonly nodeEditorState = new Map<string, NodeEditorState>()
  private readonly originalNodeEditorState = new Map<string, NodeEditorState>()
  private readonly originalTextTypography = new Map<
    string,
    { readonly fontSize?: number; readonly lineHeight?: number }
  >()
  private readonly artworkObjects = new Map<string, ArtworkObjectEntry>()
  private readonly onNodeSelected?: (path: string) => void
  private readonly onNodePointerDown?: (
    path: string,
    event: FederatedPointerEvent
  ) => void

  private constructor(
    plan: CardRenderPlan,
    onNodeSelected?: (path: string) => void,
    onNodePointerDown?: (path: string, event: FederatedPointerEvent) => void
  ) {
    super()
    this.plan = plan
    this.onNodeSelected = onNodeSelected
    this.onNodePointerDown = onNodePointerDown
    this.sortableChildren = true
    this.eventMode = 'static'
    this.label = `card:${plan.cardId}`

    this.renderedHeight = plan.height * plan.renderScaleY
    this.content = new Container()
    this.content.sortableChildren = true
    this.content.scale.y = plan.renderScaleY
    this.addChild(this.content)
  }

  readonly renderedHeight: number

  private readonly content: Container

  static async create(
    card: CardDefinition,
    resolver: CardAssetResolver,
    options: CardViewOptions = {}
  ): Promise<CardView> {
    const plan = buildCardRenderPlan(card, options)
    const view = new CardView(plan, options.onNodeSelected, options.onNodePointerDown)
    try {
      await view.build(resolver, options.artwork)
    } catch (error) {
      view.destroy({ children: true })
      throw error
    }
    return view
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    const objects = this.layerObjects.get(layerId)
    if (!objects) throw new Error(`Unknown card layer: ${layerId}`)

    for (const object of objects) {
      object.visible = visible
    }
  }

  isLayerVisible(layerId: string): boolean {
    const objects = this.layerObjects.get(layerId)
    if (!objects) throw new Error(`Unknown card layer: ${layerId}`)

    return objects.every((object) => object.visible)
  }

  private registerLayerObject(layerId: string, object: { visible: boolean }): void {
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
    const state = this.initialEditorState(node, object)
    this.nodeEditorState.set(path, state)
    this.originalNodeEditorState.set(path, { ...state })
    if (node.kind === 'text' && object instanceof Text) {
      this.originalTextTypography.set(path, {
        fontSize: object.style.fontSize,
        lineHeight: object.style.lineHeight
      })
    }

    object.eventMode = 'static'
    object.cursor = 'pointer'
    object.on('pointertap', (event) => {
      event.stopPropagation()
      this.onNodeSelected?.(path)
    })
    object.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      this.onNodePointerDown?.(path, event)
    })
  }

  private initialEditorState(
    node: CardRenderNode,
    object: Container | Sprite | Text
  ): NodeEditorState {
    if (node.kind === 'group') {
      return {
        x: object.position.x,
        y: object.position.y,
        visible: object.visible
      }
    }

    if (node.kind === 'image') {
      return {
        x: object.position.x,
        y: object.position.y,
        width: object.width,
        height: object.height,
        visible: object.visible
      }
    }

    if (node.kind === 'text') {
      return {
        x: node.box.x,
        y: node.box.y,
        width: node.box.width,
        height: node.box.height,
        visible: object.visible,
        fontSize: object instanceof Text ? object.style.fontSize : undefined,
        lineHeight: object instanceof Text ? object.style.lineHeight : undefined
      }
    }

    return {
      x: node.position.x,
      y: node.position.y,
      width: node.mask.bounds.width,
      height: node.mask.bounds.height,
      visible: object.visible
    }
  }

  private applyTextEditorState(path: string): void {
    const entry = this.treeObjects.get(path)
    const state = this.nodeEditorState.get(path)
    if (!entry || entry.node.kind !== 'text' || !state) return
    const anchor = entry.node.anchor ?? { x: 0, y: 0 }
    entry.object.position.set(
      state.x + (state.width ?? 0) * anchor.x,
      state.y + (state.height ?? 0) * anchor.y
    )
    if (entry.object instanceof Text && state.width !== undefined) {
      entry.object.style.wordWrap = true
      entry.object.style.wordWrapWidth = state.width
    }
  }

  private updateArtworkEditorState(path: string): void {
    const entry = this.artworkObjects.get(path)
    const state = this.nodeEditorState.get(path)
    if (!entry || !state) return

    const bounds = {
      x: 0,
      y: 0,
      width: state.width ?? entry.node.mask.bounds.width,
      height: state.height ?? entry.node.mask.bounds.height
    }
    entry.container.position.set(state.x, state.y)
    entry.mask.clear()
    drawShape(entry.mask, bounds, entry.node.mask.shape, 0xffffff)
    if (entry.placeholder) {
      entry.placeholder.clear()
      drawShape(entry.placeholder, bounds, entry.node.mask.shape, entry.node.mask.color)
    }
    if (entry.image) {
      entry.image.position.set(
        bounds.x + bounds.width / 2 + entry.node.artwork.offset.x,
        bounds.y + bounds.height / 2 + entry.node.artwork.offset.y
      )
      const scale = Math.max(
        bounds.width / entry.image.texture.width,
        bounds.height / entry.image.texture.height
      )
      entry.image.scale.set(scale * entry.node.artwork.overscan)
    }
  }

  getNodeInspectors(): readonly CardNodeInspector[] {
    return [...this.treeObjects.entries()].map(([path, entry]) =>
      this.inspectNode(path, entry)
    )
  }

  getNodeInspector(path: string): CardNodeInspector {
    const entry = this.treeObjects.get(path)
    if (!entry) throw new Error(`Unknown card node: ${path}`)
    return this.inspectNode(path, entry)
  }

  private inspectNode(path: string, entry: TreeObjectEntry): CardNodeInspector {
    const state = this.nodeEditorState.get(path)
    if (!state) throw new Error(`Card node has no editor state: ${path}`)
    const inspector = {
      path,
      id: entry.node.id,
      kind: entry.node.kind,
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      visible: state.visible
    }
    const details: {
      assetName?: string
      text?: string
      fontSize?: number
      lineHeight?: number
    } = {}
    if (entry.node.kind === 'image') details.assetName = entry.node.assetName
    if (entry.node.kind === 'text') {
      details.text = entry.node.text
      details.fontSize = state.fontSize
      details.lineHeight = state.lineHeight
    }
    return { ...inspector, ...details }
  }

  setNodeGeometry(path: string, patch: CardNodeGeometryPatch): void {
    const entry = this.treeObjects.get(path)
    const state = this.nodeEditorState.get(path)
    if (!entry || !state) throw new Error(`Unknown card node: ${path}`)

    if (patch.x !== undefined) state.x = patch.x
    if (patch.y !== undefined) state.y = patch.y
    if (patch.width !== undefined) state.width = Math.max(1, patch.width)
    if (patch.height !== undefined) state.height = Math.max(1, patch.height)

    if (entry.node.kind === 'text') {
      this.applyTextEditorState(path)
      return
    }
    if (entry.node.kind === 'artwork') {
      this.updateArtworkEditorState(path)
      return
    }
    entry.object.position.set(state.x, state.y)
    if (entry.node.kind === 'image' && state.width && state.height) {
      entry.object.width = state.width
      entry.object.height = state.height
    }
  }

  moveNode(path: string, delta: CardPoint): void {
    const current = this.getNodeInspector(path)
    this.setNodeGeometry(path, { x: current.x + delta.x, y: current.y + delta.y })
  }

  setNodeVisible(path: string, visible: boolean): void {
    const entry = this.treeObjects.get(path)
    const state = this.nodeEditorState.get(path)
    if (!entry || !state) throw new Error(`Unknown card node: ${path}`)
    state.visible = visible
    entry.object.visible = visible
  }

  setNodeTypography(
    path: string,
    values: { readonly fontSize?: number; readonly lineHeight?: number }
  ): void {
    const entry = this.treeObjects.get(path)
    const state = this.nodeEditorState.get(path)
    if (
      !entry ||
      !state ||
      entry.node.kind !== 'text' ||
      !(entry.object instanceof Text)
    ) {
      throw new Error(`Card node is not editable text: ${path}`)
    }
    if (values.fontSize !== undefined) {
      state.fontSize = Math.max(1, values.fontSize)
      entry.object.style.fontSize = state.fontSize
    }
    if (values.lineHeight !== undefined) {
      state.lineHeight = Math.max(1, values.lineHeight)
      entry.object.style.lineHeight = state.lineHeight
    }
  }

  resetNodeEdits(): void {
    for (const [path, original] of this.originalNodeEditorState) {
      this.nodeEditorState.set(path, { ...original })
      const entry = this.treeObjects.get(path)
      if (!entry) continue
      entry.object.visible = original.visible
      const originalTypography = this.originalTextTypography.get(path)
      if (originalTypography && entry.object instanceof Text) {
        if (originalTypography.fontSize !== undefined) {
          entry.object.style.fontSize = originalTypography.fontSize
        }
        if (originalTypography.lineHeight !== undefined) {
          entry.object.style.lineHeight = originalTypography.lineHeight
        }
      }
      if (entry.node.kind === 'text') this.applyTextEditorState(path)
      else if (entry.node.kind === 'artwork') this.updateArtworkEditorState(path)
      else {
        entry.object.position.set(original.x, original.y)
        if (entry.node.kind === 'image' && original.width && original.height) {
          entry.object.width = original.width
          entry.object.height = original.height
        }
      }
    }
  }

  getNodeOverrides(): CardNodeOverrides {
    const overrides: Record<string, CardNodeOverride> = {}

    for (const [path, state] of this.nodeEditorState) {
      const original = this.originalNodeEditorState.get(path)
      if (!original) continue

      const patch: {
        x?: number
        y?: number
        width?: number
        height?: number
        visible?: boolean
        fontSize?: number
        lineHeight?: number
      } = {}
      if (state.x !== original.x) patch.x = state.x
      if (state.y !== original.y) patch.y = state.y
      if (state.width !== original.width) patch.width = state.width
      if (state.height !== original.height) patch.height = state.height
      if (state.visible !== original.visible) patch.visible = state.visible
      if (state.fontSize !== original.fontSize) patch.fontSize = state.fontSize
      if (state.lineHeight !== original.lineHeight) patch.lineHeight = state.lineHeight

      if (Object.keys(patch).length > 0) overrides[path] = patch
    }

    return overrides
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
      drawShape(mask, node.mask.bounds, node.mask.shape, 0xffffff)
      let image: Sprite | undefined
      let placeholder: Graphics | undefined

      if (artwork) {
        image = new Sprite(artwork)
        image.anchor.set(0.5)
        image.position.set(
          node.mask.bounds.x + node.mask.bounds.width / 2 + node.artwork.offset.x,
          node.mask.bounds.y + node.mask.bounds.height / 2 + node.artwork.offset.y
        )
        const scale = Math.max(
          node.mask.bounds.width / artwork.width,
          node.mask.bounds.height / artwork.height
        )
        image.scale.set(scale * node.artwork.overscan)
        artworkLayer.mask = mask
        artworkLayer.addChild(image)
        artworkLayer.addChild(mask)
      } else {
        placeholder = new Graphics()
        drawShape(placeholder, node.mask.bounds, node.mask.shape, node.mask.color)
        artworkLayer.addChild(placeholder)
      }

      artworkLayer.zIndex = node.zIndex
      artworkLayer.visible = node.visible ?? true
      artworkLayer.label = `${this.plan.cardId}:${path}`
      parent.addChild(artworkLayer)
      this.artworkObjects.set(path, {
        container: artworkLayer,
        mask,
        image,
        placeholder,
        node
      })
      this.registerTreeObject(path, node, artworkLayer)
      return
    }

    if (node.kind === 'image') {
      const texture = await resolver.load(node.assetName)
      const sprite = new Sprite(texture)
      const transform = node.transform
      sprite.anchor.set(transform.anchor?.x ?? 0, transform.anchor?.y ?? 0)
      sprite.position.set(transform.position.x, transform.position.y)
      if (transform.size) {
        sprite.width = transform.size.width
        sprite.height = transform.size.height
      } else if (transform.scale) {
        sprite.scale.set(transform.scale.x, transform.scale.y)
      }
      if (transform.rotation !== undefined) sprite.rotation = transform.rotation
      sprite.zIndex = node.zIndex
      sprite.visible = node.visible ?? true
      sprite.label = `${this.plan.cardId}:${path}`
      parent.addChild(sprite)
      this.registerTreeObject(path, node, sprite)
      return
    }

    const layer = cardTextLayer(node)
    const text = node.curve
      ? createCurvedText(layer)
      : new Text({
          text: layer.text,
          style: layer.style,
          anchor: layer.anchor
        })
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
