import {
  Container,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent
} from 'pixi.js'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { HeroView } from '../../rendering/heroes/hero-view'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'

export type MatchResult = 'win' | 'defeat' | 'draw'

export interface MatchResultOverlayOptions {
  readonly winScreen: Texture
  readonly defeatScreen: Texture
  readonly onContinue: () => Promise<void> | void
}

/** Full-screen end-of-match presentation above the filtered gameplay layers. */
export class MatchResultOverlay extends Container {
  private readonly frame: Sprite
  private readonly heroLayer = new Container()
  private readonly continuePrompt: Text
  private continuationRequested = false

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

    this.on('pointertap', this.handleContinue)
  }

  show(result: MatchResult, hero: HeroView): void {
    this.frame.texture =
      result === 'win' ? this.options.winScreen : this.options.defeatScreen
    this.continuePrompt.text =
      result === 'draw' ? 'Draw � Click to continue' : 'Click to continue'
    hero.removeFromParent()
    applyPlacement(hero, GAME_BOARD_LAYOUT.matchResult.localHero)
    hero.label = 'game.match-result.hero'
    hero.eventMode = 'none'
    this.heroLayer.addChild(hero)
    this.visible = true
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
