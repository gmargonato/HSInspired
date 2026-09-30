import { Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import { AoeVfxShader } from '../../visual-components/effects/aoe-vfx-shader'
import {
  MissileVfxShader,
  MISSILE_VFX_TIMING
} from '../../visual-components/effects/missile-vfx-shader'
import type { GameAssets } from '../../visual-components/assets'
import { VfxLabControls } from './vfx-lab-controls'
import {
  DEFAULT_VFX_LAB_SETTINGS,
  AOE_ZONES,
  AOE_TARGET_PRESETS,
  AOE_REFERENCE_SETTINGS,
  getAoePreviewAreas,
  type AoePreviewAreaId,
  type AoeZoneId,
  type AoeTargetPreset,
  type VfxEffectId,
  type VfxLabSettingKey,
  type VfxLabSettingValue,
  type VfxLabSettings
} from './vfx-lab-model'
import { VFX_LAB_LAYOUT as LAYOUT } from './vfx-lab-layout'

interface VfxLabOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly assets: GameAssets
}

function colorValue(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16) || 0xffffff
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function makeMarker(label: string, color: number): Container {
  const marker = new Container()
  marker.label = label
  marker.eventMode = 'none'
  const glow = new Graphics()
  glow.circle(0, 0, 35).fill({ color, alpha: 0.12 })
  glow.label = label + '.glow'
  const ring = new Graphics()
  ring.circle(0, 0, 29).stroke({ color, alpha: 0.9, width: 3 })
  ring.circle(0, 0, 5).fill({ color, alpha: 0.95 })
  ring.label = label + '.ring'
  marker.addChild(glow, ring)
  return marker
}

function makeParticles(
  layer: Container,
  texture: Texture,
  prefix: string,
  count: number
): Sprite[] {
  const particles: Sprite[] = []
  for (let index = 0; index < count; index++) {
    const particle = new Sprite(texture)
    particle.label = prefix + '.particle-' + index
    particle.anchor.set(0.5)
    particle.blendMode = 'add'
    particle.alpha = 0
    particle.width = 10 + (index % 4) * 4
    particle.height = particle.width
    layer.addChild(particle)
    particles.push(particle)
  }
  return particles
}

/** Standalone, parameter-tunable preview for the first reusable VFX families. */
export class VfxLab extends Container {
  private readonly missileShader: MissileVfxShader
  private readonly aoeShader: AoeVfxShader
  private readonly aoeImpactShader: AoeVfxShader
  private readonly missileGroup = new Container()
  private readonly aoeGroup = new Container()
  private readonly missileSprite: Sprite
  private readonly aoeZones: {
    id: AoePreviewAreaId
    group: Container
    sprite: Sprite
    particles: Sprite[]
  }[] = []
  private readonly missileParticles: Sprite[]
  private readonly missileGuide = new Graphics()
  private readonly zoneLabels: Text[] = []
  private readonly missileSource: Container
  private readonly missileTarget: Container
  private readonly areaGuide: Graphics
  private readonly controls: VfxLabControls
  private readonly effectSettings: Record<VfxEffectId, VfxLabSettings> = {
    missile: { ...DEFAULT_VFX_LAB_SETTINGS },
    aoe: {
      ...DEFAULT_VFX_LAB_SETTINGS,
      ...AOE_REFERENCE_SETTINGS,
      aoeTarget: 'flamestrike'
    }
  }
  private get settings(): VfxLabSettings {
    return this.effectSettings[this.selectedEffect]
  }
  private set settings(settings: VfxLabSettings) {
    this.effectSettings[this.selectedEffect] = settings
  }
  private selectedEffect: VfxEffectId = 'missile'
  private elapsedMS = 0
  private clockSeconds = 0
  private loopDelayMS = -1
  private playing = false
  private looping = false
  private disposed = false

