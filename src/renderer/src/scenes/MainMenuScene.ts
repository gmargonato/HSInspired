import { Container, PerspectiveMesh, Sprite, Texture } from 'pixi.js'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { FlipCard } from '../actors/FlipCard'
import { Button } from '../actors/Button'
import { DeckSelectionScene } from './DeckSelectionScene'
import { ASSET_BUNDLE_IDS } from '../core/assets'
import type { MainMenuAssets } from '../core/assets'

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
const LID_MIN_WIDTH = 1
const LID_PERSPECTIVE_DEPTH = 14

type LidSide = 'left' | 'right'

export class MainMenuScene extends Scene {
  private table!: Sprite
  private boxLayer!: Container
  private menuGroup!: Container
  private chestBox!: Sprite
  private lidLeft!: PerspectiveMesh
  private lidRight!: PerspectiveMesh
  private centerCard!: FlipCard
  private buttonPlay!: Button
  private buttonCollection!: Button
  private menuOpened = false
  private deckOpened = false

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<MainMenuAssets>(
      ASSET_BUNDLE_IDS.mainMenu
    )

    this.table = new Sprite(assets.table)
    this.table.width = GAME_WIDTH
    this.table.height = GAME_HEIGHT
    this.root.addChild(this.table)

    this.buildChest(assets.box, assets.leftLid, assets.rightLid)

    this.centerCard = new FlipCard(assets.centerPart, assets.centerPartMenu, {
      oneShot: true,
      onClick: () => this.openMenu()
    })
    this.centerCard.position.set(Layout.centerPart.x, Layout.centerPart.y)
    this.menuGroup.addChild(this.centerCard)

    this.buttonPlay = new Button(assets.buttonPlay, {
      onClick: () => this.onPlayPressed()
    })
    this.buttonPlay.position.set(Layout.buttonPlay.x, Layout.buttonPlay.y)
    this.buttonPlay.setBaseY(Layout.buttonPlay.y)
    this.buttonPlay.visible = false
    this.buttonPlay.setEnabled(false)
    this.menuGroup.addChild(this.buttonPlay)

    this.buttonCollection = new Button(assets.buttonCollection, {
      onClick: () => console.log('collection clicked')
    })
    this.buttonCollection.position.set(
      Layout.buttonCollection.x,
      Layout.buttonCollection.y
    )
    this.buttonCollection.setBaseY(Layout.buttonCollection.y)
    this.buttonCollection.visible = false
    this.buttonCollection.setEnabled(false)
    this.menuGroup.addChild(this.buttonCollection)
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
    const width = texture.width
    const height = texture.height
    const hingeOnLeft = side === 'left'
    const hingeX = hingeOnLeft ? Layout.leftLid.x - width : Layout.rightLid.x + width

    const mesh = new PerspectiveMesh({
      texture,
      verticesX: 10,
      verticesY: 10,
      x0: hingeOnLeft ? 0 : -width,
      y0: 0,
      x1: hingeOnLeft ? width : 0,
      y1: 0,
      x2: hingeOnLeft ? width : 0,
      y2: height,
      x3: hingeOnLeft ? 0 : -width,
      y3: height
    })

    mesh.position.set(
      hingeX,
      (hingeOnLeft ? Layout.leftLid.y : Layout.rightLid.y) - height / 2
    )

    return mesh
  }

  private openMenu(): void {
    if (this.menuOpened) return
    this.menuOpened = true

    this.buttonPlay.visible = true
    this.buttonCollection.visible = true
    this.buttonPlay.setEnabled(true)
    this.buttonCollection.setEnabled(true)
    this.buttonPlay.alpha = 0
    this.buttonCollection.alpha = 0
    this.buttonPlay.y = Layout.buttonPlay.y - 16
    this.buttonCollection.y = Layout.buttonCollection.y - 16

    this.tweenTo(this.buttonPlay, {
      alpha: 1,
      y: Layout.buttonPlay.y,
      duration: 0.3,
      ease: 'power2.out',
      delay: 0.05
    })
    this.tweenTo(this.buttonCollection, {
      alpha: 1,
      y: Layout.buttonCollection.y,
      duration: 0.3,
      ease: 'power2.out',
      delay: 0.15
    })
  }

  private async onPlayPressed(): Promise<void> {
    if (this.deckOpened) return
    this.deckOpened = true

    // Hide the menu buttons while the chest transitions.
    this.killTweensOf(this.buttonPlay)
    this.killTweensOf(this.buttonCollection)
    this.buttonPlay.setEnabled(false)
    this.buttonCollection.setEnabled(false)
    this.tweenTo(this.buttonPlay, { alpha: 0, duration: 0.15 })
    this.tweenTo(this.buttonCollection, { alpha: 0, duration: 0.15 })

    // Loading step: flip the card back AND load the deck scene together.
    const deck = new DeckSelectionScene()
    let deckAttached = false
    try {
      await Promise.all([this.centerCard.flipToFront(), deck.load(this.appInstance)])

      // Once the center piece has returned to its closed artwork, remove it
      // immediately instead of sending it off to the side.
      this.centerCard.visible = false

      // Keep the deck panel above the chest frame but below the lids, so the
      // perspective meshes fold over it before revealing the deck screen.
      this.attachSubScene(deck, 2)
      deckAttached = true

      await this.openChest()

      // The box stays as the chest's frame; the lids, center piece, and
      // buttons are hidden after the deck has been revealed.
      this.lidLeft.visible = false
      this.lidRight.visible = false
      this.centerCard.visible = false
      this.buttonPlay.visible = false
      this.buttonCollection.visible = false
    } catch (error) {
      console.error('Failed to open deck selection:', error)
      if (deckAttached) {
        await this.removeSubScene(deck).catch(() => undefined)
      } else {
        await deck.unload().catch(() => undefined)
      }
      this.deckOpened = false
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
      this.lidLeft.visible = true
      this.lidRight.visible = true
      this.updateLidMeshes(0)
    }
  }

  private openChest(): Promise<void> {
    return new Promise<void>((resolve) => {
      const state = { progress: 0 }
      const timeline = this.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        state,
        {
          progress: 1,
          duration: LID_OPEN_DURATION,
          ease: 'power2.in',
          onUpdate: () => this.updateLidMeshes(state.progress)
        },
        0
      )
    })
  }

  private updateLidMeshes(progress: number): void {
    const clampedProgress = Math.max(0, Math.min(1, progress))
    const angle = clampedProgress * (Math.PI / 2)
    const widthScale = Math.cos(angle)
    const depth = Math.sin(angle) * LID_PERSPECTIVE_DEPTH

    this.setLidCorners(this.lidLeft, 'left', widthScale, depth)
    this.setLidCorners(this.lidRight, 'right', widthScale, depth)
  }

  private setLidCorners(
    mesh: PerspectiveMesh,
    side: LidSide,
    widthScale: number,
    depth: number
  ): void {
    const width = mesh.texture.width
    const height = mesh.texture.height
    const visibleWidth = Math.max(LID_MIN_WIDTH, width * widthScale)
    const hingeOnLeft = side === 'left'
    const freeEdgeX = hingeOnLeft ? visibleWidth : -visibleWidth

    if (hingeOnLeft) {
      mesh.setCorners(0, 0, freeEdgeX, -depth, freeEdgeX, height + depth, 0, height)
      return
    }

    mesh.setCorners(freeEdgeX, -depth, 0, 0, 0, height, freeEdgeX, height + depth)
  }

  update(_deltaMS: number): void {}
}
