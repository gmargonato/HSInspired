import { Assets, Container, Sprite, Texture } from 'pixi.js'
import { gsap } from 'gsap'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../main'
import { FlipCard } from '../actors/FlipCard'
import tableImage from '@assets/images/TABLE.png'
import boxImage from '@assets/images/BOX.png'
import leftLidImage from '@assets/images/LEFT_LID.png'
import rightLidImage from '@assets/images/RIGHT_LID.png'
import centerPartImage from '@assets/images/CENTER_PART.png'
import centerPartMenuImage from '@assets/images/CENTER_PART_MENU.png'
import buttonPlayImage from '@assets/images/MENU_BUTTON_PLAY.png'
import buttonCollectionImage from '@assets/images/MENU_BUTTON_COLLECTION.png'

// Manual nudges only (multi-line tweaks while designing the layout).
// Every piece defaults to x=0 (the chest's center line); the lids are
// shifted automatically so their inner edges meet at the center.
const Layout = {
  box: { x: 0, y: -40 },
  centerPart: { x: 0, y: -32 },
  leftLid: { x: 27, y: -37 },
  rightLid: { x: 0, y: -37 },
  buttonPlay: { x: 0, y: -175 },
  buttonCollection: { x: 0, y: -82 }
}

export class MainMenuScene extends Scene {
  private table!: Sprite
  private menuGroup!: Container
  private centerCard!: FlipCard
  private buttonPlay!: Sprite
  private buttonCollection!: Sprite
  private menuOpened = false

  async init(): Promise<void> {
    const tableTexture = await Assets.load(tableImage)
    this.table = new Sprite(tableTexture)
    this.table.width = GAME_WIDTH
    this.table.height = GAME_HEIGHT
    this.root.addChild(this.table)

    const [
      boxTexture,
      leftLidTexture,
      rightLidTexture,
      centerPartTexture,
      centerPartMenuTexture,
      buttonPlayTexture,
      buttonCollectionTexture
    ] = await Promise.all([
      Assets.load(boxImage),
      Assets.load(leftLidImage),
      Assets.load(rightLidImage),
      Assets.load(centerPartImage),
      Assets.load(centerPartMenuImage),
      Assets.load(buttonPlayImage),
      Assets.load(buttonCollectionImage)
    ])

    this.menuGroup = this.buildChest(
      boxTexture,
      leftLidTexture,
      rightLidTexture
    )
    this.root.addChild(this.menuGroup)

    this.centerCard = new FlipCard(centerPartTexture, centerPartMenuTexture, {
      onClick: () => this.openMenu()
    })
    this.centerCard.position.set(Layout.centerPart.x, Layout.centerPart.y)
    this.menuGroup.addChild(this.centerCard)

    this.buttonPlay = new Sprite(buttonPlayTexture)
    this.buttonPlay.anchor.set(0.5)
    this.buttonPlay.position.set(Layout.buttonPlay.x, Layout.buttonPlay.y)
    this.buttonPlay.eventMode = 'static'
    this.buttonPlay.cursor = 'pointer'
    this.menuGroup.addChild(this.buttonPlay)

    this.buttonCollection = new Sprite(buttonCollectionTexture)
    this.buttonCollection.anchor.set(0.5)
    this.buttonCollection.position.set(
      Layout.buttonCollection.x,
      Layout.buttonCollection.y
    )
    this.buttonCollection.eventMode = 'static'
    this.buttonCollection.cursor = 'pointer'
    this.menuGroup.addChild(this.buttonCollection)
  }

  private buildChest(
    box: Texture,
    leftLid: Texture,
    rightLid: Texture
  ): Container {
    const group = new Container()

    const chestBox = new Sprite(box)
    chestBox.anchor.set(0.5)
    chestBox.position.set(Layout.box.x, Layout.box.y)
    group.addChild(chestBox)

    const lidLeft = new Sprite(leftLid)
    lidLeft.anchor.set(0.5)
    lidLeft.position.set(
      Layout.leftLid.x - lidLeft.width / 2,
      Layout.leftLid.y
    )
    group.addChild(lidLeft)

    const lidRight = new Sprite(rightLid)
    lidRight.anchor.set(0.5)
    lidRight.position.set(
      Layout.rightLid.x + lidRight.width / 2,
      Layout.rightLid.y
    )
    group.addChild(lidRight)

    group.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    return group
  }

  private openMenu(): void {
    if (this.menuOpened) return
    this.menuOpened = true

    this.buttonPlay.visible = true
    this.buttonCollection.visible = true
    this.buttonPlay.alpha = 0
    this.buttonCollection.alpha = 0
    this.buttonPlay.y = Layout.buttonPlay.y - 16
    this.buttonCollection.y = Layout.buttonCollection.y - 16

    gsap.to(this.buttonPlay, {
      alpha: 1,
      y: Layout.buttonPlay.y,
      duration: 0.3,
      ease: 'power2.out',
      delay: 0.05
    })
    gsap.to(this.buttonCollection, {
      alpha: 1,
      y: Layout.buttonCollection.y,
      duration: 0.3,
      ease: 'power2.out',
      delay: 0.15
    })
  }

  update(_deltaMS: number): void {}
}