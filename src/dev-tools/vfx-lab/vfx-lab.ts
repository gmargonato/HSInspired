import { Container, Graphics, Sprite, type Renderer } from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import {
  FireAoeEffect,
  type FireAoeTarget
} from '../../visual-components/effects/fire-aoe-effect'
import { FireAoeResources } from '../../visual-components/effects/fire-aoe-materials'
import { FireballEffect } from '../../visual-components/effects/fireball-effect'
import { AnimationScope } from '../../visual-components/animation/animations'
import { ImpactShakeController } from '../../visual-components/animation/impact-shake'
import type { GameAssets } from '../../visual-components/assets'
import {
  getVfxTemplateLibrary,
  updateVfxTemplateLibrary
} from '../../visual-components/effects/vfx-templates'
import type { VfxTemplate } from '../../desktop/contracts/ipc/vfx-templates'
import { VfxLabControls } from './vfx-lab-controls'
import {
  DEFAULT_VFX_LAB_SETTINGS,
  createTemplateFromSettings,
  settingsFromTemplate,
  templateFromSettings,
  type VfxEffectId,
  type VfxLabSettingKey,
  type VfxLabSettingValue,
  type VfxLabSettings
} from './vfx-lab-model'
import { VFX_LAB_LAYOUT as LAYOUT } from './vfx-lab-layout'
import { HealingEffect } from '../../visual-components/effects/healing-effect'
import type { HealingAssets } from '../../visual-components/assets/healing-assets'
import { healingPreview } from './healing-preview'

interface VfxLabOptions {
  readonly canvas: HTMLCanvasElement
  readonly renderer: Renderer
  readonly parent: HTMLElement
  readonly assets: GameAssets
  readonly healingAssets: HealingAssets
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

/** Standalone, parameter-tunable preview for the first reusable VFX families. */
export class VfxLab extends Container {
  private readonly animations = new AnimationScope()
  private readonly impactShake = new ImpactShakeController(this, this.animations)
  private impactTriggered = false
  private missileEffect?: FireballEffect
  private readonly fireResources: FireAoeResources
  private fireEffect?: FireAoeEffect
  private healingEffect?: HealingEffect
  private paused = false
  private readonly excludedRecipients = new Set<string>()
  private readonly healSource = { ...LAYOUT.missile.source.position }
  private readonly healTarget = { ...LAYOUT.missile.target.position }
  private dragging: 'source' | 'target' | null = null
  private readonly fireTargets = new Graphics()
  private get playbackDurationMS(): number {
    return (
      (this.healingEffect?.duration ??
        this.fireEffect?.duration ??
        this.missileEffect?.duration ??
        this.settings.durationMs / 1000) * 1000
    )
  }
  private readonly missileGroup = new Container()
  private readonly missileGuide = new Graphics()
  private readonly missileSource: Container
  private readonly missileTarget: Container
  private readonly controls: VfxLabControls
  private templates: VfxTemplate[] = structuredClone([
    ...getVfxTemplateLibrary().templates
  ])
  private selectedTemplateId: string | null =
    this.templates.find((template) => template.family === 'missile')?.id ?? null
  private revision = 0
  private savedRevision = 0
  private saving = false
  private saveMessage = ''
  private readonly effectSettings: Record<VfxEffectId, VfxLabSettings> = {
    missile: { ...DEFAULT_VFX_LAB_SETTINGS },
    aoe: { ...DEFAULT_VFX_LAB_SETTINGS },
    'heal-aoe': {
      ...DEFAULT_VFX_LAB_SETTINGS,
      showTargetGuides: true,
      enemyBoard: false,
      enemyHero: false,
      friendlyBoard: true,
      friendlyHero: true
    },
    'heal-target': { ...DEFAULT_VFX_LAB_SETTINGS, showTargetGuides: true }
  }
  private get settings(): VfxLabSettings {
    return this.effectSettings[this.selectedEffect]
  }
  private set settings(settings: VfxLabSettings) {
    this.effectSettings[this.selectedEffect] = settings
  }
  private selectedEffect: VfxEffectId = 'missile'
  private get selectedTemplate(): VfxTemplate | undefined {
    return this.templates.find((template) => template.id === this.selectedTemplateId)
  }
  private elapsedMS = 0
  private clockSeconds = 0
  private loopDelayMS = -1
  private playing = false
  private looping = false
  private disposed = false

