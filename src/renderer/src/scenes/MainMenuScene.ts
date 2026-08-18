import { Container, PerspectiveMesh, Sprite, Texture } from 'pixi.js'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { FlipCard } from '../actors/FlipCard'
import { Button } from '../actors/Button'
import { DeckSelectionScene } from './DeckSelectionScene'
import { CollectionScene } from './CollectionScene'
import { ASSET_BUNDLE_IDS } from '../core/assets'
import type { MainMenuAssets } from '../core/assets'
import type { TransitionRect } from '../core/SceneTransitionHost'
import type { SceneTransitionOptions } from '../core/SceneManager'
import {
  createHingedDoorMesh,
  updateHingedDoor,
  type HingeSide
} from '../core/hingedDoor'

// Manual nudges only (multi-line tweaks while designing the layout).
// The lid x values are the inner edges of the closed chest.
const Layout = {
  box: { x: 0, y: 0 },
  centerPart: { x: 0, y: 0 },
  leftLid: { x: 30, y: 0 },
  rightLid: { x: 0, y: 0 },
  buttonPlay: { x: 0, y: -145 },
  buttonCollection: { x: 0, y: -52 }
}

const LID_OPEN_DURATION = 0.6
const MENU_REVEAL_DURATION = 0.15
const LID_MIN_WIDTH = 1
const LID_PERSPECTIVE_DEPTH = 14
const SCENE_SELECTION_GAP: TransitionRect = {
  x: (GAME_WIDTH - 1090) / 2,
  y: (GAME_HEIGHT - 735) / 2,
  width: 1090,
  height: 735
}

type LidSide = HingeSide
type MainMenuEntryMode = 'closed' | 'returning'

export class MainMenuScene extends Scene {
  private table!: Sprite
  private boxLayer!: Container
  private menuGroup!: Container
  private chestBox!: Sprite
  private lidLeft!: PerspectiveMesh
  private lidRight!: PerspectiveMesh
  private centerPartMount!: Container
  private centerCard!: FlipCard
  private buttonPlay!: Button
  private buttonCollection!: Button
  private transitionOpened = false
  private returnClosePromise: Promise<void> | null = null
  private returnRevealPromise: Promise<void> | null = null

  constructor(private readonly entryMode: MainMenuEntryMode = 'closed') {
    super()
  }

  static forReturn(): MainMenuScene {
    return new MainMenuScene('returning')
  }

  createReturnTransitionOptions(): SceneTransitionOptions {
    if (this.entryMode !== 'returning') {
      throw new Error('Return transition options require a returning main menu')
    }

    return {
      inset: SCENE_SELECTION_GAP,
      mode: 'collapse',
      scaleMode: 'cover',
      duration: 0.45,
      hostParent: this.root,
      hostIndex: 2,
      afterCollapse: () => this.closeReturningChest(),
      afterTransition: () => this.revealReturnedMenu()
    }
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<MainMenuAssets>(
      ASSET_BUNDLE_IDS.mainMenu
    )

    this.table = new Sprite(assets.table)
    this.table.width = GAME_WIDTH
    this.table.height = GAME_HEIGHT
    this.root.addChild(this.table)

    this.buildChest(assets.box, assets.leftLid, assets.rightLid)

    // The menu face is the initial face. The game-room face is revealed when
    // a destination is selected, immediately before the chest opens.
    this.centerCard = new FlipCard(assets.centerPartMenu, assets.centerPart, {
      initialFace: this.entryMode === 'returning' ? 'back' : 'front',
      oneShot: true
    })
    this.centerCard.eventMode = 'none'

    // Keep the center part mounted to the right lid so it follows the lid's
    // free edge while the chest opens.
    this.centerPartMount = new Container()
    this.centerPartMount.addChild(this.centerCard)
    this.lidRight.addChild(this.centerPartMount)
    this.updateLidMeshes(this.entryMode === 'returning' ? 1 : 0)
    if (this.entryMode === 'returning') {
      // At the fully open angle the meshes retain a one-pixel minimum width.
      // Keep that edge hidden until the outgoing scene has finished shrinking.
      this.lidLeft.visible = false
      this.lidRight.visible = false
      this.centerCard.visible = false
    }

    this.buttonPlay = new Button(assets.buttonPlay, {
      onClick: () => this.onPlayPressed()
    })
    this.buttonPlay.position.set(Layout.buttonPlay.x, Layout.buttonPlay.y)
    this.buttonPlay.setBaseY(Layout.buttonPlay.y)
    this.buttonPlay.visible = true
    this.buttonPlay.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonPlay.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonPlay)

