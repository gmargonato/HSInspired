import { Container, PerspectiveMesh, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { CARD_CATALOG } from '../../../../card-lab/card-catalog'
import { CardAssetResolver } from '../../../../card-lab/card-asset-manifest'
import { CardView } from '../../../../card-lab/card-view'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { ASSET_BUNDLE_IDS, CollectionAssets } from '../core/assets'
import type { CursorContextVariant } from '../core/cursor'
import { buildCollectionPages, type CollectionPage } from './collectionPages'

const PAGE_LEFT = 250
const PAGE_TOP = 80
const PAGE_RIGHT = 1380
const PAGE_BOTTOM = GAME_HEIGHT - 80
const PAGE_CENTER_X = (PAGE_LEFT + PAGE_RIGHT) / 2
const PAGE_HEIGHT = PAGE_BOTTOM - PAGE_TOP

// Manual nudges only. Keep the lock position relative to the cover so the two
// assets stay aligned when the main collection panel is moved during layout.
// These starting values line the 1157x1080 cover up with the center panel of
// the 1920x1080 collection background.
const Layout = {
  page: {
    x: PAGE_LEFT,
    y: PAGE_TOP,
    width: PAGE_RIGHT - PAGE_LEFT,
    height: PAGE_HEIGHT
  },
  classLabel: { x: PAGE_CENTER_X, y: 115 },
  pageLabel: { x: PAGE_CENTER_X, y: 960 },
  cardGrid: { x: 305, y: 145, width: 1000, height: 770 },
  cover: { x: 242, y: 0 },
  coverLock: { x: 905, y: 418 }
}

const CARD_GRID_COLUMNS = 4
const CARD_GRID_ROWS = 2
const CARD_SLOT_PADDING_X = 10
const CARD_SLOT_PADDING_Y = 12
const COVER_LOCK_OPEN_DURATION = 0.45
const COVER_OPEN_DURATION = 0.6
const DOOR_MIN_WIDTH = 1
const COVER_LOCK_PERSPECTIVE_DEPTH = 10
const COVER_PERSPECTIVE_DEPTH = 14

type DoorSide = 'left' | 'right'

/** Full-viewport collection scene presented through the main menu transition. */
export class CollectionScene extends Scene {
  private readonly pages = buildCollectionPages(CARD_CATALOG.all)
  private readonly cardResolver = new CardAssetResolver()

  private background!: Sprite
  private pageContent!: Container
  private cardLayer!: Container
  private classLabel!: Text
  private pageLabel!: Text
  private previousPageZone!: Container
  private nextPageZone!: Container
  private cover!: PerspectiveMesh
  private coverLock!: PerspectiveMesh
  private coverRevealPromise: Promise<void> | null = null
  private pageIndex = 0
  private renderSequence = 0
  private pageLoading = false
  private navigationReady = false
  private disposed = false

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )

    this.background = new Sprite(assets.background)
    this.background.width = GAME_WIDTH
    this.background.height = GAME_HEIGHT
    this.root.addChild(this.background)

    this.pageContent = new Container()
    this.root.addChild(this.pageContent)

    this.cardLayer = new Container()
    this.pageContent.addChild(this.cardLayer)

    this.classLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 38,
        fill: 0x19130e,
        align: 'center'
      }
    })
    this.classLabel.anchor.set(0.5)
    this.classLabel.position.set(Layout.classLabel.x, Layout.classLabel.y)
    this.classLabel.eventMode = 'none'
    this.pageContent.addChild(this.classLabel)

    this.pageLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 28,
        fill: 0x806d4f,
        align: 'center'
      }
    })
    this.pageLabel.anchor.set(0.5)
    this.pageLabel.position.set(Layout.pageLabel.x, Layout.pageLabel.y)
    this.pageLabel.eventMode = 'none'
    this.pageContent.addChild(this.pageLabel)

    this.previousPageZone = this.createPageZone(
      PAGE_LEFT,
      50,
      'collection-previous-page',
      () => this.changePage(-1)
    )
    this.nextPageZone = this.createPageZone(
      1310,
      PAGE_RIGHT - 1310,
      'collection-next-page',
      () => this.changePage(1)
    )
    this.pageContent.addChild(this.previousPageZone)
    this.pageContent.addChild(this.nextPageZone)

    // The cover is hinged on its left edge. The separate lock is hinged on
    // its right edge, matching the direction shown in the reference images.
    this.cover = this.createDoorMesh(assets.cover, 'left', Layout.cover)
    this.root.addChild(this.cover)

    this.coverLock = this.createDoorMesh(assets.coverLock, 'right', {
      x: Layout.cover.x + Layout.coverLock.x,
      y: Layout.cover.y + Layout.coverLock.y
    })
    this.root.addChild(this.coverLock)

    // Keep the closed doors visible while SceneTransitionHost presents this
    // scene in the inset. The afterTransition callback only starts their
    // opening animation after the destination reaches the full viewport.
    this.cover.visible = true
    this.coverLock.visible = true
    this.updateDoor(this.cover, 'left', 0, COVER_PERSPECTIVE_DEPTH)
    this.updateDoor(this.coverLock, 'right', 0, COVER_LOCK_PERSPECTIVE_DEPTH)

    if (this.pages.length === 0) {
      throw new Error('Collection has no cards to display')
    }

    this.setNavigationEnabled(false)
    await this.waitForFonts()
    await this.renderPage(0)
  }

  /**
   * Runs the collection reveal exactly once for this scene instance.
   *
   * The transition manager awaits this promise, which guarantees that the
   * lock finishes opening before the larger cover starts moving.
   */
  playCoverReveal(): Promise<void> {
    if (this.coverRevealPromise) return this.coverRevealPromise

    this.coverRevealPromise = this.revealCover()
    return this.coverRevealPromise
  }

  private async revealCover(): Promise<void> {
    this.cover.visible = true
    this.coverLock.visible = true

    await this.animateDoor(
      this.coverLock,
      'right',
      COVER_LOCK_OPEN_DURATION,
      COVER_LOCK_PERSPECTIVE_DEPTH
    )
    this.coverLock.visible = false

    await this.animateDoor(
      this.cover,
      'left',
      COVER_OPEN_DURATION,
      COVER_PERSPECTIVE_DEPTH
    )
    this.cover.visible = false

    if (!this.disposed) {
      this.navigationReady = true
      this.setNavigationEnabled(true)
    }
  }

  private async waitForFonts(): Promise<void> {
    if (!document.fonts) return

    await Promise.all([
      document.fonts.load('38px Belwe'),
      document.fonts.load('27px "Franklin Gothic Condensed"')
    ])
  }

  private async renderPage(index: number): Promise<void> {
    const page = this.pages[index]
    if (!page) throw new Error(`Collection page does not exist: ${index}`)

    const sequence = ++this.renderSequence
    this.pageLoading = true
    this.setNavigationEnabled(false)

    const nextCardLayer = new Container()
    try {
      const results = await Promise.allSettled(
        page.cards.map((card) => CardView.create(card, this.cardResolver))
      )
      const views = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      const failedResult = results.find((result) => result.status === 'rejected')

      if (failedResult && failedResult.status === 'rejected') {
        this.destroyCardViews(views)
        throw failedResult.reason
      }

      if (this.disposed || sequence !== this.renderSequence) {
        this.destroyCardViews(views)
        return
      }

      for (const [cardIndex, view] of views.entries()) {
        this.layoutCard(view, cardIndex)
        nextCardLayer.addChild(view)
      }

      const previousCardLayer = this.cardLayer
      this.pageContent.removeChild(previousCardLayer)
      this.cardLayer = nextCardLayer
      this.pageContent.addChildAt(nextCardLayer, 0)
      previousCardLayer.destroy({ children: true })

      this.pageIndex = index
      this.updatePageLabels(page)
    } finally {
      if (sequence === this.renderSequence) {
        this.pageLoading = false
        if (!this.disposed && this.navigationReady) {
          this.setNavigationEnabled(true)
        }
      }
    }
  }

  private layoutCard(view: CardView, cardIndex: number): void {
    const slotWidth = Layout.cardGrid.width / CARD_GRID_COLUMNS
    const slotHeight = Layout.cardGrid.height / CARD_GRID_ROWS
    const column = cardIndex % CARD_GRID_COLUMNS
    const row = Math.floor(cardIndex / CARD_GRID_COLUMNS)
    const maxWidth = slotWidth - CARD_SLOT_PADDING_X * 2
    const maxHeight = slotHeight - CARD_SLOT_PADDING_Y * 2
    const scale = Math.min(maxWidth / view.plan.width, maxHeight / view.plan.height)

    view.scale.set(scale)
    view.position.set(
      Layout.cardGrid.x +
        column * slotWidth +
        (slotWidth - view.plan.width * scale) / 2,
      Layout.cardGrid.y + row * slotHeight + (slotHeight - view.plan.height * scale) / 2
    )
  }

  private destroyCardViews(views: readonly CardView[]): void {
    for (const view of views) {
      view.destroy({ children: true })
    }
  }

  private updatePageLabels(page: CollectionPage): void {
    this.classLabel.text = page.cardClass
    this.pageLabel.text = `Page ${page.pageNumber}`
  }

  private createPageZone(
    x: number,
    width: number,
    cursorVariant: CursorContextVariant,
    onClick: () => void
  ): Container {
    const zone = new Container()
    zone.position.set(x, PAGE_TOP)
    zone.hitArea = new Rectangle(0, 0, width, PAGE_HEIGHT)
    zone.eventMode = 'none'
    zone.on('pointerover', () =>
      this.sceneManager.cursor?.setContextVariant(cursorVariant)
    )
    zone.on('pointerout', () => this.sceneManager.cursor?.setContextVariant(null))
    zone.on('pointertap', onClick)
    return zone
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.sceneManager.cursor?.setContextVariant(null)

    this.previousPageZone.eventMode = enabled && this.pageIndex > 0 ? 'static' : 'none'
    this.nextPageZone.eventMode =
      enabled && this.pageIndex < this.pages.length - 1 ? 'static' : 'none'
  }

  private changePage(delta: number): void {
    if (this.pageLoading || !this.navigationReady) return

    const nextIndex = this.pageIndex + delta
    if (nextIndex < 0 || nextIndex >= this.pages.length) return

    void this.renderPage(nextIndex).catch((error: unknown) => {
      console.error(`Failed to render collection page ${nextIndex}:`, error)
    })
  }

  /** Creates a mesh whose local origin is the selected door hinge. */
  private createDoorMesh(
    texture: Texture,
    side: DoorSide,
    topLeft: { x: number; y: number }
  ): PerspectiveMesh {
    const width = texture.width
    const height = texture.height
    const hingeOnLeft = side === 'left'

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

    mesh.position.set(topLeft.x + (hingeOnLeft ? 0 : width), topLeft.y)

    return mesh
  }

  /**
   * Animates the same top-view door geometry used by the main-menu lids:
   * cosine compresses the visible width while sine adds a small perspective
   * bend at the free edge.
   */
  private animateDoor(
    mesh: PerspectiveMesh,
    side: DoorSide,
    duration: number,
    perspectiveDepth: number
  ): Promise<void> {
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
          duration,
          ease: 'power2.in',
          onUpdate: () => this.updateDoor(mesh, side, state.progress, perspectiveDepth)
        },
        0
      )
    })
  }

  private updateDoor(
    mesh: PerspectiveMesh,
    side: DoorSide,
    progress: number,
    perspectiveDepth: number
  ): void {
    const clampedProgress = Math.max(0, Math.min(1, progress))
    const angle = clampedProgress * (Math.PI / 2)
    const widthScale = Math.cos(angle)
    const depth = Math.sin(angle) * perspectiveDepth
    const visibleWidth = Math.max(DOOR_MIN_WIDTH, mesh.texture.width * widthScale)

    this.setDoorCorners(mesh, side, visibleWidth, depth)
  }

  private setDoorCorners(
    mesh: PerspectiveMesh,
    side: DoorSide,
    visibleWidth: number,
    depth: number
  ): void {
    const height = mesh.texture.height
    const hingeOnLeft = side === 'left'
    const freeEdgeX = hingeOnLeft ? visibleWidth : -visibleWidth

    if (hingeOnLeft) {
      mesh.setCorners(0, 0, freeEdgeX, -depth, freeEdgeX, height + depth, 0, height)
      return
    }

    mesh.setCorners(freeEdgeX, -depth, 0, 0, 0, height, freeEdgeX, height + depth)
  }

  protected onExit(): void {
    this.disposed = true
    this.renderSequence += 1
    this.pageLoading = false
    this.navigationReady = false
    this.previousPageZone.eventMode = 'none'
    this.nextPageZone.eventMode = 'none'
    this.sceneManager.cursor?.setContextVariant(null)
  }

  update(_deltaMS: number): void {}
}
