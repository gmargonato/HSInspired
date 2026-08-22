import { Container, Text } from 'pixi.js'
import {
  CARD_CATALOG,
  type CardDefinition,
  type CardId
} from '../../../../game/content/cards'
import { CardAssetResolver } from '../../../ui/asset-registry/card-asset-resolver'
import { CardView } from '../../../rendering/cards/card-view'
import { CardInspectorControls } from './card-inspector-controls'

export interface CardInspectorOptions {
  readonly cardId?: CardId
  readonly resolver?: CardAssetResolver
}

/** Development-only composition of production card content and rendering. */
export class CardInspector extends Container {
  private readonly resolver: CardAssetResolver
  private readonly cardLayer = new Container()
  private readonly diagnostics = new Text({
    text: '',
    style: { fontFamily: 'Arial', fontSize: 16, fill: 0xd8c49a }
  })
  private cardView: CardView | null = null

  constructor(options: CardInspectorOptions = {}) {
    super()
    this.resolver = options.resolver ?? new CardAssetResolver()
    this.addChild(this.cardLayer)
    this.diagnostics.position.set(20, 56)
    this.addChild(this.diagnostics)

    const initialCard = options.cardId
      ? CARD_CATALOG.require(options.cardId)
      : CARD_CATALOG.require('classic_abomination')
    const controls = new CardInspectorControls({
      cards: CARD_CATALOG.all,
      initialCardId: initialCard.id,
      onCardSelected: (card) => void this.showCard(card)
    })
    this.addChild(controls)
    void this.showCard(initialCard)
  }

  async showCard(card: CardDefinition): Promise<void> {
    const artwork = await this.resolver.loadArtwork(card.id)
    const nextView = await CardView.create(card, this.resolver, {
      artwork,
      debug: true
    })
    nextView.position.set(650, 80)
    nextView.scale.set(0.82)
    nextView.addDebugOverlay()

    const previous = this.cardView
    this.cardView = nextView
    this.cardLayer.addChild(nextView)
    this.diagnostics.text = `${card.id} · ${nextView.plan.template} · ${nextView.plan.width}×${nextView.plan.height}`
    if (previous) {
      this.cardLayer.removeChild(previous)
      previous.destroy({ children: true })
    }
  }
}
