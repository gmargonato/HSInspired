import { Container, Sprite, Texture, type PointData } from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'
import { AoeVfxShader } from '../../../visual-components/effects/aoe-vfx-shader'
import {
  MissileVfxShader,
  MISSILE_VFX_TIMING
} from '../../../visual-components/effects/missile-vfx-shader'
import type { VfxTemplate } from '../../../visual-components/effects/vfx-templates'
import type { VfxAoeZone } from '../../../desktop/contracts/ipc/vfx-templates'
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function particles(
  parent: Container,
  texture: Texture,
  prefix: string,
  count: number
): Sprite[] {
  return Array.from({ length: count }, (_, index) => {
    const sprite = new Sprite(texture)
    sprite.label = `${prefix}.particle-${index}`
    sprite.anchor.set(0.5)
    sprite.blendMode = 'add'
    sprite.alpha = 0
    parent.addChild(sprite)
    return sprite
  })
}

interface ActiveEffect {
  readonly timeline: gsap.core.Timeline
  finish(): void
}

/** Plays one saved visual while the presentation queue waits only for impact. */
export class MatchVfxPresenter {
  readonly layer = new Container()
  private readonly active = new Set<ActiveEffect>()

  constructor(
    private readonly assets: Pick<GameAssets, 'burnNoise' | 'playSpotlight1'>,
    private readonly timeline: () => gsap.core.Timeline
  ) {
    this.layer.label = 'game.vfx'
    this.layer.eventMode = 'none'
    this.layer.interactiveChildren = false
  }

