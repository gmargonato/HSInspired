import { Rectangle, Sprite, type Texture } from 'pixi.js'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'
import type { MatchControls3D, ControlMeshView } from '../board/match-controls-3d'

export type TurnControlFace = 'endTurn' | 'extraTurn' | 'enemyTurn'

export class EndTurnControl extends Actor {
  /** The static silhouette remains available to the existing Pixi outlines. */
  readonly sprite: Sprite
  private readonly mesh: ControlMeshView
  private enabled = false
  private held = false
  private face: TurnControlFace
  private revision = 0

  constructor(
    renderer: MatchControls3D,
    texture: Texture,
    face: TurnControlFace,
    onClick: () => void
  ) {
    super()
    this.face = face
    this.sprite = new Sprite(texture)
    this.sprite.visible = false
    this.addChild(this.sprite)
    this.mesh = renderer.create('endTurn')
    this.addChild(this.mesh)
    const { size, anchor } = GAME_BOARD_LAYOUT.endTurnButton
    this.hitArea = new Rectangle(
      -size.width * anchor.x,
      -size.height * anchor.y,
      size.width,
      size.height
    )
    this.mesh.settle(face === 'enemyTurn' ? 'ENDTURN_WAITING' : 'ENDTURN_YOUR_TURN')
    this.mesh.setTurnText(face === 'extraTurn')
    this.on('pointerdown', (event) => {
      if (event.button !== 0 || !this.enabled || this.mesh.busy) return
      this.held = true
      this.mesh.press(true)
    })
    this.on('pointerup', () => this.release())
    this.on('pointerout', () => this.release())
    this.on('pointerupoutside', () => this.release())
    this.on('pointercancel', () => this.release())
    this.on('pointertap', (event) => {
      if (event.button === 0 && this.enabled && !this.mesh.busy) onClick()
    })
    window.addEventListener('blur', this.release)
  }

  private release = (): void => {
    if (!this.held) return
    this.held = false
    this.mesh.press(false)
  }

  isTextureFlipping(): boolean {
    return this.mesh.busy
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.release()
    this.eventMode = enabled && !this.mesh.busy ? 'static' : 'none'
    this.cursor = enabled ? 'pointer' : 'default'
  }

  async setFace(face: TurnControlFace, texture: Texture): Promise<void> {
    this.sprite.texture = texture
    if (this.face === face) return
    const revision = ++this.revision
    const wasWaiting = this.face === 'enemyTurn'
    this.face = face
    this.mesh.setTurnText(face === 'extraTurn')
    if (wasWaiting !== (face === 'enemyTurn')) {
      const promise = this.mesh.play(
        face === 'enemyTurn' ? 'ENDTURN_WAITING' : 'ENDTURN_YOUR_TURN'
      )
      this.setEnabled(this.enabled)
      await promise
    }
    if (!this.destroyed && revision === this.revision) this.setEnabled(this.enabled)
  }

  override dispose(): void {
    ++this.revision
    window.removeEventListener('blur', this.release)
    this.mesh.dispose()
    super.dispose()
  }
}
