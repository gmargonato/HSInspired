import { Container, RenderTexture, type Renderer } from 'pixi.js'
import { DEFAULT_HEALING_TUNING } from '../../../desktop/contracts/ipc/vfx-templates'
import type { HealingAssets } from '../../../visual-components/assets/healing-assets'
import { HealingEffect } from '../../../visual-components/effects/healing-effect'
import { FireballEffect } from '../../../visual-components/effects/fireball-effect'
import type { FireballAssets } from '../../../visual-components/effects/fireball-materials'
import { getVfxTemplateLibrary } from '../../../visual-components/effects/vfx-templates'

/** Exercise the travelling ribbon, recipient bloom, and masked area-heal meshes. */
export function prewarmHealing(renderer: Renderer, assets: HealingAssets): void {
  const root = new Container()
  root.label = 'game.healing-warmup'
  root.scale.set(0.1)
  let target: RenderTexture | undefined
  try {
    target = RenderTexture.create({ width: 128, height: 128, resolution: 1 })
    for (const family of ['heal-target', 'heal-aoe'] as const) {
      let effect: HealingEffect | undefined
      try {
        effect = new HealingEffect(assets, {
          family,
          tuning: DEFAULT_HEALING_TUNING,
          source: { x: 200, y: 600 },
          target: { x: 600, y: 200 },
          areas: [{ x: 600, y: 400, width: 800, height: 300 }],
          recipients: [{ x: 600, y: 200, kind: 'hero' }]
        })
        root.addChild(effect.container)
        for (const time of [
          effect.impactSeconds * 0.5,
          effect.impactSeconds + 0.1,
          effect.impactSeconds + 0.5
        ]) {
          effect.update(time)
          renderer.render({ container: root, target, clear: true })
        }
      } finally {
        effect?.dispose()
      }
    }
  } finally {
    root.destroy({ children: true })
    target?.destroy(true)
  }
}

/** Draw birth, flight and impact, including Fireball's internal composite passes. */
export function prewarmProjectiles(renderer: Renderer, assets: FireballAssets): void {
  const template = getVfxTemplateLibrary().templates.find(
    (entry) => entry.family === 'missile'
  )
  if (!template || template.family !== 'missile') return
  const root = new Container()
  root.label = 'game.projectile-warmup'
  root.scale.set(0.1)
  let target: RenderTexture | undefined
  let effect: FireballEffect | undefined
  try {
    target = RenderTexture.create({ width: 128, height: 128, resolution: 1 })
    effect = new FireballEffect(renderer, assets, {
      source: { x: 200, y: 600 },
      target: { x: 600, y: 200 },
      tuning: {
        ...template.tuning,
        launchDelayMs: 200,
        durationMs: 400,
        // Include the optional curved mesh and tail-filter shader paths as well.
        pathCurvature: 0.25,
        tailMotion: 0.5
      },
      seed: 1
    })
    root.addChild(effect.container)
    for (const time of [0.1, 0.4, effect.impactSeconds + 0.1]) {
      effect.update(time)
      renderer.render({ container: root, target, clear: true })
    }
  } finally {
    effect?.dispose()
    root.destroy({ children: true })
    target?.destroy(true)
  }
}
