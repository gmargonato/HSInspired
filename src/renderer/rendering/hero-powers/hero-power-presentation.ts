import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import type { HeroPowerDefinition } from '../../../game/content/hero-powers'
import { applyAnchoredPlacement, type LayoutPlacement } from '../layout'
import {
  HERO_POWER_CARD_CANVAS,
  HERO_POWER_ICON_CANVAS,
  HERO_POWER_PRESENTATION_LAYOUT
} from './hero-power-layout'

function createCircularArtwork(
  texture: Texture,
  artworkPlacement: LayoutPlacement,
  radius: number,
  label: string
): { readonly layer: Container; readonly image: Sprite } {
  const layer = new Container()
  layer.label = label
  layer.eventMode = 'none'

  const image = new Sprite(texture)
  applyAnchoredPlacement(image, artworkPlacement)
  image.label = `${label}.image`

  const mask = new Graphics()
    .circle(artworkPlacement.position.x, artworkPlacement.position.y, radius)
    .fill(0xffffff)
  mask.label = `${label}.mask`
  layer.mask = mask
  layer.addChild(image, mask)
  return { layer, image }
}

/** Compact 150x150 artwork-and-frame composition used on the game board. */
export class HeroPowerIconView extends Container {
  private readonly artworkImage: Sprite

  constructor(artwork: Texture, frame: Texture) {
    super()
    this.label = 'hero-power.icon'
    this.eventMode = 'none'
    const layout = HERO_POWER_PRESENTATION_LAYOUT.icon
    const renderedArtwork = createCircularArtwork(
      artwork,
      layout.artwork,
      layout.artworkRadius,
      'hero-power.icon.artwork'
    )
    this.artworkImage = renderedArtwork.image
    this.addChild(renderedArtwork.layer)

    const frameSprite = new Sprite(frame)
    applyAnchoredPlacement(frameSprite, layout.frame)
    frameSprite.label = 'hero-power.icon.frame'
    frameSprite.eventMode = 'none'
    this.addChild(frameSprite)
  }

  setArtwork(texture: Texture): void {
    this.artworkImage.texture = texture
  }
}

/** Full 620x903 hero-power card used by discovery and history previews. */
export class HeroPowerCardView extends Container {
  constructor(
    definition: HeroPowerDefinition,
    cost: number,
    artwork: Texture,
    frame: Texture
  ) {
    super()
    this.label = `hero-power.card.${definition.id}`
    this.eventMode = 'none'
    this.hitArea = new Rectangle(
      0,
      0,
      HERO_POWER_CARD_CANVAS.width,
      HERO_POWER_CARD_CANVAS.height
    )
    const layout = HERO_POWER_PRESENTATION_LAYOUT.card
    const renderedArtwork = createCircularArtwork(
      artwork,
      layout.artwork,
      layout.artworkRadius,
      'hero-power.card.artwork'
    )
    this.addChild(renderedArtwork.layer)

    const frameSprite = new Sprite(frame)
    applyAnchoredPlacement(frameSprite, layout.frame)
    frameSprite.label = 'hero-power.card.frame'
    frameSprite.eventMode = 'none'
    this.addChild(frameSprite)

    const costLabel = new Text({
      text: String(cost),
      style: {
        fontFamily: 'Belwe',
        fontSize: 90,
        fill: 0xffffff,
        stroke: { color: 0x17120f, width: 8 },
        align: 'center'
      },
      anchor: 0.5
    })
    applyAnchoredPlacement(costLabel, layout.cost)
    costLabel.label = 'hero-power.card.cost'
    costLabel.eventMode = 'none'

    const titleLabel = new Text({
      text: definition.displayName,
      style: {
        fontFamily: 'Belwe',
        fontSize: 42,
        fill: 0xffffff,
        stroke: { color: 0x17120f, width: 7 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: layout.title.size.width
      },
      anchor: 0.5
    })
    applyAnchoredPlacement(titleLabel, layout.title)
    if (titleLabel.width > layout.title.size.width) {
      titleLabel.scale.set(layout.title.size.width / titleLabel.width)
    }
    titleLabel.label = 'hero-power.card.title'
    titleLabel.eventMode = 'none'

    const rulesLabel = new Text({
      text: definition.rulesText,
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 44,
        fill: 0x201a15,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: layout.rules.size.width,
        breakWords: true
      },
      anchor: 0.5
    })
    applyAnchoredPlacement(rulesLabel, layout.rules)
    if (rulesLabel.height > layout.rules.size.height) {
      rulesLabel.scale.set(layout.rules.size.height / rulesLabel.height)
    }
    rulesLabel.label = 'hero-power.card.rules'
    rulesLabel.eventMode = 'none'
    this.addChild(costLabel, titleLabel, rulesLabel)
  }
}

export { HERO_POWER_CARD_CANVAS, HERO_POWER_ICON_CANVAS }
