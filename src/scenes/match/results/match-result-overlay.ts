import {
  Container,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent
} from 'pixi.js'
import {
  applyAnchoredPlacement,
  applyPlacement
} from '../../../visual-components/layout'
import { HeroView } from '../board/hero-view'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'

export type MatchResult = 'win' | 'defeat' | 'draw'

export interface MatchResultOverlayOptions {
  readonly winScreen: Texture
  readonly defeatScreen: Texture
  readonly arcaneDust: Texture
  readonly onContinue: () => Promise<void> | void
}

/** Full-screen end-of-match presentation above the filtered gameplay layers. */
export class MatchResultOverlay extends Container {
  private readonly frame: Sprite
  private readonly heroLayer = new Container()
  private readonly continuePrompt: Text
  private continuationRequested = false
  private readonly dustText: Text
  private readonly dustIcon: Sprite
  private readonly rewardError: Text
  private retryReward: (() => Promise<void>) | null = null

  constructor(private readonly options: MatchResultOverlayOptions) {
    super()
    this.visible = false
    this.label = 'game.match-result'
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.cursor = 'pointer'

    this.frame = new Sprite(options.winScreen)
    applyAnchoredPlacement(this.frame, GAME_BOARD_LAYOUT.matchResult.frame)
    this.frame.label = 'game.match-result.frame'
    this.frame.eventMode = 'none'
    this.addChild(this.frame)

    this.heroLayer.label = 'game.match-result.hero-layer'
    this.heroLayer.eventMode = 'none'
    this.addChild(this.heroLayer)

    this.continuePrompt = new Text({
      text: 'Click to continue',
      style: {
        fontFamily: 'Belwe',
        fontSize: 42,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 6 },
        align: 'center'
      }
    })
    applyAnchoredPlacement(
      this.continuePrompt,
      GAME_BOARD_LAYOUT.matchResult.continuePrompt
    )
    this.continuePrompt.label = 'game.match-result.continue-prompt'
    this.continuePrompt.eventMode = 'none'
    this.addChild(this.continuePrompt)

    this.dustText = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 48,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 5 }
      }
    })
    this.dustText.label = 'game.match-result.dust-text'
    applyAnchoredPlacement(this.dustText, GAME_BOARD_LAYOUT.matchResult.dustText)
    this.dustIcon = new Sprite(options.arcaneDust)
    this.dustIcon.label = 'game.match-result.dust-icon'
    applyAnchoredPlacement(this.dustIcon, GAME_BOARD_LAYOUT.matchResult.dustIcon)
    this.rewardError = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 26,
        fill: 0xffffff,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 800
      }
    })
    this.rewardError.label = 'game.match-result.reward-error'
    applyAnchoredPlacement(this.rewardError, GAME_BOARD_LAYOUT.matchResult.rewardError)
    this.rewardError.eventMode = 'static'
    this.rewardError.cursor = 'pointer'
    this.rewardError.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      if (event.button !== 0 || !this.retryReward) return
      const retry = this.retryReward
      this.retryReward = null
      this.rewardError.text = 'Saving reward…'
      void retry()
    })
    this.addChild(this.dustText, this.dustIcon, this.rewardError)
    this.setReward(0)

    this.on('pointertap', this.handleContinue)
  }

  show(result: MatchResult, hero: HeroView): void {
    this.frame.texture =
      result === 'win' ? this.options.winScreen : this.options.defeatScreen
    this.continuePrompt.text =
      result === 'draw' ? 'Draw — Click to continue' : 'Click to continue'
    hero.removeFromParent()
    applyPlacement(hero, GAME_BOARD_LAYOUT.matchResult.localHero)
    hero.label = 'game.match-result.hero'
    hero.eventMode = 'none'
    this.heroLayer.addChild(hero)
    this.visible = true
  }

  setReward(earned: number): void {
    this.dustText.text = `+${earned}`
    this.dustText.visible = this.dustIcon.visible = earned > 0
    this.rewardError.text = ''
    this.retryReward = null
  }

  setRewardFailure(retry: () => Promise<void>): void {
    this.setReward(0)
    this.rewardError.text = 'Could not save Arcane Dust. Click here to retry.'
    this.retryReward = retry
  }

  private readonly handleContinue = (event: FederatedPointerEvent): void => {
    if (event.button !== 0 || this.continuationRequested) return
    this.continuationRequested = true
    this.eventMode = 'none'
    void Promise.resolve(this.options.onContinue()).catch(() => {
      this.continuationRequested = false
      this.eventMode = 'static'
    })
  }
}
