import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  AssetScope,
  CardAssetResolver
} from '../../../ui/asset-registry'
import {
  AnimatedOutline,
  type OutlinePaletteName
} from '../../../rendering/effects/animated-outline'
import {
  getExperimentalOutlineDirectionId,
  listExperimentalOutlineDirections,
  type ExperimentalDirection
} from '@outline-directions'

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080

function addLabel(
  parent: Container,
  text: string,
  x: number,
  y: number,
  size = 22
): void {
  const label = new Text({
    text,
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fill: 0xfff3dc,
      dropShadow: {
        color: 0x000000,
        alpha: 0.42,
        blur: 2,
        distance: 1
      }
    }
  })
  label.position.set(x, y)
  parent.addChild(label)
}

function addPanel(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const panel = new Graphics()
  panel.roundRect(x, y, width, height, 18)
  panel.fill({ color: 0x1c3048, alpha: 0.98 })
  panel.stroke({ color: 0xb08a5c, width: 2, alpha: 0.92 })
  parent.addChild(panel)
}

/**
 * Development-only, deterministic comparison surface for the ten outline
 * directions. It intentionally uses real card/button/frame textures plus
 * primitive proxies so a single screenshot covers the production consumers.
 */
export class OutlineLab extends Container {
  private readonly assetScope = new AssetScope()
  private readonly resolver = new CardAssetResolver()
  private readonly outlines: AnimatedOutline[] = []
  private direction: ExperimentalDirection | undefined

  async mount(): Promise<void> {
    this.direction = listExperimentalOutlineDirections().find(
      (candidate) => candidate.id === getExperimentalOutlineDirectionId()
    )

    const [deckAssets, selectionAssets] = await Promise.all([
      this.assetScope.acquire<DeckPresentationAssets>(
        ASSET_BUNDLE_IDS.deckPresentation
      ),
      this.assetScope.acquire<DeckSelectionAssets>(ASSET_BUNDLE_IDS.deckSelection)
    ])
    const [minionFrame, spellFrame] = await Promise.all([
      this.resolver.load('card.frame.minion'),
      this.resolver.load('card.frame.spell')
    ])

    this.createBackground()
    this.createHeader()
    this.createCardExamples(minionFrame, spellFrame)
    this.createButtonExamples(deckAssets, selectionAssets)
    this.createProxyExamples()
  }

  dispose(): void {
    for (const outline of this.outlines) outline.dispose()
    this.outlines.length = 0
    void this.assetScope.releaseAll()
    this.destroy({ children: true })
  }

  private createBackground(): void {
    const background = new Graphics()
    background.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    background.fill(0x12243a)
    background.rect(0, 0, CANVAS_WIDTH, 170)
    background.fill({ color: 0x2b4c6d, alpha: 0.98 })
    this.addChild(background)

    addPanel(this, 42, 192, 870, 830)
    addPanel(this, 948, 192, 930, 390)
    addPanel(this, 948, 610, 930, 412)
  }

  private createHeader(): void {
    const direction = this.direction
    addLabel(this, 'OUTLINE DIRECTION LAB', 42, 35, 34)
    addLabel(
      this,
      direction ? `${direction.id}  ·  ${direction.label}` : 'Classic Balanced',
      44,
      88,
      27
    )
    addLabel(
      this,
      'Dense filament  |  animated contour  |  independent bloom  |  confined highlights',
      44,
      128,
      20
    )
    addLabel(this, 'CARD / FRAME SILHOUETTES', 72, 218, 20)
    addLabel(this, 'BUTTON / DECK FRAME', 980, 218, 20)
    addLabel(this, 'PROXY / PALETTE CHECKS', 980, 636, 20)
  }

  private createCardExamples(minionFrame: Texture, spellFrame: Texture): void {
    this.addOutlinedTexture(minionFrame, 'green', 'card', 320, 600, 0.56, 'large card')
    this.addOutlinedTexture(spellFrame, 'green', 'card', 720, 480, 0.31, 'small card')
  }

  private createButtonExamples(
    assets: DeckPresentationAssets,
    selectionAssets: DeckSelectionAssets
  ): void {
    this.addOutlinedTexture(
      assets.deckButtonFrame,
      'blue',
      'button',
      1190,
      360,
      1.6,
      'deck frame'
    )

    this.addOutlinedTexture(
      selectionAssets.playButton,
      'blue',
      'button',
      1515,
      385,
      0.88,
      'Play button'
    )
  }

  private createProxyExamples(): void {
    this.addOutlinedProxy('green', 'card', 1085, 815, 'minion oval')
    this.addOutlinedProxy('orange', 'button', 1350, 815, 'orange')
    this.addOutlinedProxy('red', 'button', 1615, 815, 'red')
  }

  private addOutlinedProxy(
    palette: OutlinePaletteName,
    preset: 'card' | 'button',
    x: number,
    y: number,
    label: string
  ): void {
    const target = new Graphics()
    target.roundRect(-70, -100, 140, 200, 26).fill(0xffffff)
    target.position.set(x, y)
    target.label = `outline-lab.${label}`
    // The target must sit above the comparison panels so the filtered outline
    // is visible; its body duplicate is added immediately afterwards.
    this.addChild(target)
    const outline = new AnimatedOutline(target, palette, preset)
    this.outlines.push(outline)

    const body = new Graphics()
    body.roundRect(-62, -92, 124, 184, 22).fill(0x46627f)
    body.position.set(x, y)
    this.addChild(body)
    addLabel(this, label, x - 55, y + 118, 18)
  }

  private addOutlinedTexture(
    texture: Texture,
    palette: OutlinePaletteName,
    preset: 'card' | 'button',
    x: number,
    y: number,
    scale: number,
    label: string
  ): void {
    const target = new Sprite(texture)
    target.anchor.set(0.5)
    target.position.set(x, y)
    target.scale.set(scale)
    target.label = `outline-lab.${label}.target`
    this.addChild(target)
    const outline = new AnimatedOutline(target, palette, preset)
    this.outlines.push(outline)

    const body = new Sprite(texture)
    body.anchor.set(0.5)
    body.position.set(x, y)
    body.scale.set(scale)
    // Keep the source artwork readable while the filtered duplicate supplies
    // the outline. The lab should expose the material, not dim the asset.
    body.tint = 0xffffff
    body.alpha = 1
    body.label = `outline-lab.${label}.body`
    this.addChild(body)
    addLabel(this, label, x - 70, y + texture.height * scale * 0.5 + 22, 18)
  }
}