  constructor(private readonly options: VfxLabOptions) {
    super()
    this.label = 'vfx-lab.preview'
    this.eventMode = 'none'
    this.interactiveChildren = false

    const background = new Sprite(options.assets.boardBase)
    background.label = 'vfx-lab.board'
    background.eventMode = 'none'
    applyAnchoredPlacement(background, LAYOUT.board)
    this.addChild(background)

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

    this.missileGroup.label = 'vfx-lab.missile.effect'
    this.addChild(this.missileGroup)

    this.fireResources = new FireAoeResources(options.renderer, options.assets)
    this.fireTargets.label = 'vfx-lab.fire-targets'
    this.addChild(this.fireTargets)

    this.controls = new VfxLabControls(
      options.canvas,
      options.renderer,
      options.parent,
      {
        select: (effect) => this.selectEffect(effect),
        selectTemplate: (id) => this.selectTemplate(id),
        createTemplate: () => this.createTemplate(),
        deleteTemplate: () => this.deleteTemplate(),
        renameTemplate: (name) => this.renameTemplate(name),
        saveTemplates: () => void this.saveTemplates(),
        change: (key, value) => this.changeSetting(key, value),
        play: () => this.play(),
        pause: () => {
          this.paused = !this.paused
          this.refreshControls()
        },
        reset: () => this.resetHealing(),
        coverage: (zones) => {
          for (const key of [
            'friendlyBoard',
            'enemyBoard',
            'friendlyHero',
            'enemyHero'
          ] as const)
            this.settings[key] = zones.includes(key)
          if (this.selectedTemplate)
            this.replaceSelectedTemplate(
              templateFromSettings(this.selectedTemplate, this.settings)
            )
          this.markDirty()
          this.play()
        },
        loop: (enabled) => this.setLooping(enabled)
      }
    )
    this.loadSelectedTemplate()
    options.canvas.addEventListener('pointerdown', this.pointerDown)
    options.canvas.addEventListener('pointermove', this.pointerMove)
    options.canvas.addEventListener('pointerup', this.pointerUp)
    options.canvas.addEventListener('pointercancel', this.pointerUp)
    this.setEffectVisibility()
    this.refreshControls()
    this.play()
  }

  update(deltaMS: number): void {
    if (this.disposed || this.paused) return
    const delta = Math.max(0, Math.min(deltaMS, 100))
    this.clockSeconds += delta / 1000
    if (this.playing) {
      this.elapsedMS += delta
      if (this.elapsedMS >= this.playbackDurationMS) {
        this.elapsedMS = this.playbackDurationMS
        this.playing = false
        this.loopDelayMS = this.looping ? LAYOUT.loopPauseMS : -1
        this.refreshControls()
      }
    } else if (this.looping && this.loopDelayMS >= 0) {
      this.loopDelayMS -= delta
      if (this.loopDelayMS <= 0) this.play()
    }

    this.updateMissile()
    this.updateAoe()
    this.healingEffect?.update(this.elapsedMS / 1000)
    this.updateImpactShake()
  }

  setControlsVisible(visible: boolean): void {
    this.controls.setVisible(visible)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.impactShake.dispose()
    this.animations.kill()
    this.fireEffect?.dispose()
    this.healingEffect?.dispose()
    this.options.canvas.removeEventListener('pointerdown', this.pointerDown)
    this.options.canvas.removeEventListener('pointermove', this.pointerMove)
    this.options.canvas.removeEventListener('pointerup', this.pointerUp)
    this.options.canvas.removeEventListener('pointercancel', this.pointerUp)
    this.fireResources.destroy()
    this.controls.dispose()
    this.missileEffect?.dispose()
  }

  private selectEffect(effect: VfxEffectId): void {
    if (this.disposed || this.selectedEffect === effect) return
    this.dragging = null
    this.selectedEffect = effect
    this.selectedTemplateId =
      this.templates.find((template) => template.family === effect)?.id ?? null
    this.loadSelectedTemplate()
    this.setEffectVisibility()
    this.play()
    this.refreshControls()
  }

  private selectTemplate(id: string): void {
    const template = this.templates.find((candidate) => candidate.id === id)
    if (!template || template.family !== this.selectedEffect) return
    this.selectedTemplateId = id
    this.loadSelectedTemplate()
    this.play()
    this.refreshControls()
  }

  private loadSelectedTemplate(): void {
    const template = this.selectedTemplate
    if (template)
      this.settings = settingsFromTemplate(template, this.settings.showTargetGuides)
    else
      this.settings = {
        ...DEFAULT_VFX_LAB_SETTINGS,
        ...(this.selectedEffect === 'heal-aoe'
          ? {
              enemyBoard: false,
              enemyHero: false,
              friendlyBoard: true,
              friendlyHero: true
            }
          : {})
      }
  }

