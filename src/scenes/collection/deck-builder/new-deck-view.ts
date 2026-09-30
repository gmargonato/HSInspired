import { Container, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { Button } from '../../../visual-components/controls/button'
import {
  ASSET_BUNDLE_IDS,
  type CollectionAssets,
  type DeckPresentationAssets
} from '../../../visual-components/assets'
import { GAME_HEIGHT, GAME_WIDTH } from '../../../visual-components/layout'
import type { RendererLogger } from '../../../application/contracts/logger'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { AssetScope } from '../../../visual-components/assets/asset-scope'
import type { DeckStore } from '../../../application/contracts/deck-store'
import { NEW_DECK_FRAME_ASSET_KEYS } from '../../../visual-components/assets/deck-frames'
import { NEW_DECK_LAYOUT } from './new-deck-layout'
import { HERO_CATALOG, type HeroDefinition } from '../../../game-rules/content/heroes'
import { PLAYABLE_CLASSES, type DeckClass } from '../../../game-rules/content/cards'
import type { Deck } from '../../../game-rules/decks'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'

export interface NewDeckViewCallbacks {
  onClassSelected?: (hero: HeroDefinition) => void | Promise<void>
  onCancelled?: () => void | Promise<void>
  onDeckCreated?: (deck: Deck, hero: HeroDefinition) => void | Promise<void>
}

/** Nested deck-creation overlay presented by CollectionScene. */
export class NewDeckView extends Container {
  private readonly deckStore: DeckStore
  private readonly callbacks: NewDeckViewCallbacks
  private readonly animationScope = new AnimationScope()
  private readonly assetScope = new AssetScope()

  private deckPresentationAssets!: DeckPresentationAssets
  private selectionLayer!: Container
  private selectionContent!: Container
  private selectionBackground!: Sprite
  private heroPortrait!: Sprite
  private heroName!: Text
  private classButtons: Button[] = []
  private selectButton!: Button
  private cancelButton!: Button
  private selectedHero: HeroDefinition | null = null
  private selectionOpen = false
  private actionInProgress = false
  private selectionEntryTimeline: gsap.core.Timeline | null = null
  private disposed = false

  constructor(
    deckStore: DeckStore,
    callbacks: NewDeckViewCallbacks = {},
    private readonly logger: RendererLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()
    this.deckStore = deckStore
    this.callbacks = callbacks
  }

  get isOpen(): boolean {
    return this.selectionOpen
  }

  async mount(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )
    this.deckPresentationAssets = await this.assetScope.acquire<DeckPresentationAssets>(
      ASSET_BUNDLE_IDS.deckPresentation
    )

    this.createSelection(assets)
    this.visible = false
  }

  async open(): Promise<void> {
    if (this.disposed || this.selectionOpen) return

    this.resetSelectionState()
    this.selectionOpen = true
    this.selectionLayer.visible = true
    this.visible = true
    this.setSelectionContentY(GAME_HEIGHT)

    await this.slideSelectionIntoView()
    if (this.disposed || !this.selectionOpen) return

    this.setClassButtonsEnabled(true)
    this.cancelButton.setEnabled(true)
  }

  private createSelection(assets: CollectionAssets): void {
    this.selectionLayer = new Container()
    this.selectionLayer.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.selectionLayer.eventMode = 'static'
    this.selectionLayer.on('pointertap', (event: FederatedPointerEvent) =>
      event.stopPropagation()
    )

    this.selectionContent = new Container()
    this.selectionLayer.addChild(this.selectionContent)

    this.selectionBackground = new Sprite(assets.newDeckHeroSelection)
    this.selectionBackground.eventMode = 'none'
    this.selectionContent.addChild(this.selectionBackground)
    this.setSelectionContentY(GAME_HEIGHT)

    this.heroPortrait = new Sprite(Texture.EMPTY)
    applyAnchoredPlacement(this.heroPortrait, NEW_DECK_LAYOUT.heroPortrait)
    this.heroPortrait.visible = false
    this.heroPortrait.eventMode = 'none'
    this.selectionContent.addChild(this.heroPortrait)

    this.heroName = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 30,
        fill: 0xffffff,
        align: 'center'
      }
    })
    applyAnchoredPlacement(this.heroName, NEW_DECK_LAYOUT.heroName)
    this.heroName.visible = false
    this.heroName.eventMode = 'none'
    this.selectionContent.addChild(this.heroName)

    for (const [index, heroClass] of PLAYABLE_CLASSES.entries()) {
      const texture = this.deckPresentationAssets[NEW_DECK_FRAME_ASSET_KEYS[heroClass]]
      const button = new Button(texture, {
        highlightOnHover: false,
        pressedBrightness: 1,
        onClick: () => this.selectClass(heroClass)
      })
      const column = index % 3
      const row = Math.floor(index / 3)
      button.position.set(
        NEW_DECK_LAYOUT.classGrid.frameStart.x +
          texture.width / 2 +
          column * (texture.width + NEW_DECK_LAYOUT.classGrid.frameGap.x),
        NEW_DECK_LAYOUT.classGrid.frameStart.y +
          texture.height / 2 +
          row * (texture.height + NEW_DECK_LAYOUT.classGrid.frameGap.y)
      )
      button.setBaseY(button.position.y)
      button.setEnabled(false)
      this.classButtons.push(button)
      this.selectionContent.addChild(button)
    }

    this.selectButton = new Button(assets.selectClassButton, {
      onClick: () => this.confirmClass()
    })
    applyPlacement(this.selectButton, NEW_DECK_LAYOUT.selectClassButton)
    this.selectButton.setBaseY(NEW_DECK_LAYOUT.selectClassButton.position.y)
    this.selectButton.visible = false
    this.selectButton.setEnabled(false)
    this.selectionContent.addChild(this.selectButton)

    this.cancelButton = new Button(assets.cancelButton, {
      onClick: () => this.cancel()
    })
    applyPlacement(this.cancelButton, NEW_DECK_LAYOUT.cancelButton)
    this.cancelButton.setBaseY(NEW_DECK_LAYOUT.cancelButton.position.y)
    this.cancelButton.setEnabled(false)
    this.selectionContent.addChild(this.cancelButton)

    this.selectionLayer.visible = false
    this.addChild(this.selectionLayer)
  }

  private setSelectionContentY(y: number): void {
    this.selectionContent.position.set(
      (GAME_WIDTH - this.selectionBackground.texture.width) / 2 +
        NEW_DECK_LAYOUT.panel.offsetX,
      y
    )
  }

  private resetSelectionState(): void {
    this.selectedHero = null
    this.actionInProgress = false
    this.heroPortrait.visible = false
    this.heroName.visible = false
    this.selectButton.visible = false
    this.selectButton.setEnabled(false)
    this.cancelButton.setEnabled(false)
    this.setClassButtonsEnabled(false)
  }

  private setClassButtonsEnabled(enabled: boolean): void {
    for (const button of this.classButtons) {
      button.setEnabled(enabled)
    }
  }

  private async cancel(): Promise<void> {
    if (!this.selectionOpen || this.actionInProgress) return

    this.actionInProgress = true
    this.setClassButtonsEnabled(false)
    this.selectButton.setEnabled(false)
    this.cancelButton.setEnabled(false)

    await this.slideSelectionTo(GAME_HEIGHT)
    if (this.disposed) return

    this.closeSelection()
    await this.callbacks.onCancelled?.()
  }

  private selectClass(heroClass: DeckClass): void {
    if (!this.selectionOpen || this.actionInProgress) return

    const hero = HERO_CATALOG.getPrimaryForClass(heroClass)
    if (!hero) return

    this.selectedHero = hero
    this.heroPortrait.texture = this.deckPresentationAssets[hero.presentationAssetKey]
    this.heroPortrait.visible = true
    this.heroName.text = hero.displayName
    this.heroName.visible = true
    this.selectButton.visible = true
    this.selectButton.setEnabled(true)

    const result = this.callbacks.onClassSelected?.(hero)
    if (result) {
      void Promise.resolve(result).catch((error: unknown) => {
        this.logger.error(`Failed to filter the collection for ${hero.classId}.`, error)
      })
    }
  }

  private async confirmClass(): Promise<void> {
    const hero = this.selectedHero
    if (!hero || !this.selectionOpen || this.actionInProgress) return

    this.actionInProgress = true
    this.setClassButtonsEnabled(false)
    this.selectButton.setEnabled(false)
    this.cancelButton.setEnabled(false)

    let deck: Deck
    try {
      deck = await this.deckStore.createDeck({ heroId: hero.id })
    } catch (error) {
      this.logger.error(`Failed to create ${hero.displayName} deck.`, error)
      this.actionInProgress = false
      if (this.selectionOpen) {
        this.setClassButtonsEnabled(true)
        this.selectButton.setEnabled(true)
        this.cancelButton.setEnabled(true)
      }
      return
    }

    this.closeSelection()
    await this.callbacks.onDeckCreated?.(deck, hero)
  }

  private closeSelection(): void {
    this.killSelectionAnimations()
    this.selectionOpen = false
    this.selectionLayer.visible = false
    this.visible = false
    this.setSelectionContentY(GAME_HEIGHT)
    this.resetSelectionState()
  }

  private slideSelectionIntoView(): Promise<void> {
    this.killSelectionAnimations()

    return new Promise<void>((resolve) => {
      const finish = (): void => {
        this.selectionEntryTimeline = null
        resolve()
      }
      const timeline = this.animationScope.timeline({
        onComplete: finish,
        onInterrupt: finish
      })

      this.selectionEntryTimeline = timeline
      timeline
        .to(this.selectionContent, {
          y: 0,
          duration: 0.32,
          ease: 'power3.out'
        })
        .to(this.selectionContent, {
          y: 18,
          duration: 0.08,
          ease: 'power2.out'
        })
        .to(this.selectionContent, {
          y: 0,
          duration: 0.12,
          ease: 'power2.in'
        })
        .to(this.selectionContent, {
          y: 8,
          duration: 0.06,
          ease: 'power2.out'
        })
        .to(this.selectionContent, {
          y: 0,
          duration: 0.09,
          ease: 'power2.in'
        })
        .to(this.selectionContent, {
          y: 3,
          duration: 0.05,
          ease: 'power2.out'
        })
        .to(this.selectionContent, {
          y: 0,
          duration: 0.07,
          ease: 'power2.in'
        })
    })
  }

  private slideSelectionTo(y: number): Promise<void> {
    this.killSelectionAnimations()

    return new Promise<void>((resolve) => {
      this.animationScope.to(this.selectionContent, {
        y,
        duration: NEW_DECK_LAYOUT.panel.slideDuration,
        ease: 'power2.out',
        onComplete: resolve,
        onInterrupt: resolve
      })
    })
  }

  private killSelectionAnimations(): void {
    this.selectionEntryTimeline?.kill()
    this.selectionEntryTimeline = null
    this.animationScope.kill(this.selectionContent)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.selectionOpen = false
    this.killSelectionAnimations()
    await this.assetScope.releaseAll()
  }
}
