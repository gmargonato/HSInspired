import { Container, Sprite, Text, type Texture } from 'pixi.js'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { CardView } from '../../../visual-components/cards/card-view'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { CardAssetResolver } from '../../../visual-components/assets/card-asset-resolver'
import { SECRET_LAYOUT } from './secret-layout'

/** Full-colour Quest -> reward pair shown above the desaturated match board. */
export class QuestPreviewView extends Container {
  private readonly animations = new AnimationScope()
  private request = 0
  private key: string | null = null
  private progressText: Text | null = null
  private latestProgress = ''

  constructor(
    private readonly resolver: CardAssetResolver,
    private readonly arrowTexture: Texture
  ) {
    super()
    this.label = 'game.quest-preview'
    this.eventMode = 'none'
  }

  hide(): void {
    this.request++
    this.key = null
    this.progressText = null
    this.latestProgress = ''
    this.animations.kill()
    this.alpha = 0
    for (const child of this.removeChildren()) child.destroy({ children: true })
  }

  async show(
    cardId: string,
    rewardCardId: string,
    progress: number,
    target: number
  ): Promise<void> {
    const key = `${cardId}:${rewardCardId}`
    const progressLabel = `${progress}/${target}`
    if (this.key === key) {
      this.latestProgress = progressLabel
      if (this.progressText) this.progressText.text = progressLabel
      return
    }
    this.hide()
    this.key = key
    this.latestProgress = progressLabel
    this.alpha = 0
    const request = this.request
    const cards: CardView[] = []
    try {
      for (const id of [cardId, rewardCardId]) {
        const artwork = await this.resolver.loadArtwork(id)
        if (request !== this.request || this.destroyed) return
        const card = await CardView.create(CARD_CATALOG.require(id), this.resolver, {
          artwork,
          animatePremiumArtwork: true
        })
        cards.push(card)
        if (request !== this.request || this.destroyed) return
        card.scale.set(SECRET_LAYOUT.questPreview.scale)
        card.position.set(
          id === cardId
            ? SECRET_LAYOUT.questPreview.leftCard.x
            : SECRET_LAYOUT.questPreview.rightCard.x,
          id === cardId
            ? SECRET_LAYOUT.questPreview.leftCard.y
            : SECRET_LAYOUT.questPreview.rightCard.y
        )
        card.label =
          id === cardId ? 'game.quest-preview.quest' : 'game.quest-preview.reward'
        card.eventMode = 'none'
      }
      if (request !== this.request || this.destroyed) return
      const arrow = new Sprite(this.arrowTexture)
      arrow.label = 'game.quest-preview.arrow'
      applyAnchoredPlacement(arrow, SECRET_LAYOUT.questPreview.arrow)
      arrow.eventMode = 'none'
      const progressText = new Text({
        text: this.latestProgress,
        style: SECRET_LAYOUT.questPreview.progressTextStyle,
        anchor: 0.5
      })
      applyAnchoredPlacement(progressText, SECRET_LAYOUT.questPreview.progress)
      progressText.label = 'game.quest-preview.progress'
      progressText.eventMode = 'none'
      this.progressText = progressText
      this.addChild(...cards, arrow, progressText)
      this.alpha = 0
      this.animations
        .timeline()
        .to(this, { alpha: 1, duration: 0.12, ease: 'power2.out' })
    } catch (error) {
      if (request === this.request) this.hide()
      throw error
    } finally {
      for (const card of cards) if (!card.parent) card.destroy({ children: true })
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.hide()
    super.destroy(options)
  }
}
