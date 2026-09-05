import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import type { HeroPowerId } from '../../../game/content/cards'
import type { CardChoiceOption, OpeningCard, PlayerId } from '../../../game/match'
import { gsap } from '../../animation/animations'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import { HERO_POWER_CARD_CANVAS } from '../../rendering/hero-powers/hero-power-presentation'
import { applyAnchoredPlacement } from '../../rendering/layout'
import { Button } from '../../ui/components/button'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { GameCardSlot } from './game-card-slot'

export interface SelectedCardSlot {
  readonly card: OpeningCard
  readonly slot: GameCardSlot
  readonly globalPosition: { readonly x: number; readonly y: number }
}

export interface CardSelectionOverlayOptions {
  readonly toggleTexture: Texture
  readonly createSlot: (card: OpeningCard) => Promise<GameCardSlot>
  readonly createHeroPowerChoice: (heroPowerId: HeroPowerId) => Container
  readonly onSelect: (card: OpeningCard) => void
  readonly onChooseOption: (choice: number) => void
  readonly isInputBlocked?: () => boolean
}

/** A modal three-card selector for Tracking and future Discover-style effects. */
export class CardSelectionOverlay extends Container {
  private readonly darkOverlay = new Graphics()
  private readonly cardsLayer = new Container()
  private readonly toggleOutline: AnimatedOutline
  private readonly toggle: Button
  private readonly toggleLabel: Text
  private readonly entries: Array<{
    readonly view: Container
    readonly card?: OpeningCard
    readonly slot?: GameCardSlot
  }> = []
  private boardVisible = false
  private selecting = false
  private selected: SelectedCardSlot | null = null
  private readonly choicesByInstanceId = new Map<string, CardChoiceOption>()

