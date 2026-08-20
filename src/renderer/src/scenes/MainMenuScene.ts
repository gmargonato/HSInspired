import { Container, PerspectiveMesh, Sprite, Texture } from 'pixi.js'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../app/config'
import { FlipCard } from '../ui/components/FlipCard'
import { Button } from '../ui/components/Button'
import { ASSET_BUNDLE_IDS } from '../ui/asset-registry'
import type { AppRoute, SceneRouter } from '../app/router'
import type { AudioService } from '../app/audio'
import type { AppLogger } from '../app/services'
import type { MainMenuAssets } from '../ui/asset-registry'
import type { SceneTransitionOptions } from './SceneManager'
import {
  createHingedDoorMesh,
  updateHingedDoor,
  type HingeSide
} from '../features/collection/choreography/hinged-door'
import {
  MAIN_MENU_HINGE,
  MAIN_MENU_LAYOUT,
  MAIN_MENU_TIMING,
  SCENE_SELECTION_GAP
} from './main-menu-layout'

export { SCENE_SELECTION_GAP }

const { chest, menuButtons } = MAIN_MENU_LAYOUT

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
  private destinationPreparation: Promise<void> | null = null
  private returnClosePromise: Promise<void> | null = null
  private returnRevealPromise: Promise<void> | null = null

  constructor(
    private readonly router?: SceneRouter,
    private readonly entryMode: MainMenuEntryMode = 'closed',
    private readonly audio?: AudioService,
    private readonly logger: AppLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()
  }

  /** True while a button-initiated destination transition is being prepared. */
  get isDestinationTransitionOpen(): boolean {
    return this.transitionOpened
  }

  /**
   * Starts the chest choreography that gates the destination expansion.
   * SceneManager calls this after the destination has been loaded into its
   * inset host, so the destination is already visible, small, and dark while
   * the lids open.
   */
  prepareDestinationTransition(): Promise<void> {
    if (!this.destinationPreparation) {
      const centerFlip = this.centerCard.flip()
      this.destinationPreparation = (async () => {
        await centerFlip
        await this.openChest()

        this.lidLeft.visible = false
        this.lidRight.visible = false
        this.centerCard.visible = false
        this.buttonPlay.visible = false
        this.buttonCollection.visible = false
      })()
    }

    return this.destinationPreparation
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
      pressSound: 'box-hub-button-press',
      hoverSound: 'hub-mouseover',
      audio: this.audio,
      onClick: () => this.onPlayPressed()
    })
    this.buttonPlay.position.set(
      menuButtons.play.position.x,
      menuButtons.play.position.y
    )
    this.buttonPlay.setBaseY(menuButtons.play.position.y)
    this.buttonPlay.visible = true
    this.buttonPlay.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonPlay.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonPlay)

    this.buttonCollection = new Button(assets.buttonCollection, {
      pressSound: 'box-hub-button-press',
      hoverSound: 'hub-mouseover',
      audio: this.audio,
      onClick: () => this.onCollectionPressed()
    })
    this.buttonCollection.position.set(
      menuButtons.collection.position.x,
      menuButtons.collection.position.y
    )
    this.buttonCollection.setBaseY(menuButtons.collection.position.y)
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
          duration: MAIN_MENU_TIMING.menuReveal,
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
    this.chestBox.position.set(chest.box.position.x, chest.box.position.y)
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
      ? {
          x: chest.leftLidInnerEdge.x - texture.width,
          y: chest.leftLidInnerEdge.y - height / 2
        }
      : {
          x: chest.rightLidInnerEdge.x,
          y: chest.rightLidInnerEdge.y - height / 2
        }

    return createHingedDoorMesh(texture, side, topLeft)
  }

  private onPlayPressed(): Promise<void> {
    return this.openDestination({ id: 'deck-selection' }, 'deck selection')
  }

  private onCollectionPressed(): Promise<void> {
    return this.openDestination({ id: 'collection' }, 'collection')
  }

  private async openDestination(
    route: AppRoute,
    destinationName: string
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

    // Start the chest choreography before navigation. SceneManager waits for
    // this promise after it has loaded the destination into its inset host.
    const destinationPreparation = this.prepareDestinationTransition()

    try {
      if (!this.router) throw new Error('Main menu router is not configured')
      await this.router.navigate(route)
    } catch (error) {
      this.logger.error(`Failed to open ${destinationName}.`, error)
      await destinationPreparation.catch(() => undefined)
      await this.centerCard.flipToFront()
      this.transitionOpened = false
      this.destinationPreparation = null
      this.killTweensOf(this.buttonPlay)
      this.killTweensOf(this.buttonCollection)
      this.buttonPlay.visible = true
      this.buttonCollection.visible = true
      this.buttonPlay.setEnabled(true)
      this.buttonCollection.setEnabled(true)
      this.buttonPlay.alpha = 1
      this.buttonCollection.alpha = 1
      this.buttonPlay.y = menuButtons.play.position.y
      this.buttonCollection.y = menuButtons.collection.position.y
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
          duration: MAIN_MENU_TIMING.lidOpen,
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
      MAIN_MENU_HINGE.perspectiveDepth,
      MAIN_MENU_HINGE.minWidth
    )
    updateHingedDoor(
      this.lidRight,
      'right',
      clampedProgress,
      MAIN_MENU_HINGE.perspectiveDepth,
      MAIN_MENU_HINGE.minWidth
    )
    this.updateCenterPartMount(widthScale)
  }

  private updateCenterPartMount(widthScale: number): void {
    const width = this.lidRight.texture.width
    const height = this.lidRight.texture.height
    const visibleWidth = Math.max(MAIN_MENU_HINGE.minWidth, width * widthScale)
    const freeEdgeX = -visibleWidth

    this.centerPartMount.position.set(
      chest.centerPartOffset.x - chest.rightLidInnerEdge.x + freeEdgeX,
      height / 2 + chest.centerPartOffset.y - chest.rightLidInnerEdge.y
    )
    this.centerPartMount.scale.set(widthScale, 1)
  }

  update(_deltaMS: number): void {}
}