    this.buttonCollection = new Button(assets.buttonCollection, {
      onClick: () => this.onCollectionPressed()
    })
    this.buttonCollection.position.set(
      Layout.buttonCollection.x,
      Layout.buttonCollection.y
    )
    this.buttonCollection.setBaseY(Layout.buttonCollection.y)
    this.buttonCollection.visible = true
    this.buttonCollection.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonCollection.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonCollection)
  }

  private closeReturningChest(): Promise<void> {
    if (this.returnClosePromise) return this.returnClosePromise

    this.lidLeft.visible = true
    this.lidRight.visible = true
    this.centerCard.visible = true
    this.returnClosePromise = this.animateChest(1, 0, 'power2.out')
    return this.returnClosePromise
  }

  private revealReturnedMenu(): Promise<void> {
    if (this.returnRevealPromise) return this.returnRevealPromise

    this.returnRevealPromise = this.finishReturnReveal()
    return this.returnRevealPromise
  }

  private async finishReturnReveal(): Promise<void> {
    await this.centerCard.flipToFront()
    this.centerCard.eventMode = 'none'
    await this.fadeMenuButtonsIn()
    this.transitionOpened = false
    this.buttonPlay.setEnabled(true)
    this.buttonCollection.setEnabled(true)
  }

  private fadeMenuButtonsIn(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeline = this.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        [this.buttonPlay, this.buttonCollection],
        {
          alpha: 1,
          duration: MENU_REVEAL_DURATION,
          ease: 'power2.out'
        },
        0
      )
    })
  }

  private buildChest(box: Texture, leftLid: Texture, rightLid: Texture): void {
    this.boxLayer = new Container()
    this.boxLayer.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.root.addChild(this.boxLayer)

    this.menuGroup = new Container()
    this.menuGroup.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.root.addChild(this.menuGroup)

    this.chestBox = new Sprite(box)
    this.chestBox.anchor.set(0.5)
    this.chestBox.position.set(Layout.box.x, Layout.box.y)
    this.boxLayer.addChild(this.chestBox)

    this.lidLeft = this.createLidMesh(leftLid, 'left')
    this.menuGroup.addChild(this.lidLeft)

    this.lidRight = this.createLidMesh(rightLid, 'right')
    this.menuGroup.addChild(this.lidRight)
  }

  private createLidMesh(texture: Texture, side: LidSide): PerspectiveMesh {
    const height = texture.height
    const hingeOnLeft = side === 'left'
    const topLeft = hingeOnLeft
      ? { x: Layout.leftLid.x - texture.width, y: Layout.leftLid.y - height / 2 }
      : { x: Layout.rightLid.x, y: Layout.rightLid.y - height / 2 }

    return createHingedDoorMesh(texture, side, topLeft)
  }

  private onPlayPressed(): Promise<void> {
    return this.openDestination(new DeckSelectionScene(), 'deck selection')
  }

  private onCollectionPressed(): Promise<void> {
    const destination = new CollectionScene()
    return this.openDestination(destination, 'collection', () =>
      destination.playCoverReveal()
    )
  }

  private async openDestination(
    destination: Scene,
    destinationName: string,
    afterTransition?: () => Promise<void> | void
  ): Promise<void> {
    if (this.transitionOpened) return
    this.transitionOpened = true

    // Hide the menu buttons while the chest transitions.
    this.killTweensOf(this.buttonPlay)
    this.killTweensOf(this.buttonCollection)
    this.buttonPlay.setEnabled(false)
    this.buttonCollection.setEnabled(false)
    this.tweenTo(this.buttonPlay, { alpha: 0, duration: 0.15 })
    this.tweenTo(this.buttonCollection, { alpha: 0, duration: 0.15 })

    // Reveal the center part while the transition manager loads the
    // destination scene in its temporary presentation host.
    const centerFlip = this.centerCard.flip()

    try {
      await this.sceneManager.transitionTo(destination, {
        inset: SCENE_SELECTION_GAP,
        scaleMode: 'cover',
        duration: 0.45,
        hostParent: this.root,
        hostIndex: 2,
        beforeExpand: async () => {
          await centerFlip
          await this.openChest()

          // The destination expands after the lids reach their edge-on state.
          this.lidLeft.visible = false
          this.lidRight.visible = false
          this.centerCard.visible = false
          this.buttonPlay.visible = false
          this.buttonCollection.visible = false
        },
        afterTransition
      })
    } catch (error) {
      console.error(`Failed to open ${destinationName}:`, error)
      await centerFlip
      await this.centerCard.flipToFront()
      this.transitionOpened = false
      this.killTweensOf(this.buttonPlay)
      this.killTweensOf(this.buttonCollection)
      this.buttonPlay.visible = true
      this.buttonCollection.visible = true
      this.buttonPlay.setEnabled(true)
      this.buttonCollection.setEnabled(true)
      this.buttonPlay.alpha = 1
      this.buttonCollection.alpha = 1
      this.buttonPlay.y = Layout.buttonPlay.y
      this.buttonCollection.y = Layout.buttonCollection.y
      this.centerCard.visible = true
      this.centerCard.eventMode = 'none'
      this.lidLeft.visible = true
      this.lidRight.visible = true
      this.updateLidMeshes(0)
    }
  }

  private openChest(): Promise<void> {
    return this.animateChest(0, 1, 'power2.in')
  }

  private animateChest(
    fromProgress: number,
    toProgress: number,
    ease: string
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const state = { progress: fromProgress }
      const timeline = this.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        state,
        {
          progress: toProgress,
          duration: LID_OPEN_DURATION,
          ease,
          onUpdate: () => this.updateLidMeshes(state.progress)
        },
        0
      )
    })
  }

  private updateLidMeshes(progress: number): void {
    const clampedProgress = Math.max(0, Math.min(1, progress))
    const widthScale = Math.cos(clampedProgress * (Math.PI / 2))

    updateHingedDoor(
      this.lidLeft,
      'left',
      clampedProgress,
      LID_PERSPECTIVE_DEPTH,
      LID_MIN_WIDTH
    )
    updateHingedDoor(
      this.lidRight,
      'right',
      clampedProgress,
      LID_PERSPECTIVE_DEPTH,
      LID_MIN_WIDTH
    )
    this.updateCenterPartMount(widthScale)
  }

  private updateCenterPartMount(widthScale: number): void {
    const width = this.lidRight.texture.width
    const height = this.lidRight.texture.height
    const visibleWidth = Math.max(LID_MIN_WIDTH, width * widthScale)
    const freeEdgeX = -visibleWidth

    this.centerPartMount.position.set(
      Layout.centerPart.x - Layout.rightLid.x + freeEdgeX,
      height / 2 + Layout.centerPart.y - Layout.rightLid.y
    )
    this.centerPartMount.scale.set(widthScale, 1)
  }

  update(_deltaMS: number): void {}
}
