import { Scene } from '../../visual-components/lifecycle/scene'
import type { SceneRouter } from '../../application/navigation/router'
import type { AppLogger } from '../../application/services'
import type { SceneTransitionOptions } from '../../application/navigation/scene-manager'
import {
  MainMenuView,
  type MainMenuEntryMode,
  type MainMenuRoute
} from './main-menu-view'
import { SCENE_SELECTION_GAP } from './main-menu-layout'
import {
  ASSET_BUNDLE_IDS,
  type ArenaAssets,
  type DeckSelectionAssets,
  type MainMenuAssets
} from '../../visual-components/assets'
import type { PlayerStatsStore } from '../../application/contracts/player-stats-store'
import type { ProgressionStore } from '../../application/contracts/progression-store'
import type { DialogService } from '../../application/services'
import type { SeasonRewardReceipt } from '../../desktop/contracts/ipc/player-stats'
import { BlurFilter } from 'pixi.js'
import { ArenaRewardsView } from '../../visual-components/cards/reward-prizes-view'
import { MainMenuSeasonView } from './main-menu-season-view'
import { seasonArenaWins } from '../../game-rules/ranking/season-rewards'

export { SCENE_SELECTION_GAP }

/**
 * Full-screen lifecycle adapter for the main-menu feature. The chest, lids,
 * buttons, and their choreography live in MainMenuView; this class only
 * connects that view to SceneManager's transition protocol.
 */
export class MainMenuScene extends Scene {
  private readonly view: MainMenuView
  /** Compatibility state for pre-load transition tests and dev hooks. */
  private transitionOpened = false
  private seasonView: MainMenuSeasonView | null = null
  private rewardView: ArenaRewardsView | null = null
  private seasonBlur: BlurFilter[] = []
  private seasonReceipt: SeasonRewardReceipt | null = null
  private seasonAssets: {
    menu: MainMenuAssets
    medals: DeckSelectionAssets
    arena: ArenaAssets
  } | null = null

  constructor(
    private readonly router?: SceneRouter,
    private readonly entryMode: MainMenuEntryMode = 'closed',
    private readonly logger: AppLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    private readonly playerStats?: PlayerStatsStore,
    private readonly progression?: ProgressionStore,
    private readonly dialogs?: DialogService
  ) {
    super()

    const viewRouter = this.router
      ? {
          navigate: (route: MainMenuRoute) => this.router!.navigate(route)
        }
      : undefined
    this.view = new MainMenuView({
      assetScope: this.assetScope,
      router: viewRouter,
      entryMode: this.entryMode,
      logger: this.logger
    })
  }

  get isDestinationTransitionOpen(): boolean {
    return this.transitionOpened || this.view.isDestinationTransitionOpen
  }

  get hasOpenSeasonReward(): boolean {
    return this.seasonReceipt !== null
  }

  /** Parent slot used by SceneManager for menu destination previews. */
  get destinationTransitionHost(): MainMenuView['transitionHost'] {
    return this.view.transitionHost
  }

  prepareDestinationTransition(): Promise<void> {
    return this.view.prepareDestinationTransition()
  }

  createReturnTransitionOptions(): SceneTransitionOptions {
    if (this.entryMode !== 'returning') {
      throw new Error('Return transition options require a returning main menu')
    }

    return {
      inset: SCENE_SELECTION_GAP,
      mode: 'collapse',
      scaleMode: 'cover',
      duration: 0.45,
      hostParent: this.destinationTransitionHost,
      hostIndex: 0,
      afterCollapse: () => this.view.closeReturningChest(),
      afterTransition: async () => {
        await this.view.revealReturnedMenu()
        if (this.seasonReceipt) await this.showSeasonReward(this.seasonReceipt)
      }
    }
  }

  async init(): Promise<void> {
    this.root.addChild(this.view)
    await this.view.init()
    const menu = await this.assetScope.acquire<MainMenuAssets>(
      ASSET_BUNDLE_IDS.mainMenu
    )
    const medals = await this.assetScope.acquire<DeckSelectionAssets>(
      ASSET_BUNDLE_IDS.deckSelection
    )
    const arena = await this.assetScope.acquire<ArenaAssets>(ASSET_BUNDLE_IDS.arena)
    await this.assetScope.acquire(ASSET_BUNDLE_IDS.cardRendering)
    this.seasonAssets = { menu, medals, arena }
    if (this.playerStats) {
      try {
        await this.playerStats.load()
        const reward = await this.playerStats.pendingSeasonReward()
        if (reward) {
          if (this.entryMode === 'returning') this.seasonReceipt = reward
          else await this.showSeasonReward(reward)
        }
      } catch (error) {
        this.logger.error('Failed to load the season reward.', error)
        this.dialogs?.error(
          'Could not load the season reward. Please retry from the main menu.'
        )
      }
    }
  }