  play(
    template: VfxTemplate,
    controllerIsLocal: boolean,
    source?: PointData,
    target?: PointData
  ): Promise<void> {
    const visual =
      template.family === 'missile'
        ? source && target
          ? this.makeMissile(template, source, target)
          : null
        : this.makeAoe(template, controllerIsLocal)
    if (!visual) return Promise.resolve()
    const seconds = template.tuning.durationMs / 1000
    const impact = template.family === 'missile' ? MISSILE_VFX_TIMING.arrival : 0.28
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
      timeline.call(resolveImpact, undefined, seconds * impact)
    })
  }

  dispose(): void {
    for (const effect of [...this.active]) {
      effect.timeline.kill()
      effect.finish()
    }
  }

  private makeMissile(
    template: Extract<VfxTemplate, { family: 'missile' }>,
    source: PointData,
    target: PointData
  ): { update(progress: number, seconds: number): void; dispose(): void } {
    const group = new Container()
    group.label = `game.vfx.${template.id}`
    const margin = MATCH_VFX_LAYOUT.missileMargin
    const left = Math.min(source.x, target.x) - margin
    const top = Math.min(source.y, target.y) - margin
    const width = Math.abs(target.x - source.x) + margin * 2
    const height = Math.abs(target.y - source.y) + margin * 2
    group.position.set(left, top)
    const shader = new MissileVfxShader(this.assets.burnNoise)
    shader.setPalette(template.tuning)
    shader.setTuning({
      intensity: template.tuning.intensity,
      noiseScale: template.tuning.noiseScale,
      flowSpeed: template.tuning.flowSpeed,
      turbulence: template.tuning.turbulence,
      width: template.tuning.missileWidth,
      trailLength: template.tuning.missileLength
    })
    shader.setGeometry(
      { width, height },
      { x: source.x - left, y: source.y - top },
      { x: target.x - left, y: target.y - top }
    )
    const sprite = new Sprite(Texture.WHITE)
    sprite.label = `${group.label}.shader`
    sprite.width = width
    sprite.height = height
    sprite.filters = [shader.filter]
    group.addChild(sprite)
    const sparks = particles(group, this.assets.playSpotlight1, group.label, 15)
    const tint = Number.parseInt(template.tuning.flameColor.slice(1), 16)
    for (const spark of sparks) spark.tint = tint
    this.layer.addChild(group)
    return {
      update(progress, seconds) {
        shader.setFrame(progress * seconds, progress)
        const post = clamp01(
          (progress - MISSILE_VFX_TIMING.arrival) / (1 - MISSILE_VFX_TIMING.arrival)
        )
        for (const [index, spark] of sparks.entries()) {
          if (progress < MISSILE_VFX_TIMING.arrival) {
            spark.alpha = 0
            continue
          }
          const angle = index * 2.39996
          const reach = (20 + ((index * 37) % 85)) * Math.sqrt(post)
          spark.position.set(
            target.x - left + Math.cos(angle) * reach,
            target.y - top + Math.sin(angle) * reach * 0.65 - post * 75
          )
          spark.alpha = Math.sin(post * Math.PI) * (1 - smoothstep(0.6, 1, post)) * 0.85
          spark.width = 3 + (index % 4)
          spark.height = spark.width * (1 + post)
          spark.rotation = angle
        }
      },
      dispose() {
        sprite.filters = null
        shader.dispose()
        group.removeFromParent()
        group.destroy({ children: true })
      }
    }
  }

  private makeAoe(
    template: Extract<VfxTemplate, { family: 'aoe' }>,
    controllerIsLocal: boolean
  ): { update(progress: number, seconds: number): void; dispose(): void } | null {
    const areas = matchVfxAreas(template.zones, controllerIsLocal)
    if (!areas.length) return null
    const group = new Container()
    group.label = `game.vfx.${template.id}`
    const boardShader = new AoeVfxShader(this.assets.burnNoise)
    const heroShader = new AoeVfxShader(this.assets.burnNoise)
    for (const shader of [boardShader, heroShader]) shader.setPalette(template.tuning)
    const tuning = {
      intensity: template.tuning.intensity,
      noiseScale: template.tuning.noiseScale,
      flowSpeed: template.tuning.flowSpeed,
      turbulence: template.tuning.turbulence,
      radius: template.tuning.aoeRadius,
      edgeSoftness: template.tuning.aoeEdgeSoftness,
      shape: template.tuning.aoeShape
    }
    boardShader.setTuning(tuning)
    heroShader.setTuning({ ...tuning, shape: 'radial', impact: true })
    const tint = Number.parseInt(template.tuning.flameColor.slice(1), 16)
    const views = areas.map((id) => {
      const placement = MATCH_VFX_LAYOUT.areas[id]
      const area = new Container()
      area.label = `${group.label}.${id}`
      area.position.set(placement.position.x, placement.position.y)
      const sprite = new Sprite(Texture.WHITE)
      sprite.label = `${area.label}.shader`
      sprite.anchor.set(0.5)
      sprite.width = placement.size.width
      sprite.height = placement.size.height
      sprite.filters = [id.endsWith('Hero') ? heroShader.filter : boardShader.filter]
      area.addChild(sprite)
      const sparks = particles(area, this.assets.playSpotlight1, area.label, 16)
      for (const spark of sparks) spark.tint = tint
      group.addChild(area)
      return { sprite, sparks, size: placement.size }
    })
    this.layer.addChild(group)
    return {
      update(progress, seconds) {
        boardShader.setFrame(progress * seconds, progress)
        heroShader.setFrame(progress * seconds + 1.7, progress)
        for (const { sparks, size } of views) {
          for (const [index, spark] of sparks.entries()) {
            const angle = (index / sparks.length) * Math.PI * 2
            const variation = 0.52 + ((index * 37) % 39) / 100
            const reach =
              variation * smoothstep(0.02, 0.65, progress) * template.tuning.aoeRadius
            spark.position.set(
              Math.cos(angle) * size.width * 0.44 * reach,
              Math.sin(angle) * size.height * 0.44 * reach
            )
            spark.alpha =
              Math.sin(progress * Math.PI) * (1 - smoothstep(0.6, 1, progress)) * 0.65
            const particleSize = 3 + ((index * 11) % 7) * (1 - progress * 0.38)
            spark.width = particleSize
            spark.height = particleSize
            spark.rotation = angle + progress * seconds
          }
        }
      },
      dispose() {
        for (const { sprite } of views) sprite.filters = null
        boardShader.dispose()
        heroShader.dispose()
        group.removeFromParent()
        group.destroy({ children: true })
      }
    }
  }
}