  private replaceSelectedTemplate(template: VfxTemplate): void {
    const index = this.templates.findIndex((item) => item.id === template.id)
    if (index >= 0) this.templates[index] = template
  }

  private uniqueId(base: string): string {
    const slug =
      base
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'effect'
    let id = slug
    let suffix = 2
    while (this.templates.some((template) => template.id === id))
      id = `${slug}-${suffix++}`
    return id
  }

  private createTemplate(): void {
    const selected = this.selectedTemplate
    let template: VfxTemplate
    if (selected) {
      const name = `${selected.name} copy`
      template = { ...structuredClone(selected), id: this.uniqueId(name), name }
    } else {
      const name =
        this.selectedEffect === 'heal-aoe'
          ? 'New mass heal'
          : this.selectedEffect === 'heal-target'
            ? 'New target heal'
            : this.selectedEffect === 'aoe'
              ? 'New AoE effect'
              : 'New missile effect'
      const id = this.uniqueId(name)
      template = createTemplateFromSettings(
        id,
        name,
        this.selectedEffect,
        this.settings
      )
    }
    this.templates.push(template)
    this.selectedTemplateId = template.id
    this.loadSelectedTemplate()
    this.markDirty()
    this.play()
    this.refreshControls()
  }

  private deleteTemplate(): void {
    const selected = this.selectedTemplate
    if (!selected || !window.confirm(`Delete effect "${selected.name}"?`)) return
    this.templates = this.templates.filter((template) => template.id !== selected.id)
    this.selectedTemplateId =
      this.templates.find((template) => template.family === this.selectedEffect)?.id ??
      null
    this.loadSelectedTemplate()
    this.markDirty()
    this.setEffectVisibility()
    this.playing = false
    this.play()
    this.refreshControls()
  }

  private renameTemplate(name: string): void {
    const selected = this.selectedTemplate
    if (!selected) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === selected.name) {
      this.refreshControls()
      return
    }
    this.replaceSelectedTemplate({ ...selected, name: trimmed })
    this.markDirty()
    this.refreshControls()
  }

  private markDirty(): void {
    this.revision++
    this.saveMessage = ''
  }

  private refreshControls(): void {
    this.controls.refresh(
      this.selectedEffect,
      this.settings,
      this.playing,
      this.looping,
      this.templates,
      this.selectedTemplateId,
      this.revision !== this.savedRevision,
      this.saving,
      this.saveMessage,
      this.paused
    )
  }

  private async saveTemplates(): Promise<void> {
    if (this.saving || this.revision === this.savedRevision) return
    const save = window.api.vfxTemplates?.save
    if (!save) {
      this.saveMessage = 'Save unavailable: development VFX API is missing.'
      this.refreshControls()
      return
    }
    const revision = this.revision
    const snapshot = { version: 1 as const, templates: structuredClone(this.templates) }
    this.saving = true
    this.saveMessage = 'Saving effects…'
    this.refreshControls()
    try {
      await save(snapshot)
      updateVfxTemplateLibrary(snapshot)
      this.savedRevision = revision
      this.saveMessage =
        this.revision === revision
          ? 'Effects saved.'
          : 'Earlier edits saved; newer changes remain unsaved.'
    } catch (error) {
      console.error('[VfxLab] Failed to save effects.', error)
      this.saveMessage = 'Save failed. Changes remain unsaved; retry Save.'
    } finally {
      this.saving = false
      if (!this.disposed) this.refreshControls()
    }
  }

  private changeSetting(key: VfxLabSettingKey, value: VfxLabSettingValue): void {
    if (!this.selectedTemplate) return
    this.settings = { ...this.settings, [key]: value } as VfxLabSettings
    this.replaceSelectedTemplate(
      templateFromSettings(this.selectedTemplate, this.settings)
    )
    if (
      key !== 'showTargetGuides' &&
      key !== 'previewMinions' &&
      key !== 'opponentCaster'
    )
      this.markDirty()
    this.setEffectVisibility()
    this.play()
    this.refreshControls()
  }

  private setLooping(enabled: boolean): void {
    this.looping = enabled
    if (!enabled) this.loopDelayMS = -1
    else if (!this.playing) this.play()
    this.refreshControls()
  }

