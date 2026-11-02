import { Rectangle, Sprite, type Texture } from 'pixi.js'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'
import type { MatchControls3D, ControlMeshView } from '../board/match-controls-3d'

export type TurnControlFace = 'endTurn' | 'extraTurn' | 'enemyTurn'

export class EndTurnControl extends Actor {
  /** Face texture retained for HUD state synchronization; the visible control is 3D. */
  readonly sprite: Sprite
  private readonly mesh: ControlMeshView
  private enabled = false
  private held = false
  private physicallyPressed = false
  private gestureRevision = 0
  private face: TurnControlFace
  private revision = 0

  constructor(
    renderer: MatchControls3D,
    texture: Texture,
    face: TurnControlFace,
    onClick: () => void,
    private readonly onHeldChange?: (held: boolean) => void
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
      ++this.gestureRevision
      this.physicallyPressed = true
      this.mesh.press(true)
      this.onHeldChange?.(true)
    })
    this.on('pointerup', this.handlePointerUp)
    this.on('pointerout', this.releaseAnimation)
    this.on('pointerupoutside', this.handlePointerUp)
    this.on('pointercancel', () => this.release())
    this.on('pointertap', (event) => {
      if (event.button === 0 && this.enabled && !this.mesh.busy) onClick()
    })
    window.addEventListener('blur', this.release)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointercancel', this.release)
  }

  private handlePointerUp = (event: { button: number }): void => {
    if (event.button > 0) return
    this.release()
  }

  private releaseAnimation = (): void => {
    if (!this.physicallyPressed) return
    this.physicallyPressed = false
    this.mesh.press(false)
  }

  private release = (): void => {
    if (!this.held) return
    this.held = false
    this.releaseAnimation()
    const revision = ++this.gestureRevision
    // Pixi emits pointertap after pointerup. Let the click update turn state
    // before restoring outlines so a committed click cannot flash white.
    queueMicrotask(() => {
      if (!this.destroyed && revision === this.gestureRevision)
        this.onHeldChange?.(false)
    })
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
    ++this.gestureRevision
    window.removeEventListener('blur', this.release)
    window.removeEventListener('pointerup', this.handlePointerUp)
    window.removeEventListener('pointercancel', this.release)
    this.mesh.dispose()
    super.dispose()
  }
}
