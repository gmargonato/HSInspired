import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import type { FederatedWheelEvent } from 'pixi.js'
import type { OpeningCard } from '../../../game/match'
import { CARD_CATALOG } from '../../../game/content/cards'
import { Actor } from '../../ui/components/actor'

const TRACKER_WIDTH = 320
const TRACKER_HEIGHT = 620
const TRACKER_X = 40
const TRACKER_Y = 110
const ROW_HEIGHT = 28
const ROW_GAP = 4
const HEADER_HEIGHT = 36

interface TrackerRow {
  cardId: string
  count: number
}

function groupDeck(deck: readonly OpeningCard[]): TrackerRow[] {
  const counts = new Map<string, number>()
  for (const card of deck) {
    counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1)
  }
  const rows: TrackerRow[] = []
  for (const [cardId, count] of counts.entries()) {
    rows.push({ cardId, count })
  }
  // Sort by cost then name for stable display
  rows.sort((a, b) => {
    const cardA = CARD_CATALOG.get(a.cardId)
    const cardB = CARD_CATALOG.get(b.cardId)
    const costA = cardA?.cost ?? 0
    const costB = cardB?.cost ?? 0
    if (costA !== costB) return costA - costB
    const nameA = cardA?.name ?? a.cardId
    const nameB = cardB?.name ?? b.cardId
    return nameA.localeCompare(nameB)
  })
  return rows
}

/**
 * Dev-only deck tracker: read-only list of remaining deck cards, grouped
 * and sorted. Mirrors the deck editor row style but without artwork or
 * interaction. Scrollable via wheel.
 */
export class DeckTrackerView extends Actor {
  private readonly viewport: Container
  private readonly content: Container
  private readonly maskGraphics: Graphics
  private readonly background: Graphics
  private readonly title: Text
  private readonly countLabel: Text
  private scrollOffset = 0
  private maxScroll = 0

  constructor() {
    super()
    this.label = 'game.deck-tracker'
    this.visible = false
    this.eventMode = 'none'

    this.background = new Graphics()
      .rect(0, 0, TRACKER_WIDTH, TRACKER_HEIGHT)
      .fill({ color: 0x1a1f2e, alpha: 0.92 })
      .stroke({ color: 0x6d4a38, width: 1, alpha: 0.95 })
    this.background.position.set(TRACKER_X, TRACKER_Y)
    this.addChild(this.background)

    this.title = new Text({
      text: 'Deck Tracker',
      style: {
        fontFamily: 'Belwe',
        fontSize: 20,
        fill: 0xfff4df,
        stroke: { color: 0x000000, width: 3 },
        align: 'center'
      }
    })
    this.title.anchor.set(0.5, 0)
    this.title.position.set(TRACKER_X + TRACKER_WIDTH / 2, TRACKER_Y + 8)
    this.addChild(this.title)

    this.countLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 16,
        fill: 0xfff4df,
        stroke: { color: 0x000000, width: 2 },
        align: 'center'
      }
    })
    this.countLabel.anchor.set(0.5, 0)
    this.countLabel.position.set(TRACKER_X + TRACKER_WIDTH / 2, TRACKER_Y + 28)
    this.addChild(this.countLabel)

    this.maskGraphics = new Graphics()
      .rect(0, 0, TRACKER_WIDTH, TRACKER_HEIGHT - HEADER_HEIGHT)
      .fill({ color: 0xffffff })
    this.maskGraphics.position.set(TRACKER_X, TRACKER_Y + HEADER_HEIGHT)
    this.addChild(this.maskGraphics)

    this.viewport = new Container()
    this.viewport.position.set(TRACKER_X, TRACKER_Y + HEADER_HEIGHT)
    this.viewport.hitArea = new Rectangle(
      0,
      0,
      TRACKER_WIDTH,
      TRACKER_HEIGHT - HEADER_HEIGHT
    )
    this.viewport.eventMode = 'static'
    this.viewport.on('wheel', this.handleWheel)
    this.viewport.mask = this.maskGraphics
    this.addChild(this.viewport)

    this.content = new Container()
    this.viewport.addChild(this.content)
  }

  update(deck: readonly OpeningCard[]): void {
    const rows = groupDeck(deck)
    const oldRows = this.content.removeChildren()
    for (const row of oldRows) row.destroy({ children: true })

    this.countLabel.text = `${deck.length} cards remaining`

    for (const [index, row] of rows.entries()) {
      const card = CARD_CATALOG.get(row.cardId)
      const container = new Container()
      container.position.set(0, index * (ROW_HEIGHT + ROW_GAP))
      container.hitArea = new Rectangle(0, 0, TRACKER_WIDTH, ROW_HEIGHT)
      container.eventMode = 'none'

      const bg = new Graphics()
        .rect(0, 0, TRACKER_WIDTH, ROW_HEIGHT)
        .fill({ color: 0x241c32, alpha: 0.92 })
        .stroke({ color: 0x3a2f4a, width: 1, alpha: 0.6 })
      container.addChild(bg)

      const costBg = new Graphics()
        .rect(1, 1, 32, ROW_HEIGHT - 2)
        .fill({ color: 0x355376 })
      container.addChild(costBg)

      const cost = new Text({
        text: String(card?.cost ?? '?'),
        style: {
          fontFamily: 'Belwe',
          fontSize: 16,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 2 },
          align: 'center'
        }
      })
      cost.anchor.set(0.5)
      cost.position.set(16, ROW_HEIGHT / 2)
      container.addChild(cost)

      const name = new Text({
        text: card?.name ?? row.cardId,
        style: {
          fontFamily: 'Belwe',
          fontSize: 15,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 2 },
          align: 'left'
        }
      })
      name.anchor.set(0, 0.5)
      name.position.set(40, ROW_HEIGHT / 2)
      // Clip long names
      const maxNameWidth = TRACKER_WIDTH - 40 - 40 - 8
      if (name.width > maxNameWidth) name.scale.x = maxNameWidth / name.width
      container.addChild(name)

      const countBg = new Graphics()
        .rect(TRACKER_WIDTH - 36, 1, 34, ROW_HEIGHT - 2)
        .fill({ color: 0x312f31 })
      container.addChild(countBg)

      const count = new Text({
        text: String(row.count),
        style: {
          fontFamily: 'Belwe',
          fontSize: 16,
          fill: 0xf4d44d,
          stroke: { color: 0x000000, width: 2 },
          align: 'center'
        }
      })
      count.anchor.set(0.5)
      count.position.set(TRACKER_WIDTH - 18, ROW_HEIGHT / 2)
      container.addChild(count)

      this.content.addChild(container)
    }

    const contentHeight = rows.length * (ROW_HEIGHT + ROW_GAP)
    const viewportHeight = TRACKER_HEIGHT - HEADER_HEIGHT
    this.maxScroll = Math.max(0, contentHeight - viewportHeight)
    this.setScroll(this.scrollOffset)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.eventMode = visible ? 'static' : 'none'
    this.viewport.eventMode = visible ? 'static' : 'none'
  }

  private setScroll(offset: number): void {
    this.scrollOffset = Math.max(-this.maxScroll, Math.min(0, offset))
    this.content.y = this.scrollOffset
  }

  private readonly handleWheel = (event: FederatedWheelEvent): void => {
    if (this.maxScroll === 0) return
    this.setScroll(this.scrollOffset - event.deltaY)
    event.stopPropagation()
  }

  override dispose(): void {
    this.viewport.off('wheel', this.handleWheel)
    super.dispose()
  }
}
