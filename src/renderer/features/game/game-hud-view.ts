import type { AnimationScope } from '../../animation/animations'
import { Container, Sprite, Text, type Texture } from 'pixi.js'
import type { PlayerId, OpeningCard, OpeningMatchState } from '../../../game/match'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import {
  applyPlacement,
  applyAnchoredPlacement,
  type LayoutPlacement
} from '../../rendering/layout'
import { ManaTray, resolveManaCrystalStates } from './mana-tray'
import { DeckTrackerView } from './deck-tracker-view'
import { DeckInfoView } from './deck-info-view'
import type { DeckTrackerSortMode } from './deck-tracker-model'
import { Button } from '../../ui/components/button'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import type { GameAssets } from '../../ui/asset-registry'
import type { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'

type Player = OpeningMatchState['players'][number]

const END_TURN_FLIP_DURATION = 0.32
const YOUR_TURN_TIMING = {
  yourTurnGrow: 0.35,
  yourTurnHold: 1,
  yourTurnFadeOut: 0.15
} as const

/** Owned HUD composition for turn controls, mana, deck counts, and tracker. */
export class GameHudView {
  readonly turnLayer = new Container()
  readonly deckInfoLayer = new Container()
  deckInfo: DeckInfoView | null = null
  readonly turnButtonLayer = new Container()
  readonly deckTracker: DeckTrackerView
  endTurnButton: Button | null = null
  private endTurnOutlineTarget: Sprite | null = null
  private endTurnOutline: AnimatedOutline | null = null
  private endTurnTexture: Texture | null = null
  private endTurnEnabled = false
  private endTurnExhausted = false
  deckCountLabels: { local: Text; remote: Text } | null = null
  manaLabels: { local: Text; remote: Text } | null = null
  manaLocalTray: ManaTray | null = null
  private yourTurnFlag: Sprite | null = null
  private yourTurnTimeline: gsap.core.Timeline | null = null

  constructor(
    resolver: CardAssetResolver,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) {
    this.deckTracker = new DeckTrackerView(resolver)
    this.turnLayer.label = 'game.turn-hud'
    this.deckInfoLayer.label = 'game.deck-info-layer'
    this.deckInfoLayer.eventMode = 'none'
    this.turnButtonLayer.label = 'game.turn-button'
    // Keep the HUD container passive so its interactive children (notably the
    // End Turn button) still participate in Pixi hit testing. `none` skips the
    // entire subtree, which makes a rendered/enabled button impossible to
    // click.
    this.turnLayer.eventMode = 'passive'
    this.turnButtonLayer.eventMode = 'passive'
  }

  mount(
    assets: Pick<
      GameAssets,
      | 'endTurn'
      | 'manaAvailable'
      | 'manaSpent'
      | 'manaHighlighted'
      | 'manaOverload'
      | 'deckInfo'
    >,
    onEndTurn: () => void,
    initialTurnTexture: Texture = assets.endTurn
  ): void {
    this.deckInfo = new DeckInfoView(assets.deckInfo)
    this.deckInfoLayer.addChild(this.deckInfo)
    this.endTurnOutlineTarget = new Sprite(initialTurnTexture)
    applyAnchoredPlacement(this.endTurnOutlineTarget, GAME_BOARD_LAYOUT.endTurnButton)
    this.endTurnOutlineTarget.eventMode = 'none'
    this.endTurnOutlineTarget.label = 'game.end-turn-exhausted-outline-target'
    this.endTurnOutline = new AnimatedOutline(this.endTurnOutlineTarget, {
      palette: 'green',
      preset: 'button'
    })
    this.endTurnOutline.setEnabled(false)
    this.turnButtonLayer.addChild(this.endTurnOutlineTarget)

    this.endTurnButton = new Button(initialTurnTexture, {
      highlightOnHover: false,
      onClick: onEndTurn
    })
    applyPlacement(this.endTurnButton, GAME_BOARD_LAYOUT.endTurnButton)
    this.endTurnButton.label = 'game.end-turn'
    this.endTurnButton.setBaseY(GAME_BOARD_LAYOUT.endTurnButton.position.y)
    this.endTurnButton.setEnabled(false)
    this.turnButtonLayer.addChild(this.endTurnButton)
    this.endTurnTexture = initialTurnTexture

    // Deck card-count labels are intentionally hidden for now.
    // const localCount = this.createHudLabel(GAME_BOARD_LAYOUT.decks.localCount, 34)
    // const remoteCount = this.createHudLabel(GAME_BOARD_LAYOUT.decks.remoteCount, 34)
    // this.deckCountLabels = { local: localCount, remote: remoteCount }
    // this.turnLayer.addChild(localCount, remoteCount)

    const localMana = this.createHudLabel(GAME_BOARD_LAYOUT.mana.localLabel, 30)
    const remoteMana = this.createHudLabel(GAME_BOARD_LAYOUT.mana.remoteLabel, 30)
    this.manaLabels = { local: localMana, remote: remoteMana }
    this.turnLayer.addChild(localMana, remoteMana)

    this.manaLocalTray = new ManaTray(
      assets.manaAvailable,
      assets.manaSpent,
      assets.manaHighlighted,
      assets.manaOverload,
      GAME_BOARD_LAYOUT.mana.crystals
    )
    this.turnLayer.addChild(this.manaLocalTray)
    this.turnLayer.visible = false
  }

  syncEndTurnButton(texture: Texture, enabled: boolean, exhausted: boolean): void {
    this.endTurnTexture = texture
    this.endTurnEnabled = enabled
    this.endTurnExhausted = exhausted
    const button = this.endTurnButton
    if (!button) return

    if (button.sprite.texture === texture && !button.isTextureFlipping()) {
      this.syncEndTurnVisualState()
      return
    }

    // The outline is hidden throughout the flip, so its texture can safely
    // advance to the next face before the button reaches its midpoint.
    this.endTurnOutline?.setEnabled(false)
    if (this.endTurnOutlineTarget) this.endTurnOutlineTarget.texture = texture
    void button.flipTextureVertically(texture, END_TURN_FLIP_DURATION).then(() => {
      this.syncEndTurnVisualState()
    })
  }

  sync(
    state: OpeningMatchState,
    findPlayer: (state: OpeningMatchState, participantId: PlayerId) => Player,
    ids: { local: PlayerId; remote: PlayerId } | null,
    highlightCost: number | null = null
  ): void {
    if (!ids) return
    const local = findPlayer(state, ids.local)
    const remote = findPlayer(state, ids.remote)
    this.deckInfo?.sync(local, remote)
    if (this.deckCountLabels) {
      this.deckCountLabels.local.text = String(local.deck.length)
      this.deckCountLabels.remote.text = String(remote.deck.length)
    }
    if (this.manaLabels) {
      this.manaLabels.local.text = `${local.mana.available}/${local.mana.maximum}`
      this.manaLabels.remote.text = `${remote.mana.available}/${remote.mana.maximum}`
    }
    this.manaLocalTray?.sync(
      resolveManaCrystalStates(local.mana, highlightCost),
      local.mana.overloadNextTurn
    )
  }

  toggleDeckTracker(deck: readonly OpeningCard[]): boolean {
    const visible = !this.deckTracker.visible
    this.deckTracker.setVisible(visible)
    if (visible) this.deckTracker.update(deck)
    return visible
  }

  setDeckTracker(
    visibility: 'hidden' | 'local',
    sortMode: DeckTrackerSortMode,
    localDeck: readonly OpeningCard[]
  ): void {
    this.deckTracker.setSortMode(sortMode)
    this.deckTracker.setVisible(visibility === 'local')
    if (this.deckTracker.visible) this.deckTracker.update(localDeck)
  }

  /**
   * Shows the "Your turn" banner, always centred on the board: it fades in
   * while growing from a small scale up to full size, holds briefly, then fades
   * out. Fire-and-forget — turn flow and draw animations continue underneath
   * it. No sound.
   */
  presentYourTurnFlag(texture: Texture): void {
    this.clearYourTurnFlag()
    const layout = GAME_BOARD_LAYOUT.yourTurnFlag
    const flag = new Sprite(texture)
    applyAnchoredPlacement(flag, layout)
    flag.scale.set(GAME_BOARD_LAYOUT.yourTurnStartScale)
    flag.alpha = 0
    flag.label = 'game.your-turn-flag'
    flag.eventMode = 'none'
    this.turnLayer.addChild(flag)
    this.yourTurnFlag = flag

    const finalScale = layout.scale ?? { x: 1, y: 1 }
    const timeline = this.animations.timeline()
    this.yourTurnTimeline = timeline
    timeline.to(flag, {
      alpha: 1,
      duration: YOUR_TURN_TIMING.yourTurnGrow,
      ease: 'power2.out'
    })
    timeline.to(
      flag.scale,
      {
        x: finalScale.x,
        y: finalScale.y,
        duration: YOUR_TURN_TIMING.yourTurnGrow,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      flag,
      {
        alpha: 0,
        duration: YOUR_TURN_TIMING.yourTurnFadeOut,
        ease: 'power2.in'
      },
      YOUR_TURN_TIMING.yourTurnGrow + YOUR_TURN_TIMING.yourTurnHold
    )
    const completed = new Promise<void>((resolve) => {
      timeline.eventCallback('onComplete', resolve)
      timeline.eventCallback('onInterrupt', resolve)
    })
    void completed.then(() => {
      if (this.yourTurnFlag !== flag || flag.destroyed) return
      this.yourTurnTimeline = null
      this.yourTurnFlag = null
      flag.destroy({ children: true })
    })
  }

  private clearYourTurnFlag(): void {
    if (this.yourTurnTimeline) this.animations.cancel(this.yourTurnTimeline)
    this.yourTurnTimeline = null
    this.yourTurnFlag?.destroy({ children: true })
    this.yourTurnFlag = null
  }

  dispose(): void {
    this.deckInfoLayer.destroy({ children: true })
    this.deckInfo = null
    this.endTurnOutline?.dispose()
    this.endTurnOutline = null
    this.endTurnOutlineTarget = null
    this.endTurnTexture = null
    this.deckTracker.dispose()
    this.manaLocalTray?.dispose()
    this.manaLocalTray = null
    this.clearYourTurnFlag()
    this.turnLayer.destroy({ children: true })
    this.turnButtonLayer.destroy({ children: true })
  }

  private createHudLabel(placement: LayoutPlacement, fontSize: number): Text {
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fill: 0xffffff,
        stroke: { color: 0x17120f, width: 6 },
        align: 'center'
      }
    })
    applyPlacement(label, placement)
    label.anchor.set(placement.anchor.x, placement.anchor.y)
    label.eventMode = 'none'
    return label
  }

  private syncEndTurnVisualState(): void {
    const button = this.endTurnButton
    if (!button) return
    button.setEnabled(this.endTurnEnabled)
    if (this.endTurnOutlineTarget) {
      this.endTurnOutlineTarget.texture = button.sprite.texture
    }
    this.endTurnOutline?.setEnabled(
      this.endTurnExhausted &&
        button.sprite.texture === this.endTurnTexture &&
        !button.isTextureFlipping()
    )
  }
}
