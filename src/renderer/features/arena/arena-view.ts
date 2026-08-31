import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Texture
} from 'pixi.js'
import {
  CARD_CATALOG,
  HERO_CATALOG,
  arenaRunToDeck,
  createArenaOpponentDeck,
  createHumanVsAiMatchSetup,
  type ArenaRunSnapshot,
  type CardDefinition,
  type CardId,
  type HeroDefinition,
  type HeroId
} from '../../../game'
import type { GameRoute } from '../game/game-route'
import { createMatchSeed } from '../deck-selection/deck-selection-model'
import { CardView } from '../../rendering/cards/card-view'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import type {
  ArenaAssets,
  DeckPresentationAssets,
  SharedUIAssets
} from '../../ui/asset-registry'
import type { ArenaStore } from '../../ui/arena-store'
import { Actor } from '../../ui/components/actor'
import { Button } from '../../ui/components/button'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { ARENA_LAYOUT } from './arena-layout'
import { buildArenaDeckEntries, buildArenaManaCurve } from './arena-model'

export interface ArenaViewCallbacks {
  readonly onBack: () => void | Promise<void>
  readonly onPlay: (route: GameRoute) => void | Promise<void>
  readonly onError?: (message: string, error?: unknown) => void
}

interface HeroChoiceView {
  readonly hero: HeroDefinition
  readonly root: Container
}

interface ArenaDeckRow {
  readonly row: Container
  readonly artworkLayer: Container
  readonly artworkPlaceholder: Graphics
  readonly artworkWidth: number
  readonly artworkHeight: number
}

const DECK_ROW_COST_WIDTH = 27
const DECK_ROW_COPIES_WIDTH = 24

