import { Container, Text } from 'pixi.js'
import {
  CARD_CATALOG,
  PLAYABLE_CLASSES,
  type CardDefinition,
  type CardId
} from '../../../../game/content/cards'
import { CardAssetResolver } from '../../../ui/asset-registry/card-asset-resolver'
import { CardView } from '../../../rendering/cards/card-view'
import {
  classFrameAppearanceFor,
  type ClassFrameAppearanceControls
} from '../../../rendering/cards/class-frame-colors'
import { CardInspectorControls } from './card-inspector-controls'

export interface CardInspectorOptions {
  readonly cardId?: CardId
  readonly resolver?: CardAssetResolver
}

const INSPECTOR_MINION_CARDS: readonly CardDefinition[] = PLAYABLE_CLASSES.map(
  (classId) => {
    const card = CARD_CATALOG.all.find(
      (candidate) => candidate.type === 'Minion' && candidate.cardClass === classId
    )
    if (!card) throw new Error(`Card inspector requires a minion for ${classId}`)
    return card
  }
)

function formatHexColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`
}

/** The card is centered in the canvas area to the right of the control panels. */
const CARD_PREVIEW_POSITION = { x: 1030, y: 80 } as const
const CARD_PREVIEW_SCALE = 0.82

/** Development-only composition of production card content and rendering. */
export class CardInspector extends Container {
  private readonly resolver: CardAssetResolver
  private readonly cardLayer = new Container()
  private readonly diagnostics = new Text({
    text: '',
    style: { fontFamily: 'Arial', fontSize: 16, fill: 0xd8c49a }
  })
  private readonly colorReadout = new Text({
    text: '',
    style: {
      fontFamily: 'Arial',
      fontSize: 16,
      fill: 0xffffff,
      align: 'right',
      lineHeight: 22,
      stroke: { color: 0x101829, width: 4 }
    }
  })
  private cardView: CardView | null = null
  private selectedCard: CardDefinition | null = null
  private currentCard: CardDefinition | null = null
  private showSequence = 0
  /** Empty means use the production class colors until the inspector changes them. */
  private frameAppearance: ClassFrameAppearanceControls = {}

  constructor(options: CardInspectorOptions = {}) {
    super()
    this.resolver = options.resolver ?? new CardAssetResolver()
    this.addChild(this.cardLayer)
    this.diagnostics.position.set(20, 56)
    this.addChild(this.diagnostics)

    const initialCard = options.cardId
      ? CARD_CATALOG.require(options.cardId)
      : (INSPECTOR_MINION_CARDS[0] ?? CARD_CATALOG.require('classic_abomination'))
    this.selectedCard = initialCard
    this.colorReadout.anchor.set(1, 1)
    this.colorReadout.position.set(1880, 1048)
    this.addChild(this.colorReadout)
    this.refreshColorReadout()
    const controls = new CardInspectorControls({
      cards: INSPECTOR_MINION_CARDS,
      initialCardId: initialCard.id,
      onCardSelected: (card) => {
        this.selectedCard = card
        this.refreshColorReadout()
        void this.showCard(card)
      },
      onFrameAppearanceChanged: (appearance) => {
        this.frameAppearance = appearance
        this.applyFrameAppearance()
        this.refreshColorReadout()
      }
    })
    this.addChild(controls)
    void this.showCard(initialCard)
  }

  async showCard(card: CardDefinition): Promise<void> {
    const sequence = ++this.showSequence
    const artwork = await this.resolver.loadArtwork(card.id)
    const nextView = await CardView.create(card, this.resolver, {
      artwork
    })
    if (sequence !== this.showSequence) {
      nextView.destroy({ children: true })
      return
    }
    nextView.position.set(CARD_PREVIEW_POSITION.x, CARD_PREVIEW_POSITION.y)
    nextView.scale.set(CARD_PREVIEW_SCALE)
    nextView.setClassFrameAppearance(card.cardClass, this.frameAppearance)

    const previous = this.cardView
    this.cardView = nextView
    this.selectedCard = card
    this.currentCard = card
    this.cardLayer.addChild(nextView)
    this.diagnostics.text = `${card.id} · ${nextView.plan.template} · ${nextView.plan.width}×${nextView.plan.height}`
    this.refreshColorReadout()
    if (previous) {
      this.cardLayer.removeChild(previous)
      previous.destroy({ children: true })
    }
  }

  private applyFrameAppearance(): void {
    const card = this.currentCard
    const view = this.cardView
    if (!card || !view) return
    view.setClassFrameAppearance(card.cardClass, this.frameAppearance)
  }

  private refreshColorReadout(): void {
    const card = this.selectedCard
    const appearance = card
      ? classFrameAppearanceFor(card.cardClass, this.frameAppearance)
      : undefined
    if (!card || !appearance) {
      this.colorReadout.text = 'NEUTRAL · MASK COLORS DISABLED'
      return
    }
    this.colorReadout.text = `${card.cardClass.toUpperCase()} MASK COLORS\nPrimary ${formatHexColor(appearance.primary)}   Accent ${formatHexColor(appearance.accent)}`
  }
}
