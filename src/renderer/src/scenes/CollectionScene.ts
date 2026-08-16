import { PerspectiveMesh, Sprite, Texture } from 'pixi.js'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { ASSET_BUNDLE_IDS, CollectionAssets } from '../core/assets'

// Manual nudges only. Keep the lock position relative to the cover so the two
// assets stay aligned when the main collection panel is moved during layout.
// These starting values line the 1157x1080 cover up with the center panel of
// the 1920x1080 collection background.
const Layout = {
  cover: { x: 242, y: 0 },
  coverLock: { x: 905, y: 418 }
}

const COVER_LOCK_OPEN_DURATION = 0.45
const COVER_OPEN_DURATION = 0.6
const DOOR_MIN_WIDTH = 1
const COVER_LOCK_PERSPECTIVE_DEPTH = 10
const COVER_PERSPECTIVE_DEPTH = 14

type DoorSide = 'left' | 'right'

/** Full-viewport collection scene presented through the main menu transition. */
export class CollectionScene extends Scene {
  private background!: Sprite
  private cover!: PerspectiveMesh
  private coverLock!: PerspectiveMesh
  private coverRevealPromise: Promise<void> | null = null

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )

    this.background = new Sprite(assets.background)
    this.background.width = GAME_WIDTH
    this.background.height = GAME_HEIGHT
    this.root.addChild(this.background)

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

  update(_deltaMS: number): void {}
}
