import type { CursorManager } from '../ui/components/cursor'

/** Narrow scene-facing port; concrete SceneManager stays an app adapter. */
export interface SceneManagerPort {
  readonly cursor: CursorManager | null
  pop(): Promise<unknown>
}