  private play(): void {
    this.paused = false
    this.healingEffect?.dispose()
    this.healingEffect = undefined
    this.impactShake.reset()
    this.impactTriggered = false
    this.missileEffect?.dispose()
    this.missileEffect = undefined
    this.fireEffect?.dispose()
    this.fireEffect = undefined
    this.fireTargets.clear()
    if (this.disposed || !this.selectedTemplate) return
    const template = this.selectedTemplate
    if (template.family === 'heal-aoe' || template.family === 'heal-target') {
      const preview = healingPreview(this.settings, this.excludedRecipients)
      const source = this.settings.opponentCaster ? this.healTarget : this.healSource,
        target = this.settings.opponentCaster ? this.healSource : this.healTarget
      this.healingEffect = new HealingEffect(this.options.healingAssets, {
        family: template.family,
        tuning: template.tuning,
        source,
        target,
        ...preview
      })
      this.addChild(this.healingEffect.container)
      if (template.family === 'heal-aoe')
        for (const p of preview.candidates)
          this.fireTargets.circle(p.x, p.y, 24).stroke({
            color: this.excludedRecipients.has(p.id) ? 0x777777 : 0x86ffaf,
            width: 2,
            alpha: 0.9
          })
      this.addChild(this.fireTargets, this.missileSource, this.missileTarget)
    } else if (template.family === 'missile') {
      this.missileEffect = new FireballEffect(
        this.options.renderer,
        this.options.assets,
        {
          source: LAYOUT.missile.source.position,
          target: LAYOUT.missile.target.position,
          tuning: template.tuning
        }
      )
      this.missileGroup.addChild(this.missileEffect.container)
    } else if (template.family === 'aoe') {
      const flip = this.settings.opponentCaster
      const enemyBoard = flip ? this.settings.friendlyBoard : this.settings.enemyBoard
      const friendlyBoard = flip
        ? this.settings.enemyBoard
        : this.settings.friendlyBoard
      const board =
        enemyBoard && friendlyBoard
          ? 'bothBoards'
          : enemyBoard
            ? 'enemyBoard'
            : friendlyBoard
              ? 'friendlyBoard'
              : undefined
      const targets: FireAoeTarget[] = []
      for (const [enabled, id] of [
        [enemyBoard, 'enemyBoard'],
        [friendlyBoard, 'friendlyBoard']
      ] as const) {
        if (!enabled) continue
        const center = LAYOUT.aoe.zones[id].position
        const count = Math.min(
          LAYOUT.aoe.previewTargets.maxPerRow,
          this.settings.previewMinions
        )
        for (let i = 0; i < count; i++)
          targets.push({
            kind: 'minion',
            x: center.x + (i - (count - 1) / 2) * LAYOUT.aoe.previewTargets.gap,
            y: center.y
          })
      }
      if (this.settings.enemyHero)
        targets.push({
          ...LAYOUT.aoe.zones[flip ? 'friendlyHero' : 'enemyHero'].position,
          kind: 'hero'
        })
      if (this.settings.friendlyHero)
        targets.push({
          ...LAYOUT.aoe.zones[flip ? 'enemyHero' : 'friendlyHero'].position,
          kind: 'hero'
        })
      this.fireEffect = new FireAoeEffect(this.fireResources, {
        area: board
          ? {
              coverage:
                board === 'bothBoards'
                  ? 'full'
                  : board === 'enemyBoard'
                    ? 'opponent'
                    : 'friendly',
              placement: LAYOUT.aoe.blasts[board]
            }
          : undefined,
        targets,
        tuning: template.tuning.fire,
        intensity: template.tuning.intensity
      })
      this.addChild(this.fireEffect.container)
      for (const target of targets)
        this.fireTargets
          .circle(target.x, target.y, 24)
          .stroke({ color: 0xffe2a0, width: 2, alpha: 0.8 })
      this.fireEffect.update(0)
    }
    this.elapsedMS = 0
    this.loopDelayMS = -1
    this.playing = true
    this.updateImpactShake()
    this.setEffectVisibility()
    this.refreshControls()
  }

