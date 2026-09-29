import type { CursorManager } from '../ui/components/cursor'
import type { Container } from 'pixi.js'

/** Narrow scene-facing port; concrete SceneManager stays an app adapter. */
export interface SceneManagerPort {
  readonly cursor: CursorManager | null
  pop(): Promise<unknown>
  setPresentationOffset?(x: number, y: number): void
  /** Show a loading root before init completes, without activating gameplay. */
  presentLoadingRoot?(root: Container): void
}
