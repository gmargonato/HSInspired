import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent
} from 'pixi.js'
import type { Deck } from '../../../../game/decks'
import { CARD_CATALOG, type CardDefinition } from '../../../../game/content/cards'
import { HERO_CATALOG } from '../../../../game/content/heroes'
import {
  createOpeningMatch,
  type MulliganResolvedEvent,
  type OpeningCard,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type OpeningMatchState
} from '../../../../game/match'
import type { PlayerId } from '../../../../game/match'
import type { AudioService } from '../../app/audio'
import type { GameRoute } from '../../app/router'
import type { AppLogger } from '../../app/services'
import { CardView } from '../../rendering/cards/card-view'
import { gsap } from '../../animation/animations'
import { type DeckPresentationAssets, type GameAssets } from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { Actor } from '../../ui/components/Actor'
import { Button } from '../../ui/components/Button'
import { DEFAULT_HAND_LAYOUT, HandCardTransform, layoutHand } from './hand-layout'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import type { LayoutPlacement } from '../../rendering/layout'

export interface GameBoardViewOptions {
  readonly route: GameRoute
  readonly decks: readonly Deck[]
  readonly gameAssets: GameAssets
  readonly heroAssets: DeckPresentationAssets
  readonly audio?: AudioService
  readonly logger?: AppLogger
}

/** Feature-local timings make the opening easy to tune without layout edits. */
const OPENING_TIMING = {
  versusHold: 1,
  heroSettle: 0.6,
  boardPause: 0.5,
  mulliganFade: 0.3,
  cardDeal: 0.75,
  cardStagger: 0.18,
  playerTwoAnnouncementHold: 0.9,
  playerTwoAnnouncementFade: 0.25,
  playerTwoFourthCard: 0.65,
  confirmationPause: 0.5,
  replacementPause: 0.25,
  handoffPause: 0.5,
  hover: 0.2
} as const

function cardDefinition(card: OpeningCard): CardDefinition {
  return CARD_CATALOG.require(card.cardId)
}

function cloneCard(card: OpeningCard): OpeningCard {
  return { ...card }
}

class GameCardSlot extends Container {
  readonly card: CardView
  readonly instanceId: string
  private readonly replaceCross: Sprite
  private readonly replacedLabel: Sprite

  constructor(
    card: CardView,
    instanceId: string,
    replaceCrossTexture: Texture,
    replacedLabelTexture: Texture
  ) {
    super()
    this.card = card
    this.instanceId = instanceId
    this.eventMode = 'static'
    this.cursor = 'pointer'
    const slotLayout = GAME_BOARD_LAYOUT.mulligan.slot
    this.hitArea = new Rectangle(
      slotLayout.hitArea.x,
      slotLayout.hitArea.y,
      slotLayout.hitArea.width,
      slotLayout.hitArea.height
    )
    this.label = `game-card:${instanceId}`

    card.eventMode = 'none'
    card.position.set(slotLayout.cardOffset.x, slotLayout.cardOffset.y)
    this.addChild(card)

    this.replaceCross = new Sprite(replaceCrossTexture)
    this.replaceCross.anchor.set(0.5)
    this.replaceCross.position.set(
      slotLayout.replaceCrossOffset.x,
      slotLayout.replaceCrossOffset.y
    )
    this.replaceCross.scale.set(slotLayout.overlayScale)
    this.replaceCross.visible = false
    this.replaceCross.eventMode = 'none'
    this.addChild(this.replaceCross)

    this.replacedLabel = new Sprite(replacedLabelTexture)
    this.replacedLabel.anchor.set(0.5, 0)
    this.replacedLabel.position.set(
      slotLayout.replacedLabelOffset.x,
      slotLayout.replacedLabelOffset.y
    )
    this.replacedLabel.scale.set(slotLayout.overlayScale)
    this.replacedLabel.visible = false
    this.replacedLabel.eventMode = 'none'
    this.addChild(this.replacedLabel)
  }

  setSelected(selected: boolean): void {
    this.replaceCross.visible = selected
    this.replacedLabel.visible = selected
  }
}

/** Ordered pair of a hand card and its interactive slot — single source of truth. */
interface HandEntry {
  card: OpeningCard
  slot: GameCardSlot
  /**
   * Resting transform (no hover applied). Set by `applyHandLayout` after every
   * structural change (deal, mulligan resolve, draw) and read by `applyHoverDelta`
   * to compute hover targets without re-running `layoutHand`.
   */
  restTransform: HandCardTransform | undefined
  /**
   * True while the card is at a non-rest position due to hover. Cleared by
   * `applyHandLayout`. Used by `applyHoverDelta` to skip cards that are at rest
   * and should not be touched (the common case — only one card is hovered).
   */
  displaced: boolean
}