export class ArenaView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly choiceLayer = new Container()
  private readonly deckContent = new Container()
  private readonly deckViewport = new Container()
  private readonly deckMask = new Graphics()
  private readonly manaLayer = new Container()
  private readonly statisticsLayer = new Container()
  private readonly heroChoices: HeroChoiceView[] = []
  private cardChoices: CardView[] = []
  private selectedHero: Sprite | null = null
  private preview: CardView | null = null
  private heading!: Text
  private deckCount!: Text
  private retireButton!: Button
  private playButton!: Button
  private backButton!: Button
  private slider!: Sprite
  private retireDialog!: Container
  private snapshot!: ArenaRunSnapshot
  private renderSequence = 0
  private busy = false
  private deckScroll = 0
  private maxDeckScroll = 0
  private sliderDragging = false
  private sliderDragOffset = 0

  constructor(
    private readonly store: ArenaStore,
    private readonly assets: ArenaAssets,
    private readonly heroAssets: DeckPresentationAssets,
    sharedAssets: SharedUIAssets,
    private readonly callbacks: ArenaViewCallbacks
  ) {
    super()
    this.label = 'arena.view'
    this.createStaticPresentation(sharedAssets)
  }

  async mount(snapshot: ArenaRunSnapshot): Promise<void> {
    await this.render(snapshot)
  }

  private createStaticPresentation(sharedAssets: SharedUIAssets): void {
    const background = new Sprite(this.assets.background)
    background.label = 'arena.background'
    applyAnchoredPlacement(background, ARENA_LAYOUT.background)
    background.eventMode = 'none'
    this.addChild(background)

    this.heading = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 31,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x1a1116, width: 5 },
        align: 'center'
      }
    })
    this.heading.label = 'arena.heading'
    applyAnchoredPlacement(this.heading, ARENA_LAYOUT.heading)
    this.addChild(this.heading)

    this.choiceLayer.label = 'arena.choices'
    this.addChild(this.choiceLayer)

    const { x, y, width, height } = ARENA_LAYOUT.deckList
    this.deckMask.rect(x, y, width, height).fill(0xffffff)
    this.deckMask.label = 'arena.deck-mask'
    this.deckMask.eventMode = 'none'
    this.deckViewport.label = 'arena.deck-viewport'
    this.deckViewport.hitArea = new Rectangle(x, y, width, height)
    this.deckViewport.eventMode = 'static'
    this.deckViewport.on('wheel', this.handleWheel)
    this.deckViewport.mask = this.deckMask
    this.deckViewport.addChild(this.deckContent)
    this.addChild(this.deckMask, this.deckViewport)

    this.slider = new Sprite(this.assets.verticalSlider)
    this.slider.label = 'arena.deck-slider'
    this.slider.anchor.set(0.5)
    this.slider.position.set(
      ARENA_LAYOUT.deckList.sliderX,
      ARENA_LAYOUT.deckList.sliderMinY
    )
    this.slider.cursor = 'pointer'
    this.slider.on('pointerdown', this.handleSliderDown)
    this.slider.on('globalpointermove', this.handleSliderMove)
    this.slider.on('pointerup', this.handleSliderUp)
    this.slider.on('pointerupoutside', this.handleSliderUp)
    this.addChild(this.slider)

    this.deckCount = new Text({
      text: '0/30',
      style: {
        fontFamily: 'Belwe',
        fontSize: 22,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 }
      }
    })
    this.deckCount.label = 'arena.deck-count'
    applyAnchoredPlacement(this.deckCount, ARENA_LAYOUT.deckCount)
    this.addChild(this.deckCount)

    this.addChild(this.manaLayer, this.statisticsLayer)

    this.retireButton = new Button(this.assets.retireButton, {
      onClick: () => this.openRetireDialog()
    })
    this.retireButton.label = 'arena.retire-button'
    applyPlacement(this.retireButton, ARENA_LAYOUT.retireButton)
    this.retireButton.setBaseY(ARENA_LAYOUT.retireButton.position.y)
    this.addChild(this.retireButton)

    this.playButton = new Button(this.assets.playButton, {
      onClick: () => this.playArena()
    })
    this.playButton.label = 'arena.play-button'
    applyPlacement(this.playButton, ARENA_LAYOUT.playButton)
    this.playButton.setBaseY(ARENA_LAYOUT.playButton.position.y)
    this.addChild(this.playButton)

    this.backButton = new Button(sharedAssets.backButton, {
      onClick: () => this.navigateBack()
    })
    this.backButton.label = 'arena.back-button'
    applyPlacement(this.backButton, ARENA_LAYOUT.backButton)
    this.backButton.setBaseY(ARENA_LAYOUT.backButton.position.y)
    this.addChild(this.backButton)

    this.createRetireDialog()
  }

  private createRetireDialog(): void {
    this.retireDialog = new Container()
    this.retireDialog.label = 'arena.retire-dialog'
    this.retireDialog.eventMode = 'static'
    this.retireDialog.hitArea = new Rectangle(0, 0, 1920, 1080)
    const panel = new Sprite(this.assets.retireContainer)
    panel.eventMode = 'none'
    this.retireDialog.addChild(panel)

    const confirm = new Button(this.assets.confirmButton, {
      onClick: () => this.confirmRetire()
    })
    confirm.label = 'arena.retire-confirm'
    applyPlacement(confirm, ARENA_LAYOUT.retireDialog.confirm)
    confirm.setBaseY(ARENA_LAYOUT.retireDialog.confirm.position.y)
    this.retireDialog.addChild(confirm)

    const cancel = new Button(this.assets.cancelButton, {
      onClick: () => this.closeRetireDialog()
    })
    cancel.label = 'arena.retire-cancel'
    applyPlacement(cancel, ARENA_LAYOUT.retireDialog.cancel)
    cancel.setBaseY(ARENA_LAYOUT.retireDialog.cancel.position.y)
    this.retireDialog.addChild(cancel)
    this.retireDialog.visible = false
    this.addChild(this.retireDialog)
  }

  private async render(snapshot: ArenaRunSnapshot): Promise<void> {
    this.snapshot = snapshot
    const sequence = ++this.renderSequence
    this.clearChoices()
    this.renderSelectedHero()
    this.renderDeck()
    this.renderManaCurve()
    this.renderStatistics()

    this.heading.text =
      snapshot.phase === 'choosing-hero'
        ? 'Choose your Hero'
        : snapshot.phase === 'drafting'
          ? 'Choose a Card'
          : 'Statistics'
    this.retireButton.visible = snapshot.heroId !== null
    this.playButton.visible = snapshot.phase === 'ready'
    this.statisticsLayer.visible = snapshot.phase === 'ready'
    this.manaLayer.visible = snapshot.heroId !== null
    this.deckCount.text = `${snapshot.picksCompleted}/30`

    if (snapshot.phase === 'choosing-hero') {
      this.renderHeroChoices(snapshot.heroChoices)
    } else if (snapshot.phase === 'drafting' && snapshot.cardChoices) {
      await this.renderCardChoices(snapshot.cardChoices, sequence)
    }
    this.setEnabled(true)
  }

  private clearChoices(): void {
    this.heroChoices.length = 0
    this.cardChoices.length = 0
    this.hidePreview()
    for (const child of this.choiceLayer.removeChildren()) {
      child.destroy({ children: true })
    }
  }

  private renderHeroChoices(heroIds: readonly HeroId[]): void {
    heroIds.forEach((heroId, index) => {
      const hero = HERO_CATALOG.require(heroId)
      const root = new Container()
      root.label = `arena.hero-choice.${hero.id}`
      root.position.set(
        ARENA_LAYOUT.heroChoices.centers[index],
        ARENA_LAYOUT.heroChoices.y
      )
      const portraitWidth =
        ARENA_LAYOUT.selectedHero.size.width * ARENA_LAYOUT.heroChoices.scale
      const portraitHeight =
        ARENA_LAYOUT.selectedHero.size.height * ARENA_LAYOUT.heroChoices.scale
      root.hitArea = new Rectangle(
        -portraitWidth / 2,
        -portraitHeight / 2,
        portraitWidth,
        portraitHeight + 92
      )
      root.eventMode = 'static'
      root.cursor = 'pointer'
      root.on('pointertap', () => void this.selectHero(hero, root))

      const portrait = new Sprite(this.heroAssets[hero.presentationAssetKey])
      portrait.label = `arena.hero-portrait.${hero.id}`
      portrait.anchor.set(0.5)
      portrait.scale.set(ARENA_LAYOUT.heroChoices.scale)
      portrait.eventMode = 'none'
      root.addChild(portrait)

      const name = this.createOutlinedText(hero.displayName, 24)
      name.label = `arena.hero-name.${hero.id}`
      name.anchor.set(0.5)
      name.position.set(0, ARENA_LAYOUT.heroChoices.nameY - ARENA_LAYOUT.heroChoices.y)
      root.addChild(name)
      const className = this.createOutlinedText(String(hero.classId).toUpperCase(), 18)
      className.label = `arena.hero-class.${hero.id}`
      className.anchor.set(0.5)
      className.position.set(
        0,
        ARENA_LAYOUT.heroChoices.classY - ARENA_LAYOUT.heroChoices.y
      )
      root.addChild(className)

      this.heroChoices.push({ hero, root })
      this.choiceLayer.addChild(root)
    })
  }

  private async selectHero(hero: HeroDefinition, root: Container): Promise<void> {
    if (this.busy) return
    this.setEnabled(false)
    try {
      const next = await this.store.selectHero(hero.id)
      for (const choice of this.heroChoices) {
        if (choice.root !== root)
          this.tweenTo(choice.root, { alpha: 0, duration: 0.18 })
      }
      await this.animateHeroToSlot(root)
      await this.render(next)
    } catch (error) {
      this.callbacks.onError?.('Failed to select the Arena hero.', error)
      this.setEnabled(true)
    }
  }

  private animateHeroToSlot(root: Container): Promise<void> {
    const start = { x: root.x, y: root.y }
    const end = ARENA_LAYOUT.selectedHero.position
    const control = { x: start.x - 250, y: start.y + 130 }
    const progress = { value: 0 }
    return new Promise((resolve) => {
      this.tweenTo(progress, {
        value: 1,
        duration: 0.7,
        ease: 'power2.inOut',
        onUpdate: () => {
          const t = progress.value
          const inverse = 1 - t
          root.position.set(
            inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
            inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
          )
          const finalScale =
            (ARENA_LAYOUT.selectedHero.scale?.x ?? 1) / ARENA_LAYOUT.heroChoices.scale
          const scale = 1 + (finalScale - 1) * t + Math.sin(Math.PI * t) * 0.3
          root.scale.set(scale)
        },
        onComplete: resolve,
        onInterrupt: resolve
      })
    })
  }

  private async renderCardChoices(
    cardIds: readonly CardId[],
    sequence: number
  ): Promise<void> {
    const views = await Promise.all(
      cardIds.map(async (cardId) => {
        const card = CARD_CATALOG.require(cardId)
        const artwork = await this.resolver.loadArtwork(card.id)
        return CardView.create(card, this.resolver, { artwork })
      })
    )
    if (sequence !== this.renderSequence) {
      for (const view of views) view.destroy({ children: true })
      return
    }
    views.forEach((view, index) => {
      view.label = `arena.card-choice.${cardIds[index]}`
      view.scale.set(ARENA_LAYOUT.cardChoices.scale)
      view.pivot.set(view.plan.width / 2, view.renderedHeight / 2)
      view.position.set(
        ARENA_LAYOUT.cardChoices.centers[index],
        ARENA_LAYOUT.cardChoices.y
      )
      view.cursor = 'pointer'
      view.on('pointertap', () => void this.selectCard(cardIds[index], view))
      this.cardChoices.push(view)
      this.choiceLayer.addChild(view)
    })
  }

  private async selectCard(cardId: CardId, selected: CardView): Promise<void> {
    if (this.busy) return
    this.setEnabled(false)
    try {
      const next = await this.store.pickCard(cardId)
      for (const card of this.cardChoices) {
        if (card !== selected) this.tweenTo(card, { alpha: 0, duration: 0.16 })
      }
      await this.animateCardToDeck(selected)
      await this.render(next)
    } catch (error) {
      this.callbacks.onError?.('Failed to add the Arena card.', error)
      this.setEnabled(true)
    }
  }

  private animateCardToDeck(card: CardView): Promise<void> {
    const start = { x: card.x, y: card.y }
    const end = { x: 1455, y: 150 }
    const control = { x: 1320, y: 130 }
    const progress = { value: 0 }
    return new Promise((resolve) => {
      this.tweenTo(progress, {
        value: 1,
        duration: 0.42,
        ease: 'power2.in',
        onUpdate: () => {
          const t = progress.value
          const inverse = 1 - t
          card.position.set(
            inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
            inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
          )
          card.scale.set(ARENA_LAYOUT.cardChoices.scale * (1 - t * 0.72))
        },
        onComplete: resolve,
        onInterrupt: resolve
      })
    })
  }

  private renderSelectedHero(): void {
    if (this.selectedHero) {
      this.removeChild(this.selectedHero)
      this.selectedHero.destroy()
      this.selectedHero = null
    }
    if (!this.snapshot.heroId) return
    const hero = HERO_CATALOG.require(this.snapshot.heroId)
    const portrait = new Sprite(this.heroAssets[hero.presentationAssetKey])
    portrait.label = 'arena.selected-hero'
    applyAnchoredPlacement(portrait, ARENA_LAYOUT.selectedHero)
    portrait.eventMode = 'none'
    this.selectedHero = portrait
    this.addChildAt(portrait, this.getChildIndex(this.choiceLayer))
  }

  private renderDeck(): void {
    for (const child of this.deckContent.removeChildren())
      child.destroy({ children: true })
    const entries = buildArenaDeckEntries(this.snapshot)
    const sequence = this.renderSequence
    entries.forEach((entry, index) => {
      const row = this.createDeckRow(entry.card, entry.count, index)
      this.deckContent.addChild(row.row)
      void this.resolver
        .loadArtwork(entry.card.id)
        .then((artwork) => {
          if (
            !artwork ||
            sequence !== this.renderSequence ||
            row.row.parent !== this.deckContent
          ) {
            return
          }
          this.applyDeckRowArtwork(row, artwork)
        })
        .catch((error: unknown) => {
          if (sequence === this.renderSequence) {
            this.callbacks.onError?.(
              `Failed to load deck artwork for ${entry.card.name}.`,
              error
            )
          }
        })
    })
    this.maxDeckScroll = Math.max(
      0,
      entries.length * ARENA_LAYOUT.deckList.rowHeight - ARENA_LAYOUT.deckList.height
    )
    this.setDeckScroll(this.deckScroll)
    this.slider.visible = this.maxDeckScroll > 0
  }

  private createDeckRow(
    card: CardDefinition,
    count: number,
    index: number
  ): ArenaDeckRow {
    const rowWidth = ARENA_LAYOUT.deckList.width
    const rowHeight = ARENA_LAYOUT.deckList.rowHeight - 1
    const row = new Container()
    row.label = `arena.deck-card.${card.id}`
    row.position.set(
      ARENA_LAYOUT.deckList.x,
      ARENA_LAYOUT.deckList.y + index * ARENA_LAYOUT.deckList.rowHeight
    )
    row.hitArea = new Rectangle(0, 0, rowWidth, rowHeight)
    row.eventMode = 'static'
    row.cursor = 'pointer'
    row.on('pointerover', () => void this.showPreview(card, row))
    row.on('pointerout', () => this.hidePreview())
    const background = new Graphics()
      .rect(0, 0, rowWidth, rowHeight)
      .fill({ color: 0x241c32, alpha: 0.92 })
      .stroke({ color: 0x6d4a38, width: 1, alpha: 0.95 })
    background.label = `arena.deck-card-background.${card.id}`
    background.eventMode = 'none'
    row.addChild(background)

    const costBackground = new Graphics()
      .rect(1, 1, DECK_ROW_COST_WIDTH - 2, rowHeight - 2)
      .fill(0x355376)
    costBackground.label = `arena.deck-card-cost-background.${card.id}`
    costBackground.eventMode = 'none'
    row.addChild(costBackground)

    const cost = new Text({
      text: String(card.cost),
      style: {
        fontFamily: 'Belwe',
        fontSize: 17,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 2 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    cost.label = `arena.deck-card-cost.${card.id}`
    cost.anchor.set(0.5)
    cost.position.set(DECK_ROW_COST_WIDTH / 2, rowHeight / 2)
    cost.eventMode = 'none'
    row.addChild(cost)

    const artworkX = DECK_ROW_COST_WIDTH
    const artworkWidth = rowWidth - DECK_ROW_COST_WIDTH - DECK_ROW_COPIES_WIDTH - 4
    const artworkHeight = rowHeight - 2
    const artworkLayer = new Container()
    artworkLayer.label = `arena.deck-card-artwork.${card.id}`
    artworkLayer.position.set(artworkX, 1)
    const artworkPlaceholder = new Graphics()
      .rect(0, 0, artworkWidth, artworkHeight)
      .fill(0x3d3150)
    artworkPlaceholder.label = `arena.deck-card-artwork-placeholder.${card.id}`
    artworkPlaceholder.eventMode = 'none'
    artworkLayer.addChild(artworkPlaceholder)
    const artworkMask = new Graphics()
      .rect(0, 0, artworkWidth, artworkHeight)
      .fill(0xffffff)
    artworkMask.label = `arena.deck-card-artwork-mask.${card.id}`
    artworkMask.eventMode = 'none'
    artworkLayer.mask = artworkMask
    artworkLayer.addChild(artworkMask)
    artworkLayer.eventMode = 'none'
    row.addChild(artworkLayer)

    const name = new Text({
      text: card.name,
      style: {
        fontFamily: 'Belwe',
        fontSize: 18,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        letterSpacing: -1,
        align: 'left'
      }
    })
    name.label = `arena.deck-card-name.${card.id}`
    name.anchor.set(0, 0.5)
    name.position.set(DECK_ROW_COST_WIDTH + 7, rowHeight / 2)
    name.eventMode = 'none'
    const copiesX = rowWidth - DECK_ROW_COPIES_WIDTH - 2
    const maxNameWidth = copiesX - name.x - 4
    if (name.width > maxNameWidth) name.scale.x = maxNameWidth / name.width
    row.addChild(name)

    const copiesBackground = new Graphics()
      .rect(copiesX, 1, DECK_ROW_COPIES_WIDTH - 2, rowHeight - 2)
      .fill(0x312f31)
    copiesBackground.label = `arena.deck-card-copies-background.${card.id}`
    copiesBackground.eventMode = 'none'
    row.addChild(copiesBackground)

    const copies = new Text({
      text: String(count),
      style: {
        fontFamily: 'Belwe',
        fontSize: 18,
        fill: 0xf4d44d,
        stroke: { color: 0x000000, width: 2 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    copies.label = `arena.deck-card-copies.${card.id}`
    copies.anchor.set(0.5)
    copies.position.set(rowWidth - DECK_ROW_COPIES_WIDTH / 2 - 1, rowHeight / 2)
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

  private applyDeckRowArtwork(row: ArenaDeckRow, artwork: Texture): void {
    if (row.artworkPlaceholder.parent === row.artworkLayer) {
      row.artworkLayer.removeChild(row.artworkPlaceholder)
      row.artworkPlaceholder.destroy()
    }

    const sprite = new Sprite(artwork)
    sprite.label = 'arena.deck-card-artwork-image'
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

  private renderManaCurve(): void {
    for (const child of this.manaLayer.removeChildren())
      child.destroy({ children: true })
    const values = buildArenaManaCurve(this.snapshot)
    const maximum = Math.max(1, ...values)
    values.forEach((value, index) => {
      const height = (value / maximum) * ARENA_LAYOUT.manaCurve.maxHeight
      const bar = new Graphics()
        .roundRect(
          ARENA_LAYOUT.manaCurve.centers[index] - ARENA_LAYOUT.manaCurve.width / 2,
          ARENA_LAYOUT.manaCurve.baselineY - height,
          ARENA_LAYOUT.manaCurve.width,
          height,
          5
        )
        .fill({ color: 0x8f2818, alpha: 0.92 })
        .stroke({ color: 0x2b0d08, width: 2 })
      bar.label = `arena.mana.${index}`
      this.manaLayer.addChild(bar)
    })
  }

  private renderStatistics(): void {
    for (const child of this.statisticsLayer.removeChildren()) {
      child.destroy({ children: true })
    }
    const labels = ['Games Played', 'Games Won', 'Defeats']
    const values = [
      this.snapshot.gamesPlayed,
      this.snapshot.wins,
      this.snapshot.defeats
    ]
    labels.forEach((label, index) => {
      const labelText = this.createOutlinedText(label, 28, 0x3b2518)
      labelText.label = `arena.stat-label.${index}`
      labelText.anchor.set(0.5)
      labelText.position.set(
        ARENA_LAYOUT.statistics.columns[index],
        ARENA_LAYOUT.statistics.labelsY
      )
      const valueText = this.createOutlinedText(String(values[index]), 82, 0x25150e)
      valueText.label = `arena.stat-value.${index}`
      valueText.anchor.set(0.5)
      valueText.position.set(
        ARENA_LAYOUT.statistics.columns[index],
        ARENA_LAYOUT.statistics.valuesY
      )
      this.statisticsLayer.addChild(labelText, valueText)
    })
  }

  private async showPreview(card: CardDefinition, row: Container): Promise<void> {
    this.hidePreview()
    try {
      const artwork = await this.resolver.loadArtwork(card.id)
      const preview = await CardView.create(card, this.resolver, { artwork })
      if (!row.parent || this.busy) {
        preview.destroy({ children: true })
        return
      }
      const scale = 0.4
      preview.scale.set(scale)
      preview.position.set(
        ARENA_LAYOUT.deckList.x - preview.plan.width * scale - 18,
        Math.max(115, Math.min(700, row.y + this.deckScroll - 120))
      )
      preview.eventMode = 'none'
      preview.label = `arena.deck-preview.${card.id}`
      this.preview = preview
      this.addChild(preview)
    } catch (error) {
      this.callbacks.onError?.(`Failed to preview ${card.name}.`, error)
    }
  }

  private hidePreview(): void {
    if (!this.preview) return
    this.removeChild(this.preview)
    this.preview.destroy({ children: true })
    this.preview = null
  }

  private setDeckScroll(value: number): void {
    this.deckScroll = Math.max(-this.maxDeckScroll, Math.min(0, value))
    this.deckContent.y = this.deckScroll
    if (this.maxDeckScroll > 0) {
      const ratio = -this.deckScroll / this.maxDeckScroll
      this.slider.y =
        ARENA_LAYOUT.deckList.sliderMinY +
        ratio * (ARENA_LAYOUT.deckList.sliderMaxY - ARENA_LAYOUT.deckList.sliderMinY)
    }
  }

  private readonly handleWheel = (event: FederatedWheelEvent): void => {
    if (this.busy) return
    this.setDeckScroll(this.deckScroll - event.deltaY * 0.55)
  }

  private readonly handleSliderDown = (event: FederatedPointerEvent): void => {
    if (this.busy || this.maxDeckScroll <= 0) return
    this.sliderDragging = true
    this.sliderDragOffset = event.global.y - this.slider.y
  }

  private readonly handleSliderMove = (event: FederatedPointerEvent): void => {
    if (!this.sliderDragging) return
    const min = ARENA_LAYOUT.deckList.sliderMinY
    const max = ARENA_LAYOUT.deckList.sliderMaxY
    const y = Math.max(min, Math.min(max, event.global.y - this.sliderDragOffset))
    this.setDeckScroll(-((y - min) / (max - min)) * this.maxDeckScroll)
  }

  private readonly handleSliderUp = (): void => {
    this.sliderDragging = false
  }

  private openRetireDialog(): void {
    if (this.busy || !this.snapshot.heroId) return
    this.retireDialog.visible = true
    this.setEnabled(false)
    this.retireDialog.eventMode = 'static'
  }

  private closeRetireDialog(): void {
    this.retireDialog.visible = false
    this.setEnabled(true)
  }

  private async confirmRetire(): Promise<void> {
    if (!this.retireDialog.visible) return
    this.busy = true
    try {
      const next = await this.store.retire()
      this.retireDialog.visible = false
      await this.render(next)
    } catch (error) {
      this.callbacks.onError?.('Failed to retire the Arena deck.', error)
      this.setEnabled(true)
    } finally {
      this.busy = false
    }
  }

  private playArena(): void {
    if (this.busy || this.snapshot.phase !== 'ready') return
    const seed = createMatchSeed()
    const humanDeck = arenaRunToDeck(this.snapshot)
    const aiDeck = createArenaOpponentDeck(seed)
    const route: GameRoute = {
      id: 'game',
      mode: 'arena',
      setup: {
        ...createHumanVsAiMatchSetup({ humanDeck, aiDeck }, seed),
        modeId: 'arena'
      },
      deckSnapshots: [humanDeck, aiDeck]
    }
    const result = this.callbacks.onPlay(route)
    if (result)
      void Promise.resolve(result).catch((error) => {
        this.callbacks.onError?.('Failed to start the Arena match.', error)
        this.setEnabled(true)
      })
    this.setEnabled(false)
  }

  private navigateBack(): void {
    if (this.busy) return
    this.setEnabled(false)
    const result = this.callbacks.onBack()
    if (result)
      void Promise.resolve(result).catch((error) => {
        this.callbacks.onError?.('Failed to return to the main menu.', error)
        this.setEnabled(true)
      })
  }

  private setEnabled(enabled: boolean): void {
    this.busy = !enabled
    for (const choice of this.heroChoices) {
      choice.root.eventMode = enabled ? 'static' : 'none'
    }
    for (const card of this.cardChoices) card.eventMode = enabled ? 'static' : 'none'
    this.retireButton.setEnabled(enabled && this.snapshot?.heroId !== null)
    this.playButton.setEnabled(enabled && this.snapshot?.phase === 'ready')
    this.backButton.setEnabled(enabled)
    this.slider.eventMode = enabled && this.maxDeckScroll > 0 ? 'static' : 'none'
  }

  private createOutlinedText(text: string, fontSize: number, fill = 0xffffff): Text {
    const value = new Text({
      text,
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fontWeight: '700',
        fill,
        stroke: { color: 0x000000, width: Math.max(2, Math.round(fontSize / 10)) },
        align: 'center'
      }
    })
    value.eventMode = 'none'
    return value
  }

  override dispose(): void {
    ++this.renderSequence
    this.hidePreview()
    super.dispose()
  }
}
