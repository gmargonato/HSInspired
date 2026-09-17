import { Graphics, Sprite, Text, Texture } from 'pixi.js'
import { Button, type ButtonOptions } from './button'

const PORTRAIT_WIDTH = 210
// Match the frame's 210 × 75 inner opening so portrait art is not reduced to a
// narrow strip above the deck name.
const PORTRAIT_HEIGHT = 75
const PORTRAIT_Y = -2
/** Moves every portrait inside the fixed artwork crop without moving the frame. */
const PORTRAIT_ARTWORK_Y_OFFSET = 12
const DECK_NAME_MAX_WIDTH = 190
const DECK_NAME_FONT_SIZE = 24
const DECK_NAME_Y = 25

export interface DeckEntryButtonOptions extends ButtonOptions {
  readonly portrait?: Texture
  readonly portraitYOffset?: number
  readonly deckName: string
  readonly showDeckName?: boolean
}

/** Shared deck button composed from portrait art, a frame, and a deck label. */
export class DeckEntryButton extends Button {
  constructor(frame: Texture, options: DeckEntryButtonOptions) {
    super(frame, options)

    if (options.portrait) this.addPortrait(options.portrait, options.portraitYOffset)
    if (options.showDeckName ?? true) this.addDeckName(options.deckName)
  }

  private addPortrait(
    texture: Texture,
    yOffset: number = PORTRAIT_ARTWORK_Y_OFFSET
  ): void {
    const portrait = new Sprite(texture)
    portrait.anchor.set(0.5)
    portrait.y = PORTRAIT_Y + yOffset
    portrait.eventMode = 'none'
    const scale = Math.max(
      PORTRAIT_WIDTH / texture.width,
      PORTRAIT_HEIGHT / texture.height
    )
    portrait.scale.set(scale)

    const mask = new Graphics()
      .rect(
        -PORTRAIT_WIDTH / 2,
        PORTRAIT_Y - PORTRAIT_HEIGHT / 2,
        PORTRAIT_WIDTH,
        PORTRAIT_HEIGHT
      )
      .fill({ color: 0xffffff })
    mask.eventMode = 'none'
    portrait.mask = mask

    this.addChildAt(portrait, 0)
    this.addChildAt(mask, 1)
  }

  private addDeckName(deckName: string): void {
    const label = new Text({
      text: deckName,
      style: {
        fontFamily: 'Belwe',
        fontSize: DECK_NAME_FONT_SIZE,
        fill: 0xffffff,
        align: 'center'
      }
    })
    label.anchor.set(0.5)
    label.position.set(0, DECK_NAME_Y)
    label.eventMode = 'none'
    if (label.width > DECK_NAME_MAX_WIDTH) {
      label.scale.set(DECK_NAME_MAX_WIDTH / label.width)
    }
    this.addChild(label)
  }
}
