import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TilingSprite,
  type Texture
} from 'pixi.js'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'
import { GAME_LOADING_LAYOUT } from './game-loading-layout'

function progressColor(progress: number): number {
  const start = GAME_LOADING_LAYOUT.progressStartColor
  const end = GAME_LOADING_LAYOUT.progressEndColor
  let color = 0
  for (const shift of [16, 8, 0]) {
    const from = (start >> shift) & 0xff
    const to = (end >> shift) & 0xff
    color |= Math.round(from + (to - from) * progress) << shift
  }
  return color
}

/** Visible before the game view mounts; blocks input to the outgoing scene. */
export class GameLoadingView extends Container {
  readonly panel = new Container()
  private readonly fill = new Graphics()
  private readonly noise: TilingSprite
  private readonly status: Text
  private progress = 0

  constructor(boardTexture: Texture, overlayTexture: Texture, noiseTexture: Texture) {
    super()
    this.label = 'game.loading'
    this.eventMode = 'static'
    this.interactiveChildren = false
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    const board = new Sprite(boardTexture)
    board.label = 'game.loading-board'
    applyAnchoredPlacement(board, GAME_BOARD_LAYOUT.board)
    const backdrop = new Graphics()
    const { area, color, alpha } = GAME_BOARD_LAYOUT.openingBackdrop
    backdrop.label = 'game.loading-backdrop'
    backdrop.eventMode = 'none'
    applyPlacement(backdrop, area)
    backdrop.rect(0, 0, area.size.width, area.size.height).fill({ color, alpha })
    this.panel.label = 'game.loading-panel'
    applyPlacement(this.panel, GAME_LOADING_LAYOUT.panel)
    const overlay = new Sprite(overlayTexture)
    overlay.label = 'game.loading-overlay'
    applyAnchoredPlacement(overlay, GAME_LOADING_LAYOUT.overlay)
    this.fill.label = 'game.loading-progress'
    applyPlacement(this.fill, GAME_LOADING_LAYOUT.progress)
    this.noise = new TilingSprite({
      texture: noiseTexture,
      width: 0,
      height: GAME_LOADING_LAYOUT.progress.size.height,
      tileScale: {
        x: GAME_LOADING_LAYOUT.noiseTileScale,
        y: GAME_LOADING_LAYOUT.noiseTileScale
      }
    })
    this.noise.label = 'game.loading-noise'
    this.noise.blendMode = 'multiply'
    this.noise.alpha = GAME_LOADING_LAYOUT.noiseAlpha
    applyPlacement(this.noise, GAME_LOADING_LAYOUT.progress)
    this.status = new Text({
      text: 'Loading match',
      style: {
        fontFamily: 'Belwe',
        fontWeight: 'bold',
        fontSize: 28,
        fill: 0xffffff,
        stroke: { color: 0x101018, width: 4 },
        align: 'center'
      }
    })
    this.status.label = 'game.loading-status'
    applyAnchoredPlacement(this.status, GAME_LOADING_LAYOUT.status)
    this.panel.addChild(overlay, this.fill, this.noise, this.status)
    this.addChild(board, backdrop, this.panel)
  }

  /** Yield past a browser paint so completed work becomes visible before more work. */
  async report(progress: number, status?: string): Promise<void> {
    if (this.destroyed) return
    this.progress = Math.max(this.progress, Math.min(1, Math.max(0, progress)))
    if (status && status !== this.status.text) this.status.text = status
    const { width, height } = GAME_LOADING_LAYOUT.progress.size
    const filledWidth = width * this.progress
    this.fill.clear().rect(0, 0, filledWidth, height).fill(progressColor(this.progress))
    this.noise.width = filledWidth
    await new Promise<void>((resolve) => {
      if (document.visibilityState === 'hidden') setTimeout(resolve, 0)
      else requestAnimationFrame(() => setTimeout(resolve, 0))
    })
  }
}
