import {
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Renderer,
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
import {
  createCardAddFlightPath,
  resolveCardAddFlightPoint,
  resolveCardAddScrollOffset
} from '../collection/choreography/card-add-flight'

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

interface ArenaCardAddEffect {
  readonly root: Container
  readonly source: Sprite
  readonly bloom: Sprite
  readonly aura: Sprite
  readonly row: ArenaDeckRow
  readonly sourceTexture: ReturnType<Renderer['generateTexture']>
  readonly blur: BlurFilter
  destroyed: boolean
}

interface ArenaCardAddTarget {
  readonly x: number
  readonly y: number
}

const DECK_ROW_COST_WIDTH = 27
const DECK_ROW_COPIES_WIDTH = 24

const CARD_ADD_CHOREOGRAPHY = {
  flightDuration: 0.34,
  landingDuration: 0.1,
  rowStartScale: 0.88,
  rowLandingScale: 1.05,
  sourceGlowScale: 1.28
} as const

export class ArenaView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly choiceLayer = new Container()
  private readonly deckContent = new Container()
  private readonly deckViewport = new Container()
  private readonly deckMask = new Graphics()
  private readonly cardAddEffectLayer = new Container()
  private readonly manaLayer = new Container()
  private readonly statisticsLayer = new Container()
  private readonly heroChoices: HeroChoiceView[] = []
  private readonly deckRows = new Map<string, ArenaDeckRow>()
  private cardChoices: CardView[] = []
  private selectedHero: Sprite | null = null
  private preview: CardView | null = null
  private activeCardAddEffect: ArenaCardAddEffect | null = null
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
  private disposed = false

  constructor(
    private readonly store: ArenaStore,
    private readonly assets: ArenaAssets,
    private readonly heroAssets: DeckPresentationAssets,
    sharedAssets: SharedUIAssets,
    private readonly renderer: Renderer,
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
    this.cardAddEffectLayer.label = 'arena.card-add-effects'
    this.cardAddEffectLayer.eventMode = 'none'
    this.addChild(this.cardAddEffectLayer)
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

  private async render(snapshot: ArenaRunSnapshot, enable = true): Promise<void> {
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
    if (enable) this.setEnabled(true)
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

      const name = this.createOutlinedText(hero.displayName, 24, 0x000000, false)
      name.label = `arena.hero-name.${hero.id}`
      name.anchor.set(0.5)
      name.position.set(0, ARENA_LAYOUT.heroChoices.nameY - ARENA_LAYOUT.heroChoices.y)
      root.addChild(name)
      const className = this.createOutlinedText(
        String(hero.classId).toUpperCase(),
        18,
        0x000000,
        false
      )
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
    let effect: ArenaCardAddEffect | null = null
    try {
      if (this.disposed) return
      const predictedSnapshot: ArenaRunSnapshot = {
        ...this.snapshot,
        cards: {
          ...this.snapshot.cards,
          [cardId]: (this.snapshot.cards[cardId] ?? 0) + 1
        },
        picksCompleted: this.snapshot.picksCompleted + 1
      }
      for (const card of this.cardChoices) {
        if (card !== selected) this.tweenTo(card, { alpha: 0, duration: 0.16 })
      }
      const target = this.prepareCardAddTarget(predictedSnapshot, cardId)
      effect = this.createCardAddEffect(
        selected,
        cardId,
        predictedSnapshot.cards[cardId] ?? 1
      )
      this.activeCardAddEffect = effect
      const animation = this.animateCardToDeck(selected, effect, target)
      const [next] = await Promise.all([this.store.pickCard(cardId), animation])
      if (this.disposed) return
      await this.render(next, false)
      await this.animateCardAddLanding(effect, cardId)
      this.setEnabled(true)
    } catch (error) {
      this.callbacks.onError?.('Failed to add the Arena card.', error)
      if (effect && !this.disposed) {
        try {
          await this.render(this.snapshot)
        } catch {
          // Keep the original card-add error as the reported failure.
        }
      }
      this.setEnabled(true)
    } finally {
      if (effect) this.destroyCardAddEffect(effect)
      if (this.activeCardAddEffect === effect) this.activeCardAddEffect = null
    }
  }

  private prepareCardAddTarget(
    snapshot: ArenaRunSnapshot,
    cardId: CardId
  ): ArenaCardAddTarget {
    const entries = buildArenaDeckEntries(snapshot)
    const index = entries.findIndex((entry) => entry.card.id === cardId)
    if (index < 0) throw new Error(`Arena card ${cardId} is missing from the deck.`)

    const rowHeight = ARENA_LAYOUT.deckList.rowHeight
    const renderedRowHeight = rowHeight - 1
    const maxScroll = Math.max(
      0,
      entries.length * rowHeight - ARENA_LAYOUT.deckList.height
    )
    const rowTop = ARENA_LAYOUT.deckList.y + index * rowHeight
    this.maxDeckScroll = maxScroll
    this.setDeckScroll(
      resolveCardAddScrollOffset({
        viewportTop: ARENA_LAYOUT.deckList.y,
        viewportHeight: ARENA_LAYOUT.deckList.height,
        contentOffset: this.deckScroll,
        maxScroll,
        rowTop,
        rowHeight: renderedRowHeight
      })
    )

    return {
      x: ARENA_LAYOUT.deckList.x + ARENA_LAYOUT.deckList.width / 2,
      y: rowTop + this.deckScroll + renderedRowHeight / 2
    }
  }

  private createCardAddEffect(
    selected: CardView,
    cardId: CardId,
    count: number
  ): ArenaCardAddEffect {
    const bounds = selected.getBounds()
    const topLeft = this.toLocal({ x: bounds.x, y: bounds.y })
    const bottomRight = this.toLocal({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height
    })
    const centerX = (topLeft.x + bottomRight.x) / 2
    const centerY = (topLeft.y + bottomRight.y) / 2
    const sourceWidth = Math.abs(bottomRight.x - topLeft.x)
    const sourceHeight = Math.abs(bottomRight.y - topLeft.y)

    const root = new Container()
    root.label = 'arena.card-add-effect'
    root.eventMode = 'none'
    this.cardAddEffectLayer.addChild(root)

    const aura = new Sprite(this.assets.cardAddAura)
    aura.label = 'arena.card-add-aura'
    aura.anchor.set(0.5)
    aura.position.set(centerX, centerY)
    aura.width = sourceWidth * 1.55
    aura.height = sourceHeight * 1.25
    aura.blendMode = 'add'
    aura.alpha = 0.72
    root.addChild(aura)

    const sourceTexture = this.renderer.generateTexture({
      target: selected,
      antialias: true
    })
    const bloom = new Sprite(sourceTexture)
    const blur = new BlurFilter({ strength: 10, quality: 3 })
    bloom.label = 'arena.card-add-bloom'
    bloom.anchor.set(0.5)
    bloom.position.set(centerX, centerY)
    bloom.width = sourceWidth
    bloom.height = sourceHeight
    bloom.blendMode = 'add'
    bloom.filters = [blur]
    bloom.alpha = 0.92
    root.addChild(bloom)

    const source = new Sprite(sourceTexture)
    source.label = 'arena.card-add-whiteout'
    source.anchor.set(0.5)
    source.position.set(centerX, centerY)
    source.width = sourceWidth
    source.height = sourceHeight
    source.blendMode = 'add'
    source.alpha = 0.92
    root.addChild(source)

    const row = this.createDeckRow(CARD_CATALOG.require(cardId), count, 0)
    const rowWidth = ARENA_LAYOUT.deckList.width
    const rowHeight = ARENA_LAYOUT.deckList.rowHeight - 1
    row.row.label = 'arena.card-add-row'
    row.row.eventMode = 'none'
    row.row.pivot.set(rowWidth / 2, rowHeight / 2)
    row.row.position.set(centerX, centerY)
    row.row.scale.set(CARD_ADD_CHOREOGRAPHY.rowStartScale)
    row.row.alpha = 0
    root.addChild(row.row)

    void this.resolver
      .loadArtwork(cardId)
      .then((artwork) => {
        if (artwork && row.row.parent === root) this.applyDeckRowArtwork(row, artwork)
      })
      .catch(() => undefined)

    return {
      root,
      source,
      bloom,
      aura,
      row,
      sourceTexture,
      blur,
      destroyed: false
    }
  }

  private animateCardToDeck(
    card: CardView,
    effect: ArenaCardAddEffect,
    target: ArenaCardAddTarget
  ): Promise<void> {
    const start = { x: effect.row.row.x, y: effect.row.row.y }
    const path = createCardAddFlightPath(start, target)
    const progress = { value: 0 }
    const updateFlight = (): void => {
      const point = resolveCardAddFlightPoint(path, progress.value)
      effect.row.row.position.set(point.x, point.y)
    }

    return new Promise((resolve) => {
      const timeline = this.timeline({ onComplete: resolve, onInterrupt: resolve })
      timeline.to(
        [effect.source, effect.bloom, effect.aura, card],
        { alpha: 0, duration: 0.16, ease: 'power2.out' },
        0
      )
      timeline.to(
        effect.aura.scale,
        {
          x: CARD_ADD_CHOREOGRAPHY.sourceGlowScale,
          y: CARD_ADD_CHOREOGRAPHY.sourceGlowScale,
          duration: 0.16,
          ease: 'power2.out'
        },
        0
      )
      timeline.to(effect.row.row, { alpha: 1, duration: 0.04 }, 0)
      timeline.to(effect.row.row.scale, { x: 1, y: 1, duration: 0.08 }, 0)
      timeline.to(
        progress,
        {
          value: 1,
          duration: CARD_ADD_CHOREOGRAPHY.flightDuration,
          ease: 'power2.inOut',
          onUpdate: updateFlight
        },
        0
      )
    })
  }

  private animateCardAddLanding(
    effect: ArenaCardAddEffect,
    cardId: CardId
  ): Promise<void> {
    const target = this.deckRows.get(cardId)
    if (!target) return Promise.resolve()

    target.row.alpha = 1
    effect.row.row.alpha = 0
    return new Promise((resolve) => {
      const timeline = this.timeline({ onComplete: resolve, onInterrupt: resolve })
      timeline.fromTo(
        target.row.scale,
        {
          x: CARD_ADD_CHOREOGRAPHY.rowLandingScale,
          y: CARD_ADD_CHOREOGRAPHY.rowLandingScale
        },
        {
          x: 1,
          y: 1,
          duration: CARD_ADD_CHOREOGRAPHY.landingDuration,
          ease: 'back.out(2)'
        }
      )
    })
  }

  private destroyCardAddEffect(effect: ArenaCardAddEffect): void {
    if (effect.destroyed) return
    effect.destroyed = true
    effect.root.removeFromParent()
    effect.blur.destroy()
    effect.root.destroy({ children: true, texture: false })
    effect.sourceTexture.destroy(true)
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
    this.deckRows.clear()
    const entries = buildArenaDeckEntries(this.snapshot)
    const sequence = this.renderSequence
    entries.forEach((entry, index) => {
      const row = this.createDeckRow(entry.card, entry.count, index)
      this.deckContent.addChild(row.row)
      this.deckRows.set(entry.card.id, row)
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
        .fill({ color: 0xf2a51a, alpha: 0.92 })
        .stroke({ color: 0x70400b, width: 2 })
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
      const labelText = this.createOutlinedText(label, 28, 0xffffff)
      labelText.label = `arena.stat-label.${index}`
      labelText.anchor.set(0.5)
      labelText.position.set(
        ARENA_LAYOUT.statistics.columns[index],
        ARENA_LAYOUT.statistics.labelsY
      )
      const valueText = this.createOutlinedText(String(values[index]), 82, 0xffffff)
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

  private createOutlinedText(
    text: string,
    fontSize: number,
    fill = 0xffffff,
    withStroke = true
  ): Text {
    const value = new Text({
      text,
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fontWeight: '700',
        fill,
        ...(withStroke
          ? {
              stroke: { color: 0x000000, width: Math.max(2, Math.round(fontSize / 10)) }
            }
          : {}),
        align: 'center'
      }
    })
    value.eventMode = 'none'
    return value
  }

  override dispose(): void {
    this.disposed = true
    ++this.renderSequence
    this.hidePreview()
    if (this.activeCardAddEffect) {
      this.destroyCardAddEffect(this.activeCardAddEffect)
      this.activeCardAddEffect = null
    }
    super.dispose()
  }
}
