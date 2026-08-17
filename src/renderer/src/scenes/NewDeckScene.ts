import { Container, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { Button } from '../actors/Button'
import { ASSET_BUNDLE_IDS, type CollectionAssets } from '../core/assets'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { playerDeckStore, type DeckStore } from '../core/decks'
import { getPrimaryHeroForClass, type HeroDefinition } from '../core/heroes'
import { Scene } from './Scene'
import { DECK_CLASSES, type Deck, type DeckClass } from '../../../shared/decks'

// Manual nudges only. These coordinates are local to the selection artwork,
// so the whole creation panel can be moved with selectionOffsetX while its
// individual controls remain easy to tune.
const NEW_DECK_HERO_SELECTION_LAYOUT = {
  selectionOffsetX: 0,
  frameStartX: 360,
  frameStartY: 300,
  columnGap: 25,
  rowGap: 100,
  heroPortrait: { x: 1470, y: 490 },
  heroName: { x: 1470, y: 720 },
  selectClassButton: { x: 1470, y: 935 },
  cancelButton: { x: 1670, y: 1045 },
  slideDuration: 0.5
}

type NewDeckFrameAssetKey =
  | 'druidDeckFrame'
  | 'hunterDeckFrame'
  | 'mageDeckFrame'
  | 'paladinDeckFrame'
  | 'priestDeckFrame'
  | 'rogueDeckFrame'
  | 'shamanDeckFrame'
  | 'warlockDeckFrame'
  | 'warriorDeckFrame'

const NEW_DECK_FRAME_ASSET_KEYS: Record<DeckClass, NewDeckFrameAssetKey> = {
  Warlock: 'warlockDeckFrame',
  Hunter: 'hunterDeckFrame',
  Rogue: 'rogueDeckFrame',
  Warrior: 'warriorDeckFrame',
  Druid: 'druidDeckFrame',
  Paladin: 'paladinDeckFrame',
  Priest: 'priestDeckFrame',
  Mage: 'mageDeckFrame',
  Shaman: 'shamanDeckFrame'
}

export interface NewDeckSceneCallbacks {
  onClassSelected?: (hero: HeroDefinition) => void | Promise<void>
  onCancelled?: () => void | Promise<void>
  onDeckCreated?: (deck: Deck, hero: HeroDefinition) => void | Promise<void>
}

/** Nested deck-creation overlay presented by CollectionScene. */
export class NewDeckScene extends Scene {
  private readonly deckStore: DeckStore
  private readonly callbacks: NewDeckSceneCallbacks

  private collectionAssets!: CollectionAssets
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
    deckStore: DeckStore = playerDeckStore,
    callbacks: NewDeckSceneCallbacks = {}
  ) {
    super()
    this.deckStore = deckStore
    this.callbacks = callbacks
  }

  get isOpen(): boolean {
    return this.selectionOpen
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )

    this.collectionAssets = assets
    this.createSelection(assets)
    this.root.visible = false
  }

  async open(): Promise<void> {
    if (this.disposed || this.selectionOpen) return

    this.resetSelectionState()
    this.selectionOpen = true
    this.selectionLayer.visible = true
    this.root.visible = true
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
    this.heroPortrait.anchor.set(0.5)
    this.heroPortrait.scale.set(0.85 * 1.1, 0.85 * 1.05)
    this.heroPortrait.position.set(
      NEW_DECK_HERO_SELECTION_LAYOUT.heroPortrait.x,
      NEW_DECK_HERO_SELECTION_LAYOUT.heroPortrait.y
    )
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
    this.heroName.anchor.set(0.5)
    this.heroName.position.set(
      NEW_DECK_HERO_SELECTION_LAYOUT.heroName.x,
      NEW_DECK_HERO_SELECTION_LAYOUT.heroName.y
    )
    this.heroName.visible = false
    this.heroName.eventMode = 'none'
    this.selectionContent.addChild(this.heroName)

    for (const [index, heroClass] of DECK_CLASSES.entries()) {
      const texture = assets[NEW_DECK_FRAME_ASSET_KEYS[heroClass]]
      const button = new Button(texture, {
        onClick: () => this.selectClass(heroClass)
      })
      const column = index % 3
      const row = Math.floor(index / 3)
      button.position.set(
        NEW_DECK_HERO_SELECTION_LAYOUT.frameStartX +
          texture.width / 2 +
          column * (texture.width + NEW_DECK_HERO_SELECTION_LAYOUT.columnGap),
        NEW_DECK_HERO_SELECTION_LAYOUT.frameStartY +
          texture.height / 2 +
          row * (texture.height + NEW_DECK_HERO_SELECTION_LAYOUT.rowGap)
      )
      button.setBaseY(button.position.y)
      button.setEnabled(false)
      this.classButtons.push(button)
      this.selectionContent.addChild(button)
    }

    this.selectButton = new Button(assets.selectClassButton, {
      onClick: () => this.confirmClass()
    })
    this.selectButton.position.set(
      NEW_DECK_HERO_SELECTION_LAYOUT.selectClassButton.x,
      NEW_DECK_HERO_SELECTION_LAYOUT.selectClassButton.y
    )
    this.selectButton.setBaseY(NEW_DECK_HERO_SELECTION_LAYOUT.selectClassButton.y)
    this.selectButton.visible = false
    this.selectButton.setEnabled(false)
    this.selectionContent.addChild(this.selectButton)

    this.cancelButton = new Button(assets.cancelButton, {
      onClick: () => this.cancel()
    })
    this.cancelButton.position.set(
      NEW_DECK_HERO_SELECTION_LAYOUT.cancelButton.x,
      NEW_DECK_HERO_SELECTION_LAYOUT.cancelButton.y
    )
    this.cancelButton.setBaseY(NEW_DECK_HERO_SELECTION_LAYOUT.cancelButton.y)
    this.cancelButton.setEnabled(false)
    this.selectionContent.addChild(this.cancelButton)

    this.selectionLayer.visible = false
    this.root.addChild(this.selectionLayer)
  }

  private setSelectionContentY(y: number): void {
    this.selectionContent.position.set(
      (GAME_WIDTH - this.selectionBackground.texture.width) / 2 +
        NEW_DECK_HERO_SELECTION_LAYOUT.selectionOffsetX,
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

    const hero = getPrimaryHeroForClass(heroClass)
    if (!hero) return

    this.selectedHero = hero
    this.heroPortrait.texture = this.collectionAssets[hero.assetKey]
    this.heroPortrait.visible = true
    this.heroName.text = hero.name
    this.heroName.visible = true
    this.selectButton.visible = true
    this.selectButton.setEnabled(true)

    const result = this.callbacks.onClassSelected?.(hero)
    if (result) {
      void Promise.resolve(result).catch((error: unknown) => {
        console.error(`Failed to filter the collection for ${hero.heroClass}:`, error)
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
      deck = await this.deckStore.createDeck({
        heroClass: hero.heroClass,
        heroId: hero.id
      })
    } catch (error) {
      console.error(`Failed to create ${hero.name} deck:`, error)
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
    this.root.visible = false
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
      const timeline = this.timeline({
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
      this.tweenTo(this.selectionContent, {
        y,
        duration: NEW_DECK_HERO_SELECTION_LAYOUT.slideDuration,
        ease: 'power2.out',
        onComplete: resolve,
        onInterrupt: resolve
      })
    })
  }

  private killSelectionAnimations(): void {
    this.selectionEntryTimeline?.kill()
    this.selectionEntryTimeline = null
    this.killTweensOf(this.selectionContent)
  }

  protected onExit(): void {
    this.disposed = true
    this.selectionOpen = false
    this.killSelectionAnimations()
  }

  update(_deltaMS: number): void {}
}
