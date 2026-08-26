import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import type { FederatedWheelEvent } from 'pixi.js'
import type { OpeningCard } from '../../../game/match'
import { Actor } from '../../ui/components/actor'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { applyPlacement, type LayoutPlacement } from '../../rendering/layout'
import { DECK_TRACKER_LAYOUT, DECK_TRACKER_ROW_LAYOUT } from './deck-tracker-layout'
import {
  buildDeckTrackerEntries,
  type DeckTrackerEntry,
  type DeckTrackerSortMode
} from './deck-tracker-model'

interface DeckTrackerRowView {
  readonly row: Container
  readonly artworkLayer: Container
  readonly artworkPlaceholder: Graphics
  readonly artworkWidth: number
  readonly artworkHeight: number
}

/**
 * Dev-only list of the local player's remaining deck cards. It follows the
 * collection deck editor's row treatment while keeping card order hidden:
 * cards are grouped by ID and sorted by cost, then name.
 */
export class DeckTrackerView extends Actor {
  private readonly viewport: Container
  private readonly content: Container
  private readonly maskGraphics: Graphics
  private renderSequence = 0
  private scrollOffset = 0
  private centerOffset = 0
  private maxScroll = 0
  private disposed = false
  private sortMode: DeckTrackerSortMode = 'cost'

  constructor(
    private readonly cardResolver = new CardAssetResolver(),
    layout: {
      readonly panel: LayoutPlacement
      readonly viewport: LayoutPlacement
    } = DECK_TRACKER_LAYOUT
  ) {
    super()
    applyPlacement(this, layout.panel)
    this.label = 'game.deck-tracker'
    this.visible = false
    this.eventMode = 'none'

    const { viewport } = layout
    const { height: viewportHeight, width: viewportWidth } = viewport.size

    this.maskGraphics = new Graphics()
      .rect(0, 0, viewportWidth, viewportHeight)
      .fill({ color: 0xffffff })
    applyPlacement(this.maskGraphics, viewport)
    this.maskGraphics.eventMode = 'none'
    this.addChild(this.maskGraphics)

    this.viewport = new Container()
    applyPlacement(this.viewport, viewport)
    this.viewport.hitArea = new Rectangle(0, 0, viewportWidth, viewportHeight)
    this.viewport.eventMode = 'none'
    this.viewport.on('wheel', this.handleWheel)
    this.viewport.mask = this.maskGraphics
    this.addChild(this.viewport)

    this.content = new Container()
    this.viewport.addChild(this.content)
  }

  update(deck: readonly OpeningCard[]): void {
    const sequence = ++this.renderSequence
    const entries = buildDeckTrackerEntries(deck, this.sortMode)
    const oldRows = this.content.removeChildren()
    for (const row of oldRows) row.destroy({ children: true })

    for (const [index, entry] of entries.entries()) {
      const row = this.createRow(entry, index)
      this.content.addChild(row.row)

      if (!entry.card) continue
      void this.cardResolver
        .loadArtwork(entry.card.id)
        .then((artwork) => {
          if (
            !artwork ||
            this.disposed ||
            sequence !== this.renderSequence ||
            row.row.parent !== this.content
          ) {
            return
          }
          this.applyRowArtwork(row, artwork)
        })
        .catch(() => undefined)
    }

    const contentHeight =
      entries.length === 0
        ? 0
        : DECK_TRACKER_ROW_LAYOUT.inset +
          entries.length *
            (DECK_TRACKER_ROW_LAYOUT.height + DECK_TRACKER_ROW_LAYOUT.gap) -
          DECK_TRACKER_ROW_LAYOUT.gap
    const viewportHeight = DECK_TRACKER_LAYOUT.viewport.size.height
    this.centerOffset = Math.max(0, (viewportHeight - contentHeight) / 2)
    this.maxScroll = Math.max(0, contentHeight - viewportHeight)
    this.scrollOffset = 0
    this.setScroll(0)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.eventMode = visible ? 'static' : 'none'
    this.viewport.eventMode = visible ? 'static' : 'none'
  }

  setSortMode(sortMode: DeckTrackerSortMode): void {
    this.sortMode = sortMode
  }

