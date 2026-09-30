import { Graphics, type Renderer } from 'pixi.js'
import { prebuildSharedAuraShape } from '../../../visual-components/effects/aura-filter'

/** Every minion outline (attack, targeting, hover) shares this silhouette field. */
export const MINION_OUTLINE_SHAPE_KEY = 'minion-oval'

/**
 * Solid oval proxy so the hollow frame does not create an inner glow. The
 * geometry must stay identical for every minion because the outline field is
 * shared under MINION_OUTLINE_SHAPE_KEY.
 */
export function createMinionOutlineProxy(label: string): Graphics {
  const proxy = new Graphics()
  proxy.label = label
  proxy.eventMode = 'none'
  proxy.ellipse(80, 90, 58, 79).fill({ color: 0xffffff })
  proxy.visible = false
  return proxy
}

/** Builds the shared minion outline field during scene load instead of in play. */
export function prebuildMinionOutlineShape(renderer: Renderer): void {
  const proxy = createMinionOutlineProxy('minion.outline-prebuild')
  try {
    prebuildSharedAuraShape(renderer, MINION_OUTLINE_SHAPE_KEY, proxy)
  } finally {
    proxy.destroy()
  }
}
