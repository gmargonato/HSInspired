import { Container, Text } from 'pixi.js'
import type { CardDefinition } from '../../../../../game/content/cards'

export interface CardInspectorControlsOptions {
  readonly cards: readonly CardDefinition[]
  readonly initialCardId: string
  readonly onCardSelected: (card: CardDefinition) => void
}

/** Small read-only control strip used by the development card inspector. */
export class CardInspectorControls extends Container {
  private readonly cards: readonly CardDefinition[]
  private readonly onCardSelected: (card: CardDefinition) => void
  private readonly selectionLabel: Text
  private selectedIndex: number

  constructor(options: CardInspectorControlsOptions) {
    super()
    this.cards = options.cards
    this.onCardSelected = options.onCardSelected
    this.selectedIndex = Math.max(
      0,
      this.cards.findIndex((card) => card.id === options.initialCardId)
    )

    this.selectionLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Arial',
        fontSize: 18,
        fill: 0xffffff
      }
    })
    this.selectionLabel.position.set(20, 20)
    this.addChild(this.selectionLabel)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', this.selectNext)
    this.refreshLabel()
  }

  private readonly selectNext = (): void => {
    if (this.cards.length === 0) return
    this.selectedIndex = (this.selectedIndex + 1) % this.cards.length
    const card = this.cards[this.selectedIndex]
    if (!card) return
    this.refreshLabel()
    this.onCardSelected(card)
  }

  private refreshLabel(): void {
    const card = this.cards[this.selectedIndex]
    this.selectionLabel.text = card
      ? `DEV CARD INSPECTOR · ${card.name} · click for next (${this.selectedIndex + 1}/${this.cards.length})`
      : 'DEV CARD INSPECTOR · no cards'
  }
}
