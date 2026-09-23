import { Container, Graphics, Sprite, Text, type Renderer, type Texture } from 'pixi.js'
import type { HeroPowerId } from '../../../game/content/cards'
import type { CardChoiceOption, OpeningCard, PlayerId } from '../../../game/match'
import { AnimationScope } from '../../animation/animations'
import { completeTimeline } from './game-presentation-animation'
import { GhostAura } from '../../rendering/effects/ghost-aura'
import { HERO_POWER_CARD_CANVAS } from '../../rendering/hero-powers/hero-power-presentation'
import { applyAnchoredPlacement } from '../../rendering/layout'
import { Button } from '../../ui/components/button'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { GameCardSlot } from './game-card-slot'
import { BoardShadowLayer } from '../../rendering/shadows/board-shadow-layer'
import { attachShadow } from '../../rendering/shadows/shadow-caster'
import { REMOTE_TIMING } from './game-presentation-timing'

export interface SelectedCardSlot {
  readonly card: OpeningCard
  readonly slot: GameCardSlot
  readonly globalPosition: { readonly x: number; readonly y: number }
}

export interface CardSelectionOverlayOptions {
  readonly renderer: Renderer
  readonly toggleTexture: Texture
  readonly cardBackTexture: Texture
  readonly createSlot: (
    card: OpeningCard,
    sourceInstanceId?: string
  ) => Promise<GameCardSlot>
  readonly createHeroPowerChoice: (
    heroPowerId: HeroPowerId,
    premium: boolean
  ) => Container
  /** Premium lookups for the choice source (e.g. a premium Sir Finley). */
  readonly heroPowerChoicePremium?: (
    participantId: PlayerId,
    sourceCardInstanceId: string
  ) => boolean
  readonly onSelect: (card: OpeningCard) => void
  readonly onChooseOption: (choice: number) => void
  readonly isInputBlocked?: () => boolean
}

/** A modal three-card selector for Tracking and future Discover-style effects. */
export class CardSelectionOverlay extends Container {
  private readonly shadowLayer: BoardShadowLayer
  private readonly animationScope = new AnimationScope()
  private requestRevision = 0
  private readonly darkOverlay = new Graphics()
  private readonly cardsLayer = new Container()
  private readonly toggleOutline: GhostAura
  private readonly toggle: Button
  private readonly toggleLabel: Text
  private readonly entries: Array<{
    readonly view: Container
    readonly card?: OpeningCard
    readonly slot?: GameCardSlot
  }> = []
  private readonly remoteEntries: Array<{
    readonly instanceId: string
    readonly view: Sprite
  }> = []
  private boardVisible = false
  private dimming = true
  private selecting = false
  private selected: SelectedCardSlot | null = null
  private readonly choicesByInstanceId = new Map<string, CardChoiceOption>()

