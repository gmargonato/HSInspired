import { Container, ObservablePoint, Rectangle, Sprite, Texture } from 'pixi.js'
import { getHeroPortraitLayers } from './assets/hero-portrait-textures'
import { applyAnchoredPlacement } from './layout'
import { HERO_PORTRAIT_LAYOUT } from './hero-portrait-layout'
import { PremiumArtworkBreath } from './effects/premium-artwork-breath'

/** A single movable/filterable surface with independently accessible art and frame.
 * Whole-portrait effects belong on this container; premium color belongs on artwork.
 */
export class HeroPortrait extends Container {
  readonly artwork = new Sprite()
  readonly frame = new Sprite()
  private readonly premiumBreath = new PremiumArtworkBreath(this.artwork)
  private currentTexture = Texture.EMPTY
  readonly anchor = new ObservablePoint({ _onUpdate: () => this.updateAnchor() })

  constructor(texture: Texture = Texture.EMPTY) {
    super()
    this.label = 'hero.portrait'
    this.eventMode = 'none'
    this.interactiveChildren = false
    this.artwork.label = 'hero.portrait-artwork'
    this.frame.label = 'hero.portrait-frame'
    applyAnchoredPlacement(this.artwork, HERO_PORTRAIT_LAYOUT.surface)
    applyAnchoredPlacement(this.frame, HERO_PORTRAIT_LAYOUT.frame)
    this.addChild(this.artwork, this.frame)
    this.texture = texture
  }

  /** Static complete surface for outlines, history thumbnails and snapshots. */
  get texture(): Texture {
    return this.currentTexture
  }
  set texture(texture: Texture) {
    this.currentTexture = texture
    const layers = getHeroPortraitLayers(texture)
    this.artwork.texture = layers?.artwork ?? texture
    this.frame.texture = layers?.frame ?? Texture.EMPTY
    this.frame.visible = !!layers
    this.premiumBreath.setEnabled(layers?.premium ?? false)
    this.boundsArea = new Rectangle(0, 0, texture.width, texture.height)
    this.updateAnchor()
  }

  private updateAnchor(): void {
    this.pivot.set(
      this.anchor.x * this.currentTexture.width,
      this.anchor.y * this.currentTexture.height
    )
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.premiumBreath.destroy()
    // AssetScope owns shared textures. A portrait only owns its display objects.
    super.destroy({
      ...(typeof options === 'object' ? options : {}),
      children: true,
      texture: false,
      textureSource: false
    })
  }
}
