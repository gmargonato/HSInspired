import { Scene } from '../scene'
import { CardInspector } from '../../features/dev/card-inspector'
import { CARD_CATALOG } from '../../../game/content/cards'

/** Development-only route for inspecting production card content and visuals. */
export class CardInspectorScene extends Scene {
  readonly devSceneId = 'card-inspector' as const
  private inspector!: CardInspector

  constructor(private readonly cardId?: string) {
    super()
  }

  init(): void {
    const selectedCard = this.cardId ? CARD_CATALOG.get(this.cardId) : undefined
    const canvas = this.appInstance.canvas
    const parent = canvas.parentElement
    if (!parent) throw new Error('Card color lab requires a canvas parent element')
    this.inspector = new CardInspector({
      cardId: selectedCard?.id,
      canvas,
      renderer: this.appInstance.renderer,
      parent
    })
    this.root.addChild(this.inspector)
  }

  update(_deltaMS: number): void {}

  protected onPause(): void {
    this.inspector.setControlsVisible(false)
  }

  protected onResume(): void {
    this.inspector.setControlsVisible(true)
  }

  protected onExit(): void {
    this.inspector.dispose()
  }
}
