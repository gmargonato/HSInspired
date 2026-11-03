import type { CursorManager } from '../../visual-components/controls/cursor'
import type { Scene } from '../../visual-components/lifecycle/scene'
import type { Container } from 'pixi.js'

/** Narrow scene-facing port; concrete SceneManager stays an app adapter. */
export interface SceneManagerPort {
  readonly cursor: CursorManager | null
  pop(): Promise<unknown>
  dismissOverlaysAbove?(scene: Scene): Promise<void>
  setPresentationOffset?(x: number, y: number): void
  /** Show a loading root before init completes, without activating gameplay. */
  presentLoadingRoot?(root: Container): void
}
