import { Container, Sprite } from 'pixi.js'
import type { GameBoardAssets } from '../../../visual-components/assets'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'
import { TABLE_LAYOUT } from './table-layout'

/** Shared composition for match loading and play; textures belong to the scene scope. */
export class TableView extends Container {
  private readonly corner = new Sprite()
  private readonly localGold: Sprite
  private readonly remoteGold: Sprite

  constructor(
    private readonly assets: GameBoardAssets,
    cornerId: string | null
  ) {
    super()
    this.label = 'game.table'
    this.eventMode = 'none'
    const base = new Sprite(assets.board)
    base.label = 'game.table-base'
    applyAnchoredPlacement(base, GAME_BOARD_LAYOUT.board)
    this.localGold = new Sprite(assets.localGoldenFrame)
    this.localGold.label = 'game.table-local-gold'
    applyAnchoredPlacement(this.localGold, TABLE_LAYOUT.localGoldenFrame)
    this.remoteGold = new Sprite(assets.remoteGoldenFrame)
    this.remoteGold.label = 'game.table-remote-gold'
    applyAnchoredPlacement(this.remoteGold, TABLE_LAYOUT.remoteGoldenFrame)
    this.corner.label = 'game.table-corners'
    applyAnchoredPlacement(this.corner, GAME_BOARD_LAYOUT.board)
    this.addChild(base, this.localGold, this.remoteGold, this.corner)
    this.setGoldenFrames(false, false)
    this.setCorner(cornerId)
  }

  setCorner(id: string | null): void {
    this.corner.visible = !!id && !!this.assets[id]
    if (id && this.assets[id]) this.corner.texture = this.assets[id]
  }

  setGoldenFrames(local: boolean, remote: boolean): void {
    this.localGold.visible = local
    this.remoteGold.visible = remote
  }
}