  constructor(private readonly options: CardSelectionOverlayOptions) {
    super()
    this.label = 'game.card-selection'
    this.eventMode = 'static'
    this.darkOverlay.rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0.8 })
    this.darkOverlay.label = 'game.card-selection.dark-overlay'
    this.darkOverlay.eventMode = 'static'
    this.darkOverlay.on('pointertap', (event) => event.stopPropagation())
    this.addChild(this.darkOverlay)
    this.shadowLayer = new BoardShadowLayer(this, options.renderer)
    this.shadowLayer.label = 'game.card-selection.shadows'
    this.addChild(this.shadowLayer)
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
    this.toggleOutline = new GhostAura(toggleOutlineTarget, {})

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

  /** Shows concealed remote Discover choices while the AI decides. */
  async showRemoteDiscover(candidates: readonly OpeningCard[]): Promise<void> {
    if (this.destroyed) return
    this.clear()
    const revision = this.requestRevision
    this.visible = true
    this.boardVisible = false
    this.dimming = false
    this.selecting = false
    this.setToggleVisible(false)
    this.syncView()

    const midpoint = (candidates.length - 1) / 2
    const remote = GAME_BOARD_LAYOUT.cardSelection.remoteDiscover
    for (const [index, candidate] of candidates.entries()) {
      const back = new Sprite(this.options.cardBackTexture)
      back.anchor.set(0.5, 1)
      back.position.set(
        remote.centerX + (index - midpoint) * remote.gap,
        remote.baselineY
      )
      back.scale.set(remote.scale)
      back.alpha = 0
      back.eventMode = 'none'
      back.label = `game.card-selection.remote-discover:${candidate.instanceId}`
      attachShadow(
        back,
        {
          x: -back.texture.width / 2,
          y: -back.texture.height,
          width: back.texture.width,
          height: back.texture.height
        },
        { restingScale: remote.scale, restingHeight: remote.shadowHeight }
      )
      this.cardsLayer.addChild(back)
      this.remoteEntries.push({ instanceId: candidate.instanceId, view: back })
    }

    if (this.destroyed || revision !== this.requestRevision) return
    await Promise.all(
      this.remoteEntries.map(({ view }) =>
        completeTimeline(
          this.animationScope.timeline().to(view, {
            alpha: 1,
            duration: REMOTE_TIMING.discoverFade
          })
        )
      )
    )
  }

  /** Resolves a concealed remote Discover and optionally hands its back to the remote hand. */
  async resolveRemoteDiscover(
    selectedInstanceId: string,
    destination: {
      readonly x: number
      readonly y: number
      readonly scale: number
      readonly rotation: number
    },
    keepSelected: boolean
  ): Promise<Sprite | null> {
    if (this.destroyed) return null
    const selected = this.remoteEntries.find(
      (entry) => entry.instanceId === selectedInstanceId
    )
    if (!selected) return null
    const revision = this.requestRevision
    this.selecting = true
    this.toggle.setEnabled(false)
    for (const entry of this.remoteEntries) {
      if (entry === selected) continue
      entry.view.eventMode = 'none'
      void this.animationScope.to(entry.view, {
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: REMOTE_TIMING.discoverSelection,
        ease: 'power2.in'
      })
    }

    const selection = this.animationScope.timeline()
    selection.to(selected.view, {
      x: destination.x,
      y: destination.y,
      rotation: destination.rotation,
      duration: REMOTE_TIMING.discoverSelection,
      ease: 'power2.inOut'
    })
    selection.to(
      selected.view.scale,
      {
        x: destination.scale,
        y: destination.scale,
        duration: REMOTE_TIMING.discoverSelection,
        ease: 'power2.inOut'
      },
      0
    )
    if (!keepSelected) {
      selection.to(selected.view, {
        alpha: 0,
        duration: REMOTE_TIMING.discoverFade,
        ease: 'power1.in'
      })
    }
    await completeTimeline(selection)
    if (this.destroyed || revision !== this.requestRevision) return null
    if (!keepSelected) {
      this.clear()
      return null
    }

    selected.view.removeFromParent()
    for (const child of this.cardsLayer.removeChildren()) {
      if (!child.destroyed) child.destroy({ children: true })
    }
    this.remoteEntries.length = 0
    this.entries.length = 0
    this.choicesByInstanceId.clear()
    this.selected = null
    this.selecting = false
    this.toggle.setEnabled(true)
    this.setToggleVisible(true)
    this.visible = false
    return selected.view
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
      await this.showHeroPowerChoices(
        options,
        this.options.heroPowerChoicePremium?.(participantId, sourceCardInstanceId) ??
          false
      )
      return
    }
    const cards = options.map((option) => ({
      instanceId: `${sourceCardInstanceId}:choice:${option.choice}`,
      cardId: option.presentationCardId ?? sourceCardId,
      ...(option.presentationCost !== undefined
        ? { baseCost: option.presentationCost, currentCost: option.presentationCost }
        : {}),
      ownerId: participantId,
      controllerId: participantId,
      zone: 'revealed' as const,
      revealed: true
    }))
    await this.showCards(cards, options, sourceCardInstanceId)
  }

  private async showCards(
    candidates: readonly OpeningCard[],
    choiceOptions: readonly CardChoiceOption[] = [],
    sourceInstanceId?: string
  ): Promise<void> {
    if (this.destroyed) return
    this.clear()
    const revision = this.requestRevision
    choiceOptions.forEach((option, index) => {
      const card = candidates[index]
      if (card) this.choicesByInstanceId.set(card.instanceId, option)
    })
    this.visible = true
    this.boardVisible = false
    this.dimming = true
    this.selecting = false
    this.syncView()
    const midpoint = (candidates.length - 1) / 2
    const created = await Promise.all(
      candidates.map(async (card, index) => {
        const slot = await this.options.createSlot(card, sourceInstanceId)
        if (this.destroyed || revision !== this.requestRevision) {
          slot.destroy({ children: true })
          return null
        }
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
        if (choice && !choice.presentationCardId) {
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
    if (this.destroyed || revision !== this.requestRevision) return
    await Promise.all(
      created.map((slot) =>
        slot
          ? completeTimeline(
              this.animationScope.timeline().to(slot, { alpha: 1, duration: 0.2 })
            )
          : Promise.resolve()
      )
    )
  }

  private async showHeroPowerChoices(
    options: readonly CardChoiceOption[],
    premium: boolean
  ): Promise<void> {
    if (this.destroyed) return
    this.clear()
    this.visible = true
    this.boardVisible = false
    this.dimming = true
    this.selecting = false
    this.syncView()
    const midpoint = (options.length - 1) / 2
    const views = options.map((option, index) => {
      const heroPowerId = option.presentationHeroPowerId!
      const view = this.options.createHeroPowerChoice(heroPowerId, premium)
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
      const label = new Text({
        text: option.label,
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
      label.position.set(view.x, view.y + 18)
      label.eventMode = 'none'
      label.label = `game.card-selection.hero-power-choice-label:${option.choice}`
      this.cardsLayer.addChild(label)
      this.entries.push({ view })
      return view
    })
    await Promise.all(
      views.map((view) =>
        completeTimeline(
          this.animationScope.timeline().to(view, { alpha: 1, duration: 0.2 })
        )
      )
    )
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

  updateShadows(deltaMS: number): void {
    if (this.visible) this.shadowLayer.update(deltaMS)
  }

  clear(): void {
    if (this.destroyed) return
    this.requestRevision += 1
    this.animationScope.kill()
    for (const entry of this.entries) entry.view.destroy({ children: true })
    this.entries.length = 0
    for (const entry of this.remoteEntries) {
      if (!entry.view.destroyed) entry.view.destroy({ children: true })
    }
    this.remoteEntries.length = 0
    for (const child of this.cardsLayer.removeChildren()) {
      if (!child.destroyed) child.destroy({ children: true })
    }
    this.choicesByInstanceId.clear()
    this.selected = null
    this.boardVisible = false
    this.dimming = true
    this.syncView()
    this.toggle.setEnabled(true)
    this.setToggleVisible(true)
    this.visible = false
  }

  dispose(): void {
    if (this.destroyed) return
    this.clear()
    this.toggleOutline.dispose()
    this.toggle.dispose()
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
      void this.animationScope.to(entry.view, {
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
      void this.animationScope.to(entry.view, {
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

  private setToggleVisible(visible: boolean): void {
    this.toggle.visible = visible
    this.toggleOutline.setEnabled(visible)
  }

  private syncView(): void {
    this.cardsLayer.visible = !this.boardVisible
    const dimmed = !this.boardVisible && this.dimming
    this.darkOverlay.alpha = dimmed ? 1 : 0
    this.darkOverlay.eventMode = dimmed ? 'static' : 'none'
    this.toggleLabel.text = this.boardVisible ? 'SEE CARDS' : 'SEE BOARD'
  }
}
