import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js'
import type { Deck } from '../../../game/decks'
import { Button } from '../../ui/components/button'
import { COLLECTION_LAYOUT } from './collection-layout'
import {
  DECK_BUTTON_GAP,
  DECK_BUTTON_HEIGHT,
  DECK_EDITOR_COUNT_FILL,
  DECK_EDITOR_LAYOUT
} from './deck-editor-layout'

export interface DeckListViewOptions {
  readonly maxDecks: number
  readonly newDeckButton: Texture
  readonly verticalSlider: Texture
  readonly onDeckTap?: (deckId: string) => void
  readonly onNewDeck?: () => void
  readonly onDeleteDeck?: (deckId: string) => void
  readonly onWheel: (event: FederatedWheelEvent) => void
  readonly onSliderDown: (event: FederatedPointerEvent) => void
  readonly onSliderMove: (event: FederatedPointerEvent) => void
  readonly onSliderUp: () => void
  readonly frameForDeck: (deck: Deck) => Texture
}

/** Deck-list presentation isolated from the much larger editor workflow. */
export class DeckListView {
  readonly entries: Container[] = []
  readonly buttons: Button[] = []
  readonly viewport = new Container()
  readonly content = new Container()
  readonly mask: Graphics
  readonly slider: Sprite
  readonly countLabel: Text
  newDeckButton: Button | null = null

  constructor(private readonly options: DeckListViewOptions) {
    const { width, height } = COLLECTION_LAYOUT.deckList.size
    this.mask = new Graphics().rect(0, 0, width, height).fill({ color: 0xffffff })
    this.mask.position.set(
      COLLECTION_LAYOUT.deckList.position.x,
      COLLECTION_LAYOUT.deckList.position.y
    )
    this.mask.label = 'collection.deck-list-mask'
    this.mask.eventMode = 'none'

    this.viewport.position.set(
      COLLECTION_LAYOUT.deckList.position.x,
      COLLECTION_LAYOUT.deckList.position.y
    )
    this.viewport.label = 'collection.deck-list-viewport'
    this.viewport.hitArea = new Rectangle(0, 0, width, height)
    this.viewport.eventMode = 'none'
    this.viewport.on('wheel', options.onWheel)
    this.viewport.mask = this.mask
    this.viewport.addChild(this.content)
    this.content.label = 'collection.deck-list-content'

    this.slider = new Sprite(options.verticalSlider)
    this.slider.label = 'collection.deck-list-slider'
    this.slider.position.set(
      COLLECTION_LAYOUT.deckSlider.x,
      COLLECTION_LAYOUT.deckSlider.minY
    )
    this.slider.eventMode = 'none'
    this.slider.cursor = 'pointer'
    this.slider.on('pointerdown', options.onSliderDown)
    this.slider.on('globalpointermove', options.onSliderMove)
    this.slider.on('pointerup', options.onSliderUp)
    this.slider.on('pointerupoutside', options.onSliderUp)
    this.slider.on('pointercancel', options.onSliderUp)

    this.countLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 24,
        fill: DECK_EDITOR_COUNT_FILL,
        stroke: { color: 0x000000, width: 4 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    this.countLabel.label = 'collection.deck-list-count'
    this.countLabel.anchor.set(0.5)
    this.countLabel.eventMode = 'none'
    this.countLabel.position.set(
      DECK_EDITOR_LAYOUT.count.position.x,
      DECK_EDITOR_LAYOUT.count.position.y
    )
  }

  mount(parent: Container): void {
    parent.addChild(this.mask, this.viewport, this.slider, this.countLabel)
  }

  render(decks: readonly Deck[]): number {
    for (const entry of this.content.removeChildren()) {
      entry.destroy({ children: true })
    }
    this.entries.length = 0
    this.buttons.length = 0
    this.newDeckButton = null
    this.countLabel.text = `${decks.length} / ${this.options.maxDecks} Decks`

    decks.forEach((deck, index) => {
      this.addEntry(
        this.options.frameForDeck(deck),
        () => this.options.onDeckTap?.(deck.id),
        index,
        this.options.onDeleteDeck
          ? () => this.options.onDeleteDeck?.(deck.id)
          : undefined
      )
    })
    this.newDeckButton = this.addEntry(
      this.options.newDeckButton,
      () => this.options.onNewDeck?.(),
      decks.length,
      undefined
    )
    const itemCount = decks.length + 1
    const contentHeight =
      itemCount * DECK_BUTTON_HEIGHT + Math.max(0, itemCount - 1) * DECK_BUTTON_GAP
    return Math.max(0, contentHeight - COLLECTION_LAYOUT.deckList.size.height)
  }

  setScroll(offset: number, maxScroll: number): number {
    const clamped = Math.max(-maxScroll, Math.min(0, offset))
    this.content.y = clamped
    for (const entry of this.entries) {
      const entryTop = entry.y - DECK_BUTTON_HEIGHT / 2 + clamped
      const entryBottom = entryTop + DECK_BUTTON_HEIGHT
      entry.visible =
        entryBottom > 0 && entryTop < COLLECTION_LAYOUT.deckList.size.height
    }
    return clamped
  }

  setInteractionEnabled(enabled: boolean, canCreateDeck: boolean): void {
    this.viewport.eventMode = enabled ? 'static' : 'none'
    for (const button of this.buttons) {
      button.setEnabled(enabled && (button !== this.newDeckButton || canCreateDeck))
    }
  }

  getEntryOrigin(index: number, target: Container): { x: number; y: number } | null {
    const entry = this.entries[index]
    if (!entry) return null
    const bounds = entry.getBounds()
    const center = target.toLocal({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    })
    return { x: center.x, y: center.y }
  }

  private addEntry(
    texture: Texture,
    onClick: () => void,
    index: number,
    onDelete?: () => void
  ): Button {
    const entry = new Container()
    entry.label = `collection.deck-entry.${index}`
    entry.position.set(
      COLLECTION_LAYOUT.deckList.size.width / 2,
      index * (DECK_BUTTON_HEIGHT + DECK_BUTTON_GAP) + DECK_BUTTON_HEIGHT / 2
    )
    const button = new Button(texture, { onClick })
    button.label = `collection.deck-entry-button.${index}`
    button.setBaseY(0)
    if (onDelete) {
      button.on('rightclick', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        onDelete()
      })
    }
    entry.addChild(button)
    this.buttons.push(button)
    this.entries.push(entry)
    this.content.addChild(entry)
    return button
  }
}