  constructor(options: VfxLabOptions) {
    super()
    this.label = 'vfx-lab.preview'
    this.eventMode = 'none'
    this.interactiveChildren = false

    const background = new Sprite(options.assets.boardBase)
    background.label = 'vfx-lab.board'
    background.eventMode = 'none'
    applyAnchoredPlacement(background, LAYOUT.board)
    this.addChild(background)

    const previewFrame = new Graphics()
    previewFrame.label = 'vfx-lab.preview-frame'
    previewFrame
      .rect(
        LAYOUT.previewPanel.position.x,
        LAYOUT.previewPanel.position.y,
        LAYOUT.previewPanel.size.width,
        LAYOUT.previewPanel.size.height
      )
      .stroke({ color: 0x68483e, alpha: 0.68, width: 2 })
    this.addChild(previewFrame)

    const missileGuide = this.missileGuide
    missileGuide.label = 'vfx-lab.missile.path'
    missileGuide.moveTo(
      LAYOUT.missile.source.position.x,
      LAYOUT.missile.source.position.y
    )
    missileGuide.lineTo(
      LAYOUT.missile.target.position.x,
      LAYOUT.missile.target.position.y
    )
    missileGuide.stroke({ color: 0xb79061, alpha: 0.26, width: 2 })
    this.addChild(missileGuide)

    this.missileSource = makeMarker('vfx-lab.missile.source', 0xe5bd74)
    this.missileTarget = makeMarker('vfx-lab.missile.target', 0xf5e6c8)
    applyPlacement(this.missileSource, LAYOUT.missile.source)
    applyPlacement(this.missileTarget, LAYOUT.missile.target)
    this.addChild(this.missileSource, this.missileTarget)

    this.areaGuide = new Graphics()
    this.areaGuide.label = 'vfx-lab.aoe.footprint'
    this.addChild(this.areaGuide)

    this.missileShader = new MissileVfxShader(options.assets.burnNoise)
    this.missileGroup.label = 'vfx-lab.missile.effect'
    this.missileSprite = new Sprite(Texture.WHITE)
    this.missileSprite.anchor.set(0)
    this.missileSprite.label = 'vfx-lab.missile.shader'
    this.missileSprite.filters = [this.missileShader.filter]
    this.missileGroup.addChild(this.missileSprite)
    this.missileParticles = makeParticles(
      this.missileGroup,
      options.assets.playSpotlight1,
      'vfx-lab.missile',
      15
    )
    this.addChild(this.missileGroup)

    this.aoeShader = new AoeVfxShader(options.assets.burnNoise)
    this.aoeImpactShader = new AoeVfxShader(options.assets.burnNoise)
    this.aoeGroup.label = 'vfx-lab.aoe.effect'
    for (const id of Object.keys(LAYOUT.aoe.blasts) as AoePreviewAreaId[]) {
      const zone = LAYOUT.aoe.blasts[id]
      const group = new Container()
      group.label = 'vfx-lab.aoe.' + id
      applyPlacement(group, zone)
      const sprite = new Sprite(Texture.WHITE)
      sprite.anchor.set(0.5)
      sprite.width = zone.size.width
      sprite.height = zone.size.height
      sprite.label = group.label + '.shader'
      sprite.filters = [
        id.endsWith('Hero') ? this.aoeImpactShader.filter : this.aoeShader.filter
      ]
      group.addChild(sprite)
      const particles = makeParticles(
        group,
        options.assets.playSpotlight1,
        group.label,
        16
      )
      this.aoeGroup.addChild(group)
      this.aoeZones.push({ id, group, sprite, particles })
    }
    for (const { key: id, label } of AOE_ZONES) {
      const zone = LAYOUT.aoe.zones[id]
      const caption = new Text({
        text: label,
        style: { fontFamily: 'Segoe UI', fontSize: 15, fill: 0xffe6b2 }
      })
      caption.label = 'vfx-lab.aoe.' + id + '.label'
      caption.position.set(
        zone.position.x - zone.size.width / 2 + 12,
        zone.position.y - zone.size.height / 2 + 5
      )
      this.zoneLabels.push(caption)
      this.aoeGroup.addChild(caption)
    }
    this.addChild(this.aoeGroup)

    this.controls = new VfxLabControls(
      options.canvas,
      options.renderer,
      options.parent,
      {
        select: (effect) => this.selectEffect(effect),
        change: (key, value) => this.changeSetting(key, value),
        play: () => this.play(),
        loop: (enabled) => this.setLooping(enabled)
      }
    )
    this.applySettings()
    this.setEffectVisibility()
    this.controls.refresh(this.selectedEffect, this.settings, false, this.looping)
    this.play()
  }

