import { Container, type PointData, type Renderer } from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'
import {
  FireAoeEffect,
  type FireAoeTarget
} from '../../../visual-components/effects/fire-aoe-effect'
import {
  FireAoeResources,
  type FireAoeAssets
} from '../../../visual-components/effects/fire-aoe-materials'
import { FireballEffect } from '../../../visual-components/effects/fireball-effect'
import type { FireballAssets } from '../../../visual-components/effects/fireball-materials'
import type { VfxTemplate } from '../../../visual-components/effects/vfx-templates'
import type { VfxAoeZone } from '../../../desktop/contracts/ipc/vfx-templates'
import { DEFAULT_VFX_IMPACT_SHAKE } from '../../../desktop/contracts/ipc/vfx-templates'
import { MATCH_VFX_LAYOUT } from './match-vfx-layout'

type AreaId = keyof typeof MATCH_VFX_LAYOUT.areas

/** Map controller-relative coverage to the visible match board. */
export function matchVfxAreas(
  zones: readonly VfxAoeZone[],
  controllerIsLocal: boolean
): readonly AreaId[] {
  const board = new Set<AreaId>()
  const heroes: AreaId[] = []
  for (const zone of zones) {
    if (zone === 'friendlyBoard')
      board.add(controllerIsLocal ? 'localBoard' : 'remoteBoard')
    if (zone === 'enemyBoard')
      board.add(controllerIsLocal ? 'remoteBoard' : 'localBoard')
    if (zone === 'friendlyHero')
      heroes.push(controllerIsLocal ? 'localHero' : 'remoteHero')
    if (zone === 'enemyHero')
      heroes.push(controllerIsLocal ? 'remoteHero' : 'localHero')
  }
  return [...(board.size === 2 ? ['bothBoards' as const] : [...board]), ...heroes]
}

interface ActiveEffect {
  readonly timeline: gsap.core.Timeline
  finish(): void
}

interface VfxVisual {
  readonly duration?: number
  readonly impactSeconds?: number
  update(progress: number, seconds: number): void
  dispose(): void
}

/** Plays one saved visual while the presentation queue waits only for impact. */
export class MatchVfxPresenter {
  readonly layer = new Container()
  private readonly active = new Set<ActiveEffect>()
  private readonly fireResources?: FireAoeResources

  constructor(
    private readonly assets: Pick<GameAssets, 'burnNoise' | 'playSpotlight1'> &
      Partial<FireAoeAssets & FireballAssets>,
    private readonly timeline: () => gsap.core.Timeline,
    private readonly renderer?: Renderer,
    private readonly shake?: (intensity: number) => void
  ) {
    if (renderer && assets.fireAoeWispAtlas)
      this.fireResources = new FireAoeResources(renderer, assets as FireAoeAssets)
    this.layer.label = 'game.vfx'
    this.layer.eventMode = 'none'
    this.layer.interactiveChildren = false
  }

  play(
    template: VfxTemplate,
    controllerIsLocal: boolean,
    source?: PointData,
    target?: PointData,
    affectedTargets: readonly FireAoeTarget[] = []
  ): Promise<void> {
    const visual: VfxVisual | null =
      template.family === 'missile'
        ? source && target
          ? this.makeMissile(template, source, target)
          : null
        : this.makeAoe(template, controllerIsLocal, affectedTargets)
    if (!visual) return Promise.resolve()
    const seconds =
      visual.duration ??
      (template.family === 'missile' ? template.tuning.durationMs / 1000 : 0)
    const impactSeconds =
      visual.impactSeconds ??
      Math.min(
        seconds,
        template.family === 'aoe' ? (template.tuning.impactMs ?? 500) / 1000 : seconds
      )
    const clock = { progress: 0 }
    const timeline = this.timeline()
    return new Promise((resolve) => {
      let finished = false
      let impactResolved = false
      const resolveImpact = (): void => {
        if (impactResolved) return
        impactResolved = true
        resolve()
      }
      const active: ActiveEffect = {
        timeline,
        finish: () => {
          if (finished) return
          finished = true
          visual.dispose()
          this.active.delete(active)
          resolveImpact()
        }
      }
      this.active.add(active)
      timeline.eventCallback('onComplete', active.finish)
      timeline.eventCallback('onInterrupt', active.finish)
      timeline.to(clock, {
        progress: 1,
        duration: seconds,
        ease: 'none',
        onUpdate: () => visual.update(clock.progress, seconds)
      })
      timeline.call(
        () => {
          if (finished || impactResolved) return
          resolveImpact()
          const shake = template.tuning.impactShake ?? DEFAULT_VFX_IMPACT_SHAKE
          if (shake.enabled && shake.intensity > 0) this.shake?.(shake.intensity)
        },
        undefined,
        impactSeconds
      )
    })
  }

  dispose(): void {
    for (const effect of [...this.active]) {
      effect.timeline.kill()
      effect.finish()
    }
    this.fireResources?.destroy()
  }

  private makeMissile(
    template: Extract<VfxTemplate, { family: 'missile' }>,
    source: PointData,
    target: PointData
  ): VfxVisual {
    if (!this.renderer || !this.assets.fireballCoreClouds)
      throw new Error('Fireball requires registered assets and a renderer')
    const effect = new FireballEffect(this.renderer, this.assets as FireballAssets, {
      source,
      target,
      tuning: template.tuning
    })
    this.layer.addChild(effect.container)
    return {
      duration: effect.duration,
      impactSeconds: effect.impactSeconds,
      update: (progress, seconds) => effect.update(progress * seconds),
      dispose: () => effect.dispose()
    }
  }

  private makeAoe(
    template: Extract<VfxTemplate, { family: 'aoe' }>,
    controllerIsLocal: boolean,
    targets: readonly FireAoeTarget[] = []
  ): {
    duration?: number
    update(progress: number, seconds: number): void
    dispose(): void
  } | null {
    const areas = matchVfxAreas(template.zones, controllerIsLocal)
    if (!areas.length && !targets.length) return null
    if (!this.fireResources)
      throw new Error(
        'Particle fire requires registered fire AOE assets and a renderer'
      )
    const board = areas.find(
      (id) => id === 'bothBoards' || id === 'localBoard' || id === 'remoteBoard'
    )
    const effect = new FireAoeEffect(this.fireResources, {
      area: board
        ? {
            coverage:
              board === 'bothBoards'
                ? 'full'
                : board === 'remoteBoard'
                  ? 'opponent'
                  : 'friendly',
            placement: MATCH_VFX_LAYOUT.areas[board]
          }
        : undefined,
      targets,
      tuning: template.tuning.fire,
      intensity: template.tuning.intensity
    })
    this.layer.addChild(effect.container)
    effect.update(0)
    return {
      duration: effect.duration,
      update: (progress, seconds) => effect.update(progress * seconds),
      dispose: () => effect.dispose()
    }
  }
}