  constructor(private readonly options: CardSelectionOverlayOptions) {
    super()
    this.label = 'game.card-selection'
    this.eventMode = 'static'
    this.darkOverlay.rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0.8 })
    this.darkOverlay.eventMode = 'static'
    this.darkOverlay.on('pointertap', (event) => event.stopPropagation())
    this.addChild(this.darkOverlay)
    this.cardsLayer.label = 'game.card-selection.cards'
    this.addChild(this.cardsLayer)

    const toggleOutlineTarget = new Sprite(options.toggleTexture)
    applyAnchoredPlacement(
      toggleOutlineTarget,
      GAME_BOARD_LAYOUT.cardSelection.toggleButton
    )
    toggleOutlineTarget.eventMode = 'none'
    toggleOutlineTarget.label = 'game.card-selection.toggle-outline'
    this.addChild(toggleOutlineTarget)
    this.toggleOutline = new AnimatedOutline(toggleOutlineTarget, { preset: 'ghost' })

    this.toggle = new Button(options.toggleTexture, {
      onClick: () => {
        if (!this.inputBlocked()) this.toggleView()
      }
    })
    this.toggle.label = 'game.card-selection.toggle'
    this.toggle.position.set(
      GAME_BOARD_LAYOUT.cardSelection.toggleButton.position.x,
      GAME_BOARD_LAYOUT.cardSelection.toggleButton.position.y
    )
    this.toggle.setBaseY(GAME_BOARD_LAYOUT.cardSelection.toggleButton.position.y)
    this.toggleLabel = new Text({
      text: 'SEE BOARD',
      style: {
        fontFamily: 'Belwe',
        fontSize: 25,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 }
      }
    })
    this.toggleLabel.anchor.set(0.5)
    this.toggleLabel.eventMode = 'none'
    this.toggle.addChild(this.toggleLabel)
    this.addChild(this.toggle)
    this.visible = false
  }

  async show(candidates: readonly OpeningCard[]): Promise<void> {
    await this.showCards(candidates)
  }

  async showChoices(
    participantId: PlayerId,
    sourceCardInstanceId: string,
    sourceCardId: OpeningCard['cardId'],
    options: readonly CardChoiceOption[]
  ): Promise<void> {
    if (
      options.length > 0 &&
      options.every((option) => option.presentationHeroPowerId !== undefined)
    ) {
      await this.showHeroPowerChoices(options)
      return
    }
    const cards = options.map((option) => ({
      instanceId: `${sourceCardInstanceId}:choice:${option.choice}`,
      cardId: option.presentationCardId ?? sourceCardId,
      ownerId: participantId,
      controllerId: participantId,
      zone: 'revealed' as const,
      revealed: true
    }))
    await this.showCards(cards, options)
  }

  private async showCards(
    candidates: readonly OpeningCard[],
    choiceOptions: readonly CardChoiceOption[] = []
  ): Promise<void> {
    this.clear()
    choiceOptions.forEach((option, index) => {
      const card = candidates[index]
      if (card) this.choicesByInstanceId.set(card.instanceId, option)
    })
    this.visible = true
    this.boardVisible = false
    this.selecting = false
    this.syncView()
    const midpoint = (candidates.length - 1) / 2
    const created = await Promise.all(
      candidates.map(async (card, index) => {
        const slot = await this.options.createSlot(card)
        slot.label = `game.card-selection.option:${card.instanceId}`
        slot.position.set(
          GAME_BOARD_LAYOUT.cardSelection.cards.centerX +
            (index - midpoint) * GAME_BOARD_LAYOUT.cardSelection.cards.gap,
          GAME_BOARD_LAYOUT.cardSelection.cards.baselineY
        )
        slot.scale.set(GAME_BOARD_LAYOUT.cardSelection.cards.scale)
        slot.alpha = 0
        slot.setMulliganInteractionEnabled(true)
        slot.on('pointertap', () => this.choose(card, slot))
        this.cardsLayer.addChild(slot)
        const choice = this.choicesByInstanceId.get(card.instanceId)
        if (choice) {
          const label = new Text({
            text: choice.label,
            style: {
              fontFamily: 'Belwe',
              fontSize: 24,
              fill: 0xffffff,
              stroke: { color: 0x000000, width: 5 },
              align: 'center',
              wordWrap: true,
              wordWrapWidth: 275
            }
          })
          label.anchor.set(0.5, 0)
          label.position.set(slot.x, slot.y + 18)
          label.eventMode = 'none'
          label.label = `game.card-selection.choice-label:${choice.choice}`
          this.cardsLayer.addChild(label)
        }
        this.entries.push({ view: slot, card, slot })
        return slot
      })
    )
    await Promise.all(created.map((slot) => gsap.to(slot, { alpha: 1, duration: 0.2 })))
  }

  private async showHeroPowerChoices(
    options: readonly CardChoiceOption[]
  ): Promise<void> {
    this.clear()
    this.visible = true
    this.boardVisible = false
    this.selecting = false
    this.syncView()
    const midpoint = (options.length - 1) / 2
    const views = options.map((option, index) => {
      const heroPowerId = option.presentationHeroPowerId!
      const view = this.options.createHeroPowerChoice(heroPowerId)
      view.label = `game.card-selection.hero-power-option:${heroPowerId}`
      view.pivot.set(HERO_POWER_CARD_CANVAS.width / 2, HERO_POWER_CARD_CANVAS.height)
      view.position.set(
        GAME_BOARD_LAYOUT.cardSelection.cards.centerX +
          (index - midpoint) * GAME_BOARD_LAYOUT.cardSelection.cards.gap,
        GAME_BOARD_LAYOUT.cardSelection.cards.baselineY
      )
      view.scale.set(GAME_BOARD_LAYOUT.cardSelection.cards.scale)
      view.alpha = 0
      view.eventMode = 'static'
      view.cursor = 'pointer'
      view.on('pointertap', () => this.chooseOption(option, view))
      this.cardsLayer.addChild(view)
      this.entries.push({ view })
      return view
    })
    await Promise.all(views.map((view) => gsap.to(view, { alpha: 1, duration: 0.2 })))
  }

  takeSelected(instanceId: string): SelectedCardSlot | null {
    if (!this.selected || this.selected.card.instanceId !== instanceId) return null
    const selected = this.selected
    const entryIndex = this.entries.findIndex((entry) => entry.slot === selected.slot)
    if (entryIndex >= 0) this.entries.splice(entryIndex, 1)
    this.selected = null
    selected.slot.removeFromParent()
    return selected
  }

  clear(): void {
    for (const entry of this.entries) entry.view.destroy({ children: true })
    this.entries.length = 0
    for (const child of this.cardsLayer.removeChildren()) {
      if (!child.destroyed) child.destroy({ children: true })
    }
    this.choicesByInstanceId.clear()
    this.selected = null
    this.toggle.setEnabled(true)
    this.visible = false
  }

  dispose(): void {
    this.clear()
    this.toggleOutline.dispose()
    this.toggle.destroy({ children: true })
    super.destroy({ children: true })
  }

  private choose(card: OpeningCard, slot: GameCardSlot): void {
    if (this.inputBlocked() || this.boardVisible || this.selecting) return
    this.selecting = true
    this.toggle.setEnabled(false)
    for (const entry of this.entries) {
      if (entry.view === slot) continue
      entry.slot?.setMulliganInteractionEnabled(false)
      entry.view.eventMode = 'none'
      void gsap.to(entry.view, {
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 0.2
      })
    }
    this.selected = { card, slot, globalPosition: slot.getGlobalPosition() }
    const choice = this.choicesByInstanceId.get(card.instanceId)
    if (choice) this.options.onChooseOption(choice.choice)
    else this.options.onSelect(card)
  }

  private chooseOption(option: CardChoiceOption, view: Container): void {
    if (this.inputBlocked() || this.boardVisible || this.selecting) return
    this.selecting = true
    this.toggle.setEnabled(false)
    for (const entry of this.entries) {
      entry.view.eventMode = 'none'
      if (entry.view === view) continue
      void gsap.to(entry.view, {
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 0.2
      })
    }
    this.options.onChooseOption(option.choice)
  }

  private toggleView(): void {
    if (this.selecting) return
    this.boardVisible = !this.boardVisible
    this.syncView()
  }

  private inputBlocked(): boolean {
    return this.options.isInputBlocked?.() === true
  }

  private syncView(): void {
    this.cardsLayer.visible = !this.boardVisible
    this.darkOverlay.alpha = this.boardVisible ? 0 : 1
    this.toggleLabel.text = this.boardVisible ? 'SEE CARDS' : 'SEE BOARD'
  }
}
