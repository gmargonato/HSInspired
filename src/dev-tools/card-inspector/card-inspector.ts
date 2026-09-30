import { Container, Text, type Renderer } from 'pixi.js'
import { CARD_CATALOG, type CardId } from '../../game-rules/content/cards'
import { CardAssetResolver } from '../../visual-components/assets/card-asset-resolver'
import { CardView } from '../../visual-components/cards/card-view'
import {
  getClassFrameConfig,
  isClassFrameClass
} from '../../visual-components/cards/class-frame-colors'
import { CardInspectorControls } from './card-inspector-controls'
import { CardInspectorModel, type CardLabTemplate } from './card-inspector-model'
import { isPremiumEnabled } from '../../visual-components/cards/premium-appearance'

export interface CardInspectorOptions {
  readonly cardId?: CardId
  readonly resolver?: CardAssetResolver
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
}

const CARD_PREVIEW_POSITION = { x: 1190, y: 125 } as const
const CARD_PREVIEW_SCALE = 0.9

/** Development-only composition of production card content and mask tuning. */
export class CardInspector extends Container {
  private readonly resolver: CardAssetResolver
  private readonly model = new CardInspectorModel()
  private readonly cardLayer = new Container()
  private readonly previewError = new Text({
    text: '',
    style: {
      fontFamily: 'Arial',
      fontSize: 16,
      fill: 0xd8c49a,
      stroke: { color: 0x101829, width: 4 }
    }
  })
  private readonly controls: CardInspectorControls
  private cardView: CardView | null = null
  private showSequence = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveRequested = false
  private saveInFlight = false

  constructor(options: CardInspectorOptions) {
    super()
    this.resolver = options.resolver ?? new CardAssetResolver()
    this.model.selectedPremium = isPremiumEnabled()

    const requested = options.cardId ? CARD_CATALOG.get(options.cardId) : undefined
    if (requested && isClassFrameClass(requested.cardClass)) {
      this.model.selectedClass = requested.cardClass
      this.model.selectedTemplate = requested.type.toLowerCase() as CardLabTemplate
    }

    this.addChild(this.cardLayer)
    this.previewError.position.set(1190, 75)
    this.previewError.label = 'dev.card-inspector.preview-error'
    this.addChild(this.previewError)

    this.controls = new CardInspectorControls({
      canvas: options.canvas,
      renderer: options.renderer,
      parent: options.parent,
      model: this.model,
      onAppearanceChanged: () => {
        this.controls.refresh()
        this.scheduleSave()
      },
      onCommit: () => this.flushSave(),
      onSelectionChanged: () => void this.showSelectedCard()
    })
    this.addChild(this.controls)

    void this.showSelectedCard()
  }

  setControlsVisible(visible: boolean): void {
    this.controls.setVisible(visible)
  }

  dispose(): void {
    ++this.showSequence
    this.flushSave()
    this.controls.dispose()
  }

  private async showSelectedCard(): Promise<void> {
    const card = this.model.selectedCard
    const sequence = ++this.showSequence
    const premium = this.model.selectedPremium
    if (!card) {
      if (this.cardView) this.cardView.visible = false
      this.previewError.text = 'No card is available for this class and type.'
      return
    }
    if (this.cardView) {
      this.cardView.eventMode = 'none'
      this.cardView.visible = false
    }
    let nextView: CardView
    try {
      const artwork = await this.resolver.loadArtwork(card.id)
      if (sequence !== this.showSequence) return
      nextView = await CardView.create(card, this.resolver, {
        artwork,
        premium,
        ignorePremiumOverride: true
      })
    } catch (error) {
      if (sequence !== this.showSequence) return
      console.error('[CardLab] Failed to load preview.', error)
      this.previewError.text = 'Preview unavailable. Select a variant to retry.'
      return
    }
    if (sequence !== this.showSequence) {
      nextView.destroy({ children: true })
      return
    }

    nextView.position.set(CARD_PREVIEW_POSITION.x, CARD_PREVIEW_POSITION.y)
    nextView.scale.set(CARD_PREVIEW_SCALE)
    nextView.eventMode = 'none'

    const previous = this.cardView
    this.cardView = nextView
    this.cardLayer.addChild(nextView)
    this.previewError.text = ''
    this.controls.refresh()
    if (previous) {
      this.cardLayer.removeChild(previous)
      previous.destroy({ children: true })
    }
  }

  private scheduleSave(): void {
    this.saveRequested = true
    this.controls.setStatus('Saving…')
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flushSave(), 200)
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.saveRequested || this.saveInFlight) return
    void this.drainSaves()
  }

  private async drainSaves(): Promise<void> {
    const save = window.api.cardClassBuilder?.save
    if (!save) {
      this.controls.setStatus('Unable to save: development builder API is unavailable.')
      return
    }

    this.saveInFlight = true
    try {
      while (this.saveRequested) {
        this.saveRequested = false
        try {
          await save(getClassFrameConfig())
        } catch (error) {
          this.saveRequested = true
          console.error('[CardLab] Failed to save production configuration.', error)
          this.controls.setStatus(
            'Save failed. The current values remain live; edit again to retry.'
          )
          return
        }
      }
      this.controls.setStatus('Saved production configuration.')
    } finally {
      this.saveInFlight = false
    }
  }
}
