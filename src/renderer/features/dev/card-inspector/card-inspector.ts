import { Container, Text, type FederatedPointerEvent, type Renderer } from 'pixi.js'
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
  formatHexColor,
  getClassFrameConfig,
  isClassFrameClass
} from '../../../rendering/cards/class-frame-colors'
import { CardInspectorControls } from './card-inspector-controls'
import { CardInspectorModel } from './card-inspector-model'

export interface CardInspectorOptions {
  readonly cardId?: CardId
  readonly resolver?: CardAssetResolver
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
}

const REPRESENTATIVE_CARDS = Object.fromEntries(
  PLAYABLE_CLASSES.map((classId) => {
    const minion = CARD_CATALOG.all.find(
      (card) => card.cardClass === classId && card.type === 'Minion'
    )
    const spell = CARD_CATALOG.all.find(
      (card) => card.cardClass === classId && card.type === 'Spell'
    )
    if (!minion || !spell) {
      throw new Error(`Card color lab requires minion and spell cards for ${classId}`)
    }
    return [classId, { minion, spell }]
  })
) as Record<
  (typeof PLAYABLE_CLASSES)[number],
  { readonly minion: CardDefinition; readonly spell: CardDefinition }
>

const CARD_PREVIEW_POSITION = { x: 1190, y: 72 } as const
const CARD_PREVIEW_SCALE = 0.9

/** Development-only composition of production card content and mask tuning. */
export class CardInspector extends Container {
  private readonly resolver: CardAssetResolver
  private readonly model = new CardInspectorModel()
  private readonly cardLayer = new Container()
  private readonly diagnostics = new Text({
    text: '',
    style: {
      fontFamily: 'Arial',
      fontSize: 16,
      fill: 0xd8c49a,
      stroke: { color: 0x101829, width: 4 }
    }
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
  private readonly controls: CardInspectorControls
  private cardView: CardView | null = null
  private showSequence = 0
  private dragPosition: { x: number; y: number } | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveRequested = false
  private saveInFlight = false

  constructor(options: CardInspectorOptions) {
    super()
    this.resolver = options.resolver ?? new CardAssetResolver()

    const requested = options.cardId ? CARD_CATALOG.get(options.cardId) : undefined
    if (requested && isClassFrameClass(requested.cardClass)) {
      this.model.selectedClass = requested.cardClass
      if (requested.type === 'Minion' || requested.type === 'Spell') {
        this.model.selectedTemplate = requested.type.toLowerCase() as 'minion' | 'spell'
      }
    }

    this.addChild(this.cardLayer)
    this.diagnostics.position.set(1080, 30)
    this.addChild(this.diagnostics)
    this.colorReadout.anchor.set(1, 1)
    this.colorReadout.position.set(1880, 1048)
    this.addChild(this.colorReadout)

    this.controls = new CardInspectorControls({
      canvas: options.canvas,
      renderer: options.renderer,
      parent: options.parent,
      model: this.model,
      onAppearanceChanged: () => {
        this.refreshColorReadout()
        this.controls.refresh()
        this.scheduleSave()
      },
      onCommit: () => this.flushSave(),
      onSelectionChanged: () => void this.showSelectedCard()
    })
    this.addChild(this.controls)
    this.refreshColorReadout()
    void this.showSelectedCard()
  }

  setControlsVisible(visible: boolean): void {
    this.controls.setVisible(visible)
  }

  dispose(): void {
    this.flushSave()
    this.controls.dispose()
  }

  private selectedCard(): CardDefinition {
    return REPRESENTATIVE_CARDS[this.model.selectedClass][this.model.selectedTemplate]
  }

  private async showSelectedCard(): Promise<void> {
    const card = this.selectedCard()
    const sequence = ++this.showSequence
    const artwork = await this.resolver.loadArtwork(card.id)
    const nextView = await CardView.create(card, this.resolver, { artwork })
    if (sequence !== this.showSequence) {
      nextView.destroy({ children: true })
      return
    }

    nextView.position.set(CARD_PREVIEW_POSITION.x, CARD_PREVIEW_POSITION.y)
    nextView.scale.set(CARD_PREVIEW_SCALE)
    nextView.cursor = 'move'
    this.installDragHandlers(nextView)

    const previous = this.cardView
    this.cardView = nextView
    this.cardLayer.addChild(nextView)
    this.diagnostics.text = `${card.name} · ${card.id} · ${this.model.selectedTemplate.toUpperCase()}`
    this.refreshColorReadout()
    this.controls.refresh()
    if (previous) {
      this.cardLayer.removeChild(previous)
      previous.destroy({ children: true })
    }
  }

  private installDragHandlers(view: CardView): void {
    view.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      const local = view.toLocal(event.global)
      this.dragPosition = { x: local.x, y: local.y }
      event.stopPropagation()
    })
    view.on('globalpointermove', (event: FederatedPointerEvent) => {
      if (!this.dragPosition || this.cardView !== view) return
      const local = view.toLocal(event.global)
      this.model.moveActiveMask(
        local.x - this.dragPosition.x,
        local.y - this.dragPosition.y
      )
      this.dragPosition = { x: local.x, y: local.y }
      this.controls.refresh()
      this.refreshColorReadout()
      this.scheduleSave()
    })
    const endDrag = (): void => {
      this.dragPosition = null
      this.flushSave()
    }
    view.on('pointerup', endDrag)
    view.on('pointerupoutside', endDrag)
    view.on('pointercancel', endDrag)
  }

  private refreshColorReadout(): void {
    const appearance = classFrameAppearanceFor(this.model.selectedClass)
    if (!appearance) return
    const secondary =
      this.model.selectedTemplate === 'minion'
        ? `   Secondary ${formatHexColor(appearance.secondary.color)}`
        : ''
    this.colorReadout.text = `${this.model.selectedClass.toUpperCase()} · ${this.model.selectedTemplate.toUpperCase()}\nPrimary ${formatHexColor(appearance.primary.color)}${secondary}`
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
          console.error(
            '[CardClassColorLab] Failed to save production configuration.',
            error
          )
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
