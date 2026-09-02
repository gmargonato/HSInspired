import { Container, PerspectiveMesh, Sprite, Texture } from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import { AssetScope } from '../../ui/asset-registry/asset-scope'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'
import { FlipCard } from '../../ui/components/flip-card'
import { Button } from '../../ui/components/button'
import { ASSET_BUNDLE_IDS } from '../../ui/asset-registry'
import type { RendererLogger } from '../../ui/logger'
import type { MainMenuAssets } from '../../ui/asset-registry'
import {
  createHingedDoorMesh,
  updateHingedDoor,
  type HingeSide
} from '../../rendering/effects/hinged-door'
import { MAIN_MENU_HINGE, MAIN_MENU_LAYOUT, MAIN_MENU_TIMING } from './main-menu-layout'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'

const { chest, menuButtons } = MAIN_MENU_LAYOUT

type LidSide = HingeSide
export type MainMenuEntryMode = 'closed' | 'returning'

export type MainMenuRoute =
  | { readonly id: 'deck-selection' }
  | { readonly id: 'collection' }
  | { readonly id: 'arena' }
  | { readonly id: 'tavern-brawl' }

export interface MainMenuRouter {
  navigate(route: MainMenuRoute): Promise<void>
}

export interface MainMenuViewOptions {
  readonly assetScope: AssetScope
  readonly router?: MainMenuRouter
  readonly entryMode?: MainMenuEntryMode
  readonly logger?: RendererLogger
}

export class MainMenuView extends Actor {
  /**
   * Stable z-order slot for SceneTransitionHost instances. It sits between
   * the chest body and the animated lid/menu group.
   */
  readonly transitionHost = new Container()
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
  private buttonArena!: Button
  private buttonTavern!: Button
  private readonly menuButtonActors: Button[] = []
  private transitionOpened = false
  private destinationPreparation: Promise<void> | null = null
  private returnClosePromise: Promise<void> | null = null
  private returnRevealPromise: Promise<void> | null = null
  private readonly router?: MainMenuRouter
  private readonly entryMode: MainMenuEntryMode
  private readonly logger: RendererLogger
  private readonly assetScope: AssetScope

