import { Container, type Renderer } from 'pixi.js'
import { CARD_CATALOG } from '../../../game/content/cards'
import { AnimationScope } from '../../animation/animations'
import { CardView } from '../../rendering/cards/card-view'
import { PreviewGhostOutline } from '../../rendering/effects/preview-ghost-outline'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { SECRET_LAYOUT, secretPreviewPositions } from './secret-layout'

export interface SecretPreviewCard {
  readonly instanceId: string
  readonly cardId: string
  readonly premium: boolean
  readonly premiumSide?: 'local' | 'remote'
}

/** Non-interactive full-card row owned by the local secret hover target. */
export class SecretPreviewView extends Container {
  private readonly animations = new AnimationScope()
  private request = 0
  private key: string | null = null
  private previewGhostOutline: PreviewGhostOutline | null = null

  constructor(
    private readonly resolver: CardAssetResolver,
    private readonly renderer: Renderer
  ) {
    super()
    this.label = 'game.secret-preview'
    this.eventMode = 'none'
  }

  hide(): void {
    this.request++
    this.key = null
    this.clearCards()
  }

  private clearCards(): void {
    this.animations.kill()
    this.previewGhostOutline?.dispose()
    this.previewGhostOutline = null
    for (const child of this.removeChildren()) child.destroy({ children: true })
  }

  async show(secrets: readonly SecretPreviewCard[]): Promise<void> {
    if (!secrets.length) {
      this.hide()
      return
    }
    const key = JSON.stringify(secrets)
    if (key === this.key) return
    this.key = key
    const request = ++this.request
    // Remove consumed secrets immediately, including while replacements load.
    this.clearCards()
    const cards: CardView[] = []
    try {
      for (const secret of secrets) {
        const artwork = await this.resolver.loadArtwork(secret.cardId)
        if (request !== this.request || this.destroyed) return
        const card = await CardView.create(
          CARD_CATALOG.require(secret.cardId),
          this.resolver,
          {
            artwork,
            premium: secret.premium,
            premiumSide: secret.premiumSide,
            animatePremiumArtwork: true
          }
        )
        cards.push(card)
        if (request !== this.request || this.destroyed) return
        card.label = `game.secret-preview.${secret.instanceId}`
        card.eventMode = 'none'
        card.scale.set(SECRET_LAYOUT.preview.scale)
      }
      const positions = secretPreviewPositions(
        cards.length,
        Math.max(...cards.map((card) => card.plan.width)),
        Math.max(...cards.map((card) => card.renderedHeight))
      )
      cards.forEach((card, index) => {
        card.position.set(positions[index].x, positions[index].y)
        this.addChild(card)
      })
      this.previewGhostOutline = new PreviewGhostOutline(this.renderer, this)
      this.alpha = 0
      this.animations.timeline().to(this, {
        alpha: 1,
        duration: SECRET_LAYOUT.preview.fadeDuration,
        ease: 'power2.out'
      })
    } catch (error) {
      if (request === this.request) this.key = null
      throw error
    } finally {
      for (const card of cards) {
        if (!card.parent) card.destroy({ children: true })
      }
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.hide()
    super.destroy(options)
  }
}
