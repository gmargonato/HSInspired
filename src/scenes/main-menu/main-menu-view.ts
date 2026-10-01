import { Container, PerspectiveMesh, Sprite, Texture } from 'pixi.js'
import { Actor } from '../../visual-components/lifecycle/actor'
import { AssetScope } from '../../visual-components/assets/asset-scope'
import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'
import { FlipCard } from '../../visual-components/controls/flip-card'
import { Button } from '../../visual-components/controls/button'
import { ASSET_BUNDLE_IDS } from '../../visual-components/assets'
import type { RendererLogger } from '../../application/contracts/logger'
import type { MainMenuAssets } from '../../visual-components/assets'
import {
  createHingedDoorMesh,
  updateHingedDoor,
  type HingeSide
} from '../../visual-components/effects/hinged-door'
import {
  createGodRaysFilter,
  type GodRaysEffect
} from '../../visual-components/effects/god-rays-filter'
import { MAIN_MENU_HINGE, MAIN_MENU_LAYOUT, MAIN_MENU_TIMING } from './main-menu-layout'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import {
  GOD_RAYS_CONFIG,
  GOD_RAYS_DUST_CONFIG
} from '../../visual-components/effects/outline-tuning'
import { GodRaysDust } from '../../visual-components/effects/god-rays-dust'

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
  private godRaysOverlay!: Sprite
  private godRays: GodRaysEffect | null = null
  private godRaysDust: GodRaysDust | null = null
  private readonly effectTargets: Container[] = []
  private boxLayer!: Container
  private menuGroup!: Container
  private chestBox!: Sprite
  private lidLeft!: PerspectiveMesh
  private rightLidGroup!: Container
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
  private seasonRewardBlocked = false

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

  setSeasonRewardBlocked(blocked: boolean): void {
    this.seasonRewardBlocked = blocked
    if (!this.transitionOpened)
      for (const button of this.menuButtonActors) button.setEnabled(!blocked)
  }

  /**
   * Starts the chest choreography that gates the destination expansion.
   * SceneManager calls this after the destination has been loaded into its
   * inset host, so the destination is already visible, small, and dark while
   * the lids open.
   */
  prepareDestinationTransition(): Promise<void> {
    if (!this.destinationPreparation) {
      const effectsFade = this.fadeEffects(0)
      const centerFlip = this.centerCard.flip()
      this.destinationPreparation = (async () => {
        await Promise.all([centerFlip, effectsFade])
        if (this.destroyed) return
        await this.openChest()

        this.lidLeft.visible = false
        this.lidRight.visible = false
        this.centerCard.visible = false
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
      oneShot: true,
      interactive: false
    })
    this.centerCard.label = 'main-menu.center-card'

    // Keep the center part mounted to the right lid so it follows the lid's
    // free edge while the chest opens.
    this.centerPartMount = new Container()
    this.centerPartMount.label = 'main-menu.center-part-mount'
    this.centerPartMount.addChild(this.centerCard)
    this.rightLidGroup.addChild(this.centerPartMount)
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
    this.buttonPlay.setEnabled(this.entryMode !== 'returning')
    this.centerCard.frontFace.addChild(this.buttonPlay)

    this.buttonCollection = new Button(assets.buttonCollection, {
      sinkPx: 6,
      onClick: () => this.onCollectionPressed()
    })
    this.buttonCollection.label = 'main-menu.collection-button'
    applyPlacement(this.buttonCollection, menuButtons.collection)
    this.buttonCollection.setBaseY(menuButtons.collection.position.y)
    this.buttonCollection.visible = true
    this.buttonCollection.setEnabled(this.entryMode !== 'returning')
    this.centerCard.frontFace.addChild(this.buttonCollection)

    this.buttonArena = new Button(assets.buttonArena, {
      sinkPx: -1,
      onClick: () => this.onArenaPressed()
    })
    this.buttonArena.label = 'main-menu.arena-button'
    applyPlacement(this.buttonArena, menuButtons.arena)
    this.buttonArena.setBaseY(menuButtons.arena.position.y)
    this.buttonArena.visible = true
    this.buttonArena.setEnabled(this.entryMode !== 'returning')
    this.centerCard.frontFace.addChild(this.buttonArena)

    this.buttonTavern = new Button(assets.buttonTavern, {
      sinkPx: -5,
      onClick: () => this.onTavernPressed()
    })
    this.buttonTavern.label = 'main-menu.tavern-button'
    applyPlacement(this.buttonTavern, menuButtons.tavern)
    this.buttonTavern.setBaseY(menuButtons.tavern.position.y)
    this.buttonTavern.visible = true
    this.buttonTavern.setEnabled(this.entryMode !== 'returning')
    this.centerCard.frontFace.addChild(this.buttonTavern)

    this.menuButtonActors.push(
      this.buttonPlay,
      this.buttonCollection,
      this.buttonArena,
      this.buttonTavern
    )

    this.godRaysOverlay = new Sprite(Texture.WHITE)
    this.godRaysOverlay.label = 'main-menu.god-rays'
    this.godRaysOverlay.eventMode = 'none'
    applyAnchoredPlacement(this.godRaysOverlay, MAIN_MENU_LAYOUT.screen.godRays)
    this.godRaysOverlay.width = MAIN_MENU_LAYOUT.screen.godRays.size.width
    this.godRaysOverlay.height = MAIN_MENU_LAYOUT.screen.godRays.size.height
    this.godRays = createGodRaysFilter(GOD_RAYS_CONFIG)
    this.godRaysOverlay.filters = [this.godRays.filter]
    this.godRaysOverlay.visible = this.entryMode !== 'returning'
    this.godRaysOverlay.alpha = 0
    this.addChild(this.godRaysOverlay)
    this.godRaysDust = new GodRaysDust(
      [assets.dustRound, assets.dustTriangle],
      this.godRays,
      GOD_RAYS_DUST_CONFIG
    )
    this.godRaysDust.label = 'main-menu.god-rays-dust'
    applyPlacement(this.godRaysDust, MAIN_MENU_LAYOUT.screen.godRays)
    this.godRaysDust.setActive(this.entryMode !== 'returning')
    this.godRaysDust.alpha = 0
    this.addChild(this.godRaysDust)
    this.effectTargets.push(this.godRaysOverlay, this.godRaysDust)
    if (this.entryMode !== 'returning') void this.fadeEffects(1)
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
    await this.fadeEffects(1)
    if (this.destroyed) return
    this.transitionOpened = false
    for (const button of this.menuButtonActors)
      button.setEnabled(!this.seasonRewardBlocked)
  }

  private fadeEffects(alpha: 0 | 1): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    this.killTweensOf(this.effectTargets)
    if (alpha === 1) {
      this.godRaysOverlay.visible = true
      this.godRaysDust?.setActive(true)
    }
    return new Promise<void>((resolve) => {
      this.tweenTo(this.effectTargets, {
        alpha,
        duration: MAIN_MENU_TIMING.effectsFade,
        ease: 'power2.inOut',
        onInterrupt: resolve,
        onComplete: () => {
          if (alpha === 0 && !this.destroyed) {
            this.godRaysOverlay.visible = false
            this.godRaysDust?.setActive(false)
          }
          resolve()
        }
      })
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
    this.rightLidGroup = new Container()
    this.rightLidGroup.label = 'main-menu.right-lid-group'
    this.rightLidGroup.position.copyFrom(this.lidRight.position)
    this.lidRight.position.set(0, 0)
    this.rightLidGroup.addChild(this.lidRight)
    this.menuGroup.addChild(this.rightLidGroup)
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
    if (this.transitionOpened || this.seasonRewardBlocked) return
    this.transitionOpened = true

    // Keep the buttons on the rotating menu face, but prevent further clicks.
    for (const button of this.menuButtonActors) {
      this.killTweensOf(button)
      button.setEnabled(false)
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
        button.y = button.getBaseY()
      }
      this.centerCard.visible = true
      this.lidLeft.visible = true
      this.lidRight.visible = true
      this.updateLidMeshes(0)
      await this.fadeEffects(1)
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

  update(deltaMS: number): void {
    if (this.godRaysOverlay?.visible) {
      this.godRays?.update(deltaMS)
      this.godRaysDust?.update(deltaMS)
    }
  }

  override destroy(options?: Parameters<Actor['destroy']>[0]): void {
    if (this.destroyed) return
    if (this.godRaysOverlay) this.godRaysOverlay.filters = null
    this.godRaysDust?.destroy({ children: true })
    this.godRaysDust = null
    this.godRays?.destroy()
    this.godRays = null
    super.destroy(options)
  }
}