  constructor(options: MainMenuViewOptions) {
    super()
    this.transitionHost.label = 'main-menu.transition-host'
    this.router = options.router
    this.entryMode = options.entryMode ?? 'closed'
    this.assetScope = options.assetScope
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
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
        for (const button of this.menuButtonActors) button.visible = false
      })()
    }

    return this.destinationPreparation
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<MainMenuAssets>(
      ASSET_BUNDLE_IDS.mainMenu
    )

    this.table = new Sprite(assets.table)
    this.table.label = 'main-menu.background'
    applyAnchoredPlacement(this.table, MAIN_MENU_LAYOUT.screen.table)
    this.table.width = GAME_WIDTH
    this.table.height = GAME_HEIGHT
    this.addChild(this.table)

    this.buildChest(assets.box, assets.leftLid, assets.rightLid)

    // The menu face is the initial face. The game-room face is revealed when
    // a destination is selected, immediately before the chest opens.
    this.centerCard = new FlipCard(assets.centerPartMenu, assets.centerPart, {
      initialFace: this.entryMode === 'returning' ? 'back' : 'front',
      oneShot: true
    })
    this.centerCard.label = 'main-menu.center-card'
    this.centerCard.eventMode = 'none'

    // Keep the center part mounted to the right lid so it follows the lid's
    // free edge while the chest opens.
    this.centerPartMount = new Container()
    this.centerPartMount.label = 'main-menu.center-part-mount'
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
      sinkPx: 6,
      onClick: () => this.onPlayPressed()
    })
    this.buttonPlay.label = 'main-menu.play-button'
    applyPlacement(this.buttonPlay, menuButtons.play)
    this.buttonPlay.setBaseY(menuButtons.play.position.y)
    this.buttonPlay.visible = true
    this.buttonPlay.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonPlay.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonPlay)

    this.buttonCollection = new Button(assets.buttonCollection, {
      sinkPx: 6,
      onClick: () => this.onCollectionPressed()
    })
    this.buttonCollection.label = 'main-menu.collection-button'
    applyPlacement(this.buttonCollection, menuButtons.collection)
    this.buttonCollection.setBaseY(menuButtons.collection.position.y)
    this.buttonCollection.visible = true
    this.buttonCollection.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonCollection.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonCollection)

    this.buttonArena = new Button(assets.buttonArena, {
      sinkPx: -1,
      onClick: () => this.onArenaPressed()
    })
    this.buttonArena.label = 'main-menu.arena-button'
    applyPlacement(this.buttonArena, menuButtons.arena)
    this.buttonArena.setBaseY(menuButtons.arena.position.y)
    this.buttonArena.visible = true
    this.buttonArena.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonArena.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonArena)

    this.buttonTavern = new Button(assets.buttonTavern, {
      sinkPx: -5,
      onClick: () => this.onTavernPressed()
    })
    this.buttonTavern.label = 'main-menu.tavern-button'
    applyPlacement(this.buttonTavern, menuButtons.tavern)
    this.buttonTavern.setBaseY(menuButtons.tavern.position.y)
    this.buttonTavern.visible = true
    this.buttonTavern.alpha = this.entryMode === 'returning' ? 0 : 1
    this.buttonTavern.setEnabled(this.entryMode !== 'returning')
    this.menuGroup.addChild(this.buttonTavern)

    this.menuButtonActors.push(
      this.buttonPlay,
      this.buttonCollection,
      this.buttonArena,
      this.buttonTavern
    )
  }

  async closeReturningChest(): Promise<void> {
    if (this.returnClosePromise) return this.returnClosePromise

    this.lidLeft.visible = true
    this.lidRight.visible = true
    this.centerCard.visible = true
    this.returnClosePromise = this.animateChest(1, 0, 'power2.out')
    return this.returnClosePromise
  }

  async revealReturnedMenu(): Promise<void> {
    if (this.returnRevealPromise) return this.returnRevealPromise

    this.returnRevealPromise = this.finishReturnReveal()
    return this.returnRevealPromise
  }

  private async finishReturnReveal(): Promise<void> {
    await this.centerCard.flipToFront()
    this.centerCard.eventMode = 'none'
    await this.fadeMenuButtonsIn()
    this.transitionOpened = false
    for (const button of this.menuButtonActors) button.setEnabled(true)
  }

  private fadeMenuButtonsIn(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeline = this.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        this.menuButtonActors,
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
    this.boxLayer.label = 'main-menu.chest-box-layer'
    this.boxLayer.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.addChild(this.boxLayer)

    this.addChild(this.transitionHost)

    this.menuGroup = new Container()
    this.menuGroup.label = 'main-menu.menu-group'
    this.menuGroup.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.addChild(this.menuGroup)

    this.chestBox = new Sprite(box)
    this.chestBox.label = 'main-menu.chest-box'
    applyAnchoredPlacement(this.chestBox, chest.box)
    this.boxLayer.addChild(this.chestBox)

    this.lidLeft = this.createLidMesh(leftLid, 'left')
    this.lidLeft.label = 'main-menu.left-lid'
    this.menuGroup.addChild(this.lidLeft)

    this.lidRight = this.createLidMesh(rightLid, 'right')
    this.lidRight.label = 'main-menu.right-lid'
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

  private onArenaPressed(): Promise<void> {
    return this.openDestination({ id: 'arena' }, 'Arena')
  }

  private onTavernPressed(): Promise<void> {
    return this.openDestination({ id: 'tavern-brawl' }, 'Tavern Brawl')
  }

  private async openDestination(
    route: MainMenuRoute,
    destinationName: string
  ): Promise<void> {
    if (this.transitionOpened) return
    this.transitionOpened = true

    // Hide the menu buttons while the chest transitions.
    for (const button of this.menuButtonActors) {
      this.killTweensOf(button)
      button.setEnabled(false)
      this.tweenTo(button, { alpha: 0, duration: 0.15 })
    }

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
      for (const button of this.menuButtonActors) {
        this.killTweensOf(button)
        button.visible = true
        button.setEnabled(true)
        button.alpha = 1
        button.y = button.getBaseY()
      }
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
