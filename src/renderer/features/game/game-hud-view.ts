import { Container, Sprite, Text, type Texture } from 'pixi.js'
import type { PlayerId, OpeningCard, OpeningMatchState } from '../../../game/match'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { applyPlacement, type LayoutPlacement } from '../../rendering/layout'
import { ManaTray, resolveManaCrystalStates } from './mana-tray'
import { DeckTrackerView } from './deck-tracker-view'
import type { DeckTrackerSortMode } from './deck-tracker-model'
import { Button } from '../../ui/components/button'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import type { GameAssets } from '../../ui/asset-registry'
import type { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'

type Player = OpeningMatchState['players'][number]

const END_TURN_FLIP_DURATION = 0.32

/** Owned HUD composition for turn controls, mana, deck counts, and tracker. */
export class GameHudView {
  readonly turnLayer = new Container()
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
  yourTurnFlag: Sprite | null = null

  constructor(resolver: CardAssetResolver) {
    this.deckTracker = new DeckTrackerView(resolver)
    this.turnLayer.label = 'game.turn-hud'
    // Keep the HUD container passive so its interactive children (notably the
    // End Turn button) still participate in Pixi hit testing. `none` skips the
    // entire subtree, which makes a rendered/enabled button impossible to
    // click.
    this.turnLayer.eventMode = 'passive'
  }

  mount(
    assets: Pick<GameAssets, 'endTurn' | 'manaCrystal'>,
    onEndTurn: () => void
  ): void {
    this.endTurnOutlineTarget = new Sprite(assets.endTurn)
    applyPlacement(this.endTurnOutlineTarget, GAME_BOARD_LAYOUT.endTurnButton)
    this.endTurnOutlineTarget.anchor.set(
      GAME_BOARD_LAYOUT.endTurnButton.anchor.x,
      GAME_BOARD_LAYOUT.endTurnButton.anchor.y
    )
    this.endTurnOutlineTarget.eventMode = 'none'
    this.endTurnOutlineTarget.label = 'game.end-turn-exhausted-outline-target'
    this.endTurnOutline = new AnimatedOutline(this.endTurnOutlineTarget, {
      palette: 'green',
      preset: 'button'
    })
    this.endTurnOutline.setEnabled(false)
    this.turnLayer.addChild(this.endTurnOutlineTarget)

    this.endTurnButton = new Button(assets.endTurn, {
      highlightOnHover: false,
      onClick: onEndTurn
    })
    applyPlacement(this.endTurnButton, GAME_BOARD_LAYOUT.endTurnButton)
    this.endTurnButton.setBaseY(GAME_BOARD_LAYOUT.endTurnButton.position.y)
    this.endTurnButton.setEnabled(false)
    this.turnLayer.addChild(this.endTurnButton)
    this.endTurnTexture = assets.endTurn

    const localCount = this.createHudLabel(GAME_BOARD_LAYOUT.decks.localCount, 34)
    const remoteCount = this.createHudLabel(GAME_BOARD_LAYOUT.decks.remoteCount, 34)
    this.deckCountLabels = { local: localCount, remote: remoteCount }
    this.turnLayer.addChild(localCount, remoteCount)

    const localMana = this.createHudLabel(GAME_BOARD_LAYOUT.mana.localLabel, 34)
    const remoteMana = this.createHudLabel(GAME_BOARD_LAYOUT.mana.remoteLabel, 26)
    this.manaLabels = { local: localMana, remote: remoteMana }
    this.turnLayer.addChild(localMana, remoteMana)

    this.manaLocalTray = new ManaTray(
      assets.manaCrystal,
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
    if (this.deckCountLabels) {
      this.deckCountLabels.local.text = String(local.deck.length)
      this.deckCountLabels.remote.text = String(remote.deck.length)
    }
    if (this.manaLabels) {
      this.manaLabels.local.text = `${local.mana.available}/${local.mana.maximum}`
      this.manaLabels.remote.text = `${remote.mana.available}/${remote.mana.maximum}`
    }
    this.manaLocalTray?.sync(resolveManaCrystalStates(local.mana, highlightCost))
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

  dispose(): void {
    this.endTurnOutline?.dispose()
    this.endTurnOutline = null
    this.endTurnOutlineTarget = null
    this.endTurnTexture = null
    this.deckTracker.dispose()
    this.manaLocalTray?.dispose()
    this.manaLocalTray = null
    this.yourTurnFlag?.destroy({ children: true })
    this.yourTurnFlag = null
    this.turnLayer.destroy({ children: true })
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