  async devResetSeason(): Promise<void> {
    if (!this.playerStats?.devResetSeason || this.state !== 'active' || this.seasonView)
      return
    await this.playerStats.devResetSeason()
    const reward = await this.playerStats.pendingSeasonReward()
    if (reward && !this.seasonView && this.state === 'active')
      await this.showSeasonReward(reward)
  }

  private async showSeasonReward(reward: SeasonRewardReceipt): Promise<void> {
    if (
      !this.playerStats ||
      !this.seasonAssets ||
      (this.state !== 'loading' && this.state !== 'active')
    )
      return
    const { menu, medals, arena } = this.seasonAssets
    const seasonView = new MainMenuSeasonView(
      reward,
      menu,
      medals,
      () => this.collectSeasonReward(arena),
      (error) =>
        this.reportSeasonError(
          'Could not collect the season reward. Please try again.',
          error
        )
    )
    this.root.addChild(seasonView)
    this.seasonView = seasonView
    this.seasonReceipt = reward
    this.view.setSeasonRewardBlocked(true)
  }

  private async collectSeasonReward(assets: ArenaAssets): Promise<void> {
    if (!this.playerStats || !this.seasonReceipt || this.rewardView) return
    const reward = await this.playerStats.claimSeasonReward(this.seasonReceipt.id)
    await this.progression?.refresh()
    if (this.state !== 'active' || !this.seasonView) return
    this.seasonReceipt = reward
    this.seasonBlur = [
      new BlurFilter({ strength: 10, quality: 3 }),
      new BlurFilter({ strength: 10, quality: 3 })
    ]
    this.view.filters = [this.seasonBlur[0]]
    this.seasonView!.filters = [this.seasonBlur[1]]
    this.rewardView = new ArenaRewardsView(
      {
        runId: reward.id,
        wins: seasonArenaWins(reward.previousRank),
        prizes: reward.prizes
      },
      assets,
      () => this.confirmSeasonReward(),
      (message, error) => this.reportSeasonError(message, error),
      'main-menu.season',
      () => this.finishSeasonReward(),
      (duration) => this.fadeSeasonBackdrop(duration)
    )
    this.root.addChild(this.rewardView)
  }

  private async confirmSeasonReward(): Promise<void> {
    if (!this.playerStats || !this.seasonReceipt) return
    await this.playerStats.acknowledgeSeasonReward(this.seasonReceipt.id)
  }

  private fadeSeasonBackdrop(duration: number): Promise<void> {
    return new Promise((resolve) => {
      const timeline = this.timeline({ onComplete: resolve, onInterrupt: resolve })
      timeline.to(this.seasonBlur, { strength: 0, duration, ease: 'power2.out' }, 0)
      if (this.seasonView)
        timeline.to(this.seasonView, { alpha: 0, duration, ease: 'power2.out' }, 0)
    })
  }

  private async finishSeasonReward(): Promise<void> {
    if (!this.playerStats) return
    if (this.state !== 'active') return
    this.rewardView?.dispose()
    this.rewardView = null
    this.view.filters = null
    if (this.seasonView) {
      this.seasonView.filters = null
      this.seasonView.dispose()
      this.seasonView = null
    }
    for (const blur of this.seasonBlur) blur.destroy()
    this.seasonBlur = []
    try {
      const next = await this.playerStats.pendingSeasonReward()
      if (this.state !== 'active') return
      if (next) await this.showSeasonReward(next)
      else {
        this.seasonReceipt = null
        this.view.setSeasonRewardBlocked(false)
      }
    } catch (error) {
      if (this.state !== 'active') return
      this.seasonReceipt = null
      this.view.setSeasonRewardBlocked(false)
      this.reportSeasonError(
        'Could not load the next season reward. Please revisit the menu.',
        error
      )
    }
  }

  private reportSeasonError(message: string, error: unknown): void {
    this.logger.error(message, error)
    this.dialogs?.error(message)
  }

  protected onExit(): void {
    this.rewardView?.dispose()
    this.rewardView = null
    this.view.filters = null
    if (this.seasonView) {
      this.seasonView.filters = null
      this.seasonView.dispose()
      this.seasonView = null
    }
    for (const blur of this.seasonBlur) blur.destroy()
    this.seasonBlur = []
    this.seasonReceipt = null
    this.seasonAssets = null
  }

  update(deltaMS: number): void {
    this.view?.update(deltaMS)
  }
}
