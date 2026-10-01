import { Rectangle, Sprite, Text } from 'pixi.js'
import { Actor } from '../../visual-components/lifecycle/actor'
import { Button } from '../../visual-components/controls/button'
import type {
  MainMenuAssets,
  DeckSelectionAssets
} from '../../visual-components/assets'
import { getRankMedalTexture } from '../../visual-components/assets/rank-medals'
import type { SeasonRewardReceipt } from '../../desktop/contracts/ipc/player-stats'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import { MAIN_MENU_SEASON_LAYOUT as LAYOUT } from './main-menu-season-layout'

export class MainMenuSeasonView extends Actor {
  private readonly collect: Button
  private busy = false

  constructor(
    reward: SeasonRewardReceipt,
    assets: MainMenuAssets,
    medalAssets: DeckSelectionAssets,
    onCollect: () => Promise<void>,
    onError: (error: unknown) => void
  ) {
    super()
    this.label = 'main-menu.season-reward'
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.on('pointertap', (event) => event.stopPropagation())
    this.on('wheel', (event) => event.stopPropagation())

    const overlay = new Sprite(assets.rankResetOverlay)
    overlay.label = 'main-menu.season-overlay'
    applyAnchoredPlacement(overlay, LAYOUT.overlay)
    this.addChild(overlay)

    const medal = new Sprite(getRankMedalTexture(medalAssets, reward.previousRank))
    medal.label = 'main-menu.season-medal'
    applyAnchoredPlacement(
      medal,
      reward.previousRank.tier === 'legend' ? LAYOUT.legendMedal : LAYOUT.medal
    )
    this.addChild(medal)

    if (reward.previousRank.tier === 'legend') {
      const legendRankNumber = new Text({
        text: String(reward.previousRank.legendRank),
        style: {
          fontFamily: 'Belwe',
          fontSize: 60,
          fill: 0xf7e08c,
          stroke: { color: 0x000000, width: 5 },
          align: 'center'
        }
      })
      legendRankNumber.label = 'main-menu.season-legend-rank-number'
      applyAnchoredPlacement(legendRankNumber, LAYOUT.legendRankNumber)
      this.addChild(legendRankNumber)
    }

    const label = new Text({
      text:
        reward.previousRank.tier === 'legend'
          ? 'Legend'
          : String(reward.previousRank.rank),
      style: {
        fontFamily: 'Belwe',
        fontSize: 66,
        fontWeight: '700',
        fill: 0x4b3224,
        align: 'center'
      }
    })
    label.label = 'main-menu.season-rank-label'
    applyAnchoredPlacement(label, LAYOUT.rankLabel)
    this.addChild(label)

    this.collect = new Button(assets.collectRewardsRankButton, {
      onClick: async () => {
        if (this.busy) return
        this.busy = true
        this.collect.setEnabled(false)
        try {
          await onCollect()
        } catch (error) {
          onError(error)
        } finally {
          if (!this.destroyed) {
            this.busy = false
            this.collect.setEnabled(true)
          }
        }
      }
    })
    this.collect.label = 'main-menu.season-collect'
    applyPlacement(this.collect, LAYOUT.collect)
    this.collect.setBaseY(LAYOUT.collect.position.y)
    this.addChild(this.collect)
  }

  override dispose(): void {
    this.collect.dispose()
    super.dispose()
  }
}