  private createRow(entry: DeckTrackerEntry, index: number): DeckTrackerRowView {
    const rowWidth =
      DECK_TRACKER_LAYOUT.viewport.size.width - DECK_TRACKER_ROW_LAYOUT.inset * 2
    const rowHeight = DECK_TRACKER_ROW_LAYOUT.height
    const row = new Container()
    row.label = `game.deck-tracker.card.${entry.cardId}`
    row.position.set(
      DECK_TRACKER_ROW_LAYOUT.inset,
      DECK_TRACKER_ROW_LAYOUT.inset + index * (rowHeight + DECK_TRACKER_ROW_LAYOUT.gap)
    )
    row.hitArea = new Rectangle(0, 0, rowWidth, rowHeight)
    row.eventMode = 'none'

    const background = new Graphics()
      .rect(0, 0, rowWidth, rowHeight)
      .fill({ color: 0x241c32, alpha: 0.92 })
      .stroke({ color: 0x6d4a38, width: 1, alpha: 0.95 })
    background.eventMode = 'none'
    row.addChild(background)

    const costBackground = new Graphics()
      .rect(1, 1, DECK_TRACKER_ROW_LAYOUT.costWidth - 2, rowHeight - 2)
      .fill(0x355376)
    costBackground.eventMode = 'none'
    row.addChild(costBackground)

    const cost = new Text({
      text: String(entry.card?.cost ?? '?'),
      style: {
        fontFamily: 'Belwe',
        fontSize: 17,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 2 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    cost.anchor.set(0.5)
    cost.position.set(DECK_TRACKER_ROW_LAYOUT.costWidth / 2, rowHeight / 2)
    cost.eventMode = 'none'
    row.addChild(cost)

    const copiesX = rowWidth - DECK_TRACKER_ROW_LAYOUT.copiesWidth - 2
    const artworkWidth =
      rowWidth -
      DECK_TRACKER_ROW_LAYOUT.costWidth -
      DECK_TRACKER_ROW_LAYOUT.copiesWidth -
      4
    const artworkHeight = rowHeight - 2

    const artworkLayer = new Container()
    artworkLayer.position.set(DECK_TRACKER_ROW_LAYOUT.costWidth, 1)
    const artworkPlaceholder = new Graphics()
      .rect(0, 0, artworkWidth, artworkHeight)
      .fill(0x3d3150)
    artworkPlaceholder.eventMode = 'none'
    artworkLayer.addChild(artworkPlaceholder)
    const artworkMask = new Graphics()
      .rect(0, 0, artworkWidth, artworkHeight)
      .fill(0xffffff)
    artworkMask.eventMode = 'none'
    artworkLayer.mask = artworkMask
    artworkLayer.addChild(artworkMask)
    artworkLayer.eventMode = 'none'
    row.addChild(artworkLayer)

    const name = new Text({
      text: entry.card?.name ?? entry.cardId,
      style: {
        fontFamily: 'Belwe',
        fontSize: 18,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        letterSpacing: -1,
        align: 'left'
      }
    })
    name.anchor.set(0, 0.5)
    name.position.set(DECK_TRACKER_ROW_LAYOUT.costWidth + 7, rowHeight / 2)
    const maxNameWidth = copiesX - name.x - 4
    if (name.width > maxNameWidth) name.scale.x = maxNameWidth / name.width
    name.eventMode = 'none'
    row.addChild(name)

    const copiesBackground = new Graphics()
      .rect(copiesX, 1, DECK_TRACKER_ROW_LAYOUT.copiesWidth - 2, rowHeight - 2)
      .fill(0x312f31)
    copiesBackground.eventMode = 'none'
    row.addChild(copiesBackground)

    const copies = new Text({
      text: entry.drawPosition ? `#${entry.drawPosition}` : String(entry.count),
      style: {
        fontFamily: 'Belwe',
        fontSize: 18,
        fill: 0xf4d44d,
        stroke: { color: 0x000000, width: 2 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    copies.anchor.set(0.5)
    copies.position.set(
      rowWidth - DECK_TRACKER_ROW_LAYOUT.copiesWidth / 2 - 1,
      rowHeight / 2
    )
    copies.eventMode = 'none'
    row.addChild(copies)

    return {
      row,
      artworkLayer,
      artworkPlaceholder,
      artworkWidth,
      artworkHeight
    }
  }

  private applyRowArtwork(row: DeckTrackerRowView, artwork: Texture): void {
    if (row.artworkPlaceholder.parent === row.artworkLayer) {
      row.artworkLayer.removeChild(row.artworkPlaceholder)
      row.artworkPlaceholder.destroy()
    }

    const sprite = new Sprite(artwork)
    sprite.anchor.set(0.5)
    const scale = Math.max(
      row.artworkWidth / artwork.width,
      row.artworkHeight / artwork.height
    )
    sprite.scale.set(scale)
    sprite.position.set(row.artworkWidth / 2, row.artworkHeight / 2)
    sprite.eventMode = 'none'
    row.artworkLayer.addChildAt(sprite, 0)
  }

  private setScroll(offset: number): void {
    this.scrollOffset = Math.max(-this.maxScroll, Math.min(0, offset))
    this.content.y = this.centerOffset + this.scrollOffset
  }

  private readonly handleWheel = (event: FederatedWheelEvent): void => {
    if (this.maxScroll === 0) return
    this.setScroll(this.scrollOffset - event.deltaY)
    event.stopPropagation()
  }

  override dispose(): void {
    this.disposed = true
    this.renderSequence += 1
    this.viewport.off('wheel', this.handleWheel)
    super.dispose()
  }
}