  update(deltaMS: number): void {
    if (this.disposed) return
    const delta = Math.max(0, Math.min(deltaMS, 100))
    this.clockSeconds += delta / 1000
    if (this.playing) {
      this.elapsedMS += delta
      if (this.elapsedMS >= this.settings.durationMs) {
        this.elapsedMS = this.settings.durationMs
        this.playing = false
        this.loopDelayMS = this.looping ? LAYOUT.loopPauseMS : -1
        this.controls.refresh(this.selectedEffect, this.settings, false, this.looping)
      }
    } else if (this.looping && this.loopDelayMS >= 0) {
      this.loopDelayMS -= delta
      if (this.loopDelayMS <= 0) this.play()
    }

    const progress = clamp01(this.elapsedMS / Math.max(1, this.settings.durationMs))
    this.updateMissile(progress)
    this.updateAoe(progress)
  }

  setControlsVisible(visible: boolean): void {
    this.controls.setVisible(visible)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.controls.dispose()
    this.missileSprite.filters = null
    for (const zone of this.aoeZones) zone.sprite.filters = null
    this.missileShader.dispose()
    this.aoeShader.dispose()
    this.aoeImpactShader.dispose()
  }

  private selectEffect(effect: VfxEffectId): void {
    if (this.disposed || this.selectedEffect === effect) return
    this.selectedEffect = effect
    this.applySettings()
    this.setEffectVisibility()
    this.play()
  }

  private changeSetting(key: VfxLabSettingKey, value: VfxLabSettingValue): void {
    this.settings = { ...this.settings, [key]: value } as VfxLabSettings
    if (key === 'aoeTarget' && value !== 'custom') {
      const preset = AOE_TARGET_PRESETS[value as Exclude<AoeTargetPreset, 'custom'>]
      if ('reference' in preset)
        this.settings = { ...this.settings, ...AOE_REFERENCE_SETTINGS }
      for (const { key: zone } of AOE_ZONES) {
        this.settings[zone] = (preset.zones as readonly AoeZoneId[]).includes(zone)
      }
    } else if (AOE_ZONES.some(({ key: zone }) => zone === key)) {
      this.settings.aoeTarget = 'custom'
    }
    this.applySettings()
    this.setEffectVisibility()
    if (!this.playing) this.play()
    this.controls.refresh(
      this.selectedEffect,
      this.settings,
      this.playing,
      this.looping
    )
  }

  private setLooping(enabled: boolean): void {
    this.looping = enabled
    if (!enabled) this.loopDelayMS = -1
    else if (!this.playing) this.play()
    this.controls.refresh(
      this.selectedEffect,
      this.settings,
      this.playing,
      this.looping
    )
  }

  private play(): void {
    if (this.disposed) return
    this.elapsedMS = 0
    this.loopDelayMS = -1
    this.playing = true
    this.setEffectVisibility()
    this.controls.refresh(this.selectedEffect, this.settings, true, this.looping)
  }

  private applySettings(): void {
    const palette = {
      flameColor: this.settings.flameColor,
      coreColor: this.settings.coreColor
    }
    this.missileShader.setPalette(palette)
    this.missileShader.setTuning({
      intensity: this.settings.intensity,
      noiseScale: this.settings.noiseScale,
      flowSpeed: this.settings.flowSpeed,
      turbulence: this.settings.turbulence,
      width: this.settings.missileWidth,
      trailLength: this.settings.missileLength
    })
    this.aoeShader.setPalette(palette)
    this.aoeImpactShader.setPalette(palette)
    const aoeTuning = {
      intensity: this.settings.intensity,
      noiseScale: this.settings.noiseScale,
      flowSpeed: this.settings.flowSpeed,
      turbulence: this.settings.turbulence,
      radius: this.settings.aoeRadius,
      edgeSoftness: this.settings.aoeEdgeSoftness,
      shape: this.settings.aoeShape
    }
    this.aoeShader.setTuning(aoeTuning)
    this.aoeImpactShader.setTuning({ ...aoeTuning, shape: 'radial', impact: true })
    const source = LAYOUT.missile.source.position
    const target = LAYOUT.missile.target.position
    const margin = LAYOUT.missile.margin
    const left = Math.min(source.x, target.x) - margin
    const top = Math.min(source.y, target.y) - margin
    const width = Math.abs(target.x - source.x) + margin * 2
    const height = Math.abs(target.y - source.y) + margin * 2
    this.missileGroup.position.set(left, top)
    this.missileSprite.width = width
    this.missileSprite.height = height
    this.missileShader.setGeometry(
      { width, height },
      { x: source.x - left, y: source.y - top },
      { x: target.x - left, y: target.y - top }
    )
    for (const particle of [
      ...this.missileParticles,
      ...this.aoeZones.flatMap((zone) => zone.particles)
    ])
      particle.tint = colorValue(this.settings.flameColor)
    this.drawAoeGuide()
  }

