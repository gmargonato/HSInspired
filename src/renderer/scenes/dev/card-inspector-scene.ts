import { Scene } from '../scene'
import { CardInspector } from '../../features/dev/card-inspector'
import { CARD_CATALOG } from '../../../game/content/cards'

/** Development-only route for inspecting production card content and visuals. */
export class CardInspectorScene extends Scene {
  private inspector!: CardInspector

  constructor(private readonly cardId?: string) {
    super()
  }

  init(): void {
    const selectedCard = this.cardId ? CARD_CATALOG.get(this.cardId) : undefined
    this.inspector = new CardInspector(
      selectedCard ? { cardId: selectedCard.id } : undefined
    )
    this.root.addChild(this.inspector)
  }

  update(_deltaMS: number): void {}
}
