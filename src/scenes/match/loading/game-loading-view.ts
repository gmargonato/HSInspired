import { Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'
import { GAME_LOADING_LAYOUT } from './game-loading-layout'

/** Visible before the game view mounts; blocks input to the outgoing scene. */
export class GameLoadingView extends Container {
  private readonly fill = new Graphics()
  private progress = 0

  constructor(boardTexture: Texture, overlayTexture: Texture) {
    super()
    this.label = 'game.loading'
    this.eventMode = 'static'
    this.interactiveChildren = false
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    const board = new Sprite(boardTexture)
    board.label = 'game.loading-board'
    applyAnchoredPlacement(board, GAME_BOARD_LAYOUT.board)
    const overlay = new Sprite(overlayTexture)
    overlay.label = 'game.loading-overlay'
    applyAnchoredPlacement(overlay, GAME_LOADING_LAYOUT.overlay)
    this.fill.label = 'game.loading-progress'
    applyPlacement(this.fill, GAME_LOADING_LAYOUT.progress)
    this.addChild(board, overlay, this.fill)
  }

  /** Yield past a browser paint so completed work becomes visible before more work. */
  async report(progress: number): Promise<void> {
    if (this.destroyed) return
    this.progress = Math.max(this.progress, Math.min(1, Math.max(0, progress)))
    const { width, height } = GAME_LOADING_LAYOUT.progress.size
    this.fill
      .clear()
      .rect(0, 0, width * this.progress, height)
      .fill(GAME_LOADING_LAYOUT.progressColor)
    await new Promise<void>((resolve) => {
      if (document.visibilityState === 'hidden') setTimeout(resolve, 0)
      else requestAnimationFrame(() => setTimeout(resolve, 0))
    })
  }
}