  private setEffectVisibility(): void {
    const missile = this.selectedEffect === 'missile'
    this.missileGuide.visible = missile && this.settings.showTargetGuides
    this.missileGroup.visible = missile
    this.missileSource.visible = missile && this.settings.showTargetGuides
    this.missileTarget.visible = missile && this.settings.showTargetGuides
    this.aoeGroup.visible = !missile
    this.areaGuide.visible = !missile && this.settings.showTargetGuides
  }

  private updateMissile(progress: number): void {
    const active = this.playing && this.selectedEffect === 'missile'
    this.missileGroup.visible = this.selectedEffect === 'missile'
    this.missileSprite.visible = active
    // Time is local to each cast, so replaying the reference is deterministic.
    this.missileShader.setFrame(this.elapsedMS / 1000, active ? progress : 1)
    const target = LAYOUT.missile.target.position
    const post = clamp01(
      (progress - MISSILE_VFX_TIMING.arrival) / (1 - MISSILE_VFX_TIMING.arrival)
    )
    for (let index = 0; index < this.missileParticles.length; index++) {
      const particle = this.missileParticles[index]!
      if (!active || progress < MISSILE_VFX_TIMING.arrival) {
        particle.alpha = 0
        continue
      }
      const angle = index * 2.39996
      const reach = (20 + ((index * 37) % 85)) * Math.sqrt(post)
      particle.position.set(
        target.x - this.missileGroup.x + Math.cos(angle) * reach,
        target.y - this.missileGroup.y + Math.sin(angle) * reach * 0.65 - post * 75
      )
      particle.alpha = Math.sin(post * Math.PI) * (1 - smoothstep(0.6, 1, post)) * 0.85
      particle.width = 3 + (index % 4)
      particle.height = particle.width * (1.0 + post)
      particle.rotation = angle
    }
  }

  private updateAoe(progress: number): void {
    const active = this.playing && this.selectedEffect === 'aoe'
    this.aoeGroup.visible = this.selectedEffect === 'aoe'
    this.aoeShader.setFrame(this.clockSeconds, active ? progress : 1)
    this.aoeImpactShader.setFrame(this.clockSeconds + 1.7, active ? progress : 1)
    this.areaGuide.visible =
      this.selectedEffect === 'aoe' && this.settings.showTargetGuides
    const areas = getAoePreviewAreas(this.settings)
    for (const zone of this.aoeZones) {
      zone.group.visible = areas.includes(zone.id)
      zone.sprite.visible = active
      const size = LAYOUT.aoe.blasts[zone.id].size
      for (let index = 0; index < zone.particles.length; index++) {
        const particle = zone.particles[index]!
        if (!active) {
          particle.alpha = 0
          continue
        }
        const angle = (index / zone.particles.length) * Math.PI * 2
        const variation = 0.52 + ((index * 37) % 39) / 100
        const reach =
          variation * smoothstep(0.02, 0.65, progress) * this.settings.aoeRadius
        particle.position.set(
          Math.cos(angle) * size.width * 0.44 * reach,
          Math.sin(angle) * size.height * 0.44 * reach
        )
        particle.alpha =
          Math.sin(progress * Math.PI) * (1 - smoothstep(0.6, 1, progress)) * 0.65
        const particleSize = 3 + ((index * 11) % 7) * (1 - progress * 0.38)
        particle.width = particleSize
        particle.height = particleSize
        particle.rotation = angle + this.clockSeconds
      }
    }
  }

  private drawAoeGuide(): void {
    this.areaGuide.clear()
    for (const [index, { key: id }] of AOE_ZONES.entries()) {
      const zone = LAYOUT.aoe.zones[id]
      const enabled = this.settings[id]
      const color = enabled ? 0xffcd81 : 0x9faebf
      this.areaGuide
        .roundRect(
          zone.position.x - zone.size.width / 2,
          zone.position.y - zone.size.height / 2,
          zone.size.width,
          zone.size.height,
          18
        )
        .fill({ color, alpha: enabled ? 0.035 : 0.015 })
        .stroke({ color, alpha: enabled ? 0.55 : 0.18, width: enabled ? 2 : 1 })
      this.zoneLabels[index]!.alpha = enabled ? 0.95 : 0.4
      this.zoneLabels[index]!.visible = this.settings.showTargetGuides
    }
  }
}
