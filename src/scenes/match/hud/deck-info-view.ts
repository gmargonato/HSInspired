import { Container, Sprite, Text, type Texture } from 'pixi.js'
import type { OpeningMatchState } from '../../../game-rules/match'
import {
  applyAnchoredPlacement,
  applyPlacement,
  placement
} from '../../../visual-components/layout'
import { DECK_INFO_LAYOUT } from './deck-info-layout'

type Side = 'local' | 'remote'
type Player = OpeningMatchState['players'][number]

/** A passive tooltip; only the deck itself owns hover input. */
export class DeckInfoView extends Container {
  private readonly heading: Text
  private readonly body: Text
  private hovered: { side: Side; deck: Sprite } | null = null
  private counts = {
    local: { deck: 0, hand: 0 },
    remote: { deck: 0, hand: 0 }
  }

  constructor(texture: Texture) {
    super()
    this.label = 'game.deck-info'
    this.eventMode = 'none'
    this.visible = false

    const background = new Sprite(texture)
    background.label = 'game.deck-info.background'
    applyAnchoredPlacement(background, DECK_INFO_LAYOUT.background)
    this.addChild(background)

    const heading = new Text({
      text: 'Deck and Hand',
      style: {
        fontFamily: 'Belwe',
        fontSize: DECK_INFO_LAYOUT.headingFontSize,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 }
      }
    })
    this.heading = heading
    heading.label = 'game.deck-info.heading'
    applyAnchoredPlacement(heading, DECK_INFO_LAYOUT.heading)
    this.addChild(heading)

    this.body = new Text({
      text: '',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: DECK_INFO_LAYOUT.bodyFontSize,
        fill: 0xffffff,
        wordWrap: true,
        wordWrapWidth: DECK_INFO_LAYOUT.body.size.width,
        lineHeight: DECK_INFO_LAYOUT.bodyLineHeight
      }
    })
    this.body.label = 'game.deck-info.body'
    applyAnchoredPlacement(this.body, DECK_INFO_LAYOUT.body)
    this.addChild(this.body)
  }

  show(side: Side, deck: Sprite): void {
    this.hovered = { side, deck }
    this.refresh()
    this.visible = true
  }

  hide(side: Side): void {
    if (this.hovered?.side !== side) return
    this.hovered = null
    this.visible = false
  }

  sync(local: Player, remote: Player): void {
    this.counts.local = { deck: local.deck.length, hand: local.hand.length }
    this.counts.remote = { deck: remote.deck.length, hand: remote.hand.length }
    this.refresh()
  }

  private refresh(): void {
    if (!this.hovered || !this.parent) return
    const { side, deck } = this.hovered
    applyAnchoredPlacement(
      this.heading,
      side === 'remote' ? DECK_INFO_LAYOUT.remoteHeading : DECK_INFO_LAYOUT.heading
    )
    applyAnchoredPlacement(
      this.body,
      side === 'remote' ? DECK_INFO_LAYOUT.remoteBody : DECK_INFO_LAYOUT.body
    )
    const count = this.counts[side]
    this.body.text =
      side === 'local'
        ? `Your deck has ${count.deck} cards. You have ${count.hand} cards in your hand`
        : `Your opponent’s deck has ${count.deck} cards. Your opponent has ${count.hand} cards in their hand.`

    const centerLeft = this.parent.toLocal(
      deck.toGlobal({
        x: -deck.anchor.x * deck.texture.orig.width,
        y: (0.5 - deck.anchor.y) * deck.texture.orig.height
      })
    )
    const background = DECK_INFO_LAYOUT.background
    const width = background.size.width * (background.scale?.x ?? 1)
    const height = background.size.height * (background.scale?.y ?? 1)
    applyPlacement(
      this,
      placement(
        {
          x: centerLeft.x - DECK_INFO_LAYOUT.gap - width,
          y: centerLeft.y - height / 2
        },
        { width, height }
      )
    )
  }
}
