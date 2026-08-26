import { Container, Sprite, Text } from 'pixi.js'
import type { PlayerId, OpeningCard, OpeningMatchState } from '../../../game/match'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { applyPlacement, type LayoutPlacement } from '../../rendering/layout'
import { ManaTray, resolveManaCrystalStates } from './mana-tray'
import { DeckTrackerView } from './deck-tracker-view'
import type { DeckTrackerSortMode } from './deck-tracker-model'
import { REMOTE_DECK_TRACKER_LAYOUT } from './deck-tracker-layout'
import { Button } from '../../ui/components/button'
import type { GameAssets } from '../../ui/asset-registry'
import type { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'

type Player = OpeningMatchState['players'][number]

/** Owned HUD composition for turn controls, mana, deck counts, and tracker. */
export class GameHudView {
  readonly turnLayer = new Container()
  readonly deckTracker: DeckTrackerView
  readonly remoteDeckTracker: DeckTrackerView
  endTurnButton: Button | null = null
  deckCountLabels: { local: Text; remote: Text } | null = null
  manaLabels: { local: Text; remote: Text } | null = null
  manaLocalTray: ManaTray | null = null
  yourTurnFlag: Sprite | null = null

  constructor(resolver: CardAssetResolver) {
    this.deckTracker = new DeckTrackerView(resolver)
    this.remoteDeckTracker = new DeckTrackerView(resolver, REMOTE_DECK_TRACKER_LAYOUT)
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
    this.endTurnButton = new Button(assets.endTurn, {
      highlightOnHover: false,
      onClick: onEndTurn
    })
    applyPlacement(this.endTurnButton, GAME_BOARD_LAYOUT.endTurnButton)
    this.endTurnButton.setBaseY(GAME_BOARD_LAYOUT.endTurnButton.position.y)
    this.endTurnButton.setEnabled(false)
    this.turnLayer.addChild(this.endTurnButton)

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
    if (this.deckTracker.visible) this.deckTracker.update(local.deck)
    if (this.remoteDeckTracker.visible) this.remoteDeckTracker.update(remote.deck)
  }

  toggleDeckTracker(deck: readonly OpeningCard[]): boolean {
    const visible = !this.deckTracker.visible
    this.deckTracker.setVisible(visible)
    if (visible) this.deckTracker.update(deck)
    return visible
  }

  setDeckTracker(
    visibility: 'hidden' | 'local' | 'both' | 'remote',
    sortMode: DeckTrackerSortMode,
    localDeck: readonly OpeningCard[],
    remoteDeck: readonly OpeningCard[]
  ): void {
    this.deckTracker.setSortMode(sortMode)
    this.remoteDeckTracker.setSortMode(sortMode)
    this.deckTracker.setVisible(visibility === 'local' || visibility === 'both')
    this.remoteDeckTracker.setVisible(visibility === 'remote' || visibility === 'both')
    if (this.deckTracker.visible) this.deckTracker.update(localDeck)
    if (this.remoteDeckTracker.visible) this.remoteDeckTracker.update(remoteDeck)
  }

  dispose(): void {
    this.deckTracker.dispose()
    this.remoteDeckTracker.dispose()
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
}
