/** Shared geometry primitives for the semantic card render tree. */
export interface CardPoint {
  readonly x: number
  readonly y: number
}

export interface CardBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CardTextStyle {
  readonly fontFamily: string
  readonly fontSize: number
  readonly fill: number
  readonly align: 'left' | 'center'
  readonly fontWeight?: 'normal' | 'bold'
  readonly letterSpacing?: number
  readonly stroke?: { readonly color: number; readonly width: number }
  readonly wordWrap?: boolean
  readonly wordWrapWidth?: number
  readonly lineHeight?: number
  readonly breakWords?: boolean
  readonly tagStyles?: Readonly<
    Record<string, { readonly fontWeight?: 'normal' | 'bold' }>
  >
}

/** Retained for the renderer's optional curved-text support. */
export interface CardTextCurve {
  readonly startY: number
  readonly control1Y: number
  readonly control2Y: number
  readonly endY: number
}

export interface CardSize {
  readonly width: number
  readonly height: number
}

export type CardTextFit = 'width'

export interface CardImageTransform {
  readonly position: CardPoint
  readonly size?: CardSize
  readonly anchor?: CardPoint
  readonly scale?: CardPoint
  readonly rotation?: number
}

export interface CardGroupNode {
  readonly kind: 'group'
  readonly id: string
  readonly position: CardPoint
  readonly zIndex: number
  readonly visible?: boolean
  readonly children: readonly CardRenderNode[]
}

export interface CardImageNode {
  readonly kind: 'image'
  readonly id: string
  /** Semantic registry key; renderers never depend on authored filenames. */
  readonly assetKey: string
  readonly transform: CardImageTransform
  readonly zIndex: number
  readonly visible?: boolean
}

export interface CardTextNode {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  /** The complete text region in the parent group's coordinates. */
  readonly box: CardBounds
  readonly anchor?: CardPoint
  readonly style: CardTextStyle
  readonly fit?: CardTextFit
  readonly curve?: CardTextCurve
  readonly zIndex: number
  readonly visible?: boolean
}

export interface CardArtworkNode {
  readonly kind: 'artwork'
  readonly id: string
  readonly position: CardPoint
  /** Native-size square artwork bounds in card coordinates. */
  readonly bounds: CardBounds
  readonly zIndex: number
  readonly visible?: boolean
}

export type CardRenderNode =
  CardGroupNode | CardImageNode | CardTextNode | CardArtworkNode

export interface CardRenderTree {
  readonly root: CardGroupNode
}

export type CardLayerKind = 'texture' | 'text' | 'placeholder'
export type CardShape = 'rectangle'

export interface CardTextureLayer {
  readonly kind: 'texture'
  readonly id: string
  readonly assetKey: string
  readonly position: CardPoint
  readonly anchor?: CardPoint
  readonly scale?: CardPoint
  readonly zIndex: number
}

export interface CardTextLayer {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  readonly position: CardPoint
  readonly anchor?: CardPoint
  readonly style: CardTextStyle
  readonly fit?: CardTextFit
  readonly curve?: CardTextCurve
  readonly zIndex: number
}

export interface CardPlaceholderLayer {
  readonly kind: 'placeholder'
  readonly id: string
  readonly bounds: CardBounds
  readonly shape: CardShape
  readonly color: number
  readonly zIndex: number
}

export type CardLayer = CardTextureLayer | CardTextLayer | CardPlaceholderLayer

function textLayer(node: CardTextNode, position: CardPoint): CardTextLayer {
  const anchor = node.anchor ?? { x: 0, y: 0 }
  return {
    kind: 'text',
    id: node.id,
    text: node.text,
    position: {
      x: position.x + node.box.x + node.box.width * anchor.x,
      y: position.y + node.box.y + node.box.height * anchor.y
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

function flattenNode(
  node: CardRenderNode,
  parentPosition: CardPoint,
  layers: CardLayer[],
  parentPath: string
): void {
  const path = parentPath ? `${parentPath}.${node.id}` : node.id

  if (node.kind === 'group') {
    const position = {
      x: parentPosition.x + node.position.x,
      y: parentPosition.y + node.position.y
    }
    for (const child of node.children) flattenNode(child, position, layers, path)
    return
  }

  if (node.kind === 'image') {
    const position = {
      x: parentPosition.x + node.transform.position.x,
      y: parentPosition.y + node.transform.position.y
    }
    layers.push({
      kind: 'texture',
      id: path,
      assetKey: node.assetKey,
      position,
      anchor: node.transform.anchor,
      scale: node.transform.scale,
      zIndex: node.zIndex
    })
    return
  }

  if (node.kind === 'text') {
    layers.push({ ...textLayer(node, parentPosition), id: path })
    return
  }

  layers.push({
    kind: 'placeholder',
    id: path,
    bounds: {
      x: parentPosition.x + node.position.x + node.bounds.x,
      y: parentPosition.y + node.position.y + node.bounds.y,
      width: node.bounds.width,
      height: node.bounds.height
    },
    shape: 'rectangle',
    color: 0x535b65,
    zIndex: node.zIndex
  })
}

/** Diagnostic projection of the semantic tree; not a renderer input model. */
export function flattenCardRenderTree(tree: CardRenderTree): readonly CardLayer[] {
  const layers: CardLayer[] = []
  flattenNode(tree.root, { x: 0, y: 0 }, layers, '')
  return layers
}
