import { Application } from 'pixi.js'
import { LayoutInspector, type LayoutInspectorOptions } from './layout-inspector'

export { LayoutInspector }
export type { LayoutInspectorOptions }

/** Dev-only factory used by `main.ts` behind `import.meta.env.DEV`. */
export function createLayoutInspector(
  app: Application,
  options: LayoutInspectorOptions
): LayoutInspector {
  return new LayoutInspector(app, options)
}
