import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type {
  CardBounds,
  CardLayer,
  CardRenderOptions,
  CardRenderPlan,
  CardShape
} from './card-render-plan'
import { buildCardRenderPlan } from './card-render-plan'
import type { CardDefinition } from './card-catalog'
import { CardAssetResolver } from './card-asset-manifest'

export interface CardViewOptions extends CardRenderOptions {
  readonly artwork?: Texture
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
  } else {
    graphics.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 28)
  }
  graphics.fill(color)
}

function createPlaceholder(
  layer: Extract<CardLayer, { kind: 'placeholder' }>
): Graphics {
  const placeholder = new Graphics()
  drawShape(placeholder, layer.bounds, layer.shape, layer.color)
  return placeholder
}

export class CardView extends Container {
  readonly plan: CardRenderPlan

  private readonly layerObjects = new Map<string, Array<{ visible: boolean }>>()

  private constructor(plan: CardRenderPlan) {
    super()
    this.plan = plan
    this.sortableChildren = true
    this.label = `card:${plan.cardId}`
  }

  static async create(
    card: CardDefinition,
    resolver: CardAssetResolver,
    options: CardViewOptions = {}
  ): Promise<CardView> {
    const plan = buildCardRenderPlan(card, options)
    const view = new CardView(plan)
    await view.build(resolver, options.artwork)
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

  private async build(resolver: CardAssetResolver, artwork?: Texture): Promise<void> {
    const artLayer = this.plan.layers.find(
      (layer): layer is Extract<CardLayer, { kind: 'placeholder' }> =>
        layer.kind === 'placeholder' && layer.id === 'art-placeholder'
    )

    if (artwork && artLayer) {
      const mask = new Graphics()
      drawShape(mask, artLayer.bounds, artLayer.shape, 0xffffff)
      mask.renderable = false
      this.addChild(mask)

      const art = new Sprite(artwork)
      art.anchor.set(0.5)
      art.position.set(
        artLayer.bounds.x + artLayer.bounds.width / 2,
        artLayer.bounds.y + artLayer.bounds.height / 2
      )
      const scale = Math.max(
        artLayer.bounds.width / artwork.width,
        artLayer.bounds.height / artwork.height
      )
      art.scale.set(scale)
      art.mask = mask
      art.zIndex = artLayer.zIndex
      this.addChild(art)
      this.registerLayerObject(artLayer.id, art)
    }

    for (const layer of this.plan.layers) {
      if (layer.kind === 'placeholder') {
        if (!artwork || layer.id !== 'art-placeholder') {
          const placeholder = createPlaceholder(layer)
          placeholder.zIndex = layer.zIndex
          this.addChild(placeholder)
          this.registerLayerObject(layer.id, placeholder)
        }
        continue
      }

      if (layer.kind === 'texture') {
        const texture = await resolver.load(layer.assetName)
        const sprite = new Sprite(texture)
        sprite.anchor.set(layer.anchor?.x ?? 0, layer.anchor?.y ?? 0)
        sprite.position.set(layer.position.x, layer.position.y)
        if (layer.scale) sprite.scale.set(layer.scale.x, layer.scale.y)
        sprite.zIndex = layer.zIndex
        sprite.label = `${this.plan.cardId}:${layer.id}`
        this.addChild(sprite)
        this.registerLayerObject(layer.id, sprite)
        continue
      }

      const text = new Text({
        text: layer.text,
        style: layer.style,
        anchor: layer.anchor ?? { x: 0.5, y: 0.5 }
      })
      text.position.set(layer.position.x, layer.position.y)
      text.zIndex = layer.zIndex
      text.label = `${this.plan.cardId}:${layer.id}`
      this.addChild(text)
      this.registerLayerObject(layer.id, text)
    }
  }

  addDebugOverlay(): void {
    const overlay = new Container()
    overlay.label = `${this.plan.cardId}:debug`
    overlay.zIndex = 1000

    const cardBounds = new Graphics()
    cardBounds.rect(0, 0, this.plan.width, this.plan.height)
    cardBounds.stroke({ color: 0x55e6ff, width: 3, alpha: 0.8 })
    overlay.addChild(cardBounds)

    const artLayer = this.plan.layers.find(
      (layer): layer is Extract<CardLayer, { kind: 'placeholder' }> =>
        layer.kind === 'placeholder' && layer.id === 'art-placeholder'
    )
    if (artLayer) {
      const artBounds = new Graphics()
      drawShape(artBounds, artLayer.bounds, artLayer.shape, 0x000000)
      artBounds.clear()
      if (artLayer.shape === 'ellipse') {
        artBounds.ellipse(
          artLayer.bounds.x + artLayer.bounds.width / 2,
          artLayer.bounds.y + artLayer.bounds.height / 2,
          artLayer.bounds.width / 2,
          artLayer.bounds.height / 2
        )
      } else if (artLayer.shape === 'circle') {
        artBounds.circle(
          artLayer.bounds.x + artLayer.bounds.width / 2,
          artLayer.bounds.y + artLayer.bounds.height / 2,
          Math.min(artLayer.bounds.width, artLayer.bounds.height) / 2
        )
      } else {
        artBounds.roundRect(
          artLayer.bounds.x,
          artLayer.bounds.y,
          artLayer.bounds.width,
          artLayer.bounds.height,
          28
        )
      }
      artBounds.stroke({ color: 0xffe066, width: 3, alpha: 0.9 })
      overlay.addChild(artBounds)
    }

    const center = new Graphics()
    center.moveTo(this.plan.width / 2 - 12, this.plan.height / 2)
    center.lineTo(this.plan.width / 2 + 12, this.plan.height / 2)
    center.moveTo(this.plan.width / 2, this.plan.height / 2 - 12)
    center.lineTo(this.plan.width / 2, this.plan.height / 2 + 12)
    center.stroke({ color: 0xff5e5e, width: 2, alpha: 0.9 })
    overlay.addChild(center)

    this.addChild(overlay)
  }
}