/** Feature-owned board, opening choreography, mulligan, and local hand interaction. */
export class GameBoardView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly handEntries: HandEntry[] = []
  private readonly selectedIds = new Set<string>()
  private readonly initialSlots: GameCardSlot[] = []
  private readonly remoteBacks: Sprite[] = []
  private readonly boardLayer = new Container()
  private readonly heroLayer = new Container()
  private readonly openingLayer = new Container()
  private readonly travelLayer = new Container()
  private readonly deckLayer = new Container()
  private readonly mulliganLayer = new Container()
  private readonly handLayer = new Container()
  private readonly remoteHandLayer = new Container()
  private readonly heroSprites = new Map<PlayerId, Sprite>()
  private readonly logger: AppLogger
  private match!: OpeningMatchInstance
  private localParticipantId!: PlayerId
  private remoteParticipantId!: PlayerId
  private localPlayerNumber!: 1 | 2
  private remotePlayerNumber!: 1 | 2
  private localHoveredSlot: GameCardSlot | null = null
  private confirmButton!: Button
  private confirmationLocked = false
  private remoteBackCount = 0
  private openingRevealStarted = false
  /**
   * True while a structural reflow (deal, mulligan resolve, draw) is animating.
   * Hover is blocked during reflow so the pointermove handler does not fight
   * the structural timeline animating the same slot properties.
   */
  private reflowing = false
  /**
   * True once `activateHandHover` has wired the pointermove/pointerleave
   * listeners on handLayer. Stays true for the lifetime of the hand; the
   * pointermove handler checks this to bail during teardown.
   */
  private handModeActive = false

  constructor(private readonly options: GameBoardViewOptions) {
    super()
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    this.addChild(this.boardLayer)
    this.addChild(this.openingLayer)
    this.addChild(this.heroLayer)
    this.addChild(this.deckLayer)
    this.addChild(this.mulliganLayer)
    // Dealt cards must stay above the mulligan dimmer while they travel from
    // the deck; they are reparented to their final layers after the animation.
    this.addChild(this.travelLayer)
    this.addChild(this.remoteHandLayer)
    this.addChild(this.handLayer)
    this.deckLayer.visible = false
    this.remoteHandLayer.visible = false
    this.handLayer.eventMode = 'none'
    this.travelLayer.sortableChildren = true
    this.deckLayer.sortableChildren = true
    this.mulliganLayer.sortableChildren = true
    this.handLayer.sortableChildren = true
  }

  async mount(): Promise<void> {
    const human = this.options.route.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )
    const remote = this.options.route.setup.participants.find(
      (participant) => participant.controllerKind === 'ai'
    )
    if (!human || !remote)
      throw new Error('GameScene requires one human and one AI participant.')

    this.localParticipantId = human.participantId
    this.remoteParticipantId = remote.participantId
    this.match = createOpeningMatch(this.options.route.setup, this.options.decks)
    const initialState = this.match.getState()
    this.localPlayerNumber = this.findPlayer(
      initialState,
      this.localParticipantId
    ).playerNumber
    this.remotePlayerNumber = this.findPlayer(
      initialState,
      this.remoteParticipantId
    ).playerNumber

    this.createBoard()
    this.createHeroes(initialState)
    this.createDecks()
    this.createOpeningLayer(initialState)
    this.createMulliganLayer()

    const localPlayer = this.findPlayer(initialState, this.localParticipantId)
    await this.createInitialLocalCards(localPlayer.hand.map(cloneCard))

    const aiResult = this.match.dispatch({
      type: 'confirm-mulligan',
      participantId: this.remoteParticipantId,
      replaceInstanceIds: []
    })
    if (!aiResult.accepted) throw new Error(aiResult.message)
    this.remoteBackCount = this.findPlayer(
      aiResult.state,
      this.remoteParticipantId
    ).hand.length
    this.ensureRemoteBacks(this.remoteBackCount)

    this.confirmButton = new Button(this.options.gameAssets.confirmMulliganButton, {
      audio: this.options.audio,
      onClick: () => void this.confirmMulligan()
    })
    this.confirmButton.position.set(
      GAME_BOARD_LAYOUT.mulligan.confirmButton.position.x,
      GAME_BOARD_LAYOUT.mulligan.confirmButton.position.y
    )
    this.confirmButton.setBaseY(GAME_BOARD_LAYOUT.mulligan.confirmButton.position.y)
    this.confirmButton.visible = false
    this.confirmButton.setEnabled(false)
    this.mulliganLayer.addChild(this.confirmButton)
  }

  async playOpeningReveal(): Promise<void> {
    if (this.openingRevealStarted) return
    this.openingRevealStarted = true
    await this.wait(OPENING_TIMING.versusHold)
    await Promise.all([
      ...[...this.heroSprites.entries()].map(([participantId, sprite]) =>
        this.animateHeroToBoard(
          sprite,
          participantId === this.localParticipantId
            ? GAME_BOARD_LAYOUT.heroes.local
            : GAME_BOARD_LAYOUT.heroes.remote
        )
      ),
      this.fadeTo(this.openingLayer, 0, OPENING_TIMING.heroSettle)
    ])
    this.openingLayer.visible = false
    this.deckLayer.visible = true
    this.remoteHandLayer.visible = true
    await this.wait(OPENING_TIMING.boardPause)
    await this.presentMulligan()
  }

  private createBoard(): void {
    const table = new Sprite(this.options.gameAssets.table)
    table.eventMode = 'none'
    this.boardLayer.addChild(table)
    const board = new Sprite(this.options.gameAssets.board)
    board.anchor.set(0.5)
    board.position.set(
      GAME_BOARD_LAYOUT.board.position.x,
      GAME_BOARD_LAYOUT.board.position.y
    )
    board.eventMode = 'none'
    this.boardLayer.addChild(board)
  }

  private createHeroes(state: OpeningMatchState): void {
    for (const player of state.players) {
      const texture =
        this.options.heroAssets[
          HERO_CATALOG.require(player.heroId).presentationAssetKey
        ]
      const intro =
        player.participantId === this.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.localIntro
          : GAME_BOARD_LAYOUT.heroes.remoteIntro
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.position.set(intro.position.x, intro.position.y)
      sprite.scale.set(intro.scale ?? 1)
      sprite.eventMode = 'none'
      this.heroSprites.set(player.participantId, sprite)
      this.heroLayer.addChild(sprite)
    }
  }

  private createDecks(): void {
    for (const position of [
      GAME_BOARD_LAYOUT.decks.local,
      GAME_BOARD_LAYOUT.decks.remote
    ] as const) {
      const deck = new Sprite(this.options.gameAssets.deck)
      deck.anchor.set(0.5)
      deck.position.set(position.position.x, position.position.y)
      deck.scale.set(position.scale ?? 1)
      deck.eventMode = 'none'
      this.deckLayer.addChild(deck)
    }
  }

  private createOpeningLayer(state: OpeningMatchState): void {
    this.openingLayer.addChild(this.createDarkOverlay())

    const versus = new Sprite(this.options.gameAssets.startOfGameVs)
    versus.anchor.set(0.5)
    versus.position.set(
      GAME_BOARD_LAYOUT.versus.position.x,
      GAME_BOARD_LAYOUT.versus.position.y
    )
    versus.eventMode = 'none'
    this.openingLayer.addChild(versus)
    for (const player of state.players) {
      const hero = HERO_CATALOG.require(player.heroId)
      const intro =
        player.participantId === this.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.localIntro
          : GAME_BOARD_LAYOUT.heroes.remoteIntro
      const label = new Text({
        text: `${hero.displayName}\n${hero.classId.toUpperCase()}`,
        style: {
          fontFamily: 'Belwe',
          fontSize: 34,
          fill: 0xffffff,
          stroke: { color: 0x17120f, width: 6 },
          align: 'center',
          lineHeight: 42
        }
      })
      label.anchor.set(0.5, 0)
      label.position.set(
        intro.position.x,
        intro.position.y +
          GAME_BOARD_LAYOUT.heroes.introLabelOffset * (intro.scale ?? 1)
      )
      label.eventMode = 'none'
      this.openingLayer.addChild(label)
    }
  }

  private createMulliganLayer(): void {
    const overlay = this.createDarkOverlay()
    overlay.label = 'mulligan-dark-overlay'
    overlay.alpha = 0
    this.mulliganLayer.addChild(overlay)

    const announcement = new Sprite(this.options.gameAssets.mulliganAnnouncement)
    announcement.anchor.set(0.5, 0)
    announcement.position.set(
      GAME_BOARD_LAYOUT.mulligan.announcement.position.x,
      GAME_BOARD_LAYOUT.mulligan.announcement.position.y
    )
    announcement.label = 'mulligan-announcement'
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.mulliganLayer.addChild(announcement)
  }

  private createDarkOverlay(): Graphics {
    const overlay = new Graphics()
    overlay.rect(0, 0, 1920, 1080)
    overlay.fill({ color: 0x000000, alpha: 0.8 })
    overlay.eventMode = 'none'
    return overlay
  }

  private async createInitialLocalCards(cards: readonly OpeningCard[]): Promise<void> {
    const entries = await Promise.all(
      cards.map(async (card) => {
        const slot = await this.createSlot(card)
        slot.alpha = 0
        slot.on('pointertap', (event: FederatedPointerEvent) => {
          if (this.confirmationLocked || event.button !== 0) return
          const selected = !this.selectedIds.has(slot.instanceId)
          if (selected) this.selectedIds.add(slot.instanceId)
          else this.selectedIds.delete(slot.instanceId)
          slot.setSelected(selected)
        })
        this.mulliganLayer.addChild(slot)
        return { card, slot, restTransform: undefined, displaced: false } as const
      })
    )
    for (const entry of entries) {
      this.handEntries.push(entry)
      this.initialSlots.push(entry.slot)
    }
  }

  private async createSlot(card: OpeningCard): Promise<GameCardSlot> {
    const view = await CardView.create(cardDefinition(card), this.resolver, {
      artwork: await this.resolver.loadArtwork(card.cardId)
    })
    return new GameCardSlot(
      view,
      card.instanceId,
      this.options.gameAssets.mulliganReplaceCross,
      this.options.gameAssets.mulliganReplacedLabel
    )
  }

  private findPlayer(state: OpeningMatchState, participantId: string) {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) throw new Error(`Unknown participant ${participantId}`)
    return player
  }

  private ensureRemoteBacks(count: number): void {
    while (this.remoteBacks.length < count) {
      const back = new Sprite(this.options.gameAssets.cardBack)
      back.anchor.set(0.5, 1)
      back.alpha = 0
      back.eventMode = 'none'
      this.remoteBacks.push(back)
      this.remoteHandLayer.addChild(back)
    }
    this.layoutRemoteHand()
  }

  private layoutRemoteHand(): void {
    const midpoint = (this.remoteBackCount - 1) / 2
    this.remoteBacks.forEach((back, index) => {
      const visible = index < this.remoteBackCount
      back.visible = visible
      if (!visible) return
      back.position.set(
        GAME_BOARD_LAYOUT.remoteHand.centerX +
          (index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.gap,
        GAME_BOARD_LAYOUT.remoteHand.baselineY
      )
      back.rotation = -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep
      back.scale.set(GAME_BOARD_LAYOUT.remoteHand.scale)
    })
  }

  private async presentMulligan(): Promise<void> {
    const announcement = this.mulliganLayer.getChildByLabel('mulligan-announcement')
    const overlay = this.mulliganLayer.getChildByLabel('mulligan-dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(overlay, 1, OPENING_TIMING.mulliganFade),
      this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    ])
    const localCommonCount = this.localPlayerNumber === 2 ? 3 : this.initialSlots.length
    const remoteCommonCount = this.remotePlayerNumber === 2 ? 3 : this.remoteBackCount
    await Promise.all([
      this.dealLocalCards(0, localCommonCount),
      this.dealRemoteCards(0, remoteCommonCount)
    ])
    if (this.localPlayerNumber === 2) {
      await this.presentPlayerTwoAnnouncement()
      await this.dealLocalCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    } else {
      await this.dealRemoteCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    }
    this.confirmButton.visible = true
    this.confirmButton.setEnabled(true)
  }

  private async presentPlayerTwoAnnouncement(): Promise<void> {
    const announcement = new Sprite(this.options.gameAssets.mulliganCoinAnnouncement)
    announcement.anchor.set(0.5)
    announcement.position.set(
      GAME_BOARD_LAYOUT.mulligan.coinAnnouncement.position.x,
      GAME_BOARD_LAYOUT.mulligan.coinAnnouncement.position.y
    )
    announcement.scale.set(GAME_BOARD_LAYOUT.mulligan.coinAnnouncement.scale ?? 1)
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.mulliganLayer.addChild(announcement)
    await this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    await this.wait(OPENING_TIMING.playerTwoAnnouncementHold)
    await this.fadeTo(announcement, 0, OPENING_TIMING.playerTwoAnnouncementFade)
    announcement.destroy()
  }

  private async dealLocalCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.initialSlots.slice(start, end).map((slot, offset) => {
        const index = start + offset
        this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
        this.travelLayer.addChild(slot)
        return this.animateSlotToMulligan(
          slot,
          index,
          this.initialSlots.length,
          duration,
          offset
        )
      })
    )
  }

  private async dealRemoteCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.remoteBacks
        .slice(start, Math.min(end, this.remoteBackCount))
        .map((back, offset) => {
          const index = start + offset
          this.prepareBackAtDeck(back, index)
          return this.animateBackToHand(
            back,
            index,
            this.remoteBackCount,
            duration,
            offset
          )
        })
    )
  }

  private async confirmMulligan(): Promise<void> {
    if (this.confirmationLocked) return
    this.confirmationLocked = true
    this.confirmButton.setEnabled(false)
    for (const entry of this.handEntries) entry.slot.eventMode = 'none'
    await this.wait(OPENING_TIMING.confirmationPause)
    const result = this.match.dispatch({
      type: 'confirm-mulligan',
      participantId: this.localParticipantId,
      replaceInstanceIds: [...this.selectedIds]
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.confirmationLocked = false
      this.confirmButton.setEnabled(true)
      return
    }
    this.confirmButton.visible = false
    for (const event of result.events) await this.presentEvent(event)
    await this.wait(OPENING_TIMING.handoffPause)
    await this.fadeTo(this.mulliganLayer, 0, OPENING_TIMING.mulliganFade)
    this.mulliganLayer.visible = false
  }

  private async presentEvent(event: OpeningMatchEvent): Promise<void> {
    switch (event.type) {
      case 'mulligan-resolved':
        if (event.participantId === this.localParticipantId) {
          await this.presentLocalMulligan(event)
        }
        return
      case 'coin-granted':
      case 'opening-card-drawn':
        if (event.participantId === this.localParticipantId) {
          await this.addLocalCard(event.card)
        } else {
          this.remoteBackCount += 1
          this.ensureRemoteBacks(this.remoteBackCount)
          const back = this.remoteBacks[this.remoteBackCount - 1]
          if (back) {
            this.prepareBackAtDeck(back, this.remoteBackCount - 1)
            await this.animateBackToHand(
              back,
              this.remoteBackCount - 1,
              this.remoteBackCount,
              OPENING_TIMING.cardDeal
            )
          }
        }
        await this.wait(OPENING_TIMING.replacementPause)
        return
      case 'opening-turn-started':
        return
    }
  }

  private async presentLocalMulligan(event: MulliganResolvedEvent): Promise<void> {
    const returnedSlots = event.returnedCards
      .map((card) => this.findEntry(card.instanceId)?.slot)
      .filter((slot): slot is GameCardSlot => slot !== undefined)
    await Promise.all(
      returnedSlots.map((slot, index) =>
        this.animateSlotToDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
      )
    )
    for (const slot of returnedSlots) {
      const entryIndex = this.handEntries.findIndex((entry) => entry.slot === slot)
      if (entryIndex >= 0) this.handEntries.splice(entryIndex, 1)
      slot.destroy({ children: true })
    }
    await this.wait(OPENING_TIMING.replacementPause)

    const replacementSlots: GameCardSlot[] = []
    for (const card of event.replacementCards) {
      const slot = await this.createSlot(card)
      this.handEntries.push({
        card: cloneCard(card),
        slot,
        restTransform: undefined,
        displaced: false
      })
      replacementSlots.push(slot)
    }
    const allSlots = this.handEntries.map((entry) => entry.slot)
    allSlots.forEach((slot, index) => {
      slot.setSelected(false)
      slot.eventMode = 'none'
      if (!replacementSlots.includes(slot)) return
      this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
      this.travelLayer.addChild(slot)
    })
    await Promise.all(
      allSlots.map((slot, index) =>
        this.animateSlotToMulligan(
          slot,
          index,
          allSlots.length,
          OPENING_TIMING.cardDeal
        )
      )
    )
    this.reflowing = true
    for (const slot of allSlots) {
      if (slot.parent !== this.handLayer) this.handLayer.addChild(slot)
      this.configureHandSlot(slot)
    }
    this.localHoveredSlot = null
    await this.applyHandLayout({
      positionDuration: OPENING_TIMING.cardDeal,
      scaleDuration: OPENING_TIMING.cardDeal
    })
    this.reflowing = false
    this.activateHandHover()
    await this.dismissMulliganPresentation()
  }

  private async dismissMulliganPresentation(): Promise<void> {
    const announcement = this.mulliganLayer.getChildByLabel('mulligan-announcement')
    const overlay = this.mulliganLayer.getChildByLabel('mulligan-dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(announcement, 0, OPENING_TIMING.mulliganFade),
      this.fadeTo(overlay, 0, OPENING_TIMING.mulliganFade)
    ])
  }

  private async addLocalCard(card: OpeningCard): Promise<void> {
    if (this.findEntry(card.instanceId)) return
    const slot = await this.createSlot(card)
    this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, this.handEntries.length)
    this.travelLayer.addChild(slot)
    this.handEntries.push({
      card: cloneCard(card),
      slot,
      restTransform: undefined,
      displaced: false
    })
    this.localHoveredSlot = null
    this.reflowing = true
    await this.applyHandLayout({
      positionDuration: OPENING_TIMING.cardDeal,
      scaleDuration: OPENING_TIMING.cardDeal,
      delayedInstanceId: card.instanceId
    })
    this.reflowing = false
    this.handLayer.addChild(slot)
    this.configureHandSlot(slot)
  }

  private prepareSlotAtDeck(
    slot: GameCardSlot,
    deck: LayoutPlacement,
    sequence: number
  ): void {
    slot.eventMode = 'none'
    slot.position.set(deck.position.x, deck.position.y)
    slot.scale.set(
      GAME_BOARD_LAYOUT.cardTravel.slotScale.x,
      GAME_BOARD_LAYOUT.cardTravel.slotScale.y
    )
    slot.skew.set(sequence % 2 === 0 ? 0.3 : -0.3, -0.06)
    slot.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    slot.alpha = 1
  }

  private prepareBackAtDeck(back: Sprite, sequence: number): void {
    back.position.set(
      GAME_BOARD_LAYOUT.decks.remote.position.x,
      GAME_BOARD_LAYOUT.decks.remote.position.y
    )
    back.scale.set(
      GAME_BOARD_LAYOUT.cardTravel.backScale.x,
      GAME_BOARD_LAYOUT.cardTravel.backScale.y
    )
    back.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    back.alpha = 1
    back.visible = true
  }

  private animateSlotToMulligan(
    slot: GameCardSlot,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const x =
      GAME_BOARD_LAYOUT.mulligan.cards.centerX +
      (index - midpoint) * GAME_BOARD_LAYOUT.mulligan.cards.gap
    const timeline = this.timeline()
    timeline.to(slot, {
      x,
      y: GAME_BOARD_LAYOUT.mulligan.cards.baselineY,
      rotation: 0,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: GAME_BOARD_LAYOUT.mulligan.cards.scale,
        y: GAME_BOARD_LAYOUT.mulligan.cards.scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    return this.completeTimeline(timeline, () => {
      this.mulliganLayer.addChild(slot)
      slot.eventMode = 'static'
    })
  }

  private animateBackToHand(
    back: Sprite,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const x =
      GAME_BOARD_LAYOUT.remoteHand.centerX +
      (index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.gap
    const timeline = this.timeline()
    timeline.to(back, {
      x,
      y: GAME_BOARD_LAYOUT.remoteHand.baselineY,
      rotation: -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      back.scale,
      {
        x: GAME_BOARD_LAYOUT.remoteHand.scale,
        y: GAME_BOARD_LAYOUT.remoteHand.scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    return this.completeTimeline(timeline)
  }

  private findEntry(instanceId: string): HandEntry | undefined {
    return this.handEntries.find((entry) => entry.card.instanceId === instanceId)
  }

  /**
   * Activates a single fixed hit zone on handLayer covering the bottom of the
   * screen. Pointer position is mapped to the nearest card by x — no per-card
   * hit areas that move with the card, eliminating hover oscillation.
   *
   * Why a single hit zone instead of per-card hit areas: when a card lifts and
   * scales on hover, its hit area moves with it. That causes the pointer to
   * exit the card's hit area, drop the hover, re-enter at the rest position,
   * re-hover — infinite oscillation (the "dancing" bug). A fixed hit zone on
   * the layer decouples "which card is hovered" (pointer x vs. rest x) from
   * "where the card is drawn" (animated). The card can move freely; the hover
   * target is recomputed from the pointer position alone.
   *
   * `pointermove` early-returns when the nearest card hasn't changed, so
   * moving the mouse within a single card's zone does not create redundant
   * tweens. `pointerleave` clears hover when the cursor exits the hit zone
   * (e.g. moves to the board or off-screen).
   */
  private activateHandHover(): void {
    if (this.handModeActive) return
    this.handModeActive = true
    this.handLayer.eventMode = 'static'
    this.handLayer.hitArea = new Rectangle(0, 850, 1920, 230)
    this.handLayer.on('pointermove', (event: FederatedPointerEvent) => {
      if (!this.handModeActive || this.reflowing) return
      const local = event.getLocalPosition(this.handLayer)
      const nearest = this.findNearestHandEntry(local.x)?.slot ?? null
      if (nearest === this.localHoveredSlot) return
      this.localHoveredSlot = nearest
      this.applyHoverDelta()
    })
    this.handLayer.on('pointerleave', () => {
      if (!this.handModeActive) return
      this.localHoveredSlot = null
      this.applyHoverDelta()
    })
  }

  /**
   * Returns the hand entry whose rest x is nearest to `x`, or `undefined` if
   * the nearest card is farther than half a card step. The threshold prevents
   * the edge cards from staying hovered when the pointer moves past the hand
   * toward the screen edges.
   */
  private findNearestHandEntry(x: number): HandEntry | undefined {
    const threshold = DEFAULT_HAND_LAYOUT.maxCardStep / 2
    let nearest: HandEntry | undefined
    let nearestDistance = Infinity
    for (const entry of this.handEntries) {
      if (!entry.restTransform) continue
      const distance = Math.abs(entry.restTransform.x - x)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = entry
      }
    }
    return nearestDistance <= threshold ? nearest : undefined
  }

  /**
   * Recomputes the rest layout for every card and animates each slot to its
   * rest transform. Called only for structural changes (deal, mulligan
   * resolve, draw) — never for hover. Stores `restTransform` on each entry so
   * `applyHoverDelta` can compute hover targets without re-running `layoutHand`.
   * Clears `displaced` on every entry since the structural animation overwrites
   * any in-flight hover state. Hover is blocked by the `reflowing` flag during
   * this call.
   */
  private async applyHandLayout(opts: {
    readonly positionDuration: number
    readonly scaleDuration: number
    readonly delayedInstanceId?: string
  }): Promise<void> {
    const transforms = layoutHand(this.handEntries.length, DEFAULT_HAND_LAYOUT, null)
    await Promise.all(
      this.handEntries.map((entry, index) => {
        const transform = transforms[index]
        if (!transform) return Promise.resolve()
        entry.restTransform = transform
        entry.displaced = false
        const delay =
          opts.delayedInstanceId !== undefined &&
          entry.card.instanceId === opts.delayedInstanceId
            ? 0.05
            : 0
        return this.animateSlotToHand(
          entry.slot,
          transform,
          delay,
          opts.positionDuration,
          opts.scaleDuration
        )
      })
    )
  }

  /**
   * Animates only the hovered card (lift, scale, straighten, front). All other
   * cards stay frozen at their rest positions. This mirrors Hearthstone: a
   * hover change touches at most 2 cards (old hover returns to rest, new hover
   * lifts), never the full hand.
   */
  private applyHoverDelta(): void {
    const hoveredIndex = this.localHoveredSlot
      ? this.handEntries.findIndex((entry) => entry.slot === this.localHoveredSlot)
      : -1

    this.handEntries.forEach((entry, index) => {
      if (!entry.restTransform) return
      const shouldDisplace = hoveredIndex >= 0 && index === hoveredIndex
      if (!shouldDisplace && !entry.displaced) return
      const target = this.computeHoverTarget(entry.restTransform, index, hoveredIndex)
      this.animateHoverTarget(entry.slot, target)
      entry.displaced = shouldDisplace
    })
  }

  /**
   * Pure transform computation for hover. The hovered card lifts by
   * `hoverLift`, scales to `hoverScale`, straightens its rotation, and jumps to
   * the front (zIndex 1000). All other cards return their rest transform
   * unchanged — neighbors do NOT shift, matching Hearthstone where only the
   * hovered card moves and the rest of the hand stays still.
   */
  private computeHoverTarget(
    rest: HandCardTransform,
    index: number,
    hoveredIndex: number
  ): HandCardTransform {
    if (hoveredIndex < 0 || index !== hoveredIndex) return rest
    return {
      x: rest.x,
      y: rest.y - DEFAULT_HAND_LAYOUT.hoverLift,
      rotation: 0,
      scale: DEFAULT_HAND_LAYOUT.hoverScale,
      zIndex: 1000
    }
  }

  /**
   * Fire-and-forget hover tween. Uses `overwrite: 'auto'` so GSAP cleanly hands
   * off the slot's properties from the previous hover tween to the new one
   * without snapping. No `killTweensOf` — the overwrite mode handles it per
   * property. `zIndex` is set immediately (not tweened) so the hovered card
   * jumps to the front instantly.
   */
  private animateHoverTarget(slot: GameCardSlot, target: HandCardTransform): void {
    this.tweenTo(slot, {
      x: target.x,
      y: target.y,
      rotation: target.rotation,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    this.tweenTo(slot.scale, {
      x: target.scale,
      y: target.scale,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    slot.zIndex = target.zIndex
  }

  private animateSlotToDeck(
    slot: GameCardSlot,
    deck: LayoutPlacement,
    sequence: number
  ): Promise<void> {
    this.travelLayer.addChild(slot)
    slot.eventMode = 'none'
    const direction = slot.x < deck.position.x ? -1 : 1
    const timeline = this.timeline()
    timeline.to(slot, {
      x: deck.position.x,
      y: deck.position.y,
      alpha: 0,
      rotation: direction * (0.16 + sequence * 0.015),
      duration: OPENING_TIMING.cardDeal,
      ease: 'power2.in'
    })
    timeline.to(
      slot.scale,
      {
        x: GAME_BOARD_LAYOUT.cardTravel.slotScale.x,
        y: GAME_BOARD_LAYOUT.cardTravel.slotScale.y,
        duration: OPENING_TIMING.cardDeal,
        ease: 'power2.in'
      },
      0
    )
    return this.completeTimeline(timeline)
  }

  private animateHeroToBoard(sprite: Sprite, target: LayoutPlacement): Promise<void> {
    const timeline = this.timeline()
    timeline.to(sprite, {
      x: target.position.x,
      y: target.position.y,
      duration: OPENING_TIMING.heroSettle,
      ease: 'power2.inOut'
    })
    timeline.to(
      sprite.scale,
      {
        x: target.scale ?? 1,
        y: target.scale ?? 1,
        duration: OPENING_TIMING.heroSettle,
        ease: 'power2.inOut'
      },
      0
    )
    return this.completeTimeline(timeline)
  }

  private animateSlotToHand(
    slot: GameCardSlot,
    transform: HandCardTransform,
    delay: number,
    positionDuration: number,
    scaleDuration: number
  ): Promise<void> {
    gsap.killTweensOf(slot)
    gsap.killTweensOf(slot.scale)
    gsap.killTweensOf(slot.skew)

    const timeline = this.timeline()
    timeline.to(slot, {
      x: transform.x,
      y: transform.y,
      rotation: transform.rotation,
      alpha: 1,
      duration: positionDuration,
      delay,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: transform.scale,
        y: transform.scale,
        duration: scaleDuration,
        delay,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration: positionDuration,
        delay,
        ease: 'power2.out'
      },
      0
    )
    slot.zIndex = transform.zIndex
    return this.completeTimeline(timeline)
  }

  /**
   * Strips a slot's mulligan-era interaction and disables its own pointer
   * events. In hand mode, hover is driven by a single pointermove listener on
   * handLayer (see `activateHandHover`), so individual slots must not receive
   * pointer events — a moving hit area on the animated slot causes oscillation.
   */
  private configureHandSlot(slot: GameCardSlot): void {
    slot.eventMode = 'none'
    slot.removeAllListeners('pointertap')
    slot.removeAllListeners('pointerover')
    slot.removeAllListeners('pointerout')
  }

  private fadeTo(
    target: { alpha: number },
    alpha: number,
    duration: number
  ): Promise<void> {
    return this.completeTimeline(
      this.timeline().to(target, { alpha, duration, ease: 'power2.out' })
    )
  }

  private wait(duration: number): Promise<void> {
    return this.completeTimeline(this.timeline().to({}, { duration }))
  }

  private completeTimeline(
    timeline: gsap.core.Timeline,
    onComplete?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      timeline.eventCallback('onComplete', () => {
        onComplete?.()
        resolve()
      })
      timeline.eventCallback('onInterrupt', resolve)
    })
  }
}
