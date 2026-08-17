import type {
  CardArtworkPlacement,
  CardBounds,
  CardPoint,
  CardShape,
  CardTextCurve,
  CardTextStyle,
  CardLayer,
  CardTextureLayer,
  CardTextLayer,
  CardPlaceholderLayer
} from './card-render-plan'

/**
 * A size is a rendered size in the card's design coordinate system. It is
 * intentionally separate from a Pixi scale: template authors should be able
 * to say how large an element is without knowing the source image dimensions.
 */
export interface CardSize {
  readonly width: number
  readonly height: number
}

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
  readonly assetName: string
  readonly transform: CardImageTransform
  readonly zIndex: number
  readonly visible?: boolean
}

export interface CardTextNode {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  /** The complete editable text region in the parent group's coordinates. */
  readonly box: CardBounds
  readonly anchor?: CardPoint
  readonly style: CardTextStyle
  readonly curve?: CardTextCurve
  readonly zIndex: number
  readonly visible?: boolean
}

export interface CardArtworkNode {
  readonly kind: 'artwork'
  readonly id: string
  readonly position: CardPoint
  readonly mask: {
    readonly bounds: CardBounds
    readonly shape: CardShape
    readonly color: number
  }
  readonly artwork: CardArtworkPlacement
  readonly zIndex: number
  readonly visible?: boolean
}

export type CardRenderNode =
  CardGroupNode | CardImageNode | CardTextNode | CardArtworkNode

export interface CardRenderTree {
  readonly root: CardGroupNode
}

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
    style: {
      ...node.style,
      wordWrap: true,
      wordWrapWidth: node.box.width
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
    const layer: CardTextureLayer = {
      kind: 'texture',
      id: path,
      assetName: node.assetName,
      position,
      anchor: node.transform.anchor,
      scale: node.transform.scale,
      zIndex: node.zIndex
    }
    layers.push(layer)
    return
  }

  if (node.kind === 'text') {
    layers.push({ ...textLayer(node, parentPosition), id: path })
    return
  }

  const placeholder: CardPlaceholderLayer = {
    kind: 'placeholder',
    id: path,
    bounds: {
      x: parentPosition.x + node.position.x + node.mask.bounds.x,
      y: parentPosition.y + node.position.y + node.mask.bounds.y,
      width: node.mask.bounds.width,
      height: node.mask.bounds.height
    },
    shape: node.mask.shape,
    color: node.mask.color,
    artwork: node.artwork,
    zIndex: node.zIndex
  }
  layers.push(placeholder)
}

/**
 * Keeps the existing flat plan representation available to diagnostics and
 * older consumers while the renderer adopts the hierarchical tree.
 */
export function flattenCardRenderTree(tree: CardRenderTree): readonly CardLayer[] {
  const layers: CardLayer[] = []
  flattenNode(tree.root, { x: 0, y: 0 }, layers, '')
  return layers
}