  private setEffectVisibility(): void {
    const healing = this.selectedEffect === 'heal-target'
    const source = healing
      ? this.settings.opponentCaster
        ? this.healTarget
        : this.healSource
      : LAYOUT.missile.source.position
    const target = healing
      ? this.settings.opponentCaster
        ? this.healSource
        : this.healTarget
      : LAYOUT.missile.target.position
    this.missileSource.position.copyFrom(source)
    this.missileTarget.position.copyFrom(target)
    const dx = target.x - source.x
    const dy = target.y - source.y
    const bend =
      (healing ? this.settings.healCurvature : this.settings.pathCurvature) * 0.5
    this.missileGuide
      .clear()
      .moveTo(source.x, source.y)
      .quadraticCurveTo(
        (source.x + target.x) / 2 - dy * bend,
        (source.y + target.y) / 2 + dx * bend,
        target.x,
        target.y
      )
      .stroke({ color: 0xb79061, alpha: 0.26, width: 2 })
    const missile = this.selectedEffect === 'missile' || healing
    this.missileGuide.visible =
      missile && !!this.selectedTemplate && this.settings.showTargetGuides
    this.missileGroup.visible = missile && !!this.selectedTemplate
    this.missileSource.visible =
      missile && !!this.selectedTemplate && this.settings.showTargetGuides
    this.missileTarget.visible =
      missile && !!this.selectedTemplate && this.settings.showTargetGuides
    this.fireTargets.visible =
      !missile && !!this.selectedTemplate && this.settings.showTargetGuides
  }

  private updateMissile(): void {
    this.missileGroup.visible =
      this.selectedEffect === 'missile' && !!this.selectedTemplate
    this.missileEffect?.update(this.elapsedMS / 1000)
  }

  private updateAoe(): void {
    this.fireEffect?.update(this.elapsedMS / 1000)
  }

  private updateImpactShake(): void {
    if (this.impactTriggered || !this.selectedTemplate) return
    const template = this.selectedTemplate
    if (template.family === 'heal-aoe' || template.family === 'heal-target') return
    const impact =
      template.family === 'missile'
        ? this.missileEffect?.impactSeconds
        : this.fireEffect && template.zones.length
          ? Math.min(this.fireEffect.duration, (template.tuning.impactMs ?? 500) / 1000)
          : undefined
    if (impact === undefined || this.elapsedMS / 1000 + 1e-9 < impact) return
    this.impactTriggered = true
    if (this.settings.impactShakeEnabled)
      this.impactShake.trigger(this.settings.shakeIntensity)
  }

  private resetHealing(): void {
    if (!this.selectedEffect.startsWith('heal-') || !this.selectedTemplate) return
    this.settings = {
      ...DEFAULT_VFX_LAB_SETTINGS,
      showTargetGuides: true,
      enemyBoard: false,
      enemyHero: false,
      friendlyBoard: true,
      friendlyHero: true
    }
    this.excludedRecipients.clear()
    Object.assign(this.healSource, LAYOUT.missile.source.position)
    Object.assign(this.healTarget, LAYOUT.missile.target.position)
    this.replaceSelectedTemplate(
      templateFromSettings(this.selectedTemplate, this.settings)
    )
    this.markDirty()
    this.play()
  }
  private pointerPosition(event: PointerEvent) {
    const rect = this.options.canvas.getBoundingClientRect()
    return this.toLocal({
      x:
        ((event.clientX - rect.left) * this.options.renderer.screen.width) / rect.width,
      y:
        ((event.clientY - rect.top) * this.options.renderer.screen.height) / rect.height
    })
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.settings.showTargetGuides) return
    const p = this.pointerPosition(event)
    if (this.selectedEffect === 'heal-aoe') {
      const target = healingPreview(
        this.settings,
        this.excludedRecipients
      ).candidates.find((t) => Math.hypot(t.x - p.x, t.y - p.y) < 30)
      if (target) {
        if (this.excludedRecipients.has(target.id))
          this.excludedRecipients.delete(target.id)
        else this.excludedRecipients.add(target.id)
        this.play()
      }
    } else if (this.selectedEffect === 'heal-target') {
      this.dragging =
        Math.hypot(p.x - this.healSource.x, p.y - this.healSource.y) < 40
          ? 'source'
          : Math.hypot(p.x - this.healTarget.x, p.y - this.healTarget.y) < 40
            ? 'target'
            : null
      if (this.dragging) this.options.canvas.setPointerCapture(event.pointerId)
    }
  }
  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return
    const p = this.pointerPosition(event),
      panel = LAYOUT.previewPanel
    Object.assign(this.dragging === 'source' ? this.healSource : this.healTarget, {
      x: Math.max(panel.position.x, Math.min(panel.position.x + panel.size.width, p.x)),
      y: Math.max(panel.position.y, Math.min(panel.position.y + panel.size.height, p.y))
    })
    this.play()
  }
  private readonly pointerUp = (event: PointerEvent): void => {
    this.dragging = null
    if (this.options.canvas.hasPointerCapture(event.pointerId))
      this.options.canvas.releasePointerCapture(event.pointerId)
  }
}
