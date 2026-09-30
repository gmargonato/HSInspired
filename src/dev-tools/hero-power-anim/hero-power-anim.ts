import type { Renderer, Texture } from 'pixi.js'
import { HERO_POWER_CATALOG } from '../../game-rules/content/hero-powers'
import { Actor } from '../../visual-components/lifecycle/actor'
import type {
  GameAssets,
  HeroAssets,
  HeroPowerAssetKey
} from '../../visual-components/assets'
import { BoardShadowLayer } from '../../scenes/match/board/board-shadow-layer'
import { HeroPowerView } from '../../scenes/match/board/hero-power-view'
import {
  HeroPowerEffectsPresenter,
  hasHeroPowerEffect
} from '../../scenes/match/board/hero-power-effects-presenter'
import { HeroPowerAnimFixtures } from './hero-power-anim-fixtures'
import { HeroPowerAnimControls } from './hero-power-anim-controls'
import {
  PREVIEW_LOCAL,
  defaultPreviewTarget,
  previewTargets,
  type PreviewTarget
} from './hero-power-anim-model'
import { HERO_POWER_ANIM_LAYOUT as LAYOUT } from './hero-power-anim-layout'

interface HeroPowerAnimOptions {
  canvas: HTMLCanvasElement
  renderer: Renderer
  parent: HTMLElement
  assets: GameAssets
  heroes: HeroAssets
}

/** One isolated playback at a time, sharing the match's effect implementation. */
export class HeroPowerAnim extends Actor {
  private readonly board: HeroPowerAnimFixtures
  private readonly shadows: BoardShadowLayer
  private readonly controls: HeroPowerAnimControls
  private power?: HeroPowerView
  private presenter?: HeroPowerEffectsPresenter
  private selected = HERO_POWER_CATALOG.require('warrior-armor-up')
  private target?: PreviewTarget
  private generation = 0
  private busy = true
  private looping = false
  private repeatInMS: number | null = null
  private disposed = false
  private mounted = false
  private hasPlayed = false
  private error?: string

  constructor(private readonly options: HeroPowerAnimOptions) {
    super()
    this.label = 'hero-power-anim.preview'
    this.board = new HeroPowerAnimFixtures(options.assets, options.heroes)
    this.shadows = new BoardShadowLayer(this.board, options.renderer)
    this.board.addChildAt(this.shadows, 1)
    this.addChild(this.board)
    this.controls = new HeroPowerAnimControls(
      options.canvas,
      options.renderer,
      options.parent,
      {
        select: (id) => {
          void this.select(id)
        },
        play: () => {
          void this.play()
        },
        loop: (enabled) => {
          this.looping = enabled
          if (!enabled) this.repeatInMS = null
          else if (!this.busy) void this.play()
          this.refresh()
        }
      }
    )
    this.refresh()
  }

  async mount(artwork: Texture): Promise<void> {
    await this.board.mount(artwork, (target) => {
      if (
        this.busy ||
        !previewTargets(this.selected).some(({ key }) => key === target.key)
      )
        return
      this.target = target
      this.refresh()
    })
    if (!this.disposed) {
      this.mounted = true
      await this.select(this.selected.id)
    }
  }

  private async select(id: string): Promise<void> {
    if (this.disposed || !this.mounted) return
    const token = ++this.generation
    this.selected = HERO_POWER_CATALOG.require(id)
    this.target = defaultPreviewTarget(this.selected)
    this.looping = false
    this.repeatInMS = null
    this.busy = true
    this.error = undefined
    this.refresh()
    try {
      await this.cancelPlayback()
      if (this.disposed || token !== this.generation) return
      this.board.setPower(this.selected)
      this.preparePower()
    } catch (error) {
      if (!this.disposed && token === this.generation) this.error = String(error)
    } finally {
      if (!this.disposed && token === this.generation) {
        this.busy = false
        this.refresh()
      }
    }
  }

  private async play(): Promise<void> {
    if (this.disposed || this.busy || !hasHeroPowerEffect(this.selected.id)) return
    const token = ++this.generation
    this.busy = true
    this.repeatInMS = null
    this.error = undefined
    this.refresh()
    try {
      if (this.hasPlayed) {
        await this.cancelPlayback()
        if (this.disposed || token !== this.generation) return
        this.preparePower()
      }
      this.hasPlayed = true
      const presenter = this.presenter!
      await presenter.play({
        participantId: PREVIEW_LOCAL,
        heroPowerId: this.selected.id,
        ...(this.selected.targeting !== 'none' && this.target
          ? { target: this.target.target }
          : {})
      })
      await presenter.finish()
    } catch (error) {
      if (!this.disposed && token === this.generation) {
        this.error = `Playback failed: ${String(error)}`
        this.looping = false
        await this.cancelPlayback()
      }
    } finally {
      if (!this.disposed && token === this.generation) {
        this.busy = false
        if (this.looping) this.repeatInMS = LAYOUT.loopPauseMS
        this.refresh()
      }
    }
  }

  private preparePower(): void {
    this.hasPlayed = false
    this.board.position.set(0, 0)
    this.board.reset()
    const a = this.options.assets
    this.power = new HeroPowerView({
      layout: { card: LAYOUT.power, ...LAYOUT.manaOverlay },
      backTexture: a.heroPowerBack,
      premiumBackTexture: a.premiumHeroPowerBack,
      frontFrameTexture: a.heroPowerFront,
      premiumFrameTexture: a.premiumHeroPowerFront,
      artworkTexture: a[this.selected.presentationAssetKey as HeroPowerAssetKey],
      manaTexture: a.heroPowerMana,
      cost: this.selected.cost
    })
    this.power.label = 'hero-power-anim.power'
    this.board.addChild(this.power)
    this.presenter = new HeroPowerEffectsPresenter(
      new Map([[PREVIEW_LOCAL, this.power]]),
      a,
      this.animationScope,
      this.board
    )
    this.board.addChild(this.presenter.layer)
    this.presenter.startTargeting(PREVIEW_LOCAL, this.selected.id)
  }

  private async cancelPlayback(): Promise<void> {
    const presenter = this.presenter
    this.presenter = undefined
    presenter?.dispose()
    this.power?.dispose()
    this.power = undefined
    this.animationScope.kill()
    // Wait for the shake's origin-restoring finally before another run can start.
    await presenter?.finish()
  }

  private refresh(): void {
    const choices = previewTargets(this.selected)
    for (const { fixture, view } of this.board.characters) {
      view.setTargetable(!this.busy && choices.some(({ key }) => key === fixture.key))
      view.setTargetingOutline(!this.busy && fixture.key === this.target?.key)
    }
    let hint = this.target
      ? `Target: ${this.target.label}${choices.length ? '. Click another character to change.' : ' (automatic).'}`
      : 'No target selection needed.'
    if (
      this.selected.id === 'priest-lesser-heal' ||
      this.selected.id === 'priest-heal'
    ) {
      hint += ' Sunlight loops while choosing; Play confirms the power.'
    }
    this.controls.refresh(this.selected.id, this.busy, this.looping, hint, this.error)
  }

  update(deltaMS: number): void {
    if (this.disposed) return
    this.shadows.update(deltaMS)
    if (this.repeatInMS === null || this.busy) return
    this.repeatInMS -= deltaMS
    if (this.repeatInMS <= 0) {
      this.repeatInMS = null
      void this.play()
    }
  }

  setControlsVisible(visible: boolean): void {
    this.controls.setVisible(visible)
  }

  override dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.repeatInMS = null
    this.looping = false
    this.controls.dispose()
    void this.cancelPlayback()
    super.dispose()
  }
}
